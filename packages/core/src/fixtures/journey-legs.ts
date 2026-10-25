import type { Coordinate } from '../geo';
import type { Leg, Place, ServiceAlert, TransitLeg, WalkLeg } from '../model';
import type { TransitJourney } from '../providers';
import type { Walk } from '../walking';
import { DEMO_PROVIDER_NAME } from './abort';
import type { JourneyPart, JourneyPlan } from './journey-search';
import { NETWORK_STOPS, type NetworkStop } from './stops';
import type { ScheduledTrip, TimetableWindow } from './timetable';

// Turns a planned journey into the walk and transit legs a TfNSW adapter would return.

export interface LegContext {
  window: TimetableWindow;
  origin: Place;
  destination: Place;
  nowMs: number;
  alertsFor: (trip: ScheduledTrip) => ServiceAlert[];
}

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
// Live times exist only for services about to run or running now, like a real realtime feed.
const REALTIME_LOOKBACK_MS = 60 * MS_PER_MINUTE;
const REALTIME_LOOKAHEAD_MS = 90 * MS_PER_MINUTE;

export function journeyFromPlan(plan: JourneyPlan, context: LegContext): TransitJourney {
  const legs: Leg[] = [];
  let lastArrivalMs = plan.departureMs;

  plan.parts.forEach((part, index) => {
    switch (part.kind) {
      case 'access': {
        const firstDepartureMs = rideDepartureMs(context, plan.parts[index + 1]);
        const startMs = firstDepartureMs - part.walk.durationSeconds * MS_PER_SECOND;
        pushWalk(legs, context.origin, stopPlace(part.stop), startMs, part.walk);
        return;
      }
      case 'ride': {
        const leg = transitLeg(context, part);
        legs.push(leg);
        lastArrivalMs = Date.parse(leg.end);
        return;
      }
      case 'transfer':
        pushWalk(legs, stopPlace(part.fromStop), stopPlace(part.toStop), lastArrivalMs, part.walk);
        return;
      case 'egress':
        pushWalk(legs, stopPlace(part.stop), context.destination, lastArrivalMs, part.walk);
        return;
    }
  });

  return { legs, fare: { status: 'unknown' }, alerts: [] };
}

export function walkOnlyJourney(
  from: Place,
  to: Place,
  startMs: number,
  walk: Walk,
): TransitJourney {
  const legs: Leg[] = [];
  pushWalk(legs, from, to, startMs, walk);
  return { legs, fare: { status: 'unknown' }, alerts: [] };
}

function rideDepartureMs(context: LegContext, part: JourneyPart | undefined): number {
  if (part?.kind !== 'ride') {
    throw new Error('A demo journey must ride straight after its first walk');
  }
  return context.window.trips[part.trip]!.timesMs[part.boardPosition]!;
}

function pushWalk(legs: Leg[], from: Place, to: Place, startMs: number, walk: Walk) {
  // Already at the stop, so there is no walk to show.
  if (walk.durationSeconds === 0) return;
  const endMs = startMs + walk.durationSeconds * MS_PER_SECOND;
  const leg: WalkLeg = {
    id: `demo-walk-${placeKey(from)}-${placeKey(to)}-${compactTime(startMs)}`,
    kind: 'walk',
    from: { ...from, coordinate: copy(from.coordinate) },
    to: { ...to, coordinate: copy(to.coordinate) },
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    source: DEMO_PROVIDER_NAME,
    timing: 'estimated',
    path: [copy(from.coordinate), copy(to.coordinate)],
    distanceMetres: Math.round(walk.distanceMetres),
  };
  legs.push(leg);
}

function transitLeg(context: LegContext, part: Extract<JourneyPart, { kind: 'ride' }>): TransitLeg {
  const trip = context.window.trips[part.trip]!;
  const calls = trip.direction.calls;
  const board = calls[part.boardPosition]!;
  const alight = calls[part.alightPosition]!;
  const start = new Date(trip.timesMs[part.boardPosition]!).toISOString();
  const end = new Date(trip.timesMs[part.alightPosition]!).toISOString();
  const live = isLive(trip, trip.timesMs[part.boardPosition]!, context.nowMs);

  return {
    id: `demo-${trip.key}-${board.stop.id}-${alight.stop.id}`,
    kind: 'transit',
    from: stopPlaceOf(board.stop),
    to: stopPlaceOf(alight.stop),
    start,
    end,
    source: DEMO_PROVIDER_NAME,
    timing: live ? 'realtime' : 'scheduled',
    path: calls
      .slice(part.boardPosition, part.alightPosition + 1)
      .map((call) => copy(call.stop.coordinate)),
    mode: trip.route.mode,
    service: {
      name: trip.route.id,
      description: trip.route.description,
      headsign: trip.direction.headsign,
      operator: trip.route.operator,
    },
    // Demo services always run to timetable, so live and timetabled times agree.
    scheduledStart: start,
    scheduledEnd: end,
    departurePlatform: board.platform,
    arrivalPlatform: alight.platform,
    stopCount: part.alightPosition - part.boardPosition,
    cancelled: trip.cancelled,
    alerts: context.alertsFor(trip),
    realtimeTripId: live ? `demo-${trip.key}` : null,
  };
}

function isLive(trip: ScheduledTrip, departureMs: number, nowMs: number): boolean {
  const withinFeed =
    departureMs >= nowMs - REALTIME_LOOKBACK_MS && departureMs <= nowMs + REALTIME_LOOKAHEAD_MS;
  return trip.realtimeEligible && withinFeed;
}

function stopPlace(stopIndex: number): Place {
  const stop = NETWORK_STOPS[stopIndex];
  if (!stop) throw new Error(`Demo stop ${stopIndex} does not exist`);
  return stopPlaceOf(stop);
}

function stopPlaceOf(stop: NetworkStop): Place {
  return { name: stop.name, coordinate: copy(stop.coordinate), kind: 'stop', stopId: stop.id };
}

function placeKey(place: Place): string {
  return place.stopId ?? place.kind;
}

// "2026-10-26T20:47:00.000Z" becomes "20261026T2047".
function compactTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '');
}

// Legs get their own coordinate objects so a caller that edits one leg cannot change another.
function copy(coordinate: Coordinate): Coordinate {
  return { lat: coordinate.lat, lon: coordinate.lon };
}
