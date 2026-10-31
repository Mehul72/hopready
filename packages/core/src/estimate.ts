import { HUB_TIMES_BY_STATION, HUBS, type HubPeriod } from './data/park-and-ride-hub-times';
import { haversineMetres, type Coordinate } from './geo';
import { sydneyWallClock } from './time';
import { walkBetween, type WalkingSpeed } from './walking';

// Estimates used only to decide which car parks are worth asking the providers about, and to say
// roughly how long the others would take. Never shown as a trip time.

// Rough public transport speed for places the hub table does not cover.
const ROAD_DISTANCE_FACTOR = 1.35;
const ROUGH_TRANSIT_METRES_PER_MINUTE = 583;
const ROUGH_TRANSIT_OVERHEAD_MINUTES = 8;
// Past this straight-line distance from a hub, the last stretch is another ride, not a walk.
const WALKABLE_FROM_HUB_METRES = 1_500;
// Changing at the hub onto whatever reaches the destination.
const CHANGE_AT_HUB_MINUTES = 5;
// A minute waiting or walking weighs more than a minute on board when people choose a route
// (Transport for NSW and ATAP appraisal guidance), so the choice between car parks uses these
// weights while the minutes shown stay plain.
const WAIT_WEIGHT = 1.4;
const WALK_WEIGHT = 1.5;

const MINUTES_PER_HOUR = 60;
const MORNING_PEAK = { fromHour: 6, toHour: 10 };
const AFTERNOON_PEAK = { fromHour: 15, toHour: 19 };

export interface TransitOrigin {
  coordinate: Coordinate;
  stopId?: string;
}

// Which column of the hub table describes the services at this time: weekends, weekday peaks, or
// the rest of the weekday, where the evening recording stands in for the off-peak.
export function hubPeriodFor(instant: string | Date): HubPeriod {
  const wall = sydneyWallClock(instant);
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return 'weekend';
  const minute = wall.hour * MINUTES_PER_HOUR + wall.minute;
  const inPeak = (peak: { fromHour: number; toHour: number }) =>
    minute >= peak.fromHour * MINUTES_PER_HOUR && minute < peak.toHour * MINUTES_PER_HOUR;
  return inPeak(MORNING_PEAK) || inPeak(AFTERNOON_PEAK) ? 'weekday-peak' : 'weekday-evening';
}

export interface TransitEstimate {
  // Plain minutes, for saying roughly how long an untried car park would take.
  minutes: number;
  // Weighted minutes, for choosing between car parks: waiting and walking count for more.
  cost: number;
}

// From a platform to the destination's door: the recorded ride to the best hub, half the service
// interval waiting for it, then on from the hub on foot or by another ride; or a rough straight-line
// ride when no hub route beats it or the table has no row for the stop. The best hub is the one a
// person would choose, by weighted minutes, and its plain minutes are what gets reported.
export function estimateTransit(
  from: TransitOrigin,
  to: Coordinate,
  period: HubPeriod,
  speed: WalkingSpeed,
): TransitEstimate {
  const rough = roughRideMinutes(from.coordinate, to);
  let best: TransitEstimate = { minutes: rough, cost: rough };
  const byHub = from.stopId === undefined ? undefined : HUB_TIMES_BY_STATION[from.stopId];
  if (!byHub) return best;
  for (const hub of HUBS) {
    const time = byHub[hub.id]?.[period];
    if (!time) continue;
    const [rideMinutes, headwayMinutes] = time;
    const waitMinutes = headwayMinutes / 2;
    const onward = onwardFromHub(hub.coordinate, to, speed);
    const viaHub = {
      minutes: rideMinutes + waitMinutes + onward.minutes,
      cost: rideMinutes + waitMinutes * WAIT_WEIGHT + onward.cost,
    };
    if (viaHub.cost < best.cost) best = viaHub;
  }
  return best;
}

export function estimateTransitMinutes(
  from: TransitOrigin,
  to: Coordinate,
  period: HubPeriod,
  speed: WalkingSpeed,
): number {
  return estimateTransit(from, to, period, speed).minutes;
}

// Walking weighs more than riding when choosing between car parks.
export function walkCost(walkMinutes: number): number {
  return walkMinutes * WALK_WEIGHT;
}

function onwardFromHub(hub: Coordinate, to: Coordinate, speed: WalkingSpeed): TransitEstimate {
  if (haversineMetres(hub, to) <= WALKABLE_FROM_HUB_METRES) {
    const walkMinutes = walkBetween(hub, to, speed).durationSeconds / MINUTES_PER_HOUR;
    return { minutes: walkMinutes, cost: walkCost(walkMinutes) };
  }
  const minutes = CHANGE_AT_HUB_MINUTES + roughRideMinutes(hub, to);
  return { minutes, cost: minutes };
}

export function roughRideMinutes(from: Coordinate, to: Coordinate): number {
  return (
    (haversineMetres(from, to) * ROAD_DISTANCE_FACTOR) / ROUGH_TRANSIT_METRES_PER_MINUTE +
    ROUGH_TRANSIT_OVERHEAD_MINUTES
  );
}
