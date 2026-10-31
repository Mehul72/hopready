import { combineSignals, mapSettled } from './async';
import { estimateTransitMinutes, hubPeriodFor } from './estimate';
import { haversineMetres } from './geo';
import {
  buildItinerary,
  findContinuityIssues,
  hasShortTransfer,
  legSeconds,
  MAX_LOCATION_GAP_METRES,
  transitLegsOf,
} from './itinerary';
import type {
  Itinerary,
  Leg,
  Occupancy,
  ParkedCar,
  Parking,
  Place,
  PlanRequest,
  PlanResponse,
  RejectionReason,
  Strategy,
} from './model';
import {
  ProviderError,
  type CarParkFacility,
  type Clock,
  type DriveRoute,
  type DriveTime,
  type DrivingProvider,
  type CarParkProvider,
  type TransitJourney,
  type TransitProvider,
} from './providers';
import {
  addMinutes,
  addSeconds,
  ceilToMinute,
  floorToMinute,
  isBefore,
  secondsBetween,
  toIso,
} from './time';
import { NO_WALK, walkBetween, type Walk } from './walking';

export interface PlannerLimits {
  maxEtaCandidates: number;
  maxTransferCandidates: number;
  journeysPerQuery: number;
  maxItineraries: number;
  providerTimeoutMs: number;
  providerConcurrency: number;
  occupancyFreshMinutes: number;
}

export const DEFAULT_PLANNER_LIMITS: PlannerLimits = {
  // Apple's ETA endpoint takes at most 10 destinations in one call; two calls run together.
  maxEtaCandidates: 20,
  maxTransferCandidates: 5,
  journeysPerQuery: 4,
  maxItineraries: 10,
  providerTimeoutMs: 8_000,
  providerConcurrency: 4,
  occupancyFreshMinutes: 15,
};

export interface PlannerDeps {
  mode: 'live' | 'demo';
  transit: TransitProvider;
  driving: DrivingProvider | null;
  carParks: CarParkProvider | null;
  clock: Clock;
  limits?: Partial<PlannerLimits>;
}

// Straight-line distance never beats the road, so 90 km/h is a safe ceiling for a first cut.
const MAX_STRAIGHT_LINE_METRES_PER_DRIVE_MINUTE = 1_500;
// A rough road speed, used only to rank candidates before the drive times come back and to tell a
// long shot from a car park within reach. Never shown to people.
const ROAD_DISTANCE_FACTOR = 1.35;
const ROUGH_DRIVE_METRES_PER_MINUTE = 667;
// The local station is the first place most people would think of, so the quickest drive is always
// tried, whatever the estimate says about car parks nearer the destination.
const QUICKEST_DRIVES_ALWAYS_TRIED = 1;
// Provider times are whole minutes; allow that much slack before calling something early or late.
const TIME_GRACE_SECONDS = 60;
// A count with no more than this share of the spaces free could easily be full by the time the
// traveller gets there.
const NEARLY_FULL_FREE_SHARE = 0.1;
// Leaving a minute earlier is not worth a card of its own when nothing else is better.
const LEAVE_EARLIER_SLACK_SECONDS = 60;
// An option with more of its times live is more certain, so only it can hide one with fewer.
const LIVE_TIMES_RANK: Readonly<Record<Itinerary['realtime'], number>> = {
  none: 0,
  partial: 1,
  full: 2,
};

type TransferStrategy = 'park-and-ride' | 'drop-off';
type CarParkOutcome = PlanResponse['checkedCarParks'][number]['outcome'];

interface TransferPoint {
  id: string;
  name: string;
  place: Place;
  // Where public transport is asked for from: the station a car park serves (by stop id, so the
  // journey starts at the platform and the walk from the car park is HopReady's own), or the
  // place itself when nothing better is known.
  boarding: Place;
  facility: CarParkFacility | null;
  // The station the traveller catches public transport from: the one a car park serves, or the
  // drop-off station. Null when there is none, as for a spot the traveller saved.
  station: string | null;
  preferred: boolean;
}

// A transfer point with its door-to-door estimate, which decides what the providers are asked about.
interface Candidate {
  point: TransferPoint;
  roughDriveMinutes: number;
  // Parking or drop-off, the walk to the platform and the public transport from there: everything a
  // drive time does not change.
  beyondDriveMinutes: number;
  // Door to door: the rough drive at first, the provider's drive time once it is known.
  estimatedMinutes: number;
}

interface RankedCandidate extends Candidate {
  driveSeconds: number;
}

interface PlanContext {
  request: PlanRequest;
  deps: PlannerDeps;
  limits: PlannerLimits;
  signal: AbortSignal | undefined;
  now: string;
  rejected: Map<RejectionReason, number>;
  checkedCarParks: Map<string, PlanResponse['checkedCarParks'][number]>;
  // Ids of options through the car park or station the traveller asked for.
  preferredOptions: Set<string>;
  // The station of each car park or drop-off option, by option id.
  optionStations: Map<string, string>;
  unavailable: PlanResponse['unavailable'];
  notices: string[];
}

interface StrategyResult {
  itineraries: Itinerary[];
  failure?: ProviderError;
}

export async function planTrip(
  request: PlanRequest,
  deps: PlannerDeps,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  const context: PlanContext = {
    request,
    deps,
    limits: { ...DEFAULT_PLANNER_LIMITS, ...deps.limits },
    signal,
    now: toIso(deps.clock.now()),
    rejected: new Map(),
    checkedCarParks: new Map(),
    preferredOptions: new Set(),
    optionStations: new Map(),
    unavailable: [],
    notices: [],
  };

  const results = await Promise.all(strategiesFor(context).map((run) => run()));
  const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
  const candidates = results.flatMap((result) => result.itineraries);
  const itineraries = selectItineraries(context, candidates);

  if (itineraries.length === 0 && failures.length === results.length && failures[0]) {
    throw failures[0];
  }

  return {
    mode: deps.mode,
    generatedAt: context.now,
    itineraries,
    rejected: [...context.rejected].map(([reason, count]) => ({ reason, count })),
    checkedCarParks: [...context.checkedCarParks.values()],
    unavailable: context.unavailable,
    notices: context.notices,
  };
}

function strategiesFor(context: PlanContext): (() => Promise<StrategyResult>)[] {
  const { request, deps } = context;
  const { trip, access } = request;

  if (trip.kind === 'return-via-car') return [() => planReturnViaCar(context, trip.parkedCar)];
  if (trip.kind === 'return-without-car') return [() => planTransitOnly(context, 'transit-home')];

  const strategies: (() => Promise<StrategyResult>)[] = [];
  if (access.transit) strategies.push(() => planTransitOnly(context, 'transit-only'));

  const drivingStrategies: Strategy[] = [];
  if (access.transit && access.drive) drivingStrategies.push('park-and-ride');
  if (access.transit && access.dropOff) drivingStrategies.push('drop-off');
  if (access.drive) drivingStrategies.push('drive-only');

  for (const strategy of drivingStrategies) {
    if (!deps.driving) {
      context.unavailable.push({ strategy, reason: 'Drive times are not set up on this server.' });
      continue;
    }
    if (strategy === 'drive-only') strategies.push(() => planDriveOnly(context));
    else strategies.push(() => planViaTransferPoints(context, strategy as TransferStrategy));
  }
  return strategies;
}

// ---------- provider calls, each bounded by its own timeout and the request's signal ----------

async function withProviderTimeout<T>(
  context: PlanContext,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), context.limits.providerTimeoutMs);
  try {
    return await call(combineSignals([context.signal, timeout.signal]));
  } finally {
    clearTimeout(timer);
  }
}

function asProviderError(error: unknown, provider: ProviderError['provider']): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ProviderError(provider, 'timeout', 'The provider did not answer in time', {
      cause: error,
    });
  }
  return new ProviderError(provider, 'unavailable', 'The provider call failed', { cause: error });
}

function describeFailure(error: ProviderError, what: string): string {
  switch (error.failure) {
    case 'timeout':
      return `${what} took too long to respond.`;
    case 'rate-limited':
      return `${what} are busy right now. Try again shortly.`;
    case 'not-configured':
      return `${what} are not set up on this server.`;
    case 'malformed-response':
      return `${what} sent a response HopReady could not read.`;
    case 'rejected-request':
      return `${what} could not handle this request.`;
    case 'unavailable':
      return `${what} are unavailable right now.`;
  }
}

async function queryTransit(
  context: PlanContext,
  from: Place,
  to: Place,
  time: { type: 'depart' | 'arrive'; at: string },
): Promise<TransitJourney[]> {
  const { preferences } = context.request;
  const at = time.type === 'depart' ? ceilToMinute(time.at) : floorToMinute(time.at);
  try {
    return await withProviderTimeout(context, (signal) =>
      context.deps.transit.planJourneys(
        {
          from,
          to,
          time: { type: time.type, at },
          maxJourneys: context.limits.journeysPerQuery,
          maxWalkMinutes: preferences.maxWalkMinutes,
          walkingSpeed: preferences.walkingSpeed,
          excludedModes: preferences.excludedTransitModes,
        },
        signal,
      ),
    );
  } catch (error) {
    throw asProviderError(error, context.deps.transit.name);
  }
}

async function routeDrive(
  context: PlanContext,
  driving: DrivingProvider,
  from: Place,
  to: Place,
  time: DriveTime,
): Promise<DriveRoute> {
  try {
    return await withProviderTimeout(context, (signal) =>
      driving.routeDrive(from.coordinate, to.coordinate, time, signal),
    );
  } catch (error) {
    throw asProviderError(error, driving.name);
  }
}

// ---------- strategies ----------

async function planTransitOnly(
  context: PlanContext,
  strategy: 'transit-only' | 'transit-home',
): Promise<StrategyResult> {
  const { origin, destination, time } = context.request;
  try {
    const journeys = await queryTransit(context, origin, destination, time);
    if (journeys.length === 0) {
      context.unavailable.push({
        strategy,
        reason: 'No public transport journeys were found for this time.',
      });
    }
    const usable = journeys.filter((journey) => keepJourney(context, journey));
    return {
      itineraries: usable.map((journey) =>
        buildItinerary({
          strategy,
          legs: journey.legs,
          fare: journey.fare,
          alerts: journey.alerts,
        }),
      ),
    };
  } catch (error) {
    const failure = asProviderError(error, context.deps.transit.name);
    context.unavailable.push({
      strategy,
      reason: describeFailure(failure, 'Public transport times'),
    });
    return { itineraries: [], failure };
  }
}

async function planDriveOnly(context: PlanContext): Promise<StrategyResult> {
  const driving = context.deps.driving!;
  const { origin, destination, time } = context.request;
  try {
    const route = await routeDrive(context, driving, origin, destination, time);
    const start = time.type === 'depart' ? time.at : addSeconds(time.at, -route.durationSeconds);
    const end = time.type === 'depart' ? addSeconds(time.at, route.durationSeconds) : time.at;
    const leg = driveLeg(driving, 'drive', origin, destination, start, end, route);
    return {
      itineraries: [
        buildItinerary({
          strategy: 'drive-only',
          legs: [leg],
          notes: ['Parking at your destination is not included in this time.'],
        }),
      ],
    };
  } catch (error) {
    const failure = asProviderError(error, driving.name);
    context.unavailable.push({
      strategy: 'drive-only',
      reason: describeFailure(failure, 'Drive times'),
    });
    return { itineraries: [], failure };
  }
}

async function planViaTransferPoints(
  context: PlanContext,
  strategy: TransferStrategy,
): Promise<StrategyResult> {
  const driving = context.deps.driving!;
  const { request } = context;
  const bufferSeconds =
    60 *
    (strategy === 'park-and-ride'
      ? request.preferences.parkingBufferMinutes
      : request.preferences.dropOffBufferMinutes);

  const { points, listFailure } = await transferPoints(context, strategy);
  const shortlist = shortlistByEstimate(context, strategy, points, bufferSeconds);
  // Without the car park list, "none within reach" would be a guess.
  if (shortlist.length === 0 && listFailure) {
    context.unavailable.push({
      strategy,
      reason: describeFailure(listFailure, 'Car park details'),
    });
    return { itineraries: [], failure: listFailure };
  }
  if (shortlist.length === 0) {
    context.unavailable.push({
      strategy,
      reason:
        strategy === 'park-and-ride'
          ? 'No documented car parks are within your driving limit.'
          : 'No stations with drop-off access are within your driving limit.',
    });
    return { itineraries: [] };
  }

  // Drive times and car park counts come from different providers, so they are asked for together.
  const [ranking, occupancy] = await Promise.all([
    rankByDriveTime(context, driving, strategy, shortlist).then(
      (reachable) => ({ reachable }),
      (error: unknown) => ({ failure: asProviderError(error, driving.name) }),
    ),
    strategy === 'park-and-ride'
      ? occupancyFor(
          context,
          shortlist.map(({ point }) => point),
        )
      : Promise.resolve(new Map<string, Occupancy>()),
  ]);
  if ('failure' in ranking) {
    shortlist.forEach((candidate) =>
      recordCarPark(context, strategy, candidate.point, 'provider-error', candidate),
    );
    context.unavailable.push({ strategy, reason: describeFailure(ranking.failure, 'Drive times') });
    return { itineraries: [], failure: ranking.failure };
  }
  const chosen = chooseCandidates(context, strategy, ranking.reachable, occupancy);

  const outcomes = await mapSettled(
    chosen,
    context.limits.providerConcurrency,
    ({ point, driveSeconds }) =>
      planThroughPoint(context, driving, strategy, point, driveSeconds, bufferSeconds, occupancy),
  );

  const itineraries: Itinerary[] = [];
  let firstFailure: ProviderError | undefined;
  outcomes.forEach((outcome, index) => {
    const candidate = chosen[index]!;
    const { point } = candidate;
    if (outcome.status === 'rejected') {
      firstFailure ??= asProviderError(outcome.reason, context.deps.transit.name);
      recordCarPark(context, strategy, point, 'provider-error', candidate);
      return;
    }
    const itinerary = outcome.value;
    if (!itinerary) {
      recordCarPark(context, strategy, point, 'no-workable-connection', candidate);
      return;
    }
    // Checked here as well as when options are chosen, so a car park reads as used only when its
    // option can be shown.
    const problem = itineraryProblem(context, itinerary);
    if (problem) {
      reject(context, problem);
      recordCarPark(
        context,
        strategy,
        point,
        problem === 'drive-too-long' ? 'too-far-to-drive' : 'no-workable-connection',
        candidate,
      );
      return;
    }
    itineraries.push(itinerary);
    if (point.preferred) context.preferredOptions.add(itinerary.id);
    if (point.station) context.optionStations.set(itinerary.id, point.station);
    recordCarPark(context, strategy, point, 'used', {
      estimatedMinutes: itinerary.durationSeconds / 60,
    });
  });

  if (itineraries.length === 0 && firstFailure) {
    context.unavailable.push({ strategy, reason: describeFailure(firstFailure, 'Trip times') });
    return { itineraries, failure: firstFailure };
  }
  // Park and ride explains an empty result car park by car park; drop-off has no such list.
  if (itineraries.length === 0 && strategy === 'drop-off') {
    context.unavailable.push({
      strategy,
      reason:
        ranking.reachable.length === 0
          ? `No stations with drop-off access are within your ${request.preferences.maxDriveMinutes} min driving limit.`
          : 'No public transport connection worked from the stations checked.',
    });
  }
  return { itineraries };
}

async function planThroughPoint(
  context: PlanContext,
  driving: DrivingProvider,
  strategy: TransferStrategy,
  point: TransferPoint,
  rankedDriveSeconds: number,
  bufferSeconds: number,
  occupancy: Map<string, Occupancy>,
): Promise<Itinerary | null> {
  const { origin, destination, time } = context.request;
  const toBoarding = walkToBoarding(context, point);
  // From arriving at the car park or station to being on the platform.
  const accessSeconds = bufferSeconds + toBoarding.durationSeconds;

  const transitTime =
    time.type === 'depart'
      ? { type: 'depart' as const, at: addSeconds(time.at, rankedDriveSeconds + accessSeconds) }
      : time;
  // Parking or being dropped off only makes sense with a public transport leg after it, and
  // Park&Ride is only free with one. A walk-only answer means the destination is simply nearby.
  const journeys = (await queryTransit(context, point.boarding, destination, transitTime)).filter(
    (journey) =>
      transitLegsOf(journey.legs).length > 0 &&
      (time.type === 'depart' || arrivesBy(journey, time.at)) &&
      keepJourney(context, journey),
  );
  // Depart-at wants the journey that arrives first, arrive-by the one that leaves last.
  const ranked = [...journeys].sort(time.type === 'depart' ? byArrival : byLatestStart);
  let journey: TransitJourney | undefined = ranked[0];
  if (!journey) return null;

  const mustArriveAt = addSeconds(journeyStart(journey), -accessSeconds);
  let route = await routeDrive(context, driving, origin, point.place, {
    type: 'arrive',
    at: mustArriveAt,
  });
  let leaveAt = addSeconds(mustArriveAt, -route.durationSeconds);
  let arriveAt = mustArriveAt;

  if (time.type === 'depart' && isBefore(leaveAt, time.at)) {
    // Traffic at the later time is worse than the first estimate: leave when asked, and take the
    // journey that arrives first among those that can still be caught.
    route = await routeDrive(context, driving, origin, point.place, {
      type: 'depart',
      at: time.at,
    });
    leaveAt = time.at;
    arriveAt = addSeconds(time.at, route.durationSeconds);
    const onPlatformFrom = addSeconds(arriveAt, accessSeconds);
    journey = ranked.find((candidate) => !isBefore(journeyStart(candidate), onPlatformFrom));
    if (!journey) {
      reject(context, 'departs-before-requested');
      return null;
    }
  }

  const readyAt = addSeconds(arriveAt, bufferSeconds);
  const onPlatformAt = addSeconds(readyAt, toBoarding.durationSeconds);
  const firstLegs: Leg[] = [
    driveLeg(
      driving,
      strategy === 'park-and-ride' ? 'drive' : 'ride',
      origin,
      point.place,
      leaveAt,
      arriveAt,
      route,
    ),
  ];
  let parking: Parking | null = null;
  if (strategy === 'park-and-ride' && point.facility) {
    parking = parkingFor(context, point.facility, occupancy.get(point.facility.id));
    firstLegs.push({
      id: `park-${point.id}`,
      kind: 'park',
      from: point.place,
      to: point.place,
      start: arriveAt,
      end: readyAt,
      source: 'hopready',
      timing: 'buffer',
      parking,
    });
  } else {
    firstLegs.push({
      id: `drop-off-${point.id}`,
      kind: 'drop-off',
      from: point.place,
      to: point.place,
      start: arriveAt,
      end: readyAt,
      source: 'hopready',
      timing: 'buffer',
    });
  }
  if (toBoarding.durationSeconds > 0) {
    firstLegs.push({
      id: `walk-to-platform-${point.id}`,
      kind: 'walk',
      from: point.place,
      to: point.boarding,
      start: readyAt,
      end: onPlatformAt,
      source: 'hopready',
      timing: 'estimated',
      distanceMetres: toBoarding.distanceMetres,
      path: [point.place.coordinate, point.boarding.coordinate],
    });
  }

  return buildItinerary({
    strategy,
    legs: [...firstLegs, ...startWalkingWhenReady(journey.legs, onPlatformAt)],
    parking,
    fare: journey.fare,
    alerts: journey.alerts,
  });
}

// The walk from a car park to the platform it serves is HopReady's own estimate, from the car
// park's position to the station's. Asking TfNSW from the stop id instead of the car park's
// coordinate makes the journey start at the platform, without TfNSW's padded access walk.
function walkToBoarding(context: PlanContext, point: TransferPoint): Walk {
  if (point.boarding === point.place) return NO_WALK;
  return walkBetween(
    point.place.coordinate,
    point.boarding.coordinate,
    context.request.preferences.walkingSpeed,
  );
}

async function planReturnViaCar(
  context: PlanContext,
  parkedCar: ParkedCar,
): Promise<StrategyResult> {
  const driving = context.deps.driving;
  if (!driving) {
    context.unavailable.push({
      strategy: 'return-via-car',
      reason: 'Drive times are not set up on this server.',
    });
    return { itineraries: [] };
  }
  const { origin, destination, time, preferences } = context.request;
  const car: Place = { ...parkedCar.location, kind: 'parked-car' };
  const retrievalSeconds = preferences.carRetrievalBufferMinutes * 60;
  // Within the gap the planner already accepts between legs, public transport cannot bring the
  // traveller any closer to the car, and providers often have no journey for a trip that short.
  const isNearCar = haversineMetres(origin.coordinate, car.coordinate) <= MAX_LOCATION_GAP_METRES;

  const noWayBack = () =>
    context.unavailable.push({
      strategy: 'return-via-car',
      reason: 'No public transport gets you back to your car in time from here.',
    });

  try {
    if (time.type === 'depart') {
      const waysToCar = isNearCar
        ? [walkToNearbyCar(context, car, time)]
        : (await queryTransit(context, origin, car, time))
            .filter((journey) => keepJourney(context, journey))
            .sort(byArrival)
            .slice(0, 2);
      if (waysToCar.length === 0) noWayBack();
      const itineraries = await Promise.all(
        waysToCar.map(async (toCar) => {
          // Already at the car, retrieval starts at the requested time.
          const atCar = toCar.legs.at(-1)?.end ?? time.at;
          const leaveCarAt = addSeconds(atCar, retrievalSeconds);
          const route = await routeDrive(context, driving, car, destination, {
            type: 'depart',
            at: leaveCarAt,
          });
          return returnItinerary(context, driving, car, toCar, leaveCarAt, route);
        }),
      );
      return { itineraries };
    }

    const route = await routeDrive(context, driving, car, destination, time);
    const leaveCarAt = addSeconds(time.at, -route.durationSeconds);
    const reachCarBy = addSeconds(leaveCarAt, -retrievalSeconds);
    const toCar = isNearCar
      ? walkToNearbyCar(context, car, { type: 'arrive', at: reachCarBy })
      : latestJourney(
          (await queryTransit(context, origin, car, { type: 'arrive', at: reachCarBy })).filter(
            // A journey that reaches the car any later would cut into the retrieval buffer.
            (journey) => arrivesBy(journey, reachCarBy) && keepJourney(context, journey),
          ),
        );
    if (!toCar) {
      noWayBack();
      return { itineraries: [] };
    }
    return { itineraries: [returnItinerary(context, driving, car, toCar, leaveCarAt, route)] };
  } catch (error) {
    const failure = asProviderError(error, context.deps.transit.name);
    context.unavailable.push({
      strategy: 'return-via-car',
      reason: describeFailure(failure, 'Trip times'),
    });
    return { itineraries: [], failure };
  }
}

// The legs to the car, then the full car retrieval buffer, then the drive home.
function returnItinerary(
  context: PlanContext,
  driving: DrivingProvider,
  car: Place,
  toCar: TransitJourney,
  leaveCarAt: string,
  route: DriveRoute,
): Itinerary {
  const { destination, preferences } = context.request;
  // The drive home cannot be avoided, so a long one is pointed out instead of rejected.
  const notes =
    route.durationSeconds > preferences.maxDriveMinutes * 60
      ? [`The drive home is longer than your ${preferences.maxDriveMinutes} min driving limit.`]
      : [];
  return buildItinerary({
    strategy: 'return-via-car',
    legs: [
      ...toCar.legs,
      {
        id: 'car-retrieval',
        kind: 'car-retrieval',
        from: car,
        to: car,
        start: addSeconds(leaveCarAt, -preferences.carRetrievalBufferMinutes * 60),
        end: leaveCarAt,
        source: 'hopready',
        timing: 'buffer',
      },
      driveLeg(
        driving,
        'drive',
        car,
        destination,
        leaveCarAt,
        addSeconds(leaveCarAt, route.durationSeconds),
        route,
      ),
    ],
    fare: toCar.fare,
    alerts: toCar.alerts,
    notes,
  });
}

// The walk to a car close by, estimated from distance at the traveller's walking speed and shaped
// like a public transport journey. Already at the car, there is no walk at all.
function walkToNearbyCar(
  context: PlanContext,
  car: Place,
  time: { type: 'depart' | 'arrive'; at: string },
): TransitJourney {
  const { origin, preferences } = context.request;
  const walk = walkBetween(origin.coordinate, car.coordinate, preferences.walkingSpeed);
  if (walk.durationSeconds === 0) return { legs: [], fare: { status: 'unknown' }, alerts: [] };
  const start = time.type === 'depart' ? time.at : addSeconds(time.at, -walk.durationSeconds);
  return {
    legs: [
      {
        id: 'walk-to-car',
        kind: 'walk',
        from: origin,
        to: car,
        start,
        end: addSeconds(start, walk.durationSeconds),
        source: 'hopready',
        timing: 'estimated',
        distanceMetres: Math.round(walk.distanceMetres),
      },
    ],
    fare: { status: 'unknown' },
    alerts: [],
  };
}

// ---------- transfer point selection ----------

async function transferPoints(
  context: PlanContext,
  strategy: TransferStrategy,
): Promise<{ points: TransferPoint[]; listFailure?: ProviderError }> {
  const { request } = context;
  let facilities: CarParkFacility[] = [];
  let listFailure: ProviderError | undefined;
  if (context.deps.carParks) {
    const carParks = context.deps.carParks;
    try {
      facilities = await withProviderTimeout(context, (signal) => carParks.listFacilities(signal));
    } catch (error) {
      listFailure = asProviderError(error, carParks.name);
      context.notices.push(describeFailure(listFailure, 'Car park details'));
    }
  }

  const preferredStopId = request.preferredStop?.stopId;
  if (strategy === 'park-and-ride') {
    const documented = facilities.map((facility): TransferPoint => {
      const place: Place = {
        name: facility.name,
        coordinate: facility.coordinate,
        kind: 'car-park',
        carParkId: facility.id,
      };
      return {
        id: facility.id,
        name: facility.name,
        place,
        boarding: facility.station?.stopId ? facility.station : place,
        facility,
        station: facility.station ? stationKey(facility.station) : null,
        preferred:
          facility.id === request.preferredCarParkId ||
          (preferredStopId !== undefined && facility.station?.stopId === preferredStopId),
      };
    });
    const saved = (request.savedParkingSpots ?? []).map((spot): TransferPoint => {
      const facility: CarParkFacility = {
        id: spot.id,
        name: spot.name,
        coordinate: spot.coordinate,
        kind: 'user-saved',
        stationName: null,
        totalSpaces: null,
        rules: { status: 'unknown' },
        station: null,
      };
      const place: Place = { name: spot.name, coordinate: spot.coordinate, kind: 'saved-parking' };
      return {
        id: spot.id,
        name: spot.name,
        place,
        boarding: place,
        facility,
        station: null,
        preferred: spot.id === request.preferredCarParkId,
      };
    });
    return { points: [...documented, ...saved], listFailure };
  }

  const stations = new Map<string, TransferPoint>();
  for (const facility of facilities) {
    const station = facility.station;
    if (!station) continue;
    const key = stationKey(station);
    if (stations.has(key)) continue;
    stations.set(key, {
      id: `station:${key}`,
      name: station.name,
      place: station,
      boarding: station,
      facility: null,
      station: key,
      preferred: preferredStopId !== undefined && station.stopId === preferredStopId,
    });
  }
  const preferredStop = request.preferredStop;
  if (preferredStop) {
    const key = stationKey(preferredStop);
    stations.set(key, {
      id: `station:${key}`,
      name: preferredStop.name,
      place: preferredStop,
      boarding: preferredStop,
      facility: null,
      station: key,
      preferred: true,
    });
  }
  return { points: [...stations.values()], listFailure };
}

function stationKey(station: Place): string {
  return station.stopId ?? station.name;
}

function roughDriveMinutes(fromPlace: Place, toPlace: Place): number {
  return (
    (haversineMetres(fromPlace.coordinate, toPlace.coordinate) * ROAD_DISTANCE_FACTOR) /
    ROUGH_DRIVE_METRES_PER_MINUTE
  );
}

// Every car park within the driving limit gets a door-to-door estimate: a rough drive, the time to
// reach the platform, and the public transport from there as the hub table knows it. The best
// estimates go on to the drive-time provider. Direction never rules a car park out on its own: one
// a few minutes behind the start, or on another line, earns its place or loses it on the estimate.
function shortlistByEstimate(
  context: PlanContext,
  strategy: TransferStrategy,
  points: TransferPoint[],
  bufferSeconds: number,
): Candidate[] {
  const { origin, destination, time, preferences } = context.request;
  const maxStraightLineMetres =
    preferences.maxDriveMinutes * MAX_STRAIGHT_LINE_METRES_PER_DRIVE_MINUTE;
  const period = hubPeriodFor(time.at);

  const candidates: Candidate[] = [];
  for (const point of points) {
    if (haversineMetres(origin.coordinate, point.place.coordinate) > maxStraightLineMetres) {
      if (point.preferred) recordCarPark(context, strategy, point, 'too-far-to-drive');
      continue;
    }
    const rough = roughDriveMinutes(origin, point.place);
    const beyondDriveMinutes =
      bufferSeconds / 60 +
      walkToBoarding(context, point).durationSeconds / 60 +
      estimateTransitMinutes(
        point.boarding,
        destination.coordinate,
        period,
        preferences.walkingSpeed,
      );
    candidates.push({
      point,
      roughDriveMinutes: rough,
      beyondDriveMinutes,
      estimatedMinutes: rough + beyondDriveMinutes,
    });
  }

  // A long drive to a short ride can look quick overall, so car parks likely beyond the driving
  // limit go last, after every one likely within it, or they would take the estimate slots and then
  // fail the limit. The car park asked for always keeps its place.
  const likelyOverLimit = (candidate: Candidate) =>
    candidate.roughDriveMinutes > preferences.maxDriveMinutes ? 1 : 0;
  const ranked = candidates.sort(
    (a, b) =>
      Number(b.point.preferred) - Number(a.point.preferred) ||
      likelyOverLimit(a) - likelyOverLimit(b) ||
      a.estimatedMinutes - b.estimatedMinutes,
  );
  const preferredCount = ranked.filter((candidate) => candidate.point.preferred).length;
  const shortlisted = ranked.slice(0, Math.max(context.limits.maxEtaCandidates, preferredCount));
  // Car parks within reach that lost their place say so, with the estimate, so none goes missing.
  for (const candidate of ranked.slice(shortlisted.length)) {
    if (candidate.roughDriveMinutes <= preferences.maxDriveMinutes) {
      recordCarPark(context, strategy, candidate.point, 'not-tried', candidate);
    }
  }
  return shortlisted;
}

// One drive-time call for the whole shortlist, then each estimate is refined with the real drive.
// Car parks whose drive runs past the limit are left out, and said so for those that looked within
// reach. A long shot that then fails the limit is not worth a line in the list.
async function rankByDriveTime(
  context: PlanContext,
  driving: DrivingProvider,
  strategy: TransferStrategy,
  shortlist: Candidate[],
): Promise<RankedCandidate[]> {
  const { origin, time, preferences } = context.request;
  // For arrive-by, ask for traffic around when the drive would happen, using the closest candidate.
  const roughLeadMinutes = Math.min(...shortlist.map((candidate) => candidate.estimatedMinutes));
  const rankingTime: DriveTime =
    time.type === 'depart'
      ? time
      : { type: 'depart', at: laterOfIso(context.now, addMinutes(time.at, -roughLeadMinutes)) };

  const estimates = await withProviderTimeout(context, (signal) =>
    driving.estimateDrives(
      origin.coordinate,
      shortlist.map((candidate) => candidate.point.place.coordinate),
      rankingTime,
      signal,
    ),
  );

  const maxDriveSeconds = preferences.maxDriveMinutes * 60;
  const reachable: RankedCandidate[] = [];
  shortlist.forEach((candidate, index) => {
    const { point } = candidate;
    const estimate = estimates[index];
    if (!estimate || estimate.durationSeconds > maxDriveSeconds) {
      if (point.preferred || candidate.roughDriveMinutes <= preferences.maxDriveMinutes) {
        recordCarPark(context, strategy, point, 'too-far-to-drive', {
          estimatedMinutes: estimate
            ? estimate.durationSeconds / 60 + candidate.beyondDriveMinutes
            : candidate.estimatedMinutes,
        });
      }
      if (point.preferred) {
        context.notices.push(
          `${point.name} is outside your ${preferences.maxDriveMinutes} min driving limit.`,
        );
      }
      return;
    }
    reachable.push({
      ...candidate,
      driveSeconds: estimate.durationSeconds,
      estimatedMinutes: estimate.durationSeconds / 60 + candidate.beyondDriveMinutes,
    });
  });
  return reachable.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
}

// Which of the reachable car parks are asked for journeys: the ones asked for by name or station,
// the quickest drive, then the best estimates, one car park per station. Two car parks at one station
// get the same services, so the one surer of a space, then the quicker one, speaks for both. The
// rest are listed with their estimates, so the traveller can see what was not tried and why.
function chooseCandidates(
  context: PlanContext,
  strategy: TransferStrategy,
  reachable: RankedCandidate[],
  occupancy: ReadonlyMap<string, Occupancy>,
): RankedCandidate[] {
  const outlook = (candidate: RankedCandidate) => {
    const { facility } = candidate.point;
    if (!facility) return 1;
    return countOutlook(freshOccupancy(context, facility, occupancy.get(facility.id)));
  };
  const forStation = new Map<string, RankedCandidate>();
  const spokenFor: RankedCandidate[] = [];
  const standalone: RankedCandidate[] = [];
  for (const candidate of reachable) {
    const { station, preferred } = candidate.point;
    if (preferred || station === null) {
      standalone.push(candidate);
      continue;
    }
    const kept = forStation.get(station);
    if (!kept) {
      forStation.set(station, candidate);
    } else if (outlook(candidate) > outlook(kept)) {
      forStation.set(station, candidate);
      spokenFor.push(kept);
    } else {
      spokenFor.push(candidate);
    }
  }

  const contenders = [...standalone, ...forStation.values()];
  const quickestDrives = [...contenders]
    .filter((candidate) => !candidate.point.preferred)
    .sort((a, b) => a.driveSeconds - b.driveSeconds)
    .slice(0, QUICKEST_DRIVES_ALWAYS_TRIED);
  const ordered = [
    ...contenders.filter((candidate) => candidate.point.preferred),
    ...quickestDrives,
    ...contenders
      .filter((candidate) => !candidate.point.preferred && !quickestDrives.includes(candidate))
      .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes),
  ];
  const preferredCount = ordered.filter((candidate) => candidate.point.preferred).length;
  const chosen = ordered.slice(0, Math.max(context.limits.maxTransferCandidates, preferredCount));
  for (const candidate of [...ordered.slice(chosen.length), ...spokenFor]) {
    recordCarPark(context, strategy, candidate.point, 'not-tried', candidate);
  }
  return chosen.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
}

// Room beats no count or a stale one, which beats nearly full.
function countOutlook(occupancy: Occupancy): number {
  if (occupancy.status !== 'known') return 1;
  return hasRoom(occupancy) ? 2 : 0;
}

async function occupancyFor(
  context: PlanContext,
  points: TransferPoint[],
): Promise<Map<string, Occupancy>> {
  const carParks = context.deps.carParks;
  const ids = points
    .filter((point) => point.facility?.kind === 'transport-park-and-ride')
    .map((point) => point.facility!.id);
  if (!carParks || ids.length === 0) return new Map();
  try {
    return await withProviderTimeout(context, (signal) => carParks.occupancy(ids, signal));
  } catch (error) {
    const failure = asProviderError(error, carParks.name);
    context.notices.push(describeFailure(failure, 'Car park occupancy figures'));
    return new Map();
  }
}

function parkingFor(
  context: PlanContext,
  facility: CarParkFacility,
  occupancy: Occupancy | undefined,
): Parking {
  const { rules, station: _station, ...carPark } = facility;
  return {
    carPark,
    rules,
    occupancy: freshOccupancy(context, facility, occupancy),
  };
}

function freshOccupancy(
  context: PlanContext,
  facility: CarParkFacility,
  occupancy: Occupancy | undefined,
): Occupancy {
  if (facility.kind === 'user-saved') {
    return { status: 'unknown', reason: 'No live occupancy for parking spots you added yourself.' };
  }
  if (!occupancy)
    return { status: 'unknown', reason: 'Occupancy figures are unavailable right now.' };
  if (occupancy.status !== 'known') return occupancy;
  const ageMinutes = secondsBetween(occupancy.observedAt, context.now) / 60;
  return ageMinutes > context.limits.occupancyFreshMinutes
    ? { ...occupancy, status: 'stale' }
    : occupancy;
}

function recordCarPark(
  context: PlanContext,
  strategy: TransferStrategy,
  point: TransferPoint,
  outcome: CarParkOutcome,
  estimate?: { estimatedMinutes: number },
) {
  if (strategy !== 'park-and-ride') return;
  const existing = context.checkedCarParks.get(point.id);
  // 'used' wins over anything recorded earlier for the same car park.
  if (existing?.outcome === 'used') return;
  const estimatedMinutes = estimate ? Math.round(estimate.estimatedMinutes) : undefined;
  context.checkedCarParks.set(point.id, {
    id: point.id,
    name: point.name,
    outcome,
    stationName: point.facility?.stationName ?? null,
    ...((estimatedMinutes ?? existing?.estimatedMinutes) !== undefined && {
      estimatedMinutes: estimatedMinutes ?? existing?.estimatedMinutes,
    }),
  });
}

// ---------- leg helpers ----------

function driveLeg(
  driving: DrivingProvider,
  kind: 'drive' | 'ride',
  from: Place,
  to: Place,
  start: string,
  end: string,
  route: DriveRoute,
): Leg {
  return {
    id: `${kind}-${to.name}`,
    kind,
    from,
    to,
    start,
    end,
    source: driving.name,
    timing: route.trafficAware ? 'estimated' : 'scheduled',
    distanceMetres: route.distanceMetres,
    trafficAware: route.trafficAware,
    path: route.path,
  };
}

// After parking, people walk to the platform straight away and wait there, not in the car park.
function startWalkingWhenReady(legs: Leg[], readyAt: string): Leg[] {
  const [first, ...rest] = legs;
  if (!first || first.kind !== 'walk' || !isBefore(readyAt, first.start)) return legs;
  const walkSeconds = legSeconds(first);
  return [{ ...first, start: readyAt, end: addSeconds(readyAt, walkSeconds) }, ...rest];
}

function journeyStart(journey: TransitJourney): string {
  return journey.legs[0]!.start;
}

function journeyEnd(journey: TransitJourney): string {
  return journey.legs[journey.legs.length - 1]!.end;
}

function arrivesBy(journey: TransitJourney, at: string): boolean {
  return !isBefore(at, journeyEnd(journey));
}

function byLatestStart(a: TransitJourney, b: TransitJourney): number {
  return secondsBetween(journeyStart(a), journeyStart(b));
}

// Providers do not promise any order. Of two journeys that arrive together, the one that leaves
// later means less waiting.
function byArrival(a: TransitJourney, b: TransitJourney): number {
  return secondsBetween(journeyEnd(b), journeyEnd(a)) || byLatestStart(a, b);
}

function latestJourney(journeys: TransitJourney[]): TransitJourney | undefined {
  return [...journeys].sort(byLatestStart)[0];
}

function laterOfIso(a: string, b: string): string {
  return isBefore(a, b) ? b : a;
}

// ---------- feasibility ----------

function reject(context: PlanContext, reason: RejectionReason): false {
  context.rejected.set(reason, (context.rejected.get(reason) ?? 0) + 1);
  return false;
}

// Checks that only need the public transport part: these run before a drive is attached.
function keepJourney(context: PlanContext, journey: TransitJourney): boolean {
  if (journey.legs.length === 0) return reject(context, 'discontinuous');
  const reason = journeyProblem(context, journey.legs);
  return reason ? reject(context, reason) : true;
}

function journeyProblem(context: PlanContext, legs: readonly Leg[]): RejectionReason | null {
  const { preferences } = context.request;
  if (transitLegsOf(legs).some((leg) => leg.cancelled)) return 'cancelled-service';
  if (
    legs.some((leg) => leg.kind === 'walk' && legSeconds(leg) > preferences.maxWalkMinutes * 60)
  ) {
    return 'walk-too-long';
  }
  if (hasShortTransfer(legs, preferences.transferBufferMinutes * 60)) return 'transfer-too-short';
  return null;
}

function itineraryProblem(context: PlanContext, itinerary: Itinerary): RejectionReason | null {
  const { time, preferences } = context.request;
  if (findContinuityIssues(itinerary.legs).length > 0) return 'discontinuous';
  const journeyReason = journeyProblem(context, itinerary.legs);
  if (journeyReason) return journeyReason;
  const longestDriveSeconds = Math.max(
    0,
    ...itinerary.legs.filter((leg) => leg.kind === 'drive' || leg.kind === 'ride').map(legSeconds),
  );
  // The drive home from a parked car is the only way to get the car home; returnItinerary notes a
  // long one instead.
  if (
    itinerary.strategy !== 'return-via-car' &&
    longestDriveSeconds > preferences.maxDriveMinutes * 60
  ) {
    return 'drive-too-long';
  }
  if (secondsBetween(context.now, itinerary.departAt) < -TIME_GRACE_SECONDS)
    return 'departs-in-past';
  if (time.type === 'depart' && secondsBetween(time.at, itinerary.departAt) < -TIME_GRACE_SECONDS) {
    return 'departs-before-requested';
  }
  if (time.type === 'arrive' && secondsBetween(time.at, itinerary.arriveAt) > TIME_GRACE_SECONDS) {
    return 'arrives-after-target';
  }
  return null;
}

function selectItineraries(context: PlanContext, candidates: Itinerary[]): Itinerary[] {
  const seen = new Set<string>();
  const valid: Itinerary[] = [];
  for (const itinerary of candidates) {
    if (seen.has(itinerary.id)) {
      reject(context, 'duplicate');
      continue;
    }
    seen.add(itinerary.id);
    const problem = itineraryProblem(context, itinerary);
    if (problem) {
      reject(context, problem);
      continue;
    }
    valid.push(itinerary);
  }
  const shown = withoutDominatedOptions(context, valid);
  const { time } = context.request;
  const ordered =
    time.type === 'depart'
      ? shown.sort(
          (a, b) => secondsBetween(b.arriveAt, a.arriveAt) || a.durationSeconds - b.durationSeconds,
        )
      : shown.sort(
          (a, b) => secondsBetween(a.departAt, b.departAt) || a.durationSeconds - b.durationSeconds,
        );
  const listed = ordered.slice(0, context.limits.maxItineraries);
  for (const option of ordered.slice(listed.length)) {
    recordUnlistedCarPark(context, option, 'left-out-for-space');
  }
  return listed;
}

// Two car parks at one station share its services, so one that is no better on anything the cards
// show, and no surer of a space, is padding rather than a choice. Car parks at different stations
// are always listed: a station a few minutes back, or on another line, is a real choice even when
// another arrives sooner, and it is where to go when the first fills. The car park the traveller
// asked for is never hidden.
function withoutDominatedOptions(context: PlanContext, options: Itinerary[]): Itinerary[] {
  const isPreferred = (option: Itinerary) => context.preferredOptions.has(option.id);
  const isCarParkAskedFor = (option: Itinerary) =>
    option.parking !== null && option.parking.carPark.id === context.request.preferredCarParkId;
  const stationOf = (option: Itinerary) => context.optionStations.get(option.id);
  // Strongest first, so an option is only ever hidden behind one that is shown. Options through the
  // car park or station the traveller asked for lead, so of two that read the same, theirs is shown.
  // After that, an option sorts ahead of any it strictly dominates, and of two that dominate each
  // other, the one surer of a space, then the one that leaves later, goes first.
  const strongestFirst = options
    .filter((option) => option.strategy === 'park-and-ride' || option.strategy === 'drop-off')
    .sort(
      (a, b) =>
        Number(isPreferred(b)) - Number(isPreferred(a)) ||
        shownSecondsBetween(b.arriveAt, a.arriveAt) ||
        shownDriveMinutes(a) - shownDriveMinutes(b) ||
        a.transfers - b.transfers ||
        a.alerts.length - b.alerts.length ||
        LIVE_TIMES_RANK[b.realtime] - LIVE_TIMES_RANK[a.realtime] ||
        spaceOutlook(b) - spaceOutlook(a) ||
        shownSecondsBetween(a.departAt, b.departAt),
    );
  const shown: Itinerary[] = [];
  const hidden = new Set<Itinerary>();
  for (const option of strongestFirst) {
    const station = stationOf(option);
    const dominated =
      station !== undefined &&
      !isCarParkAskedFor(option) &&
      shown.some(
        (other) =>
          other.strategy === option.strategy &&
          stationOf(other) === station &&
          spaceOutlook(other) >= spaceOutlook(option) &&
          dominates(other, option),
      );
    if (dominated) hidden.add(option);
    else shown.push(option);
  }
  for (const option of hidden) recordUnlistedCarPark(context, option, 'matched-by-another');
  return options.filter((option) => !hidden.has(option));
}

// A car park whose option worked but is not listed says why, rather than reading as used when the
// traveller cannot find its card.
function recordUnlistedCarPark(
  context: PlanContext,
  option: Itinerary,
  outcome: Extract<CarParkOutcome, 'matched-by-another' | 'left-out-for-space'>,
) {
  const checked = option.parking && context.checkedCarParks.get(option.parking.carPark.id);
  if (!checked) return;
  context.checkedCarParks.set(checked.id, { ...checked, outcome });
}

// At least as good on everything the results can be sorted by, read the way the app shows it, without
// having the traveller leave more than a minute earlier. It must be as certain too: an alert the
// other avoids, or fewer live times, leaves the other a real choice.
function dominates(better: Itinerary, other: Itinerary): boolean {
  return (
    shownSecondsBetween(better.arriveAt, other.arriveAt) >= 0 &&
    shownDriveMinutes(better) <= shownDriveMinutes(other) &&
    better.transfers <= other.transfers &&
    shownSecondsBetween(other.departAt, better.departAt) >= -LEAVE_EARLIER_SLACK_SECONDS &&
    LIVE_TIMES_RANK[better.realtime] >= LIVE_TIMES_RANK[other.realtime] &&
    better.alerts.every((alert) => other.alerts.some((same) => same.id === alert.id))
  );
}

// The app shows leave and arrive times to the minute with the seconds dropped, and drives in whole
// minutes. Comparing the same way means two options that read the same count as the same.
function shownSecondsBetween(from: string, to: string): number {
  return secondsBetween(floorToMinute(from), floorToMinute(to));
}

function shownDriveMinutes(itinerary: Itinerary): number {
  return Math.round(itinerary.driveSeconds / 60);
}

// How likely a car park is to have a space, judged from its count as it stands: room beats no count
// or an old one, which beats nearly full. A drop-off needs no space.
function spaceOutlook(itinerary: Itinerary): number {
  if (itinerary.strategy === 'drop-off') return 2;
  const occupancy = itinerary.parking?.occupancy;
  if (occupancy?.status !== 'known') return 1;
  return hasRoom(occupancy) ? 2 : 0;
}

function hasRoom(occupancy: { spacesAvailable: number; totalSpaces: number }): boolean {
  return occupancy.spacesAvailable > occupancy.totalSpaces * NEARLY_FULL_FREE_SHARE;
}
