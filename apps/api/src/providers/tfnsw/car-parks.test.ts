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

// Answers like the Car Park API: the list without `facility`, one car park with it, and every car
// park at /full-list. Overrides are keyed by facility ID, 'list' or 'full-list'.
function carParkApi(overrides: Overrides = {}): FakeFetch {
  return fakeFetch((url) => {
    if (url.pathname === '/v1/carpark/full-list') {
      const override = overrides['full-list'];
      if (override) return override();
      return jsonResponse(loadFixture('carpark-full-list.schema-sample.json'));
    }
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
  it('reads the list and asks for details only for car parks the catalogue cannot place', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);

    await carParks.listFacilities(neverAborted());

    expect(fetchImpl.requests.every((request) => request.url.pathname === '/v1/carpark')).toBe(
      true,
    );
    expect(facilityIdsAsked(fetchImpl)).toEqual([null, '491']);
  });

  it('describes a catalogued car park from the list name and the catalogue', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const byId = new Map(facilities.map((facility) => [facility.id, facility]));

    expect(byId.get('26')).toEqual({
      id: '26',
      name: 'Park&Ride - Tallawong P1',
      coordinate: { lat: -33.69304704, lon: 150.9052577 },
      kind: 'transport-park-and-ride',
      stationName: 'Tallawong Station',
      totalSpaces: null,
      rules: STANDARD_PARK_AND_RIDE_RULES,
      station: {
        name: 'Tallawong Station',
        stopId: '2155384',
        coordinate: { lat: -33.69163, lon: 150.906022 },
        kind: 'stop',
      },
    });
  });

  it('fills in the entrance and capacity once a plan has asked for occupancy', async () => {
    const { carParks } = setUp(carParkApi());

    await carParks.occupancy(['486'], neverAborted());
    const facilities = await carParks.listFacilities(neverAborted());
    const ashfield = facilities.find((facility) => facility.id === '486');

    expect(ashfield).toMatchObject({
      coordinate: { lat: -33.888104, lon: 151.126577 },
      totalSpaces: 216,
      stationName: 'Ashfield Station',
      station: { stopId: '213110', kind: 'stop' },
    });
  });

  it('uses the stop number as the station of a car park the catalogue does not know', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const example = facilities.find((facility) => facility.id === '491');

    expect(example).toMatchObject({
      name: 'Park&Ride - Example (not catalogued)',
      coordinate: { lat: -33.731, lon: 151.079 },
      totalSpaces: 180,
      rules: STANDARD_PARK_AND_RIDE_RULES,
      stationName: 'Park&Ride - Example (not catalogued)',
      station: {
        name: 'Park&Ride - Example (not catalogued)',
        stopId: '999001',
        coordinate: { lat: -33.731, lon: 151.079 },
        kind: 'stop',
      },
    });
  });

  it('places catalogued car parks at their documented entrance or station', async () => {
    const { carParks } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());
    const byId = new Map(facilities.map((facility) => [facility.id, facility]));

    expect(byId.get('27')?.coordinate).toEqual({ lat: -33.69163, lon: 150.906022 });
    // The documentation prints Warriewood's latitude without its minus sign; the catalogue does not.
    expect(byId.get('10')?.coordinate).toEqual({ lat: -33.697777, lon: 151.300667 });
  });

  it('leaves out car parks outside Greater Sydney, and says which', async () => {
    const { carParks, diagnostics } = setUp(carParkApi());

    const facilities = await carParks.listFacilities(neverAborted());

    expect(facilities.map((facility) => facility.id).sort()).toEqual([
      '10',
      '26',
      '27',
      '486',
      '491',
    ]);
    expect(diagnostics).toContainEqual({
      kind: 'facilities-left-out',
      reason: 'outside-coverage',
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

    await carParks.occupancy(['10', '26', '27', '486', '491'], neverAborted());

    expect(mostInFlight).toBe(3);
  });

  it('keeps the list of names for 24 hours', async () => {
    const fetchImpl = carParkApi();
    const { carParks, advanceClock } = setUp(fetchImpl);

    const first = await carParks.listFacilities(neverAborted());
    advanceClock(24 * HOUR_MS - 1);
    const second = await carParks.listFacilities(neverAborted());
    expect(second).toEqual(first);
    expect(fetchImpl.requests).toHaveLength(2);

    advanceClock(1);
    await carParks.listFacilities(neverAborted());
    expect(fetchImpl.requests).toHaveLength(4);
  });

  it('leaves out an uncatalogued car park while its details are unavailable, then asks only for it', async () => {
    let exampleAnswers = 0;
    const fetchImpl = carParkApi({
      '491': () => {
        exampleAnswers += 1;
        return exampleAnswers <= 2
          ? unavailable()
          : jsonResponse(loadFixture('carpark-facility-491.schema-sample.json'));
      },
    });
    const { carParks, diagnostics } = setUp(fetchImpl);

    const first = await carParks.listFacilities(neverAborted());
    expect(first.map((facility) => facility.id)).not.toContain('491');
    expect(diagnostics).toContainEqual({
      kind: 'facility-details-unavailable',
      facilityIds: ['491'],
    });

    const asked = fetchImpl.requests.length;
    const second = await carParks.listFacilities(neverAborted());
    expect(facilityIdsAsked(fetchImpl).slice(asked)).toEqual(['491']);
    expect(second.find((facility) => facility.id === '491')?.totalSpaces).toBe(180);
  });

  it('does not ask again the same day when TfNSW gives an unusable answer for one car park', async () => {
    const fetchImpl = carParkApi({ '491': () => jsonResponse({ unexpected: true }) });
    const { carParks, diagnostics } = setUp(fetchImpl);

    const facilities = await carParks.listFacilities(neverAborted());
    await carParks.listFacilities(neverAborted());

    expect(facilities.map((facility) => facility.id)).not.toContain('491');
    expect(diagnostics).toContainEqual({
      kind: 'facilities-left-out',
      reason: 'no-usable-location',
      facilityIds: ['491'],
    });
    expect(fetchImpl.requests).toHaveLength(2);
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

    expect(second.map((facility) => facility.id)).toEqual(first.map((facility) => facility.id));
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
    expect(filled).toHaveLength(5);

    emptyAnswers = true;
    advanceClock(25 * HOUR_MS);
    expect(await carParks.listFacilities(neverAborted())).toEqual(filled);
    expect(
      diagnostics.filter((diagnostic) => diagnostic.kind === 'empty-facility-list'),
    ).toHaveLength(2);
  });
});

describe('TfNSW car park occupancy', () => {
  it('gives free spaces as spots minus total, never below zero, observed at MessageDate', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);

    const occupancy = await carParks.occupancy(['26', '27', '486'], neverAborted());

    // Several car parks come from the one full list.
    expect(fetchImpl.requests.map((request) => request.url.pathname)).toEqual([
      '/v1/carpark/full-list',
    ]);
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
    const fullList = loadFixtureCopy<Record<string, unknown>[]>(
      'carpark-full-list.schema-sample.json',
    ).map((entry) => (String(entry.facility_id) === '26' ? { ...entry, ...change } : entry));
    const { carParks, diagnostics } = setUp(
      carParkApi({ 'full-list': () => jsonResponse(fullList) }),
    );

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

  it('reuses the occupancy that came with facility details fetched for the list', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);
    await carParks.listFacilities(neverAborted());
    const asked = fetchImpl.requests.length;

    const occupancy = await carParks.occupancy(['491'], neverAborted());

    expect(fetchImpl.requests).toHaveLength(asked);
    expect(occupancy.get('491')).toMatchObject({ totalSpaces: 180 });
  });

  it('reads several car parks in one request and keeps every count for 60 seconds', async () => {
    const fetchImpl = carParkApi();
    const { carParks, advanceClock } = setUp(fetchImpl);

    await carParks.occupancy(['26', '27'], neverAborted());
    advanceClock(59_999);
    const later = await carParks.occupancy(['486'], neverAborted());
    expect(fetchImpl.requests.map((request) => request.url.pathname)).toEqual([
      '/v1/carpark/full-list',
    ]);
    expect(later.get('486')).toMatchObject({ spacesAvailable: 180 });

    advanceClock(1);
    await carParks.occupancy(['486', '27'], neverAborted());
    expect(fetchImpl.requests).toHaveLength(2);
  });

  it('asks on its own for a car park the full list leaves out', async () => {
    const fetchImpl = carParkApi();
    const { carParks } = setUp(fetchImpl);

    const occupancy = await carParks.occupancy(['26', '7'], neverAborted());

    expect(fetchImpl.requests.map((request) => request.url.pathname)).toEqual([
      '/v1/carpark/full-list',
      '/v1/carpark',
    ]);
    expect(facilityIdsAsked(fetchImpl)).toEqual([null, '7']);
    expect([...occupancy.keys()].sort()).toEqual(['26', '7']);
  });

  it('falls back to one request per car park when the full list is unavailable', async () => {
    const fetchImpl = carParkApi({ 'full-list': unavailable });
    const { carParks, diagnostics } = setUp(fetchImpl);

    const occupancy = await carParks.occupancy(['26', '486'], neverAborted());

    // The full list is tried (and retried once, as any unavailable answer is) before each car park.
    expect(fetchImpl.requests[0]!.url.pathname).toBe('/v1/carpark/full-list');
    expect(facilityIdsAsked(fetchImpl).filter((id) => id !== null)).toEqual(['26', '486']);
    expect([...occupancy.keys()]).toEqual(['26', '486']);
    expect(diagnostics).toContainEqual({ kind: 'full-list-unavailable' });
  });

  it('skips and counts full-list entries it cannot read', async () => {
    const fullList = [
      ...loadFixtureCopy<unknown[]>('carpark-full-list.schema-sample.json'),
      'not a facility',
      { tsn: '1' },
    ];
    const { carParks, diagnostics } = setUp(
      carParkApi({ 'full-list': () => jsonResponse(fullList) }),
    );

    const occupancy = await carParks.occupancy(['26', '27'], neverAborted());

    expect([...occupancy.keys()]).toEqual(['26', '27']);
    expect(diagnostics).toContainEqual({ kind: 'full-list-entries-unreadable', count: 2 });
  });

  it('returns what it has when some car parks fail, and fails when all of them do', async () => {
    const someFail = setUp(carParkApi({ 'full-list': unavailable, '486': unavailable }));
    const occupancy = await someFail.carParks.occupancy(['26', '486'], neverAborted());
    expect([...occupancy.keys()]).toEqual(['26']);
    expect(someFail.diagnostics).toContainEqual({
      kind: 'occupancy-left-out',
      reason: 'request-failed',
      facilityIds: ['486'],
    });

    const allFail = setUp(
      carParkApi({ 'full-list': unavailable, '26': unavailable, '486': unavailable }),
    );
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
