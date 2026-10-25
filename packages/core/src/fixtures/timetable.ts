import { stableId } from '../itinerary';
import {
  bandsFor,
  minutesAt,
  NETWORK_ROUTES,
  runTimeProfile,
  type NetworkRoute,
  type RouteDirection,
  type TimedConnection,
} from './routes';
import type { TimetableSettings } from './scenarios';
import {
  addDays,
  dateKey,
  minutesFromClockText,
  serviceDayClock,
  serviceDayOf,
  sydneyDateOf,
  type CalendarDate,
  type ServiceDay,
  type ServiceDayClock,
} from './service-calendar';
import { NETWORK_STOPS, type NetworkStop } from './stops';

// Generates demo trips from the route patterns and lays them out as connections (one per hop
// between consecutive stops) for the journey search.

export interface ScheduledTrip {
  key: string;
  route: NetworkRoute;
  direction: RouteDirection;
  // Minutes after the start of the service day that the trip leaves its first stop.
  departureMinute: number;
  // One instant per stop call, in milliseconds since the epoch.
  timesMs: readonly number[];
  cancelled: boolean;
  realtimeEligible: boolean;
}

// Connections are stored column by column in typed arrays, sorted by departure. Three service days
// come to about 50,000 hops, which this keeps under 2 MB on a phone.
export interface ConnectionTable {
  count: number;
  departureMs: Float64Array;
  arrivalMs: Float64Array;
  fromStop: Int32Array;
  toStop: Int32Array;
  trip: Int32Array;
  // Index of the departure call within the trip.
  position: Int32Array;
  // Connection indexes sorted by arrival, for searches that work backwards from an arrival time.
  byArrival: Int32Array;
}

export interface TimetableWindow {
  trips: readonly ScheduledTrip[];
  connections: ConnectionTable;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1_440;
const MORNING_CANCELLATIONS = {
  routeId: 'M1',
  fromMinute: minutesFromClockText('06:30'),
  untilMinute: minutesFromClockText('09:30'),
};
// Generated days are pure functions of the date and settings, so they are shared between provider
// instances. The bounds keep memory flat however long the app runs.
const MAX_CACHED_DAYS = 6;
const MAX_CACHED_WINDOWS = 3;

const stopIndexes = new Map<NetworkStop, number>(NETWORK_STOPS.map((stop, index) => [stop, index]));
const dayCache = new Map<string, readonly ScheduledTrip[]>();
const windowCache = new Map<string, TimetableWindow>();

// The cancelled-service scenario cancels every second M1 trip that starts in this window.
export function startsInMorningCancellationWindow(
  route: NetworkRoute,
  departureMinute: number,
): boolean {
  return (
    route.id === MORNING_CANCELLATIONS.routeId &&
    departureMinute >= MORNING_CANCELLATIONS.fromMinute &&
    departureMinute < MORNING_CANCELLATIONS.untilMinute
  );
}

export function stopIndexOf(stop: NetworkStop): number {
  const index = stopIndexes.get(stop);
  if (index === undefined) throw new Error(`${stop.name} is not in the demo network`);
  return index;
}

// Trips from the service day before (late-night trips run past midnight), the day itself and the
// day after (for searches that reach into the next morning).
export function timetableWindowAround(
  instantMs: number,
  settings: TimetableSettings,
): TimetableWindow {
  const date = sydneyDateOf(new Date(instantMs));
  const cacheKey = `${dateKey(date)}|${settingsKey(settings)}`;
  const cached = windowCache.get(cacheKey);
  if (cached) return cached;

  const days = [addDays(date, -1), date, addDays(date, 1)];
  const window = buildWindow(days.flatMap((day) => tripsForServiceDay(day, settings)));
  remember(windowCache, cacheKey, window, MAX_CACHED_WINDOWS);
  return window;
}

export function tripsForServiceDay(
  date: CalendarDate,
  settings: TimetableSettings,
): readonly ScheduledTrip[] {
  const cacheKey = `${dateKey(date)}|${settingsKey(settings)}`;
  const cached = dayCache.get(cacheKey);
  if (cached) return cached;

  const trips = generateServiceDay(date, settings);
  remember(dayCache, cacheKey, trips, MAX_CACHED_DAYS);
  return trips;
}

function settingsKey(settings: TimetableSettings): string {
  return `${settings.cancelMorningMetro ? 'cancel' : 'run'}-${settings.feederConnectionMinutes}`;
}

function remember<Value>(cache: Map<string, Value>, key: string, value: Value, limit: number) {
  cache.set(key, value);
  for (const oldest of cache.keys()) {
    if (cache.size <= limit) break;
    cache.delete(oldest);
  }
}

interface DayContext {
  date: CalendarDate;
  day: ServiceDay;
  clock: ServiceDayClock;
  settings: TimetableSettings;
  // Trips already generated today, by route id and direction, for timed connections.
  generated: Map<string, ScheduledTrip[][]>;
}

function generateServiceDay(date: CalendarDate, settings: TimetableSettings): ScheduledTrip[] {
  const context: DayContext = {
    date,
    day: serviceDayOf(date),
    clock: serviceDayClock(date),
    settings,
    generated: new Map(),
  };
  for (const route of NETWORK_ROUTES) {
    const directions = route.directions.map((direction, directionIndex) =>
      tripsForDirection(context, route, direction, directionIndex),
    );
    context.generated.set(route.id, directions);
  }
  return [...context.generated.values()].flat(2);
}

function tripsForDirection(
  context: DayContext,
  route: NetworkRoute,
  direction: RouteDirection,
  directionIndex: number,
): ScheduledTrip[] {
  const trips: ScheduledTrip[] = [];
  let morningOrdinal = 0;

  for (const nominalMinute of departureMinutes(direction, context.day)) {
    const profile = runTimeProfile(context.day, nominalMinute % MINUTES_PER_DAY);
    const offsets = direction.calls.map((call) => minutesAt(call, profile));
    const minute = direction.timedTo
      ? timedDepartureMinute(context, direction.timedTo, { direction, offsets, nominalMinute })
      : nominalMinute;
    const previous = trips[trips.length - 1];
    // Two nominal buses can be retimed onto the same metro; run only one of them.
    if (previous && minute <= previous.departureMinute) continue;
    const startMs = context.clock.instantMs(minute);
    if (startMs === null) continue;

    const key = tripKey(route, directionIndex, context.date, minute);
    const inMorningWindow = startsInMorningCancellationWindow(route, minute);
    const cancelled =
      context.settings.cancelMorningMetro && inMorningWindow && morningOrdinal % 2 === 1;
    if (inMorningWindow) morningOrdinal += 1;

    trips.push({
      key,
      route,
      direction,
      departureMinute: minute,
      timesMs: offsets.map((offset) => startMs + offset * MS_PER_MINUTE),
      cancelled,
      realtimeEligible: percentile(key) < route.realtimePercent,
    });
  }
  return trips;
}

function departureMinutes(direction: RouteDirection, day: ServiceDay): number[] {
  const minutes: number[] = [];
  for (const headway of bandsFor(direction.service, day)) {
    if (headway.everyMinutes <= 0) {
      throw new Error(`Demo headway from ${headway.from} must be at least one minute`);
    }
    const until = minutesFromClockText(headway.until);
    for (
      let minute = minutesFromClockText(headway.from);
      minute < until;
      minute += headway.everyMinutes
    ) {
      minutes.push(minute);
    }
  }
  return minutes;
}

interface FeederTrip {
  direction: RouteDirection;
  offsets: readonly number[];
  nominalMinute: number;
}

// Moves a feeder bus later, by less than one metro headway, so that it meets the metro with exactly
// the scenario's connection time. Without a metro to meet (late at night) it keeps its own time.
function timedDepartureMinute(
  context: DayContext,
  timed: TimedConnection,
  feeder: FeederTrip,
): number {
  const partners = context.generated.get(timed.routeId)?.[timed.directionIndex] ?? [];
  const meetingCall = feeder.direction.calls.findIndex((call) => call.stop === timed.stop);
  const partnerCall =
    partners[0]?.direction.calls.findIndex((call) => call.stop === timed.stop) ?? -1;
  if (meetingCall < 0 || partnerCall < 0) return feeder.nominalMinute;

  const connectionMinutes = context.settings.feederConnectionMinutes;
  const busAtStopMinute = feeder.nominalMinute + feeder.offsets[meetingCall]!;
  const metroAtStopMinutes = partners.map(
    (trip) =>
      trip.departureMinute + (trip.timesMs[partnerCall]! - trip.timesMs[0]!) / MS_PER_MINUTE,
  );
  const metroMinute =
    timed.meets === 'departure'
      ? metroAtStopMinutes.find((leaves) => leaves - connectionMinutes >= busAtStopMinute)
      : metroAtStopMinutes.find((arrives) => arrives + connectionMinutes >= busAtStopMinute);
  if (metroMinute === undefined) return feeder.nominalMinute;

  const busAtStop =
    timed.meets === 'departure' ? metroMinute - connectionMinutes : metroMinute + connectionMinutes;
  return busAtStop - feeder.offsets[meetingCall]!;
}

function tripKey(
  route: NetworkRoute,
  directionIndex: number,
  date: CalendarDate,
  minute: number,
): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `${route.id}-${directionIndex}-${dateKey(date)}-${hours}${minutes}`;
}

// A stable number from 0 to 99 for a trip, used to pick which trips report live times.
function percentile(key: string): number {
  return Number.parseInt(stableId([key]), 16) % 100;
}

function buildWindow(trips: readonly ScheduledTrip[]): TimetableWindow {
  const count = trips.reduce((total, trip) => total + trip.timesMs.length - 1, 0);
  const unsorted = {
    departureMs: new Float64Array(count),
    arrivalMs: new Float64Array(count),
    fromStop: new Int32Array(count),
    toStop: new Int32Array(count),
    trip: new Int32Array(count),
    position: new Int32Array(count),
  };
  let next = 0;
  trips.forEach((trip, tripIndex) => {
    const calls = trip.direction.calls;
    for (let position = 0; position < calls.length - 1; position++) {
      unsorted.departureMs[next] = trip.timesMs[position]!;
      unsorted.arrivalMs[next] = trip.timesMs[position + 1]!;
      unsorted.fromStop[next] = stopIndexOf(calls[position]!.stop);
      unsorted.toStop[next] = stopIndexOf(calls[position + 1]!.stop);
      unsorted.trip[next] = tripIndex;
      unsorted.position[next] = position;
      next += 1;
    }
  });

  const departureOrder = indexes(count).sort(
    (a, b) =>
      unsorted.departureMs[a]! - unsorted.departureMs[b]! ||
      unsorted.arrivalMs[a]! - unsorted.arrivalMs[b]!,
  );
  const departureMs = reordered(unsorted.departureMs, departureOrder);
  const arrivalMs = reordered(unsorted.arrivalMs, departureOrder);
  const byArrival = indexes(count).sort(
    (a, b) => arrivalMs[a]! - arrivalMs[b]! || departureMs[a]! - departureMs[b]!,
  );
  return {
    trips,
    connections: {
      count,
      departureMs,
      arrivalMs,
      fromStop: reordered(unsorted.fromStop, departureOrder),
      toStop: reordered(unsorted.toStop, departureOrder),
      trip: reordered(unsorted.trip, departureOrder),
      position: reordered(unsorted.position, departureOrder),
      byArrival,
    },
  };
}

function indexes(count: number): Int32Array {
  return Int32Array.from({ length: count }, (_, index) => index);
}

function reordered<Column extends Float64Array | Int32Array>(
  column: Column,
  order: Int32Array,
): Column {
  const result = column.slice() as Column;
  order.forEach((sourceIndex, targetIndex) => {
    result[targetIndex] = column[sourceIndex]!;
  });
  return result;
}
