import type { Coordinate } from '@hopready/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  fakeAppleMaps,
  generateMapsKey,
  json,
  openSignal,
  type AppleRequest,
  type MapsKey,
} from './fake-apple-maps';

const CENTRAL = { lat: -33.8832, lon: 151.207 };
const PARRAMATTA = { lat: -33.815, lon: 151.0011 };
const HORNSBY = { lat: -33.7025, lon: 151.099 };
const DEPART = { type: 'depart', at: '2026-10-25T08:30:45.678+11:00' } as const;
const ARRIVE = { type: 'arrive', at: '2026-10-25T09:15:00+11:00' } as const;

// Destination i sits 0.01 degrees further along a diagonal across Sydney, so its index can be
// read back from the coordinate Apple echoes.
const destinationAt = (index: number): Coordinate => ({
  lat: -33.7 - index * 0.01,
  lon: 150.9 + index * 0.01,
});
const indexOf = (latitude: number) => Math.round((-33.7 - latitude) / 0.01);
const secondsFor = (index: number) => 600 + index;

interface EchoedDestination {
  latitude: number;
  longitude: number;
}

function requestedDestinations(request: AppleRequest): EchoedDestination[] {
  return (request.params.get('destinations') ?? '').split('|').map((pair) => {
    const [latitude = NaN, longitude = NaN] = pair.split(',').map(Number);
    return { latitude, longitude };
  });
}

function etaFor(destination: EchoedDestination) {
  const index = indexOf(destination.latitude);
  return {
    destination,
    transportType: 'AUTOMOBILE',
    distanceMeters: 1_000 * (index + 1),
    expectedTravelTimeSeconds: secondsFor(index),
    staticTravelTimeSeconds: secondsFor(index) - 120,
  };
}

let key: MapsKey;
beforeAll(async () => {
  key = await generateMapsKey();
});

describe('Apple Maps driving estimates', () => {
  it('asks /v1/etas for automobile times from one origin, departing at a UTC whole second', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) => json({ etas: requestedDestinations(request).map(etaFor) }),
    });
    const { driving } = connect(apple, key);

    await driving.estimateDrives(CENTRAL, [PARRAMATTA, HORNSBY], DEPART, openSignal());

    const [request] = apple.requestsTo('/v1/etas');
    expect(request?.host).toBe('maps-api.apple.com');
    expect(Object.fromEntries(request?.params ?? [])).toEqual({
      origin: '-33.883200,151.207000',
      destinations: '-33.815000,151.001100|-33.702500,151.099000',
      transportType: 'Automobile',
      departureDate: '2026-10-24T21:30:45Z',
    });
    expect(request?.query).toContain(
      'destinations=-33.815000%2C151.001100%7C-33.702500%2C151.099000',
    );
  });

  it('sends arrivalDate instead for arrive-by', async () => {
    const apple = fakeAppleMaps({ '/v1/etas': () => json({ etas: [] }) });
    const { driving } = connect(apple, key);

    await driving.estimateDrives(CENTRAL, [PARRAMATTA], ARRIVE, openSignal());

    const params = apple.requestsTo('/v1/etas')[0]?.params;
    expect(params?.get('arrivalDate')).toBe('2026-10-24T22:15:00Z');
    expect(params?.has('departureDate')).toBe(false);
  });

  it('splits more than ten destinations into calls of ten and keeps the input order', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) => json({ etas: requestedDestinations(request).map(etaFor).reverse() }),
    });
    const { driving } = connect(apple, key);
    const destinations = Array.from({ length: 23 }, (_, index) => destinationAt(index));

    const estimates = await driving.estimateDrives(CENTRAL, destinations, DEPART, openSignal());

    expect(
      apple.requestsTo('/v1/etas').map((request) => requestedDestinations(request).length),
    ).toEqual([10, 10, 3]);
    expect(estimates).toEqual(
      destinations.map((_, index) => ({
        durationSeconds: secondsFor(index),
        distanceMetres: 1_000 * (index + 1),
        trafficAware: true,
      })),
    );
  });

  it('gives null for a destination Apple leaves out or answers without a time', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) => {
        // The second destination gets no result, the third gets one without a time, and one
        // result names no destination at all.
        const [first, , third, fourth] = requestedDestinations(request);
        return json({
          etas: [
            etaFor(fourth!),
            { destination: third, distanceMeters: 4_000 },
            etaFor(first!),
            { distanceMeters: 2_000, expectedTravelTimeSeconds: 601 },
          ],
        });
      },
    });
    const { driving } = connect(apple, key);
    const destinations = [0, 1, 2, 3].map(destinationAt);

    const estimates = await driving.estimateDrives(CENTRAL, destinations, DEPART, openSignal());

    expect(estimates.map((estimate) => estimate?.durationSeconds ?? null)).toEqual([
      secondsFor(0),
      null,
      null,
      secondsFor(3),
    ]);
  });

  it('falls back to the traffic-free time only when the traffic-aware one is missing', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) => {
        const [destination] = requestedDestinations(request);
        return json({
          etas: [{ destination, distanceMeters: 23_140, staticTravelTimeSeconds: 1_380 }],
        });
      },
    });
    const { driving } = connect(apple, key);

    const [estimate] = await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());

    expect(estimate).toEqual({
      durationSeconds: 1_380,
      distanceMetres: 23_140,
      trafficAware: false,
    });
  });

  it('matches results whose echoed coordinates come back rounded', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) =>
        json({
          etas: requestedDestinations(request)
            .map(({ latitude, longitude }) => ({
              latitude: Math.fround(latitude),
              longitude: Math.fround(longitude),
            }))
            .map(etaFor)
            .reverse(),
        }),
    });
    const { driving } = connect(apple, key);
    const destinations = [destinationAt(4), destinationAt(5)];

    const estimates = await driving.estimateDrives(CENTRAL, destinations, DEPART, openSignal());

    expect(estimates.map((estimate) => estimate?.durationSeconds)).toEqual([
      secondsFor(4),
      secondsFor(5),
    ]);
  });

  it('ignores an echo too far from anything that was asked about', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': () =>
        json({ etas: [etaFor({ latitude: PARRAMATTA.lat + 0.01, longitude: PARRAMATTA.lon })] }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).resolves.toEqual([null]);
  });

  it('asks about a repeated destination once and answers every copy', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': (request) => json({ etas: requestedDestinations(request).map(etaFor) }),
    });
    const { driving } = connect(apple, key);
    const repeated = destinationAt(2);

    const estimates = await driving.estimateDrives(
      CENTRAL,
      [repeated, destinationAt(3), { ...repeated }],
      DEPART,
      openSignal(),
    );

    expect(requestedDestinations(apple.requestsTo('/v1/etas')[0]!)).toHaveLength(2);
    expect(estimates.map((estimate) => estimate?.durationSeconds)).toEqual([
      secondsFor(2),
      secondsFor(3),
      secondsFor(2),
    ]);
  });

  it('answers an empty list without calling Apple', async () => {
    const apple = fakeAppleMaps();
    const { driving } = connect(apple, key);

    await expect(driving.estimateDrives(CENTRAL, [], DEPART, openSignal())).resolves.toEqual([]);
    expect(apple.requests).toHaveLength(0);
  });

  it('fails the whole estimate when one batch fails, rather than inventing "no route"', async () => {
    let calls = 0;
    const apple = fakeAppleMaps({
      '/v1/etas': (request) =>
        ++calls === 2
          ? json({ message: 'Bad Request' }, { status: 400 })
          : json({ etas: requestedDestinations(request).map(etaFor) }),
    });
    const { driving } = connect(apple, key);
    const destinations = Array.from({ length: 12 }, (_, index) => destinationAt(index));

    await expect(
      driving.estimateDrives(CENTRAL, destinations, DEPART, openSignal()),
    ).rejects.toMatchObject({ provider: 'apple-maps', failure: 'rejected-request', status: 400 });
  });

  it('rejects a time that is not a date without calling Apple', async () => {
    const apple = fakeAppleMaps();
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], { type: 'depart', at: 'soon' }, openSignal()),
    ).rejects.toMatchObject({ failure: 'rejected-request' });
    expect(apple.requests).toHaveLength(0);
  });
});

describe('Apple Maps driving routes', () => {
  const A = { latitude: -33.8832, longitude: 151.207 };
  const B = { latitude: -33.88, longitude: 151.19 };
  const C = { latitude: -33.86, longitude: 151.12 };
  const D = { latitude: -33.815, longitude: 151.0011 };
  const E = { latitude: -33.9, longitude: 151.1 };

  // Route 0 uses steps 2, 3 and 4, whose paths sit at indexes 4, 0 and 2, so both levels of
  // indirection are exercised. Route 1 shares the arrays and must be ignored.
  const directions = {
    routes: [
      {
        name: 'M4',
        distanceMeters: 23_140,
        durationSeconds: 1_690,
        transportType: 'AUTOMOBILE',
        hasTolls: true,
        stepIndexes: [2, 3, 4],
      },
      {
        name: 'Parramatta Rd',
        distanceMeters: 21_000,
        durationSeconds: 2_100,
        stepIndexes: [0, 1],
      },
    ],
    steps: [
      { stepPathIndex: 1, distanceMeters: 0, durationSeconds: 0 },
      { stepPathIndex: 3, distanceMeters: 21_000, durationSeconds: 2_100 },
      { stepPathIndex: 4, distanceMeters: 0, durationSeconds: 0 },
      { stepPathIndex: 0, distanceMeters: 9_000, durationSeconds: 600, instructions: 'Turn left' },
      { stepPathIndex: 2, distanceMeters: 14_140, durationSeconds: 1_090 },
    ],
    stepPaths: [[A, B, C], [A], [C, D], [A, E, D], [A]],
  };

  it('uses the first route and joins its step paths in step order without repeated points', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => json(directions) });
    const { driving } = connect(apple, key);

    const route = await driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal());

    expect(route).toEqual({
      durationSeconds: 1_690,
      distanceMetres: 23_140,
      trafficAware: true,
      path: [A, B, C, D].map(({ latitude, longitude }) => ({ lat: latitude, lon: longitude })),
    });
  });

  it('asks /v1/directions for an automobile route departing or arriving at a UTC time', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => json(directions) });
    const { driving } = connect(apple, key);

    await driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal());
    await driving.routeDrive(PARRAMATTA, CENTRAL, ARRIVE, openSignal());

    const [departing, arriving] = apple.requestsTo('/v1/directions');
    expect(Object.fromEntries(departing?.params ?? [])).toEqual({
      origin: '-33.883200,151.207000',
      destination: '-33.815000,151.001100',
      transportType: 'Automobile',
      departureDate: '2026-10-24T21:30:45Z',
    });
    expect(Object.fromEntries(arriving?.params ?? [])).toEqual({
      origin: '-33.815000,151.001100',
      destination: '-33.883200,151.207000',
      transportType: 'Automobile',
      arrivalDate: '2026-10-24T22:15:00Z',
    });
  });

  it('reports no route as a rejected request', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => json({ routes: [] }) });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ provider: 'apple-maps', failure: 'rejected-request' });
  });

  it('reports a step that points at a missing path as malformed', async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': () => json({ ...directions, stepPaths: directions.stepPaths.slice(0, 3) }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'malformed-response' });
  });

  it('reports a route without a duration as malformed rather than guessing', async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': () => json({ routes: [{ distanceMeters: 23_140, stepIndexes: [] }] }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'malformed-response' });
  });
});
