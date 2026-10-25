import { describe, expect, it } from 'vitest';

import type { Place } from '../model';
import type { TransitQuery } from '../providers';
import { DEMO_PLACES } from './places';
import { scenarioSettings } from './scenarios';
import { NETWORK_STOPS, STOPS, WALKING_LINKS, type NetworkStop } from './stops';
import { stopIndexOf, timetableWindowAround, type TimetableWindow } from './timetable';
import { createDemoTransitProvider } from './transit-provider';
import { walkBetween, type WalkingSpeed } from './walking';

// Checks the connection scan against a separate, slower search over the same trips: Dijkstra on
// (stop, arrived on foot or on a vehicle) states. If both agree on the earliest arrival for many
// trips at many times of day, the scan's shortcuts are not losing journeys.

const SETTINGS = scenarioSettings('normal');
const MINIMUM_CHANGE_MS = SETTINGS.minimumChangeMinutes * 60_000;
const MAX_WALK_MINUTES = 15;
const SPEED: WalkingSpeed = 'normal';

const stopPlace = (stop: NetworkStop): Place => ({
  name: stop.name,
  coordinate: stop.coordinate,
  kind: 'stop',
  stopId: stop.id,
});

const ENDPOINTS: Place[] = [
  DEMO_PLACES.rouseHillHome,
  DEMO_PLACES.barangarooOffice,
  DEMO_PLACES.macquarieParkOffice,
  DEMO_PLACES.warringahMall,
  DEMO_PLACES.centralOffice,
  DEMO_PLACES.collaroyHome,
  DEMO_PLACES.queenVictoriaBuilding,
  stopPlace(STOPS.hornsby),
  stopPlace(STOPS.monaVale),
  stopPlace(STOPS.sydenham),
  stopPlace(STOPS.northSydney),
  stopPlace(STOPS.allanStreetToChatswood),
];

const TIMES = [
  '2026-10-26T19:12:00Z', // Tuesday 6.12 am
  '2026-10-26T21:47:00Z', // Tuesday 8.47 am
  '2026-10-27T02:03:00Z', // Tuesday 1.03 pm
  '2026-10-27T07:31:00Z', // Tuesday 6.31 pm
  '2026-10-27T11:58:00Z', // Tuesday 10.58 pm
  '2026-10-31T00:20:00Z', // Saturday 11.20 am
];

function walksNear(place: Place): Map<number, number> {
  const walks = new Map<number, number>();
  NETWORK_STOPS.forEach((stop, index) => {
    if (place.stopId === stop.id) {
      walks.set(index, 0);
      return;
    }
    const walk = walkBetween(place.coordinate, stop.coordinate, SPEED);
    if (walk.durationSeconds > MAX_WALK_MINUTES * 60) return;
    walks.set(index, walk.durationSeconds * 1_000);
  });
  return walks;
}

function linkWalks(): Map<number, { stop: number; ms: number }[]> {
  const links = new Map<number, { stop: number; ms: number }[]>();
  for (const [first, second] of WALKING_LINKS) {
    const ms = walkBetween(first.coordinate, second.coordinate, SPEED).durationSeconds * 1_000;
    if (ms > MAX_WALK_MINUTES * 60_000) continue;
    for (const [from, to] of [
      [first, second],
      [second, first],
    ] as const) {
      const list = links.get(stopIndexOf(from)) ?? [];
      list.push({ stop: stopIndexOf(to), ms });
      links.set(stopIndexOf(from), list);
    }
  }
  return links;
}

interface Boarding {
  departureMs: number;
  trip: number;
  position: number;
}

const boardingsCache = new Map<TimetableWindow, Map<number, Boarding[]>>();

// Every boarding opportunity at each stop, in departure order.
function boardingsByStop(window: TimetableWindow): Map<number, Boarding[]> {
  const cached = boardingsCache.get(window);
  if (cached) return cached;
  const boardings = new Map<number, Boarding[]>();
  window.trips.forEach((trip, tripIndex) => {
    trip.direction.calls.slice(0, -1).forEach((call, position) => {
      const stop = stopIndexOf(call.stop);
      const list = boardings.get(stop) ?? [];
      list.push({ departureMs: trip.timesMs[position]!, trip: tripIndex, position });
      boardings.set(stop, list);
    });
  });
  for (const list of boardings.values()) list.sort((a, b) => a.departureMs - b.departureMs);
  boardingsCache.set(window, boardings);
  return boardings;
}

interface State {
  stop: number;
  onFoot: boolean;
  timeMs: number;
}

// A small binary heap ordered by time, so the slow search stays fast enough to run many times.
class StateQueue {
  private readonly states: State[] = [];

  get size(): number {
    return this.states.length;
  }

  push(state: State): void {
    this.states.push(state);
    let index = this.states.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.timeAt(parent) <= this.timeAt(index)) return;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): State {
    const top = this.states[0]!;
    const last = this.states.pop()!;
    if (this.states.length === 0) return top;
    this.states[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.size && this.timeAt(left) < this.timeAt(smallest)) smallest = left;
      if (right < this.size && this.timeAt(right) < this.timeAt(smallest)) smallest = right;
      if (smallest === index) return top;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private timeAt(index: number): number {
    return this.states[index]!.timeMs;
  }

  private swap(first: number, second: number): void {
    const held = this.states[first]!;
    this.states[first] = this.states[second]!;
    this.states[second] = held;
  }
}

// Earliest arrival at the destination, by Dijkstra over every trip in the window.
function dijkstraEarliestArrival(
  window: TimetableWindow,
  from: Place,
  to: Place,
  departAfterMs: number,
): number | null {
  const access = walksNear(from);
  const egress = walksNear(to);
  const links = linkWalks();
  const boardings = boardingsByStop(window);
  const best = new Map<string, number>();
  const settled = new Set<string>();
  const queue = new StateQueue();
  const offer = (stop: number, onFoot: boolean, timeMs: number) => {
    const key = `${stop}:${onFoot}`;
    if (timeMs >= (best.get(key) ?? Number.POSITIVE_INFINITY)) return;
    best.set(key, timeMs);
    queue.push({ stop, onFoot, timeMs });
  };
  for (const [stop, walkMs] of access) offer(stop, true, departAfterMs + walkMs);

  let arrival = Number.POSITIVE_INFINITY;
  const horizonMs = departAfterMs + 12 * 3_600_000;
  while (queue.size > 0) {
    const state = queue.pop();
    const key = `${state.stop}:${state.onFoot}`;
    if (settled.has(key) || state.timeMs >= arrival) continue;
    settled.add(key);

    if (!state.onFoot) {
      const egressMs = egress.get(state.stop);
      if (egressMs !== undefined) arrival = Math.min(arrival, state.timeMs + egressMs);
      for (const link of links.get(state.stop) ?? []) {
        offer(link.stop, true, state.timeMs + link.ms);
      }
    }
    const readyMs = state.timeMs + (state.onFoot ? 0 : MINIMUM_CHANGE_MS);
    for (const boarding of boardings.get(state.stop) ?? []) {
      if (boarding.departureMs < readyMs) continue;
      if (boarding.departureMs > horizonMs || boarding.departureMs >= arrival) break;
      const trip = window.trips[boarding.trip]!;
      const calls = trip.direction.calls;
      for (let later = boarding.position + 1; later < calls.length; later++) {
        offer(stopIndexOf(calls[later]!.stop), false, trip.timesMs[later]!);
      }
    }
  }
  return Number.isFinite(arrival) ? arrival : null;
}

function query(from: Place, to: Place, at: string, type: 'depart' | 'arrive'): TransitQuery {
  return {
    from,
    to,
    time: { type, at },
    maxJourneys: 3,
    maxWalkMinutes: MAX_WALK_MINUTES,
    walkingSpeed: SPEED,
    excludedModes: [],
  };
}

const pairs = ENDPOINTS.flatMap((from) =>
  ENDPOINTS.filter((to) => to !== from).map((to) => [from, to] as const),
);
const provider = createDemoTransitProvider({
  clock: { now: () => new Date(TIMES[0]!) },
  scenario: 'normal',
});

describe('connection scan against an independent search', () => {
  it.each(TIMES)(
    'finds the earliest arrival for every pair of places leaving at %s',
    async (at) => {
      const window = timetableWindowAround(Date.parse(at), SETTINGS.timetable);
      let compared = 0;
      for (const [from, to] of pairs) {
        const expected = dijkstraEarliestArrival(window, from, to, Date.parse(at));
        const journeys = await provider.planJourneys(
          query(from, to, at, 'depart'),
          new AbortController().signal,
        );
        const walkMs = walkBetween(from.coordinate, to.coordinate, SPEED).durationSeconds * 1_000;
        // Rides slower than walking the whole way are dropped on purpose, so skip those pairs.
        if (
          expected !== null &&
          expected >= Date.parse(at) + walkMs &&
          walkMs <= MAX_WALK_MINUTES * 60_000
        ) {
          continue;
        }
        const actual = journeys[0] ? Date.parse(journeys[0].legs.at(-1)!.end) : null;
        expect({ from: from.name, to: to.name, arrival: actual }).toEqual({
          from: from.name,
          to: to.name,
          arrival: expected,
        });
        compared += 1;
      }
      expect(compared).toBeGreaterThan(100);
    },
  );

  it.each(TIMES)('leaves as late as possible for every arrive-by trip ending at %s', async (at) => {
    const window = timetableWindowAround(Date.parse(at), SETTINGS.timetable);
    let compared = 0;
    for (const [from, to] of pairs) {
      const walkMs = walkBetween(from.coordinate, to.coordinate, SPEED).durationSeconds * 1_000;
      // Pairs within walking distance drop rides slower than the walk, so the latest ride shown
      // is not necessarily the latest ride there is.
      if (walkMs <= MAX_WALK_MINUTES * 60_000) continue;
      const journeys = await provider.planJourneys(
        query(from, to, at, 'arrive'),
        new AbortController().signal,
      );
      const latest = journeys.at(-1);
      if (!latest) continue;
      compared += 1;
      const leavesMs = Date.parse(latest.legs[0]!.start);
      const laterArrival = dijkstraEarliestArrival(window, from, to, leavesMs + 60_000);

      expect(Date.parse(latest.legs.at(-1)!.end)).toBeLessThanOrEqual(Date.parse(at));
      expect(laterArrival === null || laterArrival > Date.parse(at)).toBe(true);
    }
    expect(compared).toBeGreaterThan(50);
  });
});
