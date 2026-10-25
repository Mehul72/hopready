import { combineSignals, mapSettled } from './async';
import { haversineMetres } from './geo';
import { buildItinerary, findContinuityIssues, legSeconds, transitLegsOf } from './itinerary';
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
  // Apple's ETA endpoint takes at most 10 destinations in one call.
  maxEtaCandidates: 8,
  maxTransferCandidates: 3,
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
// Rough speeds used only to choose which candidates to ask providers about. Never shown to people.
const ROAD_DISTANCE_FACTOR = 1.35;
const ROUGH_DRIVE_METRES_PER_MINUTE = 667;
const ROUGH_TRANSIT_METRES_PER_MINUTE = 583;
const ROUGH_TRANSIT_OVERHEAD_MINUTES = 8;
const MIN_PROGRESS_METRES = 1_000;
const MAX_DETOUR_RATIO = 1.6;
const MAX_EXPLAINED_SKIPPED_CAR_PARKS = 3;
// Provider times are whole minutes; allow that much slack before calling something early or late.
const TIME_GRACE_SECONDS = 60;

type TransferStrategy = 'park-and-ride' | 'drop-off';
type CarParkOutcome = PlanResponse['checkedCarParks'][number]['outcome'];

interface TransferPoint {
  id: string;
  name: string;
  place: Place;
  facility: CarParkFacility | null;
  preferred: boolean;
}

interface PlanContext {
  request: PlanRequest;
  deps: PlannerDeps;
  limits: PlannerLimits;
  signal: AbortSignal | undefined;
  now: string;
  rejected: Map<RejectionReason, number>;
  checkedCarParks: Map<string, PlanResponse['checkedCarParks'][number]>;
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

  const points = await transferPoints(context, strategy);
  const shortlist = shortlistByGeometry(context, strategy, points);
  if (shortlist.length === 0) {
    context.unavailable.push({
      strategy,
      reason:
        strategy === 'park-and-ride'
          ? 'No documented car parks are on the way to your destination within your driving limit.'
          : 'No stations with drop-off access are on the way to your destination within your driving limit.',
    });
    return { itineraries: [] };
  }

  let reachable: { point: TransferPoint; driveSeconds: number }[];
  try {
    reachable = await rankByDriveTime(context, driving, strategy, shortlist, bufferSeconds);
  } catch (error) {
    const failure = asProviderError(error, driving.name);
    shortlist.forEach((point) => recordCarPark(context, strategy, point, 'provider-error'));
    context.unavailable.push({ strategy, reason: describeFailure(failure, 'Drive times') });
    return { itineraries: [], failure };
  }

  const occupancy =
    strategy === 'park-and-ride'
      ? await occupancyFor(
          context,
          reachable.map(({ point }) => point),
        )
      : new Map<string, Occupancy>();

  const outcomes = await mapSettled(
    reachable,
    context.limits.providerConcurrency,
    ({ point, driveSeconds }) =>
      planThroughPoint(context, driving, strategy, point, driveSeconds, bufferSeconds, occupancy),
  );

  const itineraries: Itinerary[] = [];
  let firstFailure: ProviderError | undefined;
  outcomes.forEach((outcome, index) => {
    const point = reachable[index]!.point;
    if (outcome.status === 'fulfilled') {
      if (outcome.value) {
        itineraries.push(outcome.value);
        recordCarPark(context, strategy, point, 'used');
      } else {
        recordCarPark(context, strategy, point, 'no-workable-connection');
      }
      return;
    }
    firstFailure ??= asProviderError(outcome.reason, context.deps.transit.name);
    recordCarPark(context, strategy, point, 'provider-error');
  });

  if (itineraries.length === 0 && firstFailure) {
    context.unavailable.push({ strategy, reason: describeFailure(firstFailure, 'Trip times') });
    return { itineraries, failure: firstFailure };
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

  const transitTime =
    time.type === 'depart'
      ? { type: 'depart' as const, at: addSeconds(time.at, rankedDriveSeconds + bufferSeconds) }
      : time;
  const journeys = (await queryTransit(context, point.place, destination, transitTime)).filter(
    (journey) => keepJourney(context, journey),
  );
  const journey = time.type === 'depart' ? earliestJourney(journeys) : latestJourney(journeys);
  if (!journey) return null;

  const transitStart = journey.legs[0]!.start;
  const mustArriveAt = addSeconds(transitStart, -bufferSeconds);
  let route = await routeDrive(context, driving, origin, point.place, {
    type: 'arrive',
    at: mustArriveAt,
  });
  let leaveAt = addSeconds(mustArriveAt, -route.durationSeconds);
  let arriveAt = mustArriveAt;

  if (time.type === 'depart' && isBefore(leaveAt, time.at)) {
    // Traffic at the later time is worse than the first estimate: leave when asked and check it still works.
    route = await routeDrive(context, driving, origin, point.place, {
      type: 'depart',
      at: time.at,
    });
    leaveAt = time.at;
    arriveAt = addSeconds(time.at, route.durationSeconds);
    if (isBefore(transitStart, addSeconds(arriveAt, bufferSeconds))) {
      reject(context, 'departs-before-requested');
      return null;
    }
  }

  const readyAt = addSeconds(arriveAt, bufferSeconds);
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

  return buildItinerary({
    strategy,
    legs: [...firstLegs, ...startWalkingWhenReady(journey.legs, readyAt)],
    parking,
    fare: journey.fare,
    alerts: journey.alerts,
  });
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

  const noWayBack = () =>
    context.unavailable.push({
      strategy: 'return-via-car',
      reason: 'No public transport gets you back to your car in time from here.',
    });

  try {
    if (time.type === 'depart') {
      const journeys = (await queryTransit(context, origin, car, time))
        .filter((journey) => keepJourney(context, journey))
        .sort(byFirstStart)
        .slice(0, 2);
      if (journeys.length === 0) noWayBack();
      const itineraries = await Promise.all(
        journeys.map(async (journey) => {
          const atCar = journey.legs[journey.legs.length - 1]!.end;
          const leaveCarAt = addSeconds(atCar, retrievalSeconds);
          const route = await routeDrive(context, driving, car, destination, {
            type: 'depart',
            at: leaveCarAt,
          });
          return returnItinerary(driving, car, destination, journey, atCar, leaveCarAt, route);
        }),
      );
      return { itineraries };
    }

    const route = await routeDrive(context, driving, car, destination, time);
    const leaveCarAt = addSeconds(time.at, -route.durationSeconds);
    const reachCarBy = addSeconds(leaveCarAt, -retrievalSeconds);
    const journeys = (
      await queryTransit(context, origin, car, { type: 'arrive', at: reachCarBy })
    ).filter((journey) => keepJourney(context, journey));
    const journey = latestJourney(journeys);
    if (!journey) {
      noWayBack();
      return { itineraries: [] };
    }
    const atCar = journey.legs[journey.legs.length - 1]!.end;
    return {
      itineraries: [
        returnItinerary(driving, car, destination, journey, atCar, leaveCarAt, route, reachCarBy),
      ],
    };
  } catch (error) {
    const failure = asProviderError(error, context.deps.transit.name);
    context.unavailable.push({
      strategy: 'return-via-car',
      reason: describeFailure(failure, 'Trip times'),
    });
    return { itineraries: [], failure };
  }
}

function returnItinerary(
  driving: DrivingProvider,
  car: Place,
  destination: Place,
  journey: TransitJourney,
  atCar: string,
  leaveCarAt: string,
  route: DriveRoute,
  retrievalStart = atCar,
): Itinerary {
  const retrievalStartsAt = isBefore(atCar, retrievalStart) ? retrievalStart : atCar;
  return buildItinerary({
    strategy: 'return-via-car',
    legs: [
      ...journey.legs,
      {
        id: 'car-retrieval',
        kind: 'car-retrieval',
        from: car,
        to: car,
        start: retrievalStartsAt,
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
    fare: journey.fare,
    alerts: journey.alerts,
  });
}

// ---------- transfer point selection ----------

async function transferPoints(
  context: PlanContext,
  strategy: TransferStrategy,
): Promise<TransferPoint[]> {
  const { request } = context;
  let facilities: CarParkFacility[] = [];
  if (context.deps.carParks) {
    const carParks = context.deps.carParks;
    try {
      facilities = await withProviderTimeout(context, (signal) => carParks.listFacilities(signal));
    } catch (error) {
      const failure = asProviderError(error, carParks.name);
      context.notices.push(describeFailure(failure, 'Car park details'));
    }
  }

  const preferredStopId = request.preferredStop?.stopId;
  if (strategy === 'park-and-ride') {
    const documented = facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      place: {
        name: facility.name,
        coordinate: facility.coordinate,
        kind: 'car-park' as const,
        carParkId: facility.id,
      },
      facility,
      preferred:
        facility.id === request.preferredCarParkId ||
        (preferredStopId !== undefined && facility.station?.stopId === preferredStopId),
    }));
    const saved = (request.savedParkingSpots ?? []).map((spot) => {
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
      return {
        id: spot.id,
        name: spot.name,
        place: { name: spot.name, coordinate: spot.coordinate, kind: 'saved-parking' as const },
        facility,
        preferred: spot.id === request.preferredCarParkId,
      };
    });
    return [...documented, ...saved];
  }

  const stations = new Map<string, TransferPoint>();
  for (const facility of facilities) {
    const station = facility.station;
    if (!station) continue;
    const key = station.stopId ?? station.name;
    if (stations.has(key)) continue;
    stations.set(key, {
      id: `station:${key}`,
      name: station.name,
      place: station,
      facility: null,
      preferred: preferredStopId !== undefined && station.stopId === preferredStopId,
    });
  }
  const preferredStop = request.preferredStop;
  if (preferredStop) {
    const key = preferredStop.stopId ?? preferredStop.name;
    stations.set(key, {
      id: `station:${key}`,
      name: preferredStop.name,
      place: preferredStop,
      facility: null,
      preferred: true,
    });
  }
  return [...stations.values()];
}

function roughTransitMinutes(fromPlace: Place, toPlace: Place): number {
  const metres = haversineMetres(fromPlace.coordinate, toPlace.coordinate) * ROAD_DISTANCE_FACTOR;
  return metres / ROUGH_TRANSIT_METRES_PER_MINUTE + ROUGH_TRANSIT_OVERHEAD_MINUTES;
}

function roughDriveMinutes(fromPlace: Place, toPlace: Place): number {
  return (
    (haversineMetres(fromPlace.coordinate, toPlace.coordinate) * ROAD_DISTANCE_FACTOR) /
    ROUGH_DRIVE_METRES_PER_MINUTE
  );
}

function shortlistByGeometry(
  context: PlanContext,
  strategy: TransferStrategy,
  points: TransferPoint[],
): TransferPoint[] {
  const { origin, destination, preferences } = context.request;
  const directMetres = haversineMetres(origin.coordinate, destination.coordinate);
  const maxStraightLineMetres =
    preferences.maxDriveMinutes * MAX_STRAIGHT_LINE_METRES_PER_DRIVE_MINUTE;

  const wrongWay: { point: TransferPoint; fromOrigin: number }[] = [];
  const plausible = points.filter((point) => {
    const fromOrigin = haversineMetres(origin.coordinate, point.place.coordinate);
    const toDestination = haversineMetres(point.place.coordinate, destination.coordinate);
    if (fromOrigin > maxStraightLineMetres) {
      if (point.preferred) recordCarPark(context, strategy, point, 'too-far-to-drive');
      return false;
    }
    if (point.preferred) return true;
    const makesProgress = toDestination <= directMetres - MIN_PROGRESS_METRES;
    const reasonableDetour =
      (fromOrigin + toDestination) / Math.max(directMetres, 1) <= MAX_DETOUR_RATIO;
    if (!makesProgress || !reasonableDetour) wrongWay.push({ point, fromOrigin });
    return makesProgress && reasonableDetour;
  });

  // Name the nearby car parks that were skipped for direction, so a missing local car park is explained
  // without listing every facility in Sydney.
  wrongWay
    .sort((a, b) => a.fromOrigin - b.fromOrigin)
    .slice(0, MAX_EXPLAINED_SKIPPED_CAR_PARKS)
    .forEach(({ point }) => recordCarPark(context, strategy, point, 'not-towards-destination'));

  const estimate = (point: TransferPoint) =>
    roughDriveMinutes(origin, point.place) + roughTransitMinutes(point.place, destination);
  const ranked = plausible.sort((a, b) => estimate(a) - estimate(b));
  const preferred = ranked.filter((point) => point.preferred);
  const others = ranked.filter((point) => !point.preferred);
  return [...preferred, ...others].slice(
    0,
    Math.max(context.limits.maxEtaCandidates, preferred.length),
  );
}

async function rankByDriveTime(
  context: PlanContext,
  driving: DrivingProvider,
  strategy: TransferStrategy,
  shortlist: TransferPoint[],
  bufferSeconds: number,
): Promise<{ point: TransferPoint; driveSeconds: number }[]> {
  const { origin, destination, time, preferences } = context.request;
  // For arrive-by, ask for traffic around when the drive would happen, using the closest candidate.
  const roughLeadMinutes = Math.min(
    ...shortlist.map(
      (point) =>
        roughDriveMinutes(origin, point.place) + roughTransitMinutes(point.place, destination),
    ),
  );
  const rankingTime: DriveTime =
    time.type === 'depart'
      ? time
      : {
          type: 'depart',
          at: laterOfIso(context.now, addMinutes(time.at, -roughLeadMinutes - bufferSeconds / 60)),
        };

  const estimates = await withProviderTimeout(context, (signal) =>
    driving.estimateDrives(
      origin.coordinate,
      shortlist.map((point) => point.place.coordinate),
      rankingTime,
      signal,
    ),
  );

  const maxDriveSeconds = preferences.maxDriveMinutes * 60;
  const reachable: { point: TransferPoint; driveSeconds: number; score: number }[] = [];
  shortlist.forEach((point, index) => {
    const estimate = estimates[index];
    if (!estimate || estimate.durationSeconds > maxDriveSeconds) {
      recordCarPark(context, strategy, point, 'too-far-to-drive');
      if (point.preferred) {
        context.notices.push(
          `${point.name} is outside your ${preferences.maxDriveMinutes} min driving limit.`,
        );
      }
      return;
    }
    const score = estimate.durationSeconds / 60 + roughTransitMinutes(point.place, destination);
    reachable.push({
      point,
      driveSeconds: estimate.durationSeconds,
      score: point.preferred ? -1 : score,
    });
  });

  return reachable
    .sort((a, b) => a.score - b.score)
    .slice(0, context.limits.maxTransferCandidates)
    .map(({ point, driveSeconds }) => ({ point, driveSeconds }));
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
) {
  if (strategy !== 'park-and-ride') return;
  const existing = context.checkedCarParks.get(point.id);
  // 'used' wins over anything recorded earlier for the same car park.
  if (existing?.outcome === 'used') return;
  context.checkedCarParks.set(point.id, { id: point.id, name: point.name, outcome });
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

function byFirstStart(a: TransitJourney, b: TransitJourney): number {
  return secondsBetween(b.legs[0]!.start, a.legs[0]!.start);
}

function earliestJourney(journeys: TransitJourney[]): TransitJourney | undefined {
  return [...journeys].sort(byFirstStart)[0];
}

function latestJourney(journeys: TransitJourney[]): TransitJourney | undefined {
  return [...journeys].sort(byFirstStart).at(-1);
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

// The transfer buffer is the minimum time between stepping off one service and the next one leaving,
// including any walk between them. It is applied once and never stacked on the provider's walk time.
function hasShortTransfer(legs: readonly Leg[], bufferSeconds: number): boolean {
  let lastArrival: string | null = null;
  let walkSinceArrival = 0;
  for (const leg of legs) {
    if (leg.kind === 'transit') {
      if (lastArrival !== null) {
        const windowSeconds = secondsBetween(lastArrival, leg.start);
        if (windowSeconds < Math.max(bufferSeconds, walkSinceArrival)) return true;
      }
      lastArrival = leg.end;
      walkSinceArrival = 0;
    } else if (leg.kind === 'walk') {
      walkSinceArrival += legSeconds(leg);
    }
  }
  return false;
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
  if (longestDriveSeconds > preferences.maxDriveMinutes * 60) return 'drive-too-long';
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
  const { time } = context.request;
  const ordered =
    time.type === 'depart'
      ? valid.sort(
          (a, b) => secondsBetween(b.arriveAt, a.arriveAt) || a.durationSeconds - b.durationSeconds,
        )
      : valid.sort(
          (a, b) => secondsBetween(a.departAt, b.departAt) || a.durationSeconds - b.durationSeconds,
        );
  return ordered.slice(0, context.limits.maxItineraries);
}
