import type { ConnectionTable, ScheduledTrip, TimetableWindow } from './timetable';
import type { Walk } from './walking';

// Journey search over the demo timetable with the Connection Scan Algorithm (Dibbelt, Pajor,
// Strasser and Wagner, 2013). Connections are hops between consecutive stops of one trip.
//
// A depart-at search finds the earliest arrival, then the latest departure that still makes that
// arrival, so nobody is told to leave earlier than they need to. Arrive-by does the reverse. Each
// later option starts a minute after the previous one, so the list reads as the next few services.
// Stop, trip and connection indexes all come from the timetable window, so the array reads in the
// scans are always in bounds.

export interface StopWalk {
  stop: number;
  walk: Walk;
}

export interface JourneySearch {
  window: TimetableWindow;
  stopCount: number;
  // Walks from the origin to nearby stops, and from nearby stops to the destination.
  access: readonly StopWalk[];
  egress: readonly StopWalk[];
  // Walks between linked stops, indexed by the stop the walk starts from. Links are two-way.
  transfers: readonly (readonly StopWalk[])[];
  minimumChangeMs: number;
  isTripAllowed: (trip: ScheduledTrip) => boolean;
  horizonMs: number;
}

export type JourneyPart =
  | { kind: 'access'; stop: number; walk: Walk }
  | { kind: 'ride'; trip: number; boardPosition: number; alightPosition: number }
  | { kind: 'transfer'; fromStop: number; toStop: number; walk: Walk }
  | { kind: 'egress'; stop: number; walk: Walk };

export interface JourneyPlan {
  parts: JourneyPart[];
  departureMs: number;
  arrivalMs: number;
}

export type SearchTime = { type: 'depart' | 'arrive'; atMs: number };

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
// More rides than this would mean the reconstruction is looping, which is a bug.
const MAX_RIDES_PER_JOURNEY = 8;

export function searchJourneys(
  search: JourneySearch,
  time: SearchTime,
  maxJourneys: number,
): JourneyPlan[] {
  const prepared = prepare(search);
  const plans: JourneyPlan[] = [];

  if (time.type === 'depart') {
    let departAfterMs = time.atMs;
    while (plans.length < maxJourneys) {
      const earliest = scanEarliestArrival(prepared, departAfterMs);
      if (!earliest) break;
      const latest = scanLatestDeparture(prepared, earliest.arrivalMs, departAfterMs);
      if (!latest) throw new Error('Demo journey search found an arrival but no way to make it');
      plans.push(latest.plan());
      departAfterMs = latest.departureMs + MS_PER_MINUTE;
    }
    return plans;
  }

  let arriveByMs = time.atMs;
  while (plans.length < maxJourneys) {
    const latest = scanLatestDeparture(prepared, arriveByMs, Number.NEGATIVE_INFINITY);
    if (!latest) break;
    const earliest = scanEarliestArrival(prepared, latest.departureMs);
    if (!earliest || earliest.arrivalMs > arriveByMs) {
      throw new Error('Demo journey search found a departure that does not arrive in time');
    }
    plans.push(earliest.plan());
    arriveByMs = earliest.arrivalMs - MS_PER_MINUTE;
  }
  return plans.reverse();
}

interface PreparedSearch extends JourneySearch {
  table: ConnectionTable;
  accessByStop: Map<number, Walk>;
  egressByStop: Map<number, Walk>;
  allowedTrips: Uint8Array;
}

function prepare(search: JourneySearch): PreparedSearch {
  const allowedTrips = new Uint8Array(search.window.trips.length);
  search.window.trips.forEach((trip, index) => {
    allowedTrips[index] = search.isTripAllowed(trip) ? 1 : 0;
  });
  return {
    ...search,
    table: search.window.connections,
    accessByStop: shortestWalks(search.access),
    egressByStop: shortestWalks(search.egress),
    allowedTrips,
  };
}

function shortestWalks(walks: readonly StopWalk[]): Map<number, Walk> {
  const byStop = new Map<number, Walk>();
  for (const { stop, walk } of walks) {
    const known = byStop.get(stop);
    if (!known || walk.durationSeconds < known.durationSeconds) byStop.set(stop, walk);
  }
  return byStop;
}

interface EarliestArrival {
  arrivalMs: number;
  plan: () => JourneyPlan;
}

interface LatestDeparture {
  departureMs: number;
  plan: () => JourneyPlan;
}

type ForwardFoot =
  { kind: 'access'; walk: Walk } | { kind: 'transfer'; fromStop: number; walk: Walk };

interface ForwardRide {
  boardConnection: number;
  alightConnection: number;
  boardedOnFoot: boolean;
}

function scanEarliestArrival(
  search: PreparedSearch,
  departAfterMs: number,
): EarliestArrival | null {
  const { table } = search;
  const tripCount = search.window.trips.length;
  // Earliest time at each stop having walked there, or having arrived on a vehicle.
  const footArrival = new Float64Array(search.stopCount).fill(Number.POSITIVE_INFINITY);
  const rideArrival = new Float64Array(search.stopCount).fill(Number.POSITIVE_INFINITY);
  const footLabels: (ForwardFoot | undefined)[] = new Array(search.stopCount);
  const rideLabels: (ForwardRide | undefined)[] = new Array(search.stopCount);
  const boardedAt = new Int32Array(tripCount).fill(-1);
  const boardedOnFoot = new Uint8Array(tripCount);

  for (const [stop, walk] of search.accessByStop) {
    footArrival[stop] = departAfterMs + walk.durationSeconds * MS_PER_SECOND;
    footLabels[stop] = { kind: 'access', walk };
  }

  let bestArrivalMs = Number.POSITIVE_INFINITY;
  let bestStop = -1;
  const lastUsefulDepartureMs = departAfterMs + search.horizonMs;

  for (let index = firstDepartingAtOrAfter(table, departAfterMs); index < table.count; index++) {
    const departureMs = table.departureMs[index]!;
    if (departureMs >= bestArrivalMs || departureMs > lastUsefulDepartureMs) break;
    const trip = table.trip[index]!;
    if (search.allowedTrips[trip] === 0) continue;

    if (boardedAt[trip] === -1) {
      const fromStop = table.fromStop[index]!;
      if (footArrival[fromStop]! <= departureMs) {
        boardedOnFoot[trip] = 1;
      } else if (rideArrival[fromStop]! + search.minimumChangeMs > departureMs) {
        continue;
      }
      boardedAt[trip] = index;
    }

    const arrivalMs = table.arrivalMs[index]!;
    const toStop = table.toStop[index]!;
    if (arrivalMs >= rideArrival[toStop]!) continue;
    rideArrival[toStop] = arrivalMs;
    rideLabels[toStop] = {
      boardConnection: boardedAt[trip]!,
      alightConnection: index,
      boardedOnFoot: boardedOnFoot[trip] === 1,
    };

    const egress = search.egressByStop.get(toStop);
    if (egress && arrivalMs + egress.durationSeconds * MS_PER_SECOND < bestArrivalMs) {
      bestArrivalMs = arrivalMs + egress.durationSeconds * MS_PER_SECOND;
      bestStop = toStop;
    }
    for (const transfer of search.transfers[toStop] ?? []) {
      const walkedMs = arrivalMs + transfer.walk.durationSeconds * MS_PER_SECOND;
      if (walkedMs >= footArrival[transfer.stop]!) continue;
      footArrival[transfer.stop] = walkedMs;
      footLabels[transfer.stop] = { kind: 'transfer', fromStop: toStop, walk: transfer.walk };
    }
  }

  if (bestStop < 0) return null;
  const lastStop = bestStop;
  return {
    arrivalMs: bestArrivalMs,
    plan: () => timed(search, rebuildForward(search, footLabels, rideLabels, lastStop)),
  };
}

function rebuildForward(
  search: PreparedSearch,
  footLabels: readonly (ForwardFoot | undefined)[],
  rideLabels: readonly (ForwardRide | undefined)[],
  lastStop: number,
): JourneyPart[] {
  const { table } = search;
  const parts: JourneyPart[] = [
    { kind: 'egress', stop: lastStop, walk: search.egressByStop.get(lastStop)! },
  ];
  let stop = lastStop;

  for (let rides = 0; rides < MAX_RIDES_PER_JOURNEY; rides++) {
    const ride = rideLabels[stop];
    if (!ride) break;
    const boardStop = table.fromStop[ride.boardConnection]!;
    parts.push({
      kind: 'ride',
      trip: table.trip[ride.boardConnection]!,
      boardPosition: table.position[ride.boardConnection]!,
      alightPosition: table.position[ride.alightConnection]! + 1,
    });
    if (!ride.boardedOnFoot) {
      stop = boardStop;
      continue;
    }
    const foot = footLabels[boardStop];
    if (foot?.kind === 'access') {
      parts.push({ kind: 'access', stop: boardStop, walk: foot.walk });
      return parts.reverse();
    }
    if (!foot) break;
    parts.push({ kind: 'transfer', fromStop: foot.fromStop, toStop: boardStop, walk: foot.walk });
    stop = foot.fromStop;
  }
  throw new Error('Demo journey search could not rebuild an earliest-arrival journey');
}

type BackwardFoot =
  { kind: 'egress'; walk: Walk } | { kind: 'transfer'; toStop: number; walk: Walk };

interface BackwardRide {
  boardConnection: number;
  alightConnection: number;
  alightedOnFoot: boolean;
}

function scanLatestDeparture(
  search: PreparedSearch,
  arriveByMs: number,
  departNotBeforeMs: number,
): LatestDeparture | null {
  const { table } = search;
  const tripCount = search.window.trips.length;
  // Latest time to step off a vehicle at a stop and still make it by walking on.
  const footDeparture = new Float64Array(search.stopCount).fill(Number.NEGATIVE_INFINITY);
  // Latest time to board a vehicle at a stop and still make it.
  const rideDeparture = new Float64Array(search.stopCount).fill(Number.NEGATIVE_INFINITY);
  const footLabels: (BackwardFoot | undefined)[] = new Array(search.stopCount);
  const rideLabels: (BackwardRide | undefined)[] = new Array(search.stopCount);
  const alightAt = new Int32Array(tripCount).fill(-1);
  const alightOnFoot = new Uint8Array(tripCount);

  for (const [stop, walk] of search.egressByStop) {
    footDeparture[stop] = arriveByMs - walk.durationSeconds * MS_PER_SECOND;
    footLabels[stop] = { kind: 'egress', walk };
  }

  let bestDepartureMs = Number.NEGATIVE_INFINITY;
  let bestStop = -1;
  const earliestUsefulArrivalMs = arriveByMs - search.horizonMs;

  for (let rank = lastArrivingAtOrBefore(table, arriveByMs); rank >= 0; rank--) {
    const index = table.byArrival[rank]!;
    const arrivalMs = table.arrivalMs[index]!;
    if (arrivalMs <= bestDepartureMs || arrivalMs < earliestUsefulArrivalMs) break;
    const trip = table.trip[index]!;
    if (search.allowedTrips[trip] === 0) continue;

    if (alightAt[trip] === -1) {
      const toStop = table.toStop[index]!;
      if (arrivalMs <= footDeparture[toStop]!) {
        alightOnFoot[trip] = 1;
      } else if (arrivalMs + search.minimumChangeMs > rideDeparture[toStop]!) {
        continue;
      }
      alightAt[trip] = index;
    }

    const departureMs = table.departureMs[index]!;
    const fromStop = table.fromStop[index]!;
    if (departureMs <= rideDeparture[fromStop]!) continue;
    rideDeparture[fromStop] = departureMs;
    rideLabels[fromStop] = {
      boardConnection: index,
      alightConnection: alightAt[trip]!,
      alightedOnFoot: alightOnFoot[trip] === 1,
    };

    const access = search.accessByStop.get(fromStop);
    const leaveOriginMs = departureMs - (access?.durationSeconds ?? 0) * MS_PER_SECOND;
    if (access && leaveOriginMs > bestDepartureMs && leaveOriginMs >= departNotBeforeMs) {
      bestDepartureMs = leaveOriginMs;
      bestStop = fromStop;
    }
    for (const transfer of search.transfers[fromStop] ?? []) {
      const leaveMs = departureMs - transfer.walk.durationSeconds * MS_PER_SECOND;
      if (leaveMs <= footDeparture[transfer.stop]!) continue;
      footDeparture[transfer.stop] = leaveMs;
      footLabels[transfer.stop] = { kind: 'transfer', toStop: fromStop, walk: transfer.walk };
    }
  }

  if (bestStop < 0) return null;
  const firstStop = bestStop;
  return {
    departureMs: bestDepartureMs,
    plan: () => timed(search, rebuildBackward(search, footLabels, rideLabels, firstStop)),
  };
}

function rebuildBackward(
  search: PreparedSearch,
  footLabels: readonly (BackwardFoot | undefined)[],
  rideLabels: readonly (BackwardRide | undefined)[],
  firstStop: number,
): JourneyPart[] {
  const { table } = search;
  const parts: JourneyPart[] = [
    { kind: 'access', stop: firstStop, walk: search.accessByStop.get(firstStop)! },
  ];
  let stop = firstStop;

  for (let rides = 0; rides < MAX_RIDES_PER_JOURNEY; rides++) {
    const ride = rideLabels[stop];
    if (!ride) break;
    const alightStop = table.toStop[ride.alightConnection]!;
    parts.push({
      kind: 'ride',
      trip: table.trip[ride.boardConnection]!,
      boardPosition: table.position[ride.boardConnection]!,
      alightPosition: table.position[ride.alightConnection]! + 1,
    });
    if (!ride.alightedOnFoot) {
      stop = alightStop;
      continue;
    }
    const foot = footLabels[alightStop];
    if (foot?.kind === 'egress') {
      parts.push({ kind: 'egress', stop: alightStop, walk: foot.walk });
      return parts;
    }
    if (!foot) break;
    parts.push({ kind: 'transfer', fromStop: alightStop, toStop: foot.toStop, walk: foot.walk });
    stop = foot.toStop;
  }
  throw new Error('Demo journey search could not rebuild a latest-departure journey');
}

// The traveller sets off with exactly enough time to walk to the first service, and walks on as
// soon as the last one arrives, so the journey's ends come from the rides, not the requested time.
function timed(search: PreparedSearch, parts: JourneyPart[]): JourneyPlan {
  const rides = parts.filter((part) => part.kind === 'ride');
  const first = rides[0];
  const last = rides[rides.length - 1];
  const access = parts[0];
  const egress = parts[parts.length - 1];
  if (!first || !last || access?.kind !== 'access' || egress?.kind !== 'egress') {
    throw new Error('A demo journey must start with a walk, include a ride and end with a walk');
  }
  const { trips } = search.window;
  const departureMs =
    trips[first.trip]!.timesMs[first.boardPosition]! - access.walk.durationSeconds * MS_PER_SECOND;
  const arrivalMs =
    trips[last.trip]!.timesMs[last.alightPosition]! + egress.walk.durationSeconds * MS_PER_SECOND;
  return { parts, departureMs, arrivalMs };
}

function firstDepartingAtOrAfter(table: ConnectionTable, timeMs: number): number {
  let low = 0;
  let high = table.count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table.departureMs[middle]! < timeMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

// A rank in arrival order (an index into table.byArrival), or -1 when nothing arrives in time.
function lastArrivingAtOrBefore(table: ConnectionTable, timeMs: number): number {
  let low = 0;
  let high = table.count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table.arrivalMs[table.byArrival[middle]!]! <= timeMs) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
