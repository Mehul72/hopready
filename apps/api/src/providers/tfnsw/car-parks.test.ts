import { ProviderError, STANDARD_PARK_AND_RIDE_RULES, type Clock } from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { observedAtFromMessageDate } from './car-parks';
import type { TfnswDiagnostic } from './diagnostics';
import { createTfnswProviders } from './index';
import {
  fakeFetch,
  jsonResponse,
  loadFixture,
  loadFixtureCopy,
  neverAborted,
  type FakeFetch,
} from './test-support';

const HOUR_MS = 3_600_000;
const unavailable = () => new Response('', { status: 503 });

type Overrides = Record<string, () => Response>;

// Answers like the Car Park API: the list without `facility`, one car park with it. Overrides are
// keyed by facility ID, or 'list'.
function carParkApi(overrides: Overrides = {}): FakeFetch {
  return fakeFetch((url) => {
    const facilityId = url.searchParams.get('facility');
    const override = overrides[facilityId ?? 'list'];
    if (override) return override();
    if (facilityId === null) return jsonResponse(loadFixture('carpark-list.schema-sample.json'));
    return jsonResponse(loadFixture(`carpark-facility-${facilityId}.schema-sample.json`));
  });
}

function setUp(fetchImpl: FakeFetch) {
  let nowMs = Date.parse('2026-10-25T20:46:00Z');
  const clock: Clock = { now: () => new Date(nowMs) };
  const diagnostics: TfnswDiagnostic[] = [];
  const { carParks } = createTfnswProviders({
    apiKey: 'test-key',
    fetchImpl,
    clock,
    requestsPerSecond: 1_000,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    carParks,
    diagnostics,
    advanceClock: (ms: number) => {
      nowMs += ms;
    },
  };
}

function facilityIdsAsked(fetchImpl: FakeFetch): (string | null)[] {
  return fetchImpl.requests.map((request) => request.url.searchParams.get('facility'));
}

describe('TfNSW car park facilities', () => {
  it('reads the list, then each facility, skipping the historical-only IDs 1 to 5', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);

    await carParks.listFacilities(neverAborted());

    expect(fetchImpl.requests.every((request) => request.url.pathname === '/v1/carpark')).toBe(
      true,
    );
    const asked = facilityIdsAsked(fetchImpl);
    expect(asked[0]).toBeNull();
    expect(asked.slice(1).sort()).toEqual(['10', '26', '27', '486', '7']);
  });

  it('describes each car park from the feed, with the catalogue station and rules', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const byId = new Map(facilities.map((facility) => [facility.id, facility]));

    expect(byId.get('26')).toEqual({
      id: '26',
      name: 'Park&Ride - Tallawong P1',
      coordinate: { lat: -33.69304704, lon: 150.9052577 },
      kind: 'transport-park-and-ride',
      stationName: 'Tallawong Station',
      totalSpaces: 121,
      rules: STANDARD_PARK_AND_RIDE_RULES,
      station: {
        name: 'Tallawong Station',
        stopId: '2155384',
        coordinate: { lat: -33.69163, lon: 150.906022 },
        kind: 'stop',
      },
    });
  });

  it('uses the stop number as the station of a car park the catalogue does not know', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const ashfield = facilities.find((facility) => facility.id === '486');

    expect(ashfield).toMatchObject({
      name: 'Park&Ride - Ashfield',
      coordinate: { lat: -33.888104, lon: 151.126577 },
      totalSpaces: 216,
      rules: STANDARD_PARK_AND_RIDE_RULES,
      stationName: 'Park&Ride - Ashfield',
      station: {
        name: 'Park&Ride - Ashfield',
        stopId: '213110',
        coordinate: { lat: -33.888104, lon: 151.126577 },
        kind: 'stop',
      },
    });
  });

  it('falls back to the catalogue when the feed has no usable entrance', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const byId = new Map(facilities.map((facility) => [facility.id, facility]));

    // Tallawong P2 has no location in the feed and no catalogued entrance: the station it serves.
    expect(byId.get('27')?.coordinate).toEqual({ lat: -33.69163, lon: 150.906022 });
    // Warriewood's feed latitude has lost its minus sign, as in the documentation's table.
    expect(byId.get('10')?.coordinate).toEqual({ lat: -33.697777, lon: 151.300667 });
    expect(byId.get('10')?.totalSpaces).toBe(244);
  });

  it('leaves out a car park it cannot place, and says which', async () => {
    const { carParks, diagnostics } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());

    expect(facilities.map((facility) => facility.id).sort()).toEqual(['10', '26', '27', '486']);
    expect(diagnostics).toContainEqual({
      kind: 'facilities-left-out',
      reason: 'no-usable-location',
      facilityIds: ['7'],
    });
  });

  it('never has more than 3 facility requests in flight', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const fetchImpl = fakeFetch(async (url) => {
      const facilityId = url.searchParams.get('facility');
      if (facilityId === null) return jsonResponse(loadFixture('carpark-list.schema-sample.json'));
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(loadFixture(`carpark-facility-${facilityId}.schema-sample.json`));
    });
    const { carParks } = setUp(fetchImpl);

    await carParks.listFacilities(neverAborted());

    expect(mostInFlight).toBe(3);
  });

  it('keeps the list for 24 hours', async () => {
    const fetchImpl = carParkApi();
    const { carParks, advanceClock } = setUp(fetchImpl);

    const first = await carParks.listFacilities(neverAborted());
    advanceClock(24 * HOUR_MS - 1);
    const second = await carParks.listFacilities(neverAborted());
    expect(second).toBe(first);
    expect(fetchImpl.requests).toHaveLength(6);

    advanceClock(1);
    await carParks.listFacilities(neverAborted());
    expect(fetchImpl.requests).toHaveLength(12);
  });

  it('serves a list with catalogue details when a facility is briefly unavailable, then asks only for it', async () => {
    let tallawongAnswers = 0;
    const fetchImpl = carParkApi({
      '26': () => {
        tallawongAnswers += 1;
        return tallawongAnswers <= 2
          ? unavailable()
          : jsonResponse(loadFixture('carpark-facility-26.schema-sample.json'));
      },
    });
    const { carParks, diagnostics } = setUp(fetchImpl);

    const first = await carParks.listFacilities(neverAborted());
    const tallawong = first.find((facility) => facility.id === '26');
    expect(tallawong).toMatchObject({
      coordinate: { lat: -33.69304704, lon: 150.9052577 },
      totalSpaces: null,
      stationName: 'Tallawong Station',
    });
    expect(diagnostics).toContainEqual({
      kind: 'facility-details-unavailable',
      facilityIds: ['26'],
    });

    const asked = fetchImpl.requests.length;
    const second = await carParks.listFacilities(neverAborted());
    expect(facilityIdsAsked(fetchImpl).slice(asked)).toEqual([null, '26']);
    expect(second.find((facility) => facility.id === '26')?.totalSpaces).toBe(121);
  });

  it('caches the list even when TfNSW gives an unusable answer for one car park', async () => {
    const fetchImpl = carParkApi({ '486': () => jsonResponse({ unexpected: true }) });
    const { carParks, diagnostics } = setUp(fetchImpl);

    const facilities = await carParks.listFacilities(neverAborted());
    await carParks.listFacilities(neverAborted());

    expect(facilities.map((facility) => facility.id)).not.toContain('486');
    expect(diagnostics).toContainEqual({
      kind: 'facilities-left-out',
      reason: 'no-usable-location',
      facilityIds: ['7', '486'],
    });
    expect(fetchImpl.requests).toHaveLength(6);
  });

  it("serves yesterday's list when the list cannot be refreshed", async () => {
    let listAnswers = 0;
    const fetchImpl = carParkApi({
      list: () => {
        listAnswers += 1;
        return listAnswers === 1
          ? jsonResponse(loadFixture('carpark-list.schema-sample.json'))
          : unavailable();
      },
    });
    const { carParks, diagnostics, advanceClock } = setUp(fetchImpl);

    const first = await carParks.listFacilities(neverAborted());
    advanceClock(25 * HOUR_MS);
    const second = await carParks.listFacilities(neverAborted());

    expect(second).toBe(first);
    expect(diagnostics).toContainEqual({ kind: 'stale-facility-list', ageHours: 25 });
  });

  it('fails when there is no list to fall back on', async () => {
    const { carParks } = setUp(carParkApi({ list: () => new Response('', { status: 401 }) }));

    await expect(carParks.listFacilities(neverAborted())).rejects.toMatchObject({
      failure: 'not-configured',
    });
  });

  it('never keeps an empty list, and prefers the previous one when TfNSW sends one', async () => {
    let emptyAnswers = true;
    const fetchImpl = carParkApi({
      list: () => jsonResponse(emptyAnswers ? {} : loadFixture('carpark-list.schema-sample.json')),
    });
    const { carParks, diagnostics, advanceClock } = setUp(fetchImpl);

    expect(await carParks.listFacilities(neverAborted())).toEqual([]);
    emptyAnswers = false;
    const filled = await carParks.listFacilities(neverAborted());
    expect(filled).toHaveLength(4);

    emptyAnswers = true;
    advanceClock(25 * HOUR_MS);
    expect(await carParks.listFacilities(neverAborted())).toBe(filled);
    expect(
      diagnostics.filter((diagnostic) => diagnostic.kind === 'empty-facility-list'),
    ).toHaveLength(2);
  });
});

describe('TfNSW car park occupancy', () => {
  it('gives free spaces as spots minus total, never below zero, observed at MessageDate', async () => {
    const { carParks } = setUp(carParkApi());

    const occupancy = await carParks.occupancy(['26', '27', '486'], neverAborted());

    expect(occupancy.get('26')).toEqual({
      status: 'known',
      spacesAvailable: 24,
      totalSpaces: 121,
      observedAt: '2026-10-25T20:45:12.000Z',
    });
    // 466 counted in 455 spaces: full, not negative.
    expect(occupancy.get('27')).toMatchObject({ spacesAvailable: 0, totalSpaces: 455 });
    expect(occupancy.get('486')).toMatchObject({ spacesAvailable: 180, totalSpaces: 216 });
  });

  it('accepts counts sent as numbers as well as strings', async () => {
    const feed = loadFixtureCopy<Record<string, unknown>>('carpark-facility-26.schema-sample.json');
    feed.spots = 121;
    feed.occupancy = { total: 97 };
    const { carParks } = setUp(carParkApi({ '26': () => jsonResponse(feed) }));

    const occupancy = await carParks.occupancy(['26'], neverAborted());

    expect(occupancy.get('26')).toMatchObject({ spacesAvailable: 24, totalSpaces: 121 });
  });

  it('reads a winter MessageDate as AEST', async () => {
    const feed = loadFixtureCopy<Record<string, unknown>>('carpark-facility-26.schema-sample.json');
    feed.MessageDate = '2026-07-01T08:00:00';
    const { carParks } = setUp(carParkApi({ '26': () => jsonResponse(feed) }));

    const occupancy = await carParks.occupancy(['26'], neverAborted());

    expect(occupancy.get('26')).toMatchObject({ observedAt: '2026-06-30T22:00:00.000Z' });
  });

  it.each([
    ['a missing total', { occupancy: { total: null } }],
    ['spots that are not a number', { spots: 'many' }],
    ['no spots', { spots: '0' }],
    ['an unreadable MessageDate', { MessageDate: '26/10/2026 7:45' }],
    ['no MessageDate', { MessageDate: null }],
  ])('leaves out a car park with %s, and says so', async (_, change) => {
    const feed = {
      ...loadFixtureCopy<Record<string, unknown>>('carpark-facility-26.schema-sample.json'),
      ...change,
    };
    const { carParks, diagnostics } = setUp(carParkApi({ '26': () => jsonResponse(feed) }));

    const occupancy = await carParks.occupancy(['26', '486'], neverAborted());

    expect([...occupancy.keys()]).toEqual(['486']);
    expect(diagnostics).toContainEqual({
      kind: 'occupancy-left-out',
      reason: 'unreadable',
      facilityIds: ['26'],
    });
  });

  it('keeps occupancy for 60 seconds', async () => {
    const fetchImpl = carParkApi();
    const { carParks, advanceClock } = setUp(fetchImpl);

    await carParks.occupancy(['26'], neverAborted());
    advanceClock(59_999);
    await carParks.occupancy(['26'], neverAborted());
    expect(fetchImpl.requests).toHaveLength(1);

    advanceClock(1);
    await carParks.occupancy(['26'], neverAborted());
    expect(fetchImpl.requests).toHaveLength(2);
  });

  it('reuses the occupancy that came with the facility details', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);
    await carParks.listFacilities(neverAborted());
    const asked = fetchImpl.requests.length;

    const occupancy = await carParks.occupancy(['26', '27'], neverAborted());

    expect(fetchImpl.requests).toHaveLength(asked);
    expect(occupancy.get('26')).toMatchObject({ spacesAvailable: 24 });
  });

  it('returns what it has when some car parks fail, and fails when all of them do', async () => {
    const someFail = setUp(carParkApi({ '486': unavailable }));
    const occupancy = await someFail.carParks.occupancy(['26', '486'], neverAborted());
    expect([...occupancy.keys()]).toEqual(['26']);
    expect(someFail.diagnostics).toContainEqual({
      kind: 'occupancy-left-out',
      reason: 'request-failed',
      facilityIds: ['486'],
    });

    const allFail = setUp(carParkApi({ '26': unavailable, '486': unavailable }));
    const error = await allFail.carParks
      .occupancy(['26', '486'], neverAborted())
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ failure: 'unavailable', provider: 'tfnsw-car-park' });
  });

  it('asks once per car park and never for IDs that cannot be live facilities', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);

    const occupancy = await carParks.occupancy(['26', '26', '1', 'abc', '../26'], neverAborted());

    expect(facilityIdsAsked(fetchImpl)).toEqual(['26']);
    expect([...occupancy.keys()]).toEqual(['26']);
  });
});

describe('observedAtFromMessageDate', () => {
  it.each([
    ['daylight saving time (AEDT)', '2026-10-26T07:45:12', '2026-10-25T20:45:12.000Z'],
    ['standard time (AEST)', '2026-07-01T08:00:00', '2026-06-30T22:00:00.000Z'],
    [
      'the repeated hour, taking the earlier reading',
      '2026-04-05T02:30:00',
      '2026-04-04T15:30:00.000Z',
    ],
    ['fractional seconds', '2026-10-26T07:45:12.250', '2026-10-25T20:45:12.000Z'],
    ['an explicit offset', '2026-10-26T07:45:12+11:00', '2026-10-25T20:45:12.000Z'],
    ['an explicit UTC time', '2026-10-25T20:45:12Z', '2026-10-25T20:45:12.000Z'],
  ])('reads %s', (_, messageDate, expected) => {
    expect(observedAtFromMessageDate(messageDate)).toBe(expected);
  });

  it.each(['2026-02-30T08:00:00', '2026-10-26T24:00:00', '26/10/2026 07:45', '', null, undefined])(
    'gives up on %j',
    (messageDate) => {
      expect(observedAtFromMessageDate(messageDate)).toBeNull();
    },
  );
});
