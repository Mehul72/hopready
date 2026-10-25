import { describe, expect, it } from 'vitest';

import { haversineMetres } from '../geo';
import { findContinuityIssues, legSeconds, transitLegsOf } from '../itinerary';
import { legSchema, type Leg, type Place, type TransitLeg, type WalkLeg } from '../model';
import { ProviderError, type TransitJourney, type TransitQuery } from '../providers';
import { formatSydneyTime, secondsBetween } from '../time';
import { DEMO_PLACES } from './places';
import { STOPS, type NetworkStop } from './stops';
import { createDemoTransitProvider } from './transit-provider';
import type { DemoScenario } from './scenarios';

const TUESDAY_0740 = '2026-10-26T20:40:00Z';
const TUESDAY_0900 = '2026-10-26T22:00:00Z';
const TUESDAY_1000 = '2026-10-26T23:00:00Z';
const NEXT_TUESDAY_0740 = '2026-11-02T20:40:00Z';
const NEXT_TUESDAY_1000 = '2026-11-02T23:00:00Z';

const signal = () => new AbortController().signal;

function stopPlace(stop: NetworkStop): Place {
  return { name: stop.name, coordinate: stop.coordinate, kind: 'stop', stopId: stop.id };
}

function query(overrides: Partial<TransitQuery> = {}): TransitQuery {
  return {
    from: DEMO_PLACES.rouseHillHome,
    to: DEMO_PLACES.barangarooOffice,
    time: { type: 'depart', at: TUESDAY_0740 },
    maxJourneys: 4,
    maxWalkMinutes: 15,
    walkingSpeed: 'normal',
    excludedModes: [],
    ...overrides,
  };
}

function plan(
  transitQuery: TransitQuery,
  options: { now?: string; scenario?: DemoScenario } = {},
): Promise<TransitJourney[]> {
  const provider = createDemoTransitProvider({
    clock: { now: () => new Date(options.now ?? transitQuery.time.at) },
    scenario: options.scenario ?? 'normal',
  });
  return provider.planJourneys(transitQuery, signal());
}

// formatSydneyTime uses a no-break space before "am"; plain spaces keep the expectations readable.
const clockTime = (iso: string) => formatSydneyTime(iso).replace(/\u00a0/g, ' ');
const times = (leg: Leg) => `${clockTime(leg.start)} to ${clockTime(leg.end)}`;
const firstLeg = (journey: TransitJourney) => journey.legs[0]!;
const lastLeg = (journey: TransitJourney) => journey.legs[journey.legs.length - 1]!;
const walksOf = (journey: TransitJourney) =>
  journey.legs.filter((leg): leg is WalkLeg => leg.kind === 'walk');

describe('depart at', () => {
  it('finds the timetabled M1 from Rouse Hill with the walks either side', async () => {
    const [first] = await plan(query());

    // 881 m of walking at 1.3 m/s is 12 minutes, which misses the 7.50 am metro by two minutes.
    expect(first!.legs.map((leg) => `${leg.kind} ${times(leg)}`)).toEqual([
      'walk 7:42 am to 7:54 am',
      'transit 7:54 am to 8:38 am',
      'walk 8:38 am to 8:47 am',
    ]);
    const metro = transitLegsOf(first!.legs)[0]!;
    expect(metro.service).toEqual({
      name: 'M1',
      description: 'Metro North West & Bankstown Line',
      headsign: 'Sydenham',
      operator: 'Sydney Metro',
    });
    expect(metro.mode).toBe('metro');
    expect(metro.stopCount).toBe(14);
  });

  it('offers later services in order, none leaving before the requested time', async () => {
    const journeys = await plan(query());

    expect(journeys).toHaveLength(4);
    const departures = journeys.map((journey) => Date.parse(firstLeg(journey).start));
    expect(departures).toEqual([...departures].sort((a, b) => a - b));
    expect(new Set(departures).size).toBe(4);
    for (const journey of journeys) {
      expect(secondsBetween(TUESDAY_0740, firstLeg(journey).start)).toBeGreaterThanOrEqual(0);
      expect(findContinuityIssues(journey.legs)).toEqual([]);
      expect(firstLeg(journey).from).toEqual(DEMO_PLACES.rouseHillHome);
      expect(lastLeg(journey).to).toEqual(DEMO_PLACES.barangarooOffice);
      for (const leg of journey.legs) expect(() => legSchema.parse(leg)).not.toThrow();
    }
  });

  it('returns at most the number of journeys asked for', async () => {
    expect(await plan(query({ maxJourneys: 2 }))).toHaveLength(2);
  });

  it('gives the same answer, ids included, for the same question', async () => {
    expect(await plan(query())).toEqual(await plan(query()));
  });
});

describe('arrive by', () => {
  it('arrives in time and leaves as late as the timetable allows', async () => {
    const journeys = await plan(query({ time: { type: 'arrive', at: TUESDAY_0900 } }));

    expect(journeys.length).toBeGreaterThan(0);
    for (const journey of journeys) {
      expect(secondsBetween(lastLeg(journey).end, TUESDAY_0900)).toBeGreaterThanOrEqual(0);
    }
    const latest = journeys[journeys.length - 1]!;
    const leaveLater = await plan(
      query({
        time: {
          type: 'depart',
          at: new Date(Date.parse(firstLeg(latest).start) + 60_000).toISOString(),
        },
      }),
    );
    expect(secondsBetween(lastLeg(leaveLater[0]!).end, TUESDAY_0900)).toBeLessThan(0);
  });

  it('lists the options in departure order', async () => {
    const journeys = await plan(query({ time: { type: 'arrive', at: TUESDAY_0900 } }));
    const departures = journeys.map((journey) => Date.parse(firstLeg(journey).start));

    expect(departures).toEqual([...departures].sort((a, b) => a - b));
  });
});

describe('walking', () => {
  it('times walks at the chosen speed over 1.3 times the straight-line distance', async () => {
    const fast = await plan(query({ walkingSpeed: 'fast' }));
    const slow = await plan(query({ walkingSpeed: 'slow', maxWalkMinutes: 20 }));
    const walkTo = (journey: TransitJourney) => walksOf(journey)[0]!;
    const straightMetres = haversineMetres(
      DEMO_PLACES.rouseHillHome.coordinate,
      STOPS.rouseHill.coordinate,
    );

    expect(walkTo(fast[0]!).distanceMetres).toBe(Math.round(straightMetres * 1.3));
    expect(legSeconds(walkTo(fast[0]!))).toBe(Math.ceil((straightMetres * 1.3) / 1.6 / 60) * 60);
    expect(legSeconds(walkTo(slow[0]!))).toBe(Math.ceil((straightMetres * 1.3) / 0.9 / 60) * 60);
  });

  it('finds nothing when every stop is further than the walking limit', async () => {
    expect(await plan(query({ maxWalkMinutes: 5 }))).toEqual([]);
    expect(await plan(query({ walkingSpeed: 'slow' }))).toEqual([]);
    expect(await plan(query({ from: DEMO_PLACES.boxHillHome }))).toEqual([]);
  });

  it('starts at the stop itself, without a walk, when the origin is a stop', async () => {
    const [journey] = await plan(query({ from: stopPlace(STOPS.rouseHill) }));

    expect(firstLeg(journey!).kind).toBe('transit');
    expect(firstLeg(journey!).from.stopId).toBe(STOPS.rouseHill.id);
  });

  it('changes between linked stops on foot', async () => {
    const journeys = await plan(
      query({
        from: stopPlace(STOPS.monaVale),
        to: stopPlace(STOPS.waterloo),
        time: { type: 'depart', at: TUESDAY_1000 },
        excludedModes: ['train'],
      }),
    );
    const journey = journeys[0]!;
    const transfer = journey.legs.find(
      (leg, index) => leg.kind === 'walk' && index > 0 && index < journey.legs.length - 1,
    )!;
    const [bus, metro] = [
      journey.legs[journey.legs.indexOf(transfer) - 1],
      journey.legs[journey.legs.indexOf(transfer) + 1],
    ];

    expect(bus).toMatchObject({ kind: 'transit', service: { name: 'B1' } });
    expect(transfer.from.stopId).toBe(STOPS.wynyard.id);
    expect(transfer.to.stopId).toBe(STOPS.martinPlace.id);
    expect(transfer.start).toBe(bus!.end);
    expect(metro).toMatchObject({ kind: 'transit', service: { name: 'M1' } });
    expect(secondsBetween(transfer.end, metro!.start)).toBeGreaterThanOrEqual(0);
  });

  it('offers the walk itself, not a ride that is slower than walking the whole way', async () => {
    const station = stopPlace(STOPS.chatswood);
    const leaving = await plan(query({ from: DEMO_PLACES.chatswoodOffice, to: station }));
    const arriving = await plan(
      query({
        from: DEMO_PLACES.chatswoodOffice,
        to: station,
        time: { type: 'arrive', at: TUESDAY_0900 },
      }),
    );

    expect(leaving.map((journey) => journey.legs.map((leg) => leg.kind))).toEqual([['walk']]);
    expect(firstLeg(leaving[0]!)).toMatchObject({
      from: DEMO_PLACES.chatswoodOffice,
      to: station,
      start: '2026-10-26T20:40:00.000Z',
      source: 'demo-fixture',
      timing: 'estimated',
    });
    expect(arriving.map((journey) => journey.legs.map((leg) => leg.kind))).toEqual([['walk']]);
    expect(lastLeg(arriving[0]!).end).toBe('2026-10-26T22:00:00.000Z');
    expect(legSeconds(lastLeg(arriving[0]!))).toBe(legSeconds(firstLeg(leaving[0]!)));
  });

  it('has no journey for a trip that is already there', async () => {
    const station = stopPlace(STOPS.chatswood);

    expect(await plan(query({ from: station, to: station }))).toEqual([]);
  });
});

describe('changing services at one stop', () => {
  it('allows at least the 3 minute minimum change', async () => {
    const journeys = await plan(
      query({
        from: stopPlace(STOPS.hornsby),
        to: DEMO_PLACES.barangarooOffice,
        time: { type: 'depart', at: TUESDAY_1000 },
      }),
    );

    const changes = journeys.flatMap((journey) => {
      const legs = transitLegsOf(journey.legs);
      return legs.slice(1).map((leg, index) => ({
        sameStop: leg.from.stopId === legs[index]!.to.stopId,
        seconds: secondsBetween(legs[index]!.end, leg.start),
      }));
    });
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes.filter(({ sameStop }) => sameStop)) {
      expect(change.seconds).toBeGreaterThanOrEqual(180);
    }
  });
});

describe('modes', () => {
  it('leaves out excluded modes', async () => {
    const journeys = await plan(
      query({
        from: DEMO_PLACES.chatswoodOffice,
        to: DEMO_PLACES.queenVictoriaBuilding,
        time: { type: 'depart', at: TUESDAY_1000 },
        excludedModes: ['metro'],
      }),
    );

    expect(journeys.length).toBeGreaterThan(0);
    for (const journey of journeys) {
      const modes = transitLegsOf(journey.legs).map((leg) => leg.mode);
      expect(modes).not.toContain('metro');
      expect(modes).toContain('train');
    }
  });

  it('finds nothing when every mode that serves the trip is excluded', async () => {
    expect(await plan(query({ excludedModes: ['metro'] }))).toEqual([]);
  });
});

describe('transit legs', () => {
  it('carry the stop path, modelled platforms and nothing invented', async () => {
    const [journey] = await plan(
      query({
        from: DEMO_PLACES.chatswoodOffice,
        to: DEMO_PLACES.queenVictoriaBuilding,
        time: { type: 'depart', at: TUESDAY_1000 },
      }),
    );
    const metro = transitLegsOf(journey!.legs)[0]!;

    expect(metro.from.stopId).toBe(STOPS.chatswood.id);
    expect(metro.to.stopId).toBe(STOPS.gadigal.id);
    expect(metro.departurePlatform).toBe('2');
    expect(metro.arrivalPlatform).toBeNull();
    expect(metro.path).toEqual([
      STOPS.chatswood.coordinate,
      STOPS.crowsNest.coordinate,
      STOPS.victoriaCross.coordinate,
      STOPS.barangaroo.coordinate,
      STOPS.martinPlace.coordinate,
      STOPS.gadigal.coordinate,
    ]);
    expect(metro.stopCount).toBe(5);
    expect(metro.alerts).toEqual([]);
    expect(journey!.fare).toEqual({ status: 'unknown' });
  });

  it('leaves platforms out where the timetable does not give one', async () => {
    const [journey] = await plan(
      query({ from: DEMO_PLACES.barangarooOffice, to: DEMO_PLACES.rouseHillHome }),
    );
    const metro = transitLegsOf(journey!.legs)[0]!;

    expect(metro.from.stopId).toBe(STOPS.barangaroo.id);
    expect(metro.departurePlatform).toBeNull();
    expect(metro.to.stopId).toBe(STOPS.rouseHill.id);
    expect(metro.arrivalPlatform).toBe('2');
  });

  it('labels live times only for services running soon, and never for route 280', async () => {
    const soon = await plan(query(), { now: TUESDAY_0740 });
    const nextWeek = await plan(query({ time: { type: 'depart', at: NEXT_TUESDAY_1000 } }), {
      now: TUESDAY_0740,
    });
    const feeder = await plan(
      query({
        from: DEMO_PLACES.warringahMall,
        to: stopPlace(STOPS.chatswood),
        time: { type: 'depart', at: TUESDAY_1000 },
        excludedModes: ['metro', 'train'],
      }),
    );
    const legsOf = (journeys: TransitJourney[]) =>
      journeys.flatMap((journey) => transitLegsOf(journey.legs));
    const isLabelledHonestly = (leg: TransitLeg) =>
      (leg.timing === 'realtime') === (leg.realtimeTripId !== null);

    expect(legsOf(soon).some((leg) => leg.timing === 'realtime')).toBe(true);
    expect(legsOf(nextWeek).every((leg) => leg.timing === 'scheduled')).toBe(true);
    const routes280 = legsOf(feeder).filter((leg) => leg.service.name === '280');
    expect(routes280.length).toBeGreaterThan(0);
    expect(routes280.every((leg) => leg.timing === 'scheduled')).toBe(true);
    expect(
      [...legsOf(soon), ...legsOf(nextWeek), ...legsOf(feeder)].every(isLabelledHonestly),
    ).toBe(true);
  });
});

describe('scenarios and input', () => {
  it('returns no journeys in the no-route scenario', async () => {
    expect(await plan(query(), { scenario: 'no-route' })).toEqual([]);
  });

  it('marks cancelled services instead of hiding them, with an alert', async () => {
    const journeys = await plan(query(), { scenario: 'cancelled-service' });
    const metros = journeys.flatMap((journey) => transitLegsOf(journey.legs));

    expect(metros.some((leg) => leg.cancelled)).toBe(true);
    expect(metros.some((leg) => !leg.cancelled)).toBe(true);
    for (const leg of metros) {
      expect(leg.alerts.map((alert) => alert.id)).toEqual(['demo-m1-morning-cancellations']);
    }
  });

  it('labels a cancellation outside the live window as timetable information', async () => {
    const journeys = await plan(query({ time: { type: 'depart', at: NEXT_TUESDAY_0740 } }), {
      now: TUESDAY_0740,
      scenario: 'cancelled-service',
    });
    const cancelled = journeys
      .flatMap((journey) => transitLegsOf(journey.legs))
      .filter((leg) => leg.cancelled);

    expect(cancelled.length).toBeGreaterThan(0);
    for (const leg of cancelled) {
      expect(leg.timing).toBe('scheduled');
      expect(leg.realtimeTripId).toBeNull();
    }
  });

  it('rejects a malformed query as a rejected request', async () => {
    await expect(plan(query({ maxJourneys: 0 }))).rejects.toMatchObject({
      provider: 'demo-fixture',
      failure: 'rejected-request',
    });
    await expect(plan(query({ time: { type: 'depart', at: 'tomorrow' } }))).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('reports an already cancelled request as a timeout', async () => {
    const provider = createDemoTransitProvider({
      clock: { now: () => new Date(TUESDAY_0740) },
      scenario: 'normal',
    });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.planJourneys(query(), controller.signal)).rejects.toMatchObject({
      failure: 'timeout',
    });
  });
});
