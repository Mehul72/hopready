import { z } from 'zod';

import { PARK_AND_RIDE_CATALOGUE, type CataloguedCarPark } from '../data/park-and-ride';
import { stableId } from '../itinerary';
import type { Occupancy } from '../model';
import {
  ProviderError,
  type CarParkFacility,
  type CarParkProvider,
  type Clock,
} from '../providers';
import { DEMO_PROVIDER_NAME, throwIfAborted } from './abort';
import { valueAt, type DayCurve } from './curves';
import type { DemoScenario } from './scenarios';
import { isWeekend, serviceDayAt, sydneyMinuteOfDay } from './service-calendar';

// Demo car parks are the documented Park&Ride facilities. Their counts are made up: they follow a
// typical commuter day (filling through the morning peak, emptying in the evening) and differ a
// little between car parks so the app shows a mix of busy and full.

export interface DemoCarParkOptions {
  clock: Clock;
  scenario: DemoScenario;
}

// Tallawong P3 deliberately reports no count, so the app's "unknown" state can be seen.
const UNCOUNTED_FACILITY_ID = '28';

const MS_PER_SECOND = 1_000;
const FRESH_MIN_AGE_SECONDS = 60;
const FRESH_AGE_SPREAD_SECONDS = 121;
const STALE_MIN_AGE_SECONDS = 3 * 60 * 60;
const STALE_AGE_SPREAD_SECONDS = 2 * 60 * 60;
// Car parks fill up to 25 minutes earlier or later than the typical curve.
const FILL_SHIFT_SPREAD_MINUTES = 51;
const FILL_SHIFT_CENTRE_MINUTES = 25;
const MINUTES_PER_DAY = 1_440;

// Share of spaces taken through the day.
const WEEKDAY_FILL: DayCurve = [
  [0, 0.04],
  [300, 0.05],
  [360, 0.2],
  [420, 0.6],
  [480, 0.93],
  [540, 1],
  [900, 0.98],
  [960, 0.86],
  [1080, 0.45],
  [1200, 0.15],
  [1440, 0.04],
];
const WEEKEND_FILL: DayCurve = [
  [0, 0.03],
  [420, 0.05],
  [600, 0.3],
  [900, 0.35],
  [1080, 0.15],
  [1440, 0.03],
];

const facilityIdsSchema = z.array(z.string().max(64)).max(200);

export function createDemoCarParkProvider(options: DemoCarParkOptions): CarParkProvider {
  return {
    name: DEMO_PROVIDER_NAME,
    async listFacilities(signal) {
      throwIfAborted(signal);
      return PARK_AND_RIDE_CATALOGUE.map(facilityFrom);
    },
    async occupancy(facilityIds, signal) {
      throwIfAborted(signal);
      const parsed = facilityIdsSchema.safeParse(facilityIds);
      if (!parsed.success) {
        throw new ProviderError(
          DEMO_PROVIDER_NAME,
          'rejected-request',
          'The demo facility ids are not valid',
          {
            cause: parsed.error,
          },
        );
      }
      const nowMs = options.clock.now().getTime();
      const counts = new Map<string, Occupancy>();
      for (const id of new Set(parsed.data)) {
        const carPark = PARK_AND_RIDE_CATALOGUE.find((entry) => entry.facilityId === id);
        if (carPark) counts.set(id, occupancyOf(carPark, nowMs, options.scenario));
      }
      return counts;
    },
  };
}

function facilityFrom(carPark: CataloguedCarPark): CarParkFacility {
  const { station } = carPark;
  return {
    id: carPark.facilityId,
    name: carPark.name,
    coordinate: { ...(carPark.entrance ?? station.coordinate) },
    kind: 'transport-park-and-ride',
    stationName: station.name,
    totalSpaces: carPark.documentedSpaces,
    rules: { ...carPark.rules },
    station: {
      name: station.name,
      coordinate: { ...station.coordinate },
      kind: 'stop',
      stopId: station.stopId,
    },
  };
}

function occupancyOf(carPark: CataloguedCarPark, nowMs: number, scenario: DemoScenario): Occupancy {
  if (carPark.facilityId === UNCOUNTED_FACILITY_ID) {
    return { status: 'unknown', reason: 'This car park is not reporting a space count.' };
  }
  const variation = Number.parseInt(stableId([carPark.facilityId]), 16);
  const ageSeconds =
    scenario === 'stale-occupancy'
      ? STALE_MIN_AGE_SECONDS + (variation % STALE_AGE_SPREAD_SECONDS)
      : FRESH_MIN_AGE_SECONDS + (variation % FRESH_AGE_SPREAD_SECONDS);
  const observedAt = new Date(nowMs - ageSeconds * MS_PER_SECOND);
  const fillShiftMinutes = (variation % FILL_SHIFT_SPREAD_MINUTES) - FILL_SHIFT_CENTRE_MINUTES;
  const takenShare = occupiedShare(observedAt, fillShiftMinutes);
  const totalSpaces = carPark.documentedSpaces;
  return {
    status: 'known',
    spacesAvailable: Math.max(0, Math.round(totalSpaces * (1 - takenShare))),
    totalSpaces,
    observedAt: observedAt.toISOString(),
  };
}

// A car park that fills earlier is further along the curve at the same clock time.
function occupiedShare(observedAt: Date, fillShiftMinutes: number): number {
  const curve = isWeekend(serviceDayAt(observedAt)) ? WEEKEND_FILL : WEEKDAY_FILL;
  const minute =
    (sydneyMinuteOfDay(observedAt) - fillShiftMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return Math.min(1, Math.max(0, valueAt(curve, minute)));
}
