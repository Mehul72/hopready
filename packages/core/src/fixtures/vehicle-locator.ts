import { bearingDegrees, type Coordinate } from '../geo';
import type { Clock, VehicleLocator } from '../providers';
import { toIso } from '../time';
import { isTrackedVehicleMode, type TrackedService, type VehicleLookup } from '../vehicles';
import { DEMO_PROVIDER_NAME, throwIfAborted } from './abort';
import { scenarioSettings, type DemoScenario } from './scenarios';
import { timetableWindowAround, type ScheduledTrip, type TimetableWindow } from './timetable';

export interface DemoVehicleOptions {
  clock: Clock;
  scenario: DemoScenario;
}

// Demo legs carry this prefix and the trip's key as their realtime trip id (journey-legs.ts).
const DEMO_TRIP_ID_PREFIX = 'demo-';
// A demo vehicle waits at its first stop this long before it leaves, so a service about to start
// can be seen there, like the buses the live feed lists before their trip begins.
const WAITS_AT_FIRST_STOP_MS = 10 * 60_000;

const tripsByKeyCache = new WeakMap<TimetableWindow, Map<string, ScheduledTrip>>();

function tripsByKey(window: TimetableWindow): Map<string, ScheduledTrip> {
  const cached = tripsByKeyCache.get(window);
  if (cached) return cached;
  const byKey = new Map(window.trips.map((trip) => [trip.key, trip]));
  tripsByKeyCache.set(window, byKey);
  return byKey;
}

// Positions from the demo timetable: a vehicle is where its timetable puts it, moving in a straight
// line between stops. Answers are labelled as samples by the app, never shown as live.
export function createDemoVehicleLocator(options: DemoVehicleOptions): VehicleLocator {
  const settings = scenarioSettings(options.scenario).timetable;
  // The scenarios that make the demo trip planner fail make the demo vehicle feed unreadable too.
  const feedsDown = options.scenario === 'provider-timeout' || options.scenario === 'rate-limited';

  return {
    name: DEMO_PROVIDER_NAME,
    async locate(services, signal) {
      throwIfAborted(signal);
      const nowMs = options.clock.now().getTime();
      const trips = tripsByKey(timetableWindowAround(nowMs, settings));
      return services.map((service) => {
        if (!isTrackedVehicleMode(service.mode)) return { ...service, status: 'not-tracked' };
        if (feedsDown) return { ...service, status: 'unavailable' };
        return lookUp(service, trips, nowMs);
      });
    },
  };
}

function lookUp(
  service: TrackedService,
  trips: ReadonlyMap<string, ScheduledTrip>,
  nowMs: number,
): VehicleLookup {
  const notLocated: VehicleLookup = { ...service, status: 'not-located' };
  if (!service.realtimeTripId.startsWith(DEMO_TRIP_ID_PREFIX)) return notLocated;
  const trip = trips.get(service.realtimeTripId.slice(DEMO_TRIP_ID_PREFIX.length));
  if (!trip || trip.cancelled || trip.route.mode !== service.mode) return notLocated;

  const stops = trip.direction.calls.map((call) => call.stop.coordinate);
  const times = trip.timesMs;
  const firstMs = times[0];
  const lastMs = times.at(-1);
  if (firstMs === undefined || lastMs === undefined || stops.length < 2) return notLocated;
  if (nowMs < firstMs - WAITS_AT_FIRST_STOP_MS || nowMs >= lastMs) return notLocated;

  // The stop it last called at, or the first stop while it waits there.
  let segment = 0;
  for (let index = 1; index < times.length - 1; index++) {
    if (times[index]! <= nowMs) segment = index;
  }
  const from = stops[segment]!;
  const to = stops[Math.min(segment + 1, stops.length - 1)]!;
  const segmentStartMs = times[segment]!;
  const segmentEndMs = times[segment + 1] ?? segmentStartMs;
  const share =
    nowMs <= segmentStartMs || segmentEndMs <= segmentStartMs
      ? 0
      : (nowMs - segmentStartMs) / (segmentEndMs - segmentStartMs);

  return {
    ...service,
    status: 'located',
    position: between(from, to, share),
    bearingDegrees: bearingDegrees(from, to),
    observedAt: toIso(new Date(nowMs)),
    servingTrip: 'this-trip',
  };
}

function between(from: Coordinate, to: Coordinate, share: number): Coordinate {
  return {
    lat: from.lat + (to.lat - from.lat) * share,
    lon: from.lon + (to.lon - from.lon) * share,
  };
}
