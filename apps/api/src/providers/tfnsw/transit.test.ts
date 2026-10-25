import {
  buildItinerary,
  DEFAULT_PREFERENCES,
  findContinuityIssues,
  legSchema,
  planTrip,
  ProviderError,
  type Leg,
  type Place,
  type TransitLeg,
  type TransitMode,
  type TransitQuery,
  type WalkLeg,
} from '@hopready/core';
import { describe, expect, it } from 'vitest';

import type { TfnswDiagnostic } from './diagnostics';
import { createTfnswProviders } from './index';
import {
  fakeFetch,
  jsonResponse,
  loadFixture,
  loadFixtureCopy,
  neverAborted,
} from './test-support';

const TALLAWONG_P1: Place = {
  name: 'Tallawong P1',
  coordinate: { lat: -33.69304704, lon: 150.9052577 },
  kind: 'car-park',
  carParkId: '26',
};
const CHATSWOOD: Place = {
  name: 'Chatswood Station',
  coordinate: { lat: -33.797237, lon: 151.180934 },
  kind: 'stop',
  stopId: '206710',
};
const KELLYVILLE: Place = {
  name: 'Kellyville Station',
  coordinate: { lat: -33.713514, lon: 150.935304 },
  kind: 'stop',
  stopId: '2155382',
};
const BARANGAROO: Place = {
  name: 'Barangaroo Station',
  coordinate: { lat: -33.859577, lon: 151.202615 },
  kind: 'stop',
  stopId: '200046',
};
const NEAR_ROUSE_HILL: Place = {
  name: 'Home',
  coordinate: { lat: -33.687, lon: 150.92 },
  kind: 'address',
};
const NORTH_SYDNEY: Place = {
  name: 'North Sydney Station',
  coordinate: { lat: -33.84115, lon: 151.207412 },
  kind: 'stop',
  stopId: '206010',
};

const TALLAWONG_TRIP = 'trip-tallawong-to-chatswood.schema-sample.json';
const KELLYVILLE_TRIP = 'trip-kellyville-to-barangaroo.schema-sample.json';
const ROUSE_HILL_TRIP = 'trip-rouse-hill-to-north-sydney.schema-sample.json';

function query(overrides: Partial<TransitQuery> = {}): TransitQuery {
  return {
    from: TALLAWONG_P1,
    to: CHATSWOOD,
    // 08:00 on Monday 26 October 2026 in Sydney (AEDT).
    time: { type: 'depart', at: '2026-10-25T21:00:00.000Z' },
    maxJourneys: 4,
    maxWalkMinutes: 15,
    walkingSpeed: 'normal',
    excludedModes: [],
    ...overrides,
  };
}

async function plan(body: unknown, transitQuery: TransitQuery) {
  const diagnostics: TfnswDiagnostic[] = [];
  const fetchImpl = fakeFetch(() => jsonResponse(body));
  const { transit } = createTfnswProviders({
    apiKey: 'test-key',
    fetchImpl,
    requestsPerSecond: 100,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const journeys = await transit.planJourneys(transitQuery, neverAborted());
  const params = Object.fromEntries(fetchImpl.requests[0]!.url.searchParams);
  return { journeys, diagnostics, params, url: fetchImpl.requests[0]!.url };
}

const tallawongToChatswood = () => plan(loadFixture(TALLAWONG_TRIP), query());
const kellyvilleToBarangaroo = () =>
  plan(
    loadFixture(KELLYVILLE_TRIP),
    query({
      from: KELLYVILLE,
      to: BARANGAROO,
      time: { type: 'arrive', at: '2026-10-25T22:00:00.000Z' },
    }),
  );
const rouseHillToNorthSydney = (overrides: Partial<TransitQuery> = {}) =>
  plan(
    loadFixture(ROUSE_HILL_TRIP),
    query({
      from: NEAR_ROUSE_HILL,
      to: NORTH_SYDNEY,
      time: { type: 'depart', at: '2026-10-25T20:30:00.000Z' },
      ...overrides,
    }),
  );

function transitLegs(legs: readonly Leg[]): TransitLeg[] {
  return legs.filter((leg): leg is TransitLeg => leg.kind === 'transit');
}

function asWalk(leg: Leg | undefined): WalkLeg {
  expect(leg?.kind).toBe('walk');
  return leg as WalkLeg;
}

function asTransit(leg: Leg | undefined): TransitLeg {
  expect(leg?.kind).toBe('transit');
  return leg as TransitLeg;
}

describe('TfNSW trip request', () => {
  it('asks for journeys from a coordinate (longitude first) to a stop, in Sydney local time', async () => {
    const { params, url } = await tallawongToChatswood();

    expect(url.pathname).toBe('/v1/tp/trip');
    expect(params).toEqual({
      outputFormat: 'rapidJSON',
      coordOutputFormat: 'EPSG:4326',
      depArrMacro: 'dep',
      itdDate: '20261026',
      itdTime: '0800',
      type_origin: 'coord',
      name_origin: '150.905258:-33.693047:EPSG:4326',
      type_destination: 'any',
      name_destination: '206710',
      calcNumberOfTrips: '4',
      TfNSWTR: 'true',
    });
  });

  it('asks for arrive-by trips in winter with AEST date and time', async () => {
    const { params } = await plan(
      { journeys: [] },
      query({ time: { type: 'arrive', at: '2026-07-01T22:30:00.000Z' } }),
    );

    expect(params).toMatchObject({ depArrMacro: 'arr', itdDate: '20260702', itdTime: '0830' });
  });

  it.each([
    ['train', 'exclMOT_1'],
    ['metro', 'exclMOT_2'],
    ['light-rail', 'exclMOT_4'],
    ['bus', 'exclMOT_5'],
    ['coach', 'exclMOT_7'],
    ['ferry', 'exclMOT_9'],
    ['school-bus', 'exclMOT_11'],
  ] as const)('excludes %s with excludedMeans=checkbox and %s=1', async (mode, param) => {
    const { params } = await plan({ journeys: [] }, query({ excludedModes: [mode] }));

    expect(params.excludedMeans).toBe('checkbox');
    expect(params[param]).toBe('1');
    expect(Object.keys(params).filter((name) => name.startsWith('exclMOT_'))).toEqual([param]);
  });

  it('sends one parameter per excluded mode and none for On Demand, which TfNSW cannot exclude', async () => {
    const excludedModes: TransitMode[] = ['metro', 'bus', 'on-demand', 'metro'];
    const { params } = await plan({ journeys: [] }, query({ excludedModes }));

    expect(Object.keys(params).filter((name) => name.startsWith('exclMOT_'))).toEqual([
      'exclMOT_2',
      'exclMOT_5',
    ]);
  });

  it('sends no exclusion parameters when nothing is excluded', async () => {
    const { params } = await tallawongToChatswood();

    expect(params).not.toHaveProperty('excludedMeans');
  });
});

describe('TfNSW trip mapping', () => {
  it('maps a walk and a real-time metro leg, starting and ending where the planner asked', async () => {
    const { journeys } = await tallawongToChatswood();
    const [walkLeg, metroLeg] = journeys[0]!.legs;
    const walk = asWalk(walkLeg);
    const metro = asTransit(metroLeg);

    expect(walk).toMatchObject({
      kind: 'walk',
      from: TALLAWONG_P1,
      to: {
        name: 'Tallawong Station',
        kind: 'stop',
        stopId: '2155269',
        coordinate: { lat: -33.691705, lon: 150.905653 },
      },
      start: '2026-10-25T21:04:00.000Z',
      end: '2026-10-25T21:08:00.000Z',
      source: 'tfnsw-trip-planner',
      timing: 'estimated',
      distanceMetres: 210,
    });
    expect(metro).toMatchObject({
      mode: 'metro',
      from: walk.to,
      to: CHATSWOOD,
      timing: 'realtime',
      start: '2026-10-25T21:08:00.000Z',
      end: '2026-10-25T21:44:01.000Z',
      scheduledStart: '2026-10-25T21:07:00.000Z',
      scheduledEnd: '2026-10-25T21:43:01.000Z',
      service: {
        name: 'M1',
        description: 'Tallawong to Sydenham',
        headsign: 'Sydenham',
        operator: 'Sydney Metro',
      },
      departurePlatform: 'Platform 2',
      arrivalPlatform: 'Platform 2',
      stopCount: 12,
      cancelled: false,
    });
    expect(metro.realtimeTripId).toMatch(/^0272-001-\d{3}-002:1000$/);
    expect(journeys[0]!.fare).toEqual({ status: 'unknown' });
  });

  it('reads coordinates as [latitude, longitude]', async () => {
    const { journeys } = await tallawongToChatswood();
    const [walk, metro] = journeys[0]!.legs;

    expect(walk?.path?.[0]).toEqual({ lat: -33.693047, lon: 150.905258 });
    expect(metro?.path).toHaveLength(13);
    expect(metro?.path?.[12]).toEqual({ lat: -33.797469, lon: 151.180988 });
  });

  it('marks a leg scheduled when TfNSW does not control it with real-time data', async () => {
    const { journeys } = await tallawongToChatswood();
    const metro = asTransit(journeys[1]!.legs[1]);

    expect(metro.timing).toBe('scheduled');
    expect(metro.start).toBe(metro.scheduledStart);
    expect(metro.start).toBe('2026-10-25T21:17:00.000Z');
  });

  it('flags a whole service TfNSW reports as TRIP_CANCELLED', async () => {
    const { journeys } = await tallawongToChatswood();

    expect(transitLegs(journeys[2]!.legs).map((leg) => leg.cancelled)).toEqual([true]);
  });

  it('flags a service that will not stop where the traveller boards or gets off', async () => {
    const { journeys } = await kellyvilleToBarangaroo();
    const [onTime, departureCancelled, skipsDestination] = journeys.map(
      (journey) => transitLegs(journey.legs)[0]!,
    );

    expect(onTime?.cancelled).toBe(false);
    expect(departureCancelled?.cancelled).toBe(true);
    expect(skipsDestination?.cancelled).toBe(true);
  });

  it('counts stops after boarding and leaves out stops the service skips', async () => {
    const { journeys } = await kellyvilleToBarangaroo();
    const [skipsOneStop, callsEverywhere] = journeys.map((journey) => transitLegs(journey.legs)[0]);

    expect(skipsOneStop?.stopCount).toBe(12);
    expect(callsEverywhere?.stopCount).toBe(13);
  });

  it('maps a bus leg and reports a platform or stand only when TfNSW names one', async () => {
    const { journeys } = await rouseHillToNorthSydney();
    const [bus, metro] = transitLegs(journeys[0]!.legs);

    expect(bus).toMatchObject({
      mode: 'bus',
      service: {
        name: '603',
        description: 'Rouse Hill Station to Parramatta via Glenhaven',
        headsign: 'Parramatta via Glenhaven',
        operator: 'CDC NSW R4',
      },
      departurePlatform: null,
      arrivalPlatform: 'Stand C',
      stopCount: 8,
    });
    expect(bus?.from.name).toBe('Rouse Hill Station, North West Twy');
    expect(bus?.to.name).toBe('Kellyville Station, Guragura St');
    expect(metro?.departurePlatform).toBe('Platform 1');
  });

  it('places a stop without its own coordinate at its station', async () => {
    const { journeys } = await rouseHillToNorthSydney();

    expect(journeys[0]!.legs[0]?.to.coordinate).toEqual({ lat: -33.691812, lon: 150.924168 });
  });

  it('turns TfNSW interchanges into walk legs that join the services in time and place', async () => {
    const { journeys } = await rouseHillToNorthSydney();
    const legs = journeys[0]!.legs;

    expect(legs.map((leg) => leg.kind)).toEqual([
      'walk',
      'transit',
      'walk',
      'transit',
      'walk',
      'transit',
    ]);
    const [, bus, toPlatform, metro, change, train] = legs;
    expect(toPlatform).toMatchObject({
      from: bus!.to,
      to: metro!.from,
      start: '2026-10-25T20:54:00.000Z',
      end: '2026-10-25T20:57:00.000Z',
      distanceMetres: null,
    });
    expect(toPlatform?.path).toHaveLength(3);
    // TfNSW gave no walking time for this platform change, so none is invented.
    expect(change).toMatchObject({
      from: metro!.to,
      to: train!.from,
      start: '2026-10-25T21:29:01.000Z',
      end: '2026-10-25T21:29:01.000Z',
    });
    expect(findContinuityIssues(legs)).toEqual([]);
  });

  it('leaves the time before the next departure as waiting once built into an itinerary', async () => {
    const { journeys } = await rouseHillToNorthSydney();
    const itinerary = buildItinerary({ strategy: 'transit-only', legs: journeys[0]!.legs });
    const wait = itinerary.legs.find(
      (leg) => leg.kind === 'wait' && leg.end.endsWith('21:35:00.000Z'),
    );

    expect(wait).toMatchObject({
      start: '2026-10-25T21:29:01.000Z',
      to: { name: 'Chatswood Station' },
    });
  });

  it('maps On Demand services by their icon', async () => {
    const { journeys } = await rouseHillToNorthSydney();
    const [onDemand] = transitLegs(journeys[1]!.legs);

    expect(onDemand).toMatchObject({ mode: 'on-demand', service: { name: 'On Demand' } });
  });

  it('drops journeys that use a mode the traveller excluded but TfNSW cannot exclude', async () => {
    const { journeys, diagnostics } = await rouseHillToNorthSydney({
      excludedModes: ['on-demand'],
    });

    expect(journeys).toHaveLength(1);
    expect(transitLegs(journeys[0]!.legs).map((leg) => leg.mode)).toEqual([
      'bus',
      'metro',
      'train',
    ]);
    expect(diagnostics).toContainEqual({
      kind: 'journeys-dropped',
      reason: 'excluded-mode',
      count: 1,
    });
  });

  it('drops journeys with legs HopReady cannot show, and counts them', async () => {
    const { journeys, diagnostics } = await tallawongToChatswood();

    expect(journeys).toHaveLength(3);
    expect(diagnostics).toContainEqual({
      kind: 'journeys-dropped',
      reason: 'unsupported-mode',
      count: 1,
      productClasses: [105],
    });
  });

  it('maps alerts with severity, plain text and their link', async () => {
    const { journeys } = await tallawongToChatswood();
    const metro = asTransit(journeys[0]!.legs[1]);

    expect(metro.alerts).toEqual([
      {
        id: 'ems-50101',
        severity: 'info',
        title: 'Chatswood Station lift 3 is not available',
        detail:
          'Lift 3 between the concourse and Platforms 1 & 2 is temporarily out of service.\nIf you need help, ask staff.',
        url: 'https://transportnsw.info/alerts/details#/ems-50101',
      },
      {
        id: 'ems-50102',
        severity: 'severe',
        title: 'Metro & trains: allow extra travel time',
        detail:
          'Allow extra travel time between Tallawong and Chatswood.\nServices run every 10 minutes & may be crowded.',
        url: 'https://transportnsw.info/alerts/details#/ems-50102',
      },
    ]);
  });

  it('keeps alerts with missing parts, drops plain-http links and counts unreadable alerts', async () => {
    const { journeys, diagnostics } = await rouseHillToNorthSydney();
    const train = transitLegs(journeys[0]!.legs)[2]!;
    const [withoutPriority, withoutId] = train.alerts;

    expect(train.alerts).toHaveLength(2);
    expect(withoutPriority).toEqual({
      id: 'ems-50210',
      severity: 'warning',
      title: 'Trackwork between Chatswood and North Sydney',
      detail: 'Trains run to a changed timetable.',
    });
    expect(withoutId).toMatchObject({
      severity: 'warning',
      title: 'North Sydney Station: Blue St entrance closed',
      detail: 'Use the Miller St entrance.',
    });
    expect(withoutId?.id).toMatch(/^tfnsw-[0-9a-f]{8}$/);
    expect(diagnostics).toContainEqual({ kind: 'alerts-dropped', reason: 'unreadable', count: 1 });
  });

  it('produces legs that satisfy the shared model and join up, for every sample journey', async () => {
    const results = await Promise.all([
      tallawongToChatswood(),
      kellyvilleToBarangaroo(),
      rouseHillToNorthSydney(),
    ]);
    const journeys = results.flatMap((result) => result.journeys);

    expect(journeys).toHaveLength(8);
    for (const journey of journeys) {
      for (const leg of journey.legs) expect(() => legSchema.parse(leg)).not.toThrow();
      expect(findContinuityIssues(journey.legs)).toEqual([]);
    }
  });

  it('returns no more journeys than asked for', async () => {
    const { journeys } = await plan(loadFixture(TALLAWONG_TRIP), query({ maxJourneys: 1 }));

    expect(journeys).toHaveLength(1);
  });

  it('moves a walk so it never overlaps the services around it, keeping its length', async () => {
    type Journeys = { journeys: { legs: Record<string, Record<string, string>>[] }[] };
    const tallawong = loadFixtureCopy<Journeys>(TALLAWONG_TRIP);
    const firstWalk = tallawong.journeys[0]!.legs[0]!;
    firstWalk.origin!.departureTimeEstimated = '2026-10-25T21:06:00Z';
    firstWalk.destination!.arrivalTimeEstimated = '2026-10-25T21:10:00Z';
    const rouseHill = loadFixtureCopy<Journeys>(ROUSE_HILL_TRIP);
    rouseHill.journeys[1]!.legs[0]!.destination!.arrivalTimeEstimated = '2026-10-25T20:54:30Z';

    const leading = (await plan(tallawong, query())).journeys[0]!.legs[0];
    const between = (await plan(rouseHill, query({ from: NEAR_ROUSE_HILL, to: NORTH_SYDNEY })))
      .journeys[1]!.legs[1];

    expect(leading).toMatchObject({
      start: '2026-10-25T21:04:00.000Z',
      end: '2026-10-25T21:08:00.000Z',
    });
    expect(between).toMatchObject({
      start: '2026-10-25T20:54:30.000Z',
      end: '2026-10-25T20:58:30.000Z',
    });
  });

  it('stretches walks for a slow walker, so the walk to the first service starts earlier', async () => {
    const journeysAt = async (walkingSpeed: TransitQuery['walkingSpeed']) =>
      (await plan(loadFixture(TALLAWONG_TRIP), query({ walkingSpeed }))).journeys;
    const [normal, fast, slow] = await Promise.all(
      (['normal', 'fast', 'slow'] as const).map(journeysAt),
    );
    const [normalWalk, normalMetro] = normal![0]!.legs;
    const [slowWalk, slowMetro] = slow![0]!.legs;

    expect(normalWalk).toMatchObject({
      start: '2026-10-25T21:04:00.000Z',
      end: '2026-10-25T21:08:00.000Z',
    });
    // TfNSW's 4 minutes take 5 min 47 s at 0.9 m/s instead of 1.3, still ending as the metro leaves.
    expect(slowWalk).toMatchObject({
      start: '2026-10-25T21:02:13.000Z',
      end: '2026-10-25T21:08:00.000Z',
      distanceMetres: 210,
    });
    expect(slowMetro).toEqual(normalMetro);
    expect(fast).toEqual(normal);
  });

  it('keeps the arrival of a slow arrive-by walk that has no service to catch', async () => {
    type Journeys = { journeys: { legs: unknown[] }[] };
    const body = loadFixtureCopy<Journeys>(TALLAWONG_TRIP);
    const [first] = body.journeys;
    body.journeys = [{ ...first!, legs: first!.legs.slice(0, 1) }];
    const walkFor = async (time: TransitQuery['time']) =>
      (await plan(body, query({ walkingSpeed: 'slow', time }))).journeys[0]!.legs;

    expect(await walkFor({ type: 'arrive', at: '2026-10-25T21:10:00.000Z' })).toMatchObject([
      { kind: 'walk', start: '2026-10-25T21:02:13.000Z', end: '2026-10-25T21:08:00.000Z' },
    ]);
    expect(await walkFor({ type: 'depart', at: '2026-10-25T21:00:00.000Z' })).toMatchObject([
      { kind: 'walk', start: '2026-10-25T21:04:00.000Z', end: '2026-10-25T21:09:47.000Z' },
    ]);
  });

  it('lets the planner turn down changes a slow walker cannot make', async () => {
    const leaveAt = '2026-10-25T20:30:00.000Z';
    const planFor = (walkingSpeed: TransitQuery['walkingSpeed']) => {
      const fetchImpl = fakeFetch(() => jsonResponse(loadFixture(ROUSE_HILL_TRIP)));
      const { transit } = createTfnswProviders({ apiKey: 'test-key', fetchImpl });
      return planTrip(
        {
          origin: NEAR_ROUSE_HILL,
          destination: NORTH_SYDNEY,
          time: { type: 'depart', at: leaveAt },
          access: { transit: true, drive: false, dropOff: false },
          preferences: { ...DEFAULT_PREFERENCES, walkingSpeed },
          trip: { kind: 'outbound' },
        },
        {
          mode: 'live',
          transit,
          driving: null,
          carParks: null,
          clock: { now: () => new Date(leaveAt) },
        },
      );
    };
    const normal = await planFor('normal');
    const slow = await planFor('slow');
    const toMetro = (await rouseHillToNorthSydney({ walkingSpeed: 'slow' })).journeys[0]!.legs[2]!;

    expect(normal.itineraries).toHaveLength(2);
    // TfNSW allows 3 minutes to walk from the bus to the metro. At a slow pace that takes 4 min 20 s
    // and ends after the 7.58 am metro has left.
    expect(toMetro).toMatchObject({
      start: '2026-10-25T20:54:00.000Z',
      end: '2026-10-25T20:58:20.000Z',
    });
    expect(slow.itineraries).toEqual([]);
    expect(slow.rejected).toEqual([{ reason: 'transfer-too-short', count: 2 }]);
  });

  it('returns no journeys, and the system message codes, when TfNSW finds none', async () => {
    const arrayForm = await plan(
      { version: '10.6.21.17', systemMessages: [{ type: 'error', module: 'BROKER', code: -4000 }] },
      query(),
    );
    const specForm = await plan(
      { systemMessages: { responseMessages: [{ type: 'error', code: -2000 }] }, journeys: [] },
      query(),
    );

    expect(arrayForm.journeys).toEqual([]);
    expect(arrayForm.diagnostics).toEqual([{ kind: 'no-journeys', systemMessageCodes: [-4000] }]);
    expect(specForm.diagnostics).toEqual([{ kind: 'no-journeys', systemMessageCodes: [-2000] }]);
  });

  it('drops and counts a journey it cannot read, keeping the rest', async () => {
    type Journeys = { journeys: { legs: Record<string, unknown>[] }[] };
    const body = loadFixtureCopy<Journeys>(TALLAWONG_TRIP);
    delete body.journeys[1]!.legs[1]!.transportation;

    const { journeys, diagnostics } = await plan(body, query());

    expect(journeys).toHaveLength(2);
    expect(diagnostics).toContainEqual({
      kind: 'journeys-dropped',
      reason: 'unreadable',
      count: 1,
    });
  });

  it('reports a response where no journey can be read as malformed', async () => {
    const error = await plan(
      { journeys: [{ legs: [] }, { legs: [{ origin: {} }] }] },
      query(),
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ failure: 'malformed-response' });
  });
});
