import { type Itinerary, legSeconds, secondsBetween } from '@hopready/core';

export const RESULT_ORDERS = [
  'earliest-arrival',
  'least-driving',
  'fewest-changes',
  'leave-latest',
] as const;
export type ResultOrder = (typeof RESULT_ORDERS)[number];

export const RESULT_ORDER_LABELS: Readonly<Record<ResultOrder, string>> = {
  'earliest-arrival': 'Earliest arrival',
  'least-driving': 'Least driving',
  'fewest-changes': 'Fewest changes',
  'leave-latest': 'Leave latest',
};

export type RequestTimeType = 'depart' | 'arrive';

// "Leave latest" only means something when the person gave an arrive-by time.
export function ordersFor(timeType: RequestTimeType): ResultOrder[] {
  return timeType === 'arrive'
    ? ['leave-latest', 'earliest-arrival', 'least-driving', 'fewest-changes']
    : ['earliest-arrival', 'least-driving', 'fewest-changes'];
}

export function defaultOrderFor(timeType: RequestTimeType): ResultOrder {
  return timeType === 'arrive' ? 'leave-latest' : 'earliest-arrival';
}

// Time behind the wheel. A drop-off ride is someone else driving, so it does not count.
export function selfDriveSeconds(itinerary: Itinerary): number {
  return itinerary.legs
    .filter((leg) => leg.kind === 'drive')
    .reduce((total, leg) => total + legSeconds(leg), 0);
}

type Comparison = (a: Itinerary, b: Itinerary) => number;

const arrivesEarlier: Comparison = (a, b) => secondsBetween(b.arriveAt, a.arriveAt);
const leavesLater: Comparison = (a, b) => secondsBetween(a.departAt, b.departAt);

const COMPARISONS: Readonly<Record<ResultOrder, Comparison>> = {
  'earliest-arrival': (a, b) => arrivesEarlier(a, b) || leavesLater(a, b),
  'least-driving': (a, b) => selfDriveSeconds(a) - selfDriveSeconds(b),
  'fewest-changes': (a, b) => a.transfers - b.transfers,
  'leave-latest': (a, b) => leavesLater(a, b) || arrivesEarlier(a, b),
};

// The sort is stable, so ties keep the planner's order, which already suits the request:
// earliest arrival for "depart at", latest departure for "arrive by".
export function orderItineraries(
  itineraries: readonly Itinerary[],
  order: ResultOrder,
): Itinerary[] {
  return [...itineraries].sort(COMPARISONS[order]);
}
