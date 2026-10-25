import { z } from 'zod';

import { haversineMetres } from '../geo';
import {
  placeSchema,
  transitModeSchema,
  WALKING_SPEEDS,
  type Place,
  type ServiceAlert,
} from '../model';
import {
  ProviderError,
  type Clock,
  type TransitJourney,
  type TransitProvider,
  type TransitQuery,
} from '../providers';
import { DEMO_PROVIDER_NAME, throwIfAborted, waitUntilAborted } from './abort';
import { journeyFromPlan } from './journey-legs';
import {
  searchJourneys,
  type JourneyPlan,
  type JourneySearch,
  type StopWalk,
} from './journey-search';
import { scenarioSettings, type DemoScenario, type ScenarioSettings } from './scenarios';
import { NETWORK_STOPS, WALKING_LINKS } from './stops';
import {
  startsInMorningCancellationWindow,
  stopIndexOf,
  timetableWindowAround,
  type ScheduledTrip,
} from './timetable';
import {
  maxStraightLineMetres,
  NO_WALK,
  walkBetween,
  type Walk,
  type WalkingSpeed,
} from './walking';

export interface DemoTransitOptions {
  clock: Clock;
  scenario: DemoScenario;
}

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
// The provider-timeout scenario waits for the caller's signal; this bound stops a caller without
// a deadline from waiting forever.
const HANG_CEILING_MS = 30_000;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 30;
// Searches look this far past the requested time, enough to reach the first services of the morning.
const SEARCH_HORIZON_MS = 12 * 60 * MS_PER_MINUTE;
const MAX_JOURNEYS_PER_QUERY = 10;

const MORNING_CANCELLATION_ALERT: ServiceAlert = {
  id: 'demo-m1-morning-cancellations',
  severity: 'warning',
  title: 'Some morning M1 services are cancelled',
  detail:
    'Demo scenario: every second M1 service that starts between 6.30 am and 9.30 am is cancelled. Allow time for the next one.',
};

const transitQuerySchema = z.object({
  from: placeSchema,
  to: placeSchema,
  time: z.object({ type: z.enum(['depart', 'arrive']), at: z.iso.datetime({ offset: true }) }),
  maxJourneys: z.number().int().min(1).max(MAX_JOURNEYS_PER_QUERY),
  maxWalkMinutes: z.number().int().min(0).max(120),
  walkingSpeed: z.enum(WALKING_SPEEDS),
  excludedModes: z.array(transitModeSchema),
});

export function createDemoTransitProvider(options: DemoTransitOptions): TransitProvider {
  const settings = scenarioSettings(options.scenario);

  return {
    name: DEMO_PROVIDER_NAME,
    async planJourneys(query, signal) {
      throwIfAborted(signal);
      if (options.scenario === 'provider-timeout') return waitUntilAborted(signal, HANG_CEILING_MS);
      if (options.scenario === 'rate-limited') {
        throw new ProviderError(
          DEMO_PROVIDER_NAME,
          'rate-limited',
          'demo-fixture is limiting requests (rate-limited demo scenario)',
          { retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS },
        );
      }
      const valid = validQuery(query);
      if (options.scenario === 'no-route') return [];
      return planDemoJourneys(valid, settings, options.clock.now().getTime());
    },
  };
}

function validQuery(query: TransitQuery): TransitQuery {
  const parsed = transitQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ProviderError(
      DEMO_PROVIDER_NAME,
      'rejected-request',
      'The demo transit query is not valid',
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

function planDemoJourneys(
  query: TransitQuery,
  settings: ScenarioSettings,
  nowMs: number,
): TransitJourney[] {
  const atMs = Date.parse(query.time.at);
  const directWalk = walkBetween(query.from.coordinate, query.to.coordinate, query.walkingSpeed);
  // Already there: no public transport journey makes sense.
  if (directWalk.durationSeconds === 0) return [];

  const access = stopsWithinWalk(query.from, query.maxWalkMinutes, query.walkingSpeed);
  const egress = stopsWithinWalk(query.to, query.maxWalkMinutes, query.walkingSpeed);
  if (access.length === 0 || egress.length === 0) return [];

  const window = timetableWindowAround(atMs, settings.timetable);
  const excludedModes = new Set(query.excludedModes);
  const search: JourneySearch = {
    window,
    stopCount: NETWORK_STOPS.length,
    access,
    egress,
    transfers: walkingTransfers(query.maxWalkMinutes, query.walkingSpeed),
    minimumChangeMs: settings.minimumChangeMinutes * MS_PER_MINUTE,
    isTripAllowed: (trip) => !excludedModes.has(trip.route.mode),
    horizonMs: SEARCH_HORIZON_MS,
  };

  const plans = searchJourneys(search, { type: query.time.type, atMs }, query.maxJourneys);
  const walkable = directWalk.durationSeconds <= query.maxWalkMinutes * SECONDS_PER_MINUTE;
  const alertsFor = (trip: ScheduledTrip) =>
    settings.timetable.cancelMorningMetro &&
    startsInMorningCancellationWindow(trip.route, trip.departureMinute)
      ? [{ ...MORNING_CANCELLATION_ALERT }]
      : [];

  return plans
    .filter((plan) => !walkable || beatsWalking(plan, query, atMs, directWalk))
    .map((plan) =>
      journeyFromPlan(plan, {
        window,
        origin: query.from,
        destination: query.to,
        nowMs,
        alertsFor,
      }),
    );
}

// A ride that gets there no sooner than walking the whole way is not worth offering.
function beatsWalking(plan: JourneyPlan, query: TransitQuery, atMs: number, directWalk: Walk) {
  const walkMs = directWalk.durationSeconds * MS_PER_SECOND;
  return query.time.type === 'depart'
    ? plan.arrivalMs < atMs + walkMs
    : plan.departureMs > atMs - walkMs;
}

function stopsWithinWalk(place: Place, maxWalkMinutes: number, speed: WalkingSpeed): StopWalk[] {
  const limitMetres = maxStraightLineMetres(maxWalkMinutes, speed);
  const nearby: StopWalk[] = [];
  NETWORK_STOPS.forEach((stop, index) => {
    if (place.stopId === stop.id) {
      nearby.push({ stop: index, walk: NO_WALK });
      return;
    }
    if (haversineMetres(place.coordinate, stop.coordinate) > limitMetres) return;
    const walk = walkBetween(place.coordinate, stop.coordinate, speed);
    if (walk.durationSeconds > maxWalkMinutes * SECONDS_PER_MINUTE) return;
    nearby.push({ stop: index, walk });
  });
  return nearby;
}

function walkingTransfers(maxWalkMinutes: number, speed: WalkingSpeed): StopWalk[][] {
  const transfers: StopWalk[][] = NETWORK_STOPS.map(() => []);
  for (const [first, second] of WALKING_LINKS) {
    const walk = walkBetween(first.coordinate, second.coordinate, speed);
    if (walk.durationSeconds > maxWalkMinutes * SECONDS_PER_MINUTE) continue;
    transfers[stopIndexOf(first)]!.push({ stop: stopIndexOf(second), walk });
    transfers[stopIndexOf(second)]!.push({ stop: stopIndexOf(first), walk });
  }
  return transfers;
}
