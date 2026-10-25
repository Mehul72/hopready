import { z } from 'zod';

import { haversineMetres, isWithinGreaterSydney, type Coordinate } from '../geo';
import { coordinateSchema } from '../model';
import {
  ProviderError,
  type DriveEstimate,
  type DriveRoute,
  type DriveTime,
  type DrivingProvider,
} from '../providers';
import { DEMO_PROVIDER_NAME, throwIfAborted } from './abort';
import { valueAt, type DayCurve } from './curves';
import { isWeekend, serviceDayAt, sydneyMinuteOfDay } from './service-calendar';

// A traffic-aware drive estimate without a map: straight-line distance times a road factor, at
// speeds that rise with trip length (local streets first, then arterials and motorways), slowed by
// a time-of-day traffic curve. Plausible for Sydney, never a real route.

// Roads are longer than the straight line between two points; 1.35 matches the planner's own
// rough estimate, so demo drives and the planner's shortlist agree.
const ROAD_DISTANCE_FACTOR = 1.35;
const SPEED_BANDS: readonly { untilMetres: number; kilometresPerHour: number }[] = [
  { untilMetres: 2_000, kilometresPerHour: 28 },
  { untilMetres: 8_000, kilometresPerHour: 38 },
  { untilMetres: 20_000, kilometresPerHour: 48 },
  { untilMetres: Number.POSITIVE_INFINITY, kilometresPerHour: 60 },
];
// Getting out of a driveway and finding the way in, on top of the moving time.
const START_AND_FINISH_SECONDS = 60;
const SAME_PLACE_METRES = 1;
const PATH_POINT_SPACING_METRES = 1_000;
const MAX_PATH_SEGMENTS = 24;
const SECONDS_PER_HOUR = 3_600;
const METRES_PER_KILOMETRE = 1_000;
const MS_PER_SECOND = 1_000;
const ARRIVE_BY_ITERATIONS = 3;

// Multipliers on free-flow time. Weekday peaks are 7 am to 9.30 am and 4 pm to 6.30 pm, with
// half-hour ramps either side; nights are a little faster than the free-flow speeds.
const WEEKDAY_TRAFFIC: DayCurve = [
  [0, 0.9],
  [300, 0.9],
  [360, 1],
  [390, 1.05],
  [420, 1.45],
  [570, 1.45],
  [600, 1.1],
  [930, 1.1],
  [960, 1.35],
  [1110, 1.35],
  [1140, 1.05],
  [1320, 1],
  [1380, 0.9],
  [1440, 0.9],
];
const WEEKEND_TRAFFIC: DayCurve = [
  [0, 0.9],
  [360, 0.9],
  [420, 1],
  [600, 1.1],
  [1080, 1.1],
  [1200, 1],
  [1380, 0.9],
  [1440, 0.9],
];

const driveTimeSchema = z.object({
  type: z.enum(['depart', 'arrive']),
  at: z.iso.datetime({ offset: true }),
});
const destinationsSchema = z.array(coordinateSchema).max(100);

export function createDemoDrivingProvider(): DrivingProvider {
  return {
    name: DEMO_PROVIDER_NAME,
    async estimateDrives(origin, destinations, time, signal) {
      throwIfAborted(signal);
      const from = validCoordinate(origin);
      const to = valid(destinationsSchema, destinations, 'destinations');
      const when = valid(driveTimeSchema, time, 'drive time');
      return to.map((destination) =>
        isDrivable(from, destination) ? estimateDrive(from, destination, when) : null,
      );
    },
    async routeDrive(from, to, time, signal) {
      throwIfAborted(signal);
      const start = validCoordinate(from);
      const end = validCoordinate(to);
      const when = valid(driveTimeSchema, time, 'drive time');
      if (!isDrivable(start, end)) {
        throw new ProviderError(
          DEMO_PROVIDER_NAME,
          'rejected-request',
          'The demo drive model only covers Greater Sydney',
        );
      }
      const route: DriveRoute = {
        ...estimateDrive(start, end, when),
        path: straightPath(start, end),
      };
      return route;
    },
  };
}

function validCoordinate(coordinate: Coordinate): Coordinate {
  return valid(coordinateSchema, coordinate, 'coordinate');
}

function valid<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ProviderError(
      DEMO_PROVIDER_NAME,
      'rejected-request',
      `The demo ${what} is not valid`,
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

function isDrivable(from: Coordinate, to: Coordinate): boolean {
  return isWithinGreaterSydney(from) && isWithinGreaterSydney(to);
}

function estimateDrive(from: Coordinate, to: Coordinate, time: DriveTime): DriveEstimate {
  const roadMetres = haversineMetres(from, to) * ROAD_DISTANCE_FACTOR;
  if (roadMetres < SAME_PLACE_METRES) {
    return { durationSeconds: 0, distanceMetres: 0, trafficAware: true };
  }
  const freeFlowSeconds = freeFlowSecondsFor(roadMetres);
  const atMs = Date.parse(time.at);
  const durationSeconds =
    time.type === 'depart'
      ? departingDuration(freeFlowSeconds, atMs)
      : arrivingDuration(freeFlowSeconds, atMs);
  return {
    durationSeconds: Math.round(durationSeconds),
    distanceMetres: Math.round(roadMetres),
    trafficAware: true,
  };
}

function freeFlowSecondsFor(roadMetres: number): number {
  let seconds = 0;
  let coveredMetres = 0;
  for (const band of SPEED_BANDS) {
    const bandMetres = Math.min(roadMetres, band.untilMetres) - coveredMetres;
    if (bandMetres <= 0) break;
    seconds += (bandMetres / METRES_PER_KILOMETRE / band.kilometresPerHour) * SECONDS_PER_HOUR;
    coveredMetres += bandMetres;
  }
  return seconds;
}

// Traffic is read at the middle of the drive, which needs a first guess at the drive's length.
function departingDuration(freeFlowSeconds: number, departAtMs: number): number {
  const firstGuess = freeFlowSeconds * trafficMultiplier(departAtMs);
  const middleMs = departAtMs + (firstGuess / 2) * MS_PER_SECOND;
  return freeFlowSeconds * trafficMultiplier(middleMs) + START_AND_FINISH_SECONDS;
}

function arrivingDuration(freeFlowSeconds: number, arriveAtMs: number): number {
  let movingSeconds = freeFlowSeconds * trafficMultiplier(arriveAtMs);
  for (let iteration = 0; iteration < ARRIVE_BY_ITERATIONS; iteration++) {
    const middleMs = arriveAtMs - (movingSeconds / 2) * MS_PER_SECOND;
    movingSeconds = freeFlowSeconds * trafficMultiplier(middleMs);
  }
  return movingSeconds + START_AND_FINISH_SECONDS;
}

function trafficMultiplier(atMs: number): number {
  const instant = new Date(atMs);
  const curve = isWeekend(serviceDayAt(instant)) ? WEEKEND_TRAFFIC : WEEKDAY_TRAFFIC;
  return valueAt(curve, sydneyMinuteOfDay(instant));
}

// A straight line with a point every kilometre. The map shows it as an approximate route. The ends
// are copied rather than computed so they match the places exactly.
function straightPath(from: Coordinate, to: Coordinate): Coordinate[] {
  const segments = Math.min(
    MAX_PATH_SEGMENTS,
    Math.max(1, Math.round(haversineMetres(from, to) / PATH_POINT_SPACING_METRES)),
  );
  const between = Array.from({ length: segments - 1 }, (_, index) => ({
    lat: from.lat + ((to.lat - from.lat) * (index + 1)) / segments,
    lon: from.lon + ((to.lon - from.lon) * (index + 1)) / segments,
  }));
  return [{ ...from }, ...between, { ...to }];
}
