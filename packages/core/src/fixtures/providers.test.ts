import { afterEach, describe, expect, it, vi } from 'vitest';

import { haversineMetres } from '../geo';
import { occupancySchema, placeSchema } from '../model';
import { ProviderError, type DriveTime } from '../providers';
import { secondsBetween } from '../time';
import {
  createDemoProviders,
  DEMO_PLACES,
  DEMO_SCENARIO_IDS,
  DEMO_SCENARIOS,
  demoScenarioSchema,
  type DemoScenario,
} from './index';
import { DEMO_CAR_PARKS } from './car-park-provider';
import { NETWORK_STOPS } from './stops';

const TUESDAY_0630 = '2026-10-26T19:30:00Z';
const TUESDAY_0800 = '2026-10-26T21:00:00Z';
const TUESDAY_0830 = '2026-10-26T21:30:00Z';
const TUESDAY_1100 = '2026-10-27T00:00:00Z';
const TUESDAY_2300 = '2026-10-27T12:00:00Z';
const SATURDAY_0800 = '2026-10-30T21:00:00Z';

const signal = () => new AbortController().signal;
const abortedSignal = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

function providersAt(now: string, scenario: DemoScenario = 'normal') {
  return createDemoProviders({ clock: { now: () => new Date(now) }, scenario });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createDemoProviders', () => {
  it('names every provider as demo data', () => {
    const providers = createDemoProviders();

    expect(providers.transit.name).toBe('demo-fixture');
    expect(providers.driving.name).toBe('demo-fixture');
    expect(providers.carParks.name).toBe('demo-fixture');
    expect(providers.places.name).toBe('demo-fixture');
  });

  it('refuses a scenario it does not know, rather than quietly running another', () => {
    expect(() => createDemoProviders({ scenario: 'everything-is-fine' as DemoScenario })).toThrow();
  });

  it('describes every scenario for the settings picker in plain words', () => {
    expect(DEMO_SCENARIOS.map((scenario) => scenario.id)).toEqual([...DEMO_SCENARIO_IDS]);
    for (const scenario of DEMO_SCENARIOS) {
      expect(demoScenarioSchema.parse(scenario.id)).toBe(scenario.id);
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(`${scenario.title} ${scenario.description}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('demo places', () => {
  it('are valid places inside Greater Sydney, with clearly made-up street addresses', () => {
    for (const place of Object.values(DEMO_PLACES)) {
      expect(placeSchema.parse(place)).toEqual(place);
      if (place.kind === 'address') expect(place.name).toMatch(/^\d+ Example /);
    }
  });

  it('cannot be changed by one caller for everyone else', () => {
    expect(Object.isFrozen(DEMO_PLACES.boxHillHome)).toBe(true);
    expect(Object.isFrozen(DEMO_PLACES.boxHillHome.coordinate)).toBe(true);
  });
});

describe('demo driving', () => {
  const driveMinutes = async (time: DriveTime) => {
    const [estimate] = await providersAt(TUESDAY_0800).driving.estimateDrives(
      DEMO_PLACES.boxHillHome.coordinate,
      [DEMO_PLACES.chatswoodOffice.coordinate],
      time,
      signal(),
    );
    return estimate!.durationSeconds / 60;
  };

  it('is slower in the weekday peaks than at night or on the weekend', async () => {
    const peak = await driveMinutes({ type: 'depart', at: TUESDAY_0800 });
    const midday = await driveMinutes({ type: 'depart', at: TUESDAY_1100 });
    const night = await driveMinutes({ type: 'depart', at: TUESDAY_2300 });
    const weekend = await driveMinutes({ type: 'depart', at: SATURDAY_0800 });

    expect(peak).toBeGreaterThan(midday);
    expect(midday).toBeGreaterThan(night);
    expect(peak).toBeGreaterThan(weekend);
  });

  it('answers an arrive-by time with a drive that fits the traffic before it', async () => {
    const arriving = await driveMinutes({ type: 'arrive', at: TUESDAY_0830 });
    const departing = await driveMinutes({
      type: 'depart',
      at: new Date(Date.parse(TUESDAY_0830) - arriving * 60_000).toISOString(),
    });

    expect(Math.abs(arriving - departing)).toBeLessThan(2);
  });

  it('estimates one drive per destination, with no route outside Greater Sydney', async () => {
    const estimates = await providersAt(TUESDAY_0800).driving.estimateDrives(
      DEMO_PLACES.boxHillHome.coordinate,
      [DEMO_PLACES.chatswoodOffice.coordinate, { lat: -35.2809, lon: 149.13 }],
      { type: 'depart', at: TUESDAY_1100 },
      signal(),
    );

    expect(estimates).toHaveLength(2);
    expect(estimates[0]).toMatchObject({ trafficAware: true });
    expect(estimates[0]!.distanceMetres).toBeGreaterThan(
      haversineMetres(DEMO_PLACES.boxHillHome.coordinate, DEMO_PLACES.chatswoodOffice.coordinate),
    );
    expect(estimates[1]).toBeNull();
  });

  it('routes along a path from the start to the end', async () => {
    const from = DEMO_PLACES.collaroyPlateauHome.coordinate;
    const to = DEMO_PLACES.deeWhyOffice.coordinate;
    const route = await providersAt(TUESDAY_0800).driving.routeDrive(
      from,
      to,
      { type: 'depart', at: TUESDAY_1100 },
      signal(),
    );

    expect(route.path[0]).toEqual(from);
    expect(route.path.at(-1)).toEqual(to);
    expect(route.durationSeconds).toBeGreaterThan(0);
  });

  it('rejects bad input and a cancelled request', async () => {
    const { driving } = providersAt(TUESDAY_0800);
    const time: DriveTime = { type: 'depart', at: TUESDAY_1100 };

    await expect(
      driving.routeDrive({ lat: 91, lon: 0 }, DEMO_PLACES.deeWhyOffice.coordinate, time, signal()),
    ).rejects.toMatchObject({ failure: 'rejected-request' });
    await expect(
      driving.routeDrive(
        DEMO_PLACES.boxHillHome.coordinate,
        { lat: -35.2809, lon: 149.13 },
        time,
        signal(),
      ),
    ).rejects.toMatchObject({ failure: 'rejected-request' });
    await expect(
      driving.estimateDrives(DEMO_PLACES.boxHillHome.coordinate, [], time, abortedSignal()),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });
});

describe('demo car parks', () => {
  it('lists the documented Park&Ride car parks, at their entrance or station', async () => {
    const facilities = await providersAt(TUESDAY_0800).carParks.listFacilities(signal());

    expect(facilities.map((facility) => facility.id)).toEqual(
      DEMO_CAR_PARKS.map((carPark) => carPark.facilityId),
    );
    const networkStops = new Map(NETWORK_STOPS.map((stop) => [stop.id, stop]));
    for (const facility of facilities) {
      const entry = DEMO_CAR_PARKS.find((carPark) => carPark.facilityId === facility.id)!;
      expect(facility.coordinate).toEqual(entry.entrance ?? entry.station.coordinate);
      expect(facility.station).toEqual({
        name: entry.station.name,
        coordinate: networkStops.get(entry.station.stopId)!.coordinate,
        kind: 'stop',
        stopId: entry.station.stopId,
      });
      expect(facility.totalSpaces).toBe(entry.documentedSpaces);
      expect(facility.rules.status).toBe('documented');
    }
  });

  it('reports counts from one to three minutes ago, never more spaces than exist', async () => {
    const ids = DEMO_CAR_PARKS.map((carPark) => carPark.facilityId);
    const counts = await providersAt(TUESDAY_0800).carParks.occupancy(ids, signal());

    for (const [, occupancy] of counts) {
      expect(() => occupancySchema.parse(occupancy)).not.toThrow();
      if (occupancy.status === 'unknown') continue;
      expect(occupancy.status).toBe('known');
      const ageSeconds = secondsBetween(occupancy.observedAt, TUESDAY_0800);
      expect(ageSeconds).toBeGreaterThanOrEqual(60);
      expect(ageSeconds).toBeLessThanOrEqual(180);
      expect(occupancy.spacesAvailable).toBeLessThanOrEqual(occupancy.totalSpaces);
    }
  });

  it('leaves Tallawong P3 without a count, and answers only for car parks it knows', async () => {
    const counts = await providersAt(TUESDAY_0800).carParks.occupancy(
      ['28', '26', 'not-a-car-park'],
      signal(),
    );

    expect(counts.get('28')).toEqual({
      status: 'unknown',
      reason: 'This car park is not reporting a space count.',
    });
    expect(counts.get('26')?.status).toBe('known');
    expect(counts.has('not-a-car-park')).toBe(false);
  });

  it('fills car parks through the weekday morning peak', async () => {
    const free = async (now: string) => {
      const counts = await providersAt(now).carParks.occupancy(['26', '27', '29', '13'], signal());
      return [...counts.values()].map((occupancy) =>
        occupancy.status === 'unknown' ? Number.NaN : occupancy.spacesAvailable,
      );
    };
    const early = await free(TUESDAY_0630);
    const peak = await free(TUESDAY_0830);

    early.forEach((spaces, index) => expect(peak[index]).toBeLessThan(spaces));
  });

  it('serves hours-old counts in the stale-occupancy scenario', async () => {
    const counts = await providersAt(TUESDAY_0800, 'stale-occupancy').carParks.occupancy(
      ['26', '29'],
      signal(),
    );

    for (const [, occupancy] of counts) {
      expect(occupancy.status).toBe('known');
      if (occupancy.status === 'known') {
        expect(secondsBetween(occupancy.observedAt, TUESDAY_0800)).toBeGreaterThanOrEqual(3 * 3600);
      }
    }
  });
});

describe('demo place search', () => {
  const search = (query: string, near = DEMO_PLACES.chatswoodOffice.coordinate) =>
    providersAt(TUESDAY_0800).places.search(query, near, signal());

  it('matches the start of words in any letter case and labels demo addresses', async () => {
    const lower = await search('chats');
    const upper = await search('CHATS');

    expect(upper).toEqual(lower);
    expect(lower.map((suggestion) => suggestion.place.name)).toEqual([
      'Chatswood Station',
      '1 Example Street, Chatswood',
    ]);
    expect(lower[0]!.place).toMatchObject({ kind: 'stop', stopId: '206710' });
    expect(lower[0]!.detail).toBe('Chatswood, served by M1, T1 and 280');
    expect(lower[1]!.detail).toBe('Demo office in Chatswood');
  });

  it('finds stops, addresses and landmarks, nearest first among equal matches', async () => {
    const results = await search('rouse', DEMO_PLACES.rouseHillHome.coordinate);

    expect(new Set(results.map((suggestion) => suggestion.place.kind))).toEqual(
      new Set(['stop', 'address', 'poi']),
    );
    const examples = await search('example', DEMO_PLACES.rouseHillHome.coordinate);
    expect(examples[0]!.place).toEqual(DEMO_PLACES.rouseHillHome);
  });

  it('finds a stop by its suburb', async () => {
    const results = await search('brookvale');

    expect(results.map((suggestion) => suggestion.place.name)).toContain(
      'Warringah Mall, Pittwater Rd',
    );
  });

  it('returns nothing for an empty or unmatched query, and rejects an overlong one', async () => {
    expect(await search('   ')).toEqual([]);
    expect(await search('zzzz')).toEqual([]);
    await expect(search('a'.repeat(201))).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('failure scenarios', () => {
  const query = {
    from: DEMO_PLACES.rouseHillHome,
    to: DEMO_PLACES.barangarooOffice,
    time: { type: 'depart' as const, at: TUESDAY_0800 },
    maxJourneys: 4,
    walkingSpeed: 'normal' as const,
    excludedModes: [],
  };

  it('waits for the caller to give up in the provider-timeout scenario', async () => {
    const controller = new AbortController();
    const waiting = providersAt(TUESDAY_0800, 'provider-timeout').transit.planJourneys(
      query,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 10);

    await expect(waiting).rejects.toMatchObject({ provider: 'demo-fixture', failure: 'timeout' });
  });

  it('stops waiting on its own when nobody ever cancels', async () => {
    vi.useFakeTimers();
    const waiting = providersAt(TUESDAY_0800, 'provider-timeout').transit.planJourneys(
      query,
      signal(),
    );
    const outcome = expect(waiting).rejects.toMatchObject({ failure: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000);

    await outcome;
  });

  it('asks the caller to retry after 30 seconds in the rate-limited scenario', async () => {
    const failure = await providersAt(TUESDAY_0800, 'rate-limited')
      .transit.planJourneys(query, signal())
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({
      provider: 'demo-fixture',
      failure: 'rate-limited',
      retryAfterSeconds: 30,
      isRetryable: true,
    });
  });

  it('keeps driving, car parks and search working while public transport fails', async () => {
    for (const scenario of ['provider-timeout', 'rate-limited', 'no-route'] as const) {
      const providers = providersAt(TUESDAY_0800, scenario);
      await expect(providers.carParks.listFacilities(signal())).resolves.toHaveLength(
        DEMO_CAR_PARKS.length,
      );
      await expect(providers.places.search('chats', null, signal())).resolves.not.toEqual([]);
      await expect(
        providers.driving.estimateDrives(
          DEMO_PLACES.boxHillHome.coordinate,
          [DEMO_PLACES.chatswoodOffice.coordinate],
          { type: 'depart', at: TUESDAY_0800 },
          signal(),
        ),
      ).resolves.toHaveLength(1);
    }
  });
});
