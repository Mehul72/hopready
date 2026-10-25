import {
  type CarParkFacility,
  type Occupancy,
  ProviderError,
  type ProviderFailure,
} from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { API_VERSION } from './app';
import type { RateLimiter } from './rate-limit';
import {
  facility,
  fakeCarParks,
  fakeDriving,
  fakePlaces,
  fakeTransit,
  INSTALL_ID,
  never,
  NOW,
  parramattaToWynyard,
  PLACES,
  planRequest,
  postJson,
  suggestion,
  testApp,
  untilAborted,
} from './test-support/fakes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ErrorBody {
  error: { code: string; message: string; retryable: boolean; requestId: string };
}

async function errorOf(response: Response): Promise<ErrorBody['error']> {
  const body = (await response.json()) as ErrorBody;
  return body.error;
}

function expectStandardHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-request-id')).toMatch(UUID);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

describe('GET /v1/health', () => {
  it('reports the mode and which providers are set up, without calling any of them', async () => {
    const transit = fakeTransit();
    const { app } = testApp({ providers: { transit } });

    const response = await app.request('/v1/health');

    expect(response.status).toBe(200);
    expectStandardHeaders(response);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'hopready-api',
      version: API_VERSION,
      mode: 'live',
      providers: {
        transit: 'configured',
        driving: 'missing',
        carParks: 'missing',
        places: 'missing',
      },
    });
    expect(transit.queries).toHaveLength(0);
  });

  it('never includes provider keys', async () => {
    const { app } = testApp();
    const text = await (await app.request('/v1/health')).text();
    expect(text).not.toContain('tfnsw-test-key-not-real');
  });
});

describe('routing', () => {
  it('answers unknown routes with a JSON 404 and never logs the path as sent', async () => {
    const { app, logs } = testApp();
    const response = await app.request('/v1/nope/-33.8688,151.2093');

    expect(response.status).toBe(404);
    expectStandardHeaders(response);
    const error = await errorOf(response);
    expect(error.code).toBe('not-found');
    expect(error.requestId).toBe(response.headers.get('x-request-id'));
    expect(logs.entries).toContainEqual(
      expect.objectContaining({ message: 'request finished', route: 'unmatched', status: 404 }),
    );
    expect(logs.lines().join('\n')).not.toContain('33.8688');
  });

  it('answers a wrong method with a JSON 405 that lists the allowed ones', async () => {
    const { app, logs } = testApp();

    const getPlan = await app.request('/v1/plan');
    expect(getPlan.status).toBe(405);
    expect(logs.entries).toContainEqual(
      expect.objectContaining({ message: 'request finished', route: 'unmatched', status: 405 }),
    );
    expect(getPlan.headers.get('allow')).toBe('POST');
    expectStandardHeaders(getPlan);
    expect((await errorOf(getPlan)).code).toBe('method-not-allowed');

    const postHealth = await app.request('/v1/health', { method: 'POST' });
    expect(postHealth.status).toBe(405);
    expect(postHealth.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('POST /v1/plan', () => {
  it('plans a trip with the configured providers and labels it live', async () => {
    const transit = fakeTransit();
    const { app } = testApp({ providers: { transit } });

    const response = await postJson(app, '/v1/plan', planRequest());

    expect(response.status).toBe(200);
    expectStandardHeaders(response);
    const plan = (await response.json()) as {
      mode: string;
      itineraries: { strategy: string; departAt: string; arriveAt: string }[];
    };
    expect(plan.mode).toBe('live');
    expect(plan.itineraries).toHaveLength(1);
    expect(plan.itineraries[0]).toMatchObject({
      strategy: 'transit-only',
      departAt: '2026-10-26T20:32:00.000Z',
      arriveAt: '2026-10-26T21:20:00.000Z',
    });
    expect(transit.queries).toHaveLength(1);
    expect(transit.queries[0]?.from.name).toBe(PLACES.parramattaHome.name);
  });

  it('rejects a body that is not JSON', async () => {
    const { app } = testApp({ providers: { transit: fakeTransit() } });
    const response = await postJson(app, '/v1/plan', '{"origin": ');

    expect(response.status).toBe(400);
    expectStandardHeaders(response);
    expect((await errorOf(response)).code).toBe('invalid-json');
  });

  it('rejects an empty body as not JSON', async () => {
    const { app } = testApp({ providers: { transit: fakeTransit() } });
    const response = await app.request('/v1/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('invalid-json');
  });

  it.each([
    ['text/plain;charset=UTF-8', '/v1/plan'],
    ['application/x-www-form-urlencoded', '/v1/plan'],
    ['multipart/form-data; boundary=x', '/v1/places/search'],
    [null, '/v1/places/search'],
  ])(
    'refuses a %s body to %s, which a web page could send without asking',
    async (contentType, path) => {
      const transit = fakeTransit();
      const { app } = testApp({ providers: { transit } });
      const body = path === '/v1/plan' ? planRequest() : { query: 'Central', near: null };
      const response = await app.request(path, {
        method: 'POST',
        headers: contentType === null ? {} : { 'content-type': contentType },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(415);
      expect((await errorOf(response)).code).toBe('unsupported-media-type');
      expect(transit.queries).toHaveLength(0);
    },
  );

  it('accepts JSON declared with a charset', async () => {
    const { app } = testApp({ providers: { transit: fakeTransit() } });
    const response = await postJson(app, '/v1/plan', planRequest(), {
      'content-type': 'application/json; charset=utf-8',
    });

    expect(response.status).toBe(200);
  });

  it('names the first invalid field without echoing its value', async () => {
    const transit = fakeTransit();
    const { app } = testApp({ providers: { transit } });
    const request = planRequest();
    const response = await postJson(app, '/v1/plan', {
      ...request,
      origin: { ...request.origin, coordinate: { lat: -133.815, lon: 151.0011 } },
    });

    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe('invalid-request');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('origin.coordinate.lat');
    expect(error.message).not.toContain('133.815');
    expect(transit.queries).toHaveLength(0);
  });

  it('refuses bodies over 32 KB with or without a declared length', async () => {
    const { app } = testApp({ providers: { transit: fakeTransit() } });
    const oversized = JSON.stringify({ ...planRequest(), padding: 'x'.repeat(33 * 1024) });

    const undeclared = await postJson(app, '/v1/plan', oversized);
    expect(undeclared.status).toBe(413);
    expect((await errorOf(undeclared)).code).toBe('payload-too-large');

    const declared = await postJson(app, '/v1/plan', oversized, {
      'content-length': String(oversized.length),
    });
    expect(declared.status).toBe(413);
  });

  it.each([
    ['origin', { origin: PLACES.melbourne }],
    ['destination', { destination: PLACES.melbourne }],
    [
      'parked car',
      {
        trip: {
          kind: 'return-via-car' as const,
          parkedCar: { location: PLACES.melbourne, carParkId: null, confirmedAt: NOW },
        },
      },
    ],
  ])('answers 422 outside-coverage when the %s is outside Greater Sydney', async (_, change) => {
    const transit = fakeTransit();
    const { app } = testApp({ providers: { transit } });
    const response = await postJson(app, '/v1/plan', planRequest(change));

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('outside-coverage');
    expect(transit.queries).toHaveLength(0);
  });

  it('answers 503 not-configured when no transit provider is set up', async () => {
    const { app } = testApp();
    const response = await postJson(app, '/v1/plan', planRequest());

    expect(response.status).toBe(503);
    expectStandardHeaders(response);
    const error = await errorOf(response);
    expect(error.code).toBe('not-configured');
    expect(error.retryable).toBe(false);
  });

  const failureCases: {
    failure: ProviderFailure;
    status: number;
    code: string;
    retryable: boolean;
  }[] = [
    { failure: 'timeout', status: 504, code: 'provider-timeout', retryable: true },
    { failure: 'rate-limited', status: 503, code: 'provider-busy', retryable: true },
    { failure: 'not-configured', status: 503, code: 'not-configured', retryable: false },
    { failure: 'unavailable', status: 502, code: 'provider-unavailable', retryable: true },
    { failure: 'malformed-response', status: 502, code: 'provider-bad-response', retryable: false },
    { failure: 'rejected-request', status: 422, code: 'provider-rejected', retryable: false },
  ];

  it.each(failureCases)(
    'maps a $failure provider failure to $status $code',
    async ({ failure, status, code, retryable }) => {
      const transit = fakeTransit(async () => {
        throw new ProviderError('tfnsw-trip-planner', failure, 'upstream said no', { status: 500 });
      });
      const { app } = testApp({ providers: { transit } });

      const response = await postJson(app, '/v1/plan', planRequest());

      expect(response.status).toBe(status);
      expectStandardHeaders(response);
      const error = await errorOf(response);
      expect(error).toMatchObject({ code, retryable });
      expect(error.message).not.toContain('upstream said no');
      expect(response.headers.get('retry-after')).toBeNull();
    },
  );

  it('passes on Retry-After when a busy provider says when to come back', async () => {
    const transit = fakeTransit(async () => {
      throw new ProviderError('tfnsw-trip-planner', 'rate-limited', 'over quota', {
        status: 429,
        retryAfterSeconds: 30,
      });
    });
    const { app } = testApp({ providers: { transit } });

    const response = await postJson(app, '/v1/plan', planRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('answers 500 with a generic message when something unexpected fails', async () => {
    const { app, logs } = testApp({
      providers: { transit: fakeTransit() },
      planTrip: async () => {
        throw new TypeError('Cannot read properties of undefined (reading -33.815)');
      },
    });

    const response = await postJson(app, '/v1/plan', planRequest());

    expect(response.status).toBe(500);
    expectStandardHeaders(response);
    const error = await errorOf(response);
    expect(error.code).toBe('internal-error');
    expect(error.message).not.toContain('Cannot read');
    const logged = logs.entries.find((entry) => entry.message === 'unexpected error');
    expect(logged).toMatchObject({ level: 'error', errorName: 'TypeError' });
    expect(logs.lines().join('\n')).not.toContain('-33.815');
  });

  it('answers 504 within the deadline when a provider hangs and ignores the abort', async () => {
    const deadlineMs = 300;
    const transit = fakeTransit(() => never());
    const { app, logs } = testApp({
      providers: { transit },
      config: { planDeadlineMs: deadlineMs },
    });

    const startedAt = performance.now();
    const response = await postJson(app, '/v1/plan', planRequest());
    const tookMs = performance.now() - startedAt;

    expect(response.status).toBe(504);
    expect((await errorOf(response)).code).toBe('deadline-exceeded');
    expect(tookMs).toBeGreaterThanOrEqual(deadlineMs - 20);
    expect(tookMs).toBeLessThan(deadlineMs + 1_000);
    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'request finished',
        status: 504,
        errorCode: 'deadline-exceeded',
      }),
    );
  });

  it('returns the options it has when a slow provider stops at the deadline abort', async () => {
    const transit = fakeTransit();
    const driving = fakeDriving((_from, _to, signal) => untilAborted(signal));
    const { app } = testApp({
      providers: { transit, driving },
      config: { planDeadlineMs: 300 },
    });

    const response = await postJson(
      app,
      '/v1/plan',
      planRequest({ access: { transit: true, drive: true, dropOff: false } }),
    );

    expect(response.status).toBe(200);
    const plan = (await response.json()) as {
      itineraries: { strategy: string }[];
      unavailable: { strategy: string }[];
    };
    expect(plan.itineraries.map((itinerary) => itinerary.strategy)).toEqual(['transit-only']);
    expect(plan.unavailable.map((entry) => entry.strategy)).toContain('drive-only');
  });
});

describe('rate limiting', () => {
  it('turns away the 21st plan request in a minute from one install with 429 and Retry-After', async () => {
    const { app, clock } = testApp({ providers: { transit: fakeTransit() } });

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await postJson(app, '/v1/plan', planRequest());
      expect(response.status).toBe(200);
      clock.advanceMs(1_000);
    }
    const limited = await postJson(app, '/v1/plan', planRequest());

    expect(limited.status).toBe(429);
    expectStandardHeaders(limited);
    expect(limited.headers.get('retry-after')).toBe('40');
    const error = await errorOf(limited);
    expect(error).toMatchObject({ code: 'too-many-requests', retryable: true });

    const otherInstall = await postJson(app, '/v1/plan', planRequest(), {
      'X-HopReady-Install': '9b2e7c4a-1d3f-4a5b-8c6d-0e1f2a3b4c5d',
    });
    expect(otherInstall.status).toBe(200);

    clock.advanceMs(41_000);
    expect((await postJson(app, '/v1/plan', planRequest())).status).toBe(200);
  });

  it('rejects an install header that is not a version 4 UUID', async () => {
    const transit = fakeTransit();
    const { app } = testApp({ providers: { transit } });

    for (const header of ['not-a-uuid', '3f0c8a52-6b1e-1d3a-9c7e-2b5d8f1a4e60', `${INSTALL_ID}x`]) {
      const response = await postJson(app, '/v1/plan', planRequest(), {
        'X-HopReady-Install': header,
      });
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe('invalid-request');
      expect(error.message).toContain('X-HopReady-Install');
    }
    expect(transit.queries).toHaveLength(0);
  });

  it('falls back to the client address when there is no install header', async () => {
    const { app } = testApp({ providers: { transit: fakeTransit() } });
    const send = (address: string) =>
      app.request('/v1/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': address },
        body: JSON.stringify(planRequest()),
      });

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect((await send('203.0.113.7')).status).toBe(200);
    }
    expect((await send('203.0.113.7')).status).toBe(429);
    expect((await send('203.0.113.8')).status).toBe(200);
  });

  it('applies the coarse per-address limit to every route', async () => {
    const { app } = testApp();
    const health = () =>
      app.request('/v1/health', { headers: { 'CF-Connecting-IP': '198.51.100.4' } });

    for (let attempt = 1; attempt <= 120; attempt += 1) {
      expect((await health()).status).toBe(200);
    }
    const limited = await health();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('lets requests through and logs an error when the limiter itself fails', async () => {
    const brokenLimiter: RateLimiter = {
      check: async () => {
        throw new Error('rate limiting service unreachable');
      },
    };
    const { app, logs } = testApp({ rateLimiter: brokenLimiter });

    const response = await app.request('/v1/health');

    expect(response.status).toBe(200);
    expect(
      logs.entries.some((entry) => entry.message === 'rate limiter failed, request allowed'),
    ).toBe(true);
  });
});

describe('POST /v1/places/search', () => {
  const centralStop = suggestion('Central Station', -33.8832, 151.2063, 'stop');
  const centralPlace = suggestion('Central station', -33.8836, 151.2068, 'poi');
  const centralPark = suggestion('Central Park', -33.8846, 151.2005, 'poi');

  it('merges stops first, then places, without duplicates', async () => {
    const stops = fakePlaces('tfnsw-trip-planner', async () => [centralStop]);
    const places = fakePlaces('apple-maps', async () => [centralPlace, centralPark]);
    const { app } = testApp({ providers: { places: [stops, places] } });

    const response = await postJson(app, '/v1/places/search', {
      query: '  Central  ',
      near: { lat: -33.87, lon: 151.21 },
    });

    expect(response.status).toBe(200);
    expectStandardHeaders(response);
    expect(await response.json()).toEqual({
      mode: 'live',
      results: [centralStop, centralPark],
      unavailable: [],
    });
    expect(stops.searches).toEqual([{ query: 'Central', near: { lat: -33.87, lon: 151.21 } }]);
    expect(places.searches[0]?.query).toBe('Central');
  });

  it('still answers 200 with what worked when one provider fails', async () => {
    const stops = fakePlaces('tfnsw-trip-planner', async () => [centralStop]);
    const places = fakePlaces('apple-maps', async () => {
      throw new ProviderError('apple-maps', 'unavailable', 'Apple returned HTTP 500', {
        status: 500,
      });
    });
    const { app } = testApp({ providers: { places: [stops, places] } });

    const response = await postJson(app, '/v1/places/search', { query: 'Central' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: 'live',
      results: [centralStop],
      unavailable: ['apple-maps'],
    });
  });

  it('answers 502 when every provider fails', async () => {
    const failing = (name: 'tfnsw-trip-planner' | 'apple-maps', failure: ProviderFailure) =>
      fakePlaces(name, async () => {
        throw new ProviderError(name, failure, 'failed');
      });
    const { app } = testApp({
      providers: {
        places: [failing('tfnsw-trip-planner', 'timeout'), failing('apple-maps', 'unavailable')],
      },
    });

    const response = await postJson(app, '/v1/places/search', { query: 'Central' });

    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('provider-unavailable');
  });

  it('answers 503 with Retry-After when every provider is out of quota', async () => {
    const busy = (name: 'tfnsw-trip-planner' | 'apple-maps', retryAfterSeconds: number) =>
      fakePlaces(name, async () => {
        throw new ProviderError(name, 'rate-limited', 'over quota', { retryAfterSeconds });
      });
    const { app } = testApp({
      providers: { places: [busy('tfnsw-trip-planner', 20), busy('apple-maps', 90)] },
    });

    const response = await postJson(app, '/v1/places/search', { query: 'Central' });

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('90');
    expect((await errorOf(response)).code).toBe('provider-busy');
  });

  it('answers 503 not-configured when no place provider is set up', async () => {
    const { app } = testApp();
    const response = await postJson(app, '/v1/places/search', { query: 'Central' });

    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('not-configured');
  });

  it.each([
    ['a query under 2 characters', { query: ' a ' }],
    ['a query over 80 characters', { query: 'x'.repeat(81) }],
    ['a query with control characters', { query: 'Central\u0000Station' }],
    ['an impossible coordinate', { query: 'Central', near: { lat: 200, lon: 151 } }],
  ])('rejects a search with %s', async (_, body) => {
    const stops = fakePlaces('tfnsw-trip-planner', async () => [centralStop]);
    const { app } = testApp({ providers: { places: [stops] } });

    const response = await postJson(app, '/v1/places/search', body);

    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('invalid-request');
    expect(stops.searches).toHaveLength(0);
  });
});

describe('GET /v1/carparks', () => {
  const tallawong = facility('26', 'Tallawong P1', -33.6913, 150.9061);
  const kellyville = facility('29', 'Kellyville (north)', -33.7135, 150.9353);

  it('lists facilities without asking for space counts, and caches the list for ten minutes', async () => {
    const carParks = fakeCarParks({
      facilities: [tallawong, kellyville],
      occupancy: async () => new Map(),
    });
    const { app, clock } = testApp({ providers: { carParks } });

    const first = await app.request('/v1/carparks', {
      headers: { 'X-HopReady-Install': INSTALL_ID },
    });
    expect(first.status).toBe(200);
    expectStandardHeaders(first);
    const listing = (await first.json()) as {
      mode: string;
      fetchedAt: string;
      carParks: { id: string; occupancy: Occupancy }[];
      notices: string[];
    };
    expect(listing.mode).toBe('live');
    expect(listing.fetchedAt).toBe(NOW);
    expect(listing.notices).toEqual([]);
    expect(listing.carParks.map((carPark) => [carPark.id, carPark.occupancy])).toEqual([
      ['26', { status: 'unknown', reason: 'Space counts are checked when you plan a trip.' }],
      ['29', { status: 'unknown', reason: 'Space counts are checked when you plan a trip.' }],
    ]);

    clock.advanceMs(9 * 60_000);
    expect((await app.request('/v1/carparks')).status).toBe(200);
    expect(carParks.calls).toEqual({ listFacilities: 1, occupancy: 0 });

    clock.advanceMs(2 * 60_000);
    expect((await app.request('/v1/carparks')).status).toBe(200);
    expect(carParks.calls).toEqual({ listFacilities: 2, occupancy: 0 });
  });

  it('asks again next time after an empty list, instead of keeping it', async () => {
    const answers: CarParkFacility[][] = [[], [tallawong]];
    const carParks = fakeCarParks({
      facilities: [],
      listFacilities: async () => answers.shift() ?? [],
      occupancy: async () => new Map(),
    });
    const { app } = testApp({ providers: { carParks } });

    const empty = (await (await app.request('/v1/carparks')).json()) as { carParks: unknown[] };
    const recovered = (await (await app.request('/v1/carparks')).json()) as {
      carParks: unknown[];
    };

    expect(empty.carParks).toEqual([]);
    expect(recovered.carParks).toHaveLength(1);
    expect(carParks.calls.listFacilities).toBe(2);
  });

  it('maps a facility list failure like any provider failure', async () => {
    const carParks = fakeCarParks({
      facilities: [],
      listFacilities: async () => {
        throw new ProviderError('tfnsw-car-park', 'malformed-response', 'bad shape');
      },
      occupancy: async () => new Map(),
    });
    const { app } = testApp({ providers: { carParks } });

    const response = await app.request('/v1/carparks');
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('provider-bad-response');
  });

  it('answers 503 not-configured without a car park provider', async () => {
    const { app } = testApp();
    const response = await app.request('/v1/carparks');
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('not-configured');
  });
});

describe('logging', () => {
  it('writes one structured line per request with its ID, route, status and duration', async () => {
    const { app, logs } = testApp({ providers: { transit: fakeTransit() } });

    const response = await postJson(app, '/v1/plan', planRequest());

    const finished = logs.entries.filter((entry) => entry.message === 'request finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      level: 'info',
      requestId: response.headers.get('x-request-id'),
      method: 'POST',
      route: '/v1/plan',
      status: 200,
      mode: 'live',
      itineraryCount: 1,
    });
    expect(typeof finished[0]?.durationMs).toBe('number');
  });

  it('logs provider failures by kind, provider and status', async () => {
    const transit = fakeTransit(async () => {
      throw new ProviderError('tfnsw-trip-planner', 'rate-limited', 'over quota', { status: 403 });
    });
    const { app, logs } = testApp({ providers: { transit } });

    await postJson(app, '/v1/plan', planRequest());

    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'provider call failed',
        provider: 'tfnsw-trip-planner',
        operation: 'planJourneys',
        failure: 'rate-limited',
        providerStatus: 403,
      }),
    );
  });

  it('never logs coordinates, search text, keys or install IDs', async () => {
    const secretQuery = 'Wynyard Secret Lane';
    const leakyError = new Error(
      `fetch failed: https://api.example/search?q=${secretQuery}&lat=-33.8150&key=tfnsw-test-key-not-real`,
    );
    const transit = fakeTransit(async () => {
      throw leakyError;
    });
    const places = fakePlaces('apple-maps', async () => {
      throw leakyError;
    });
    const stops = fakePlaces('tfnsw-trip-planner', async () => [
      suggestion('Wynyard Station', -33.8659, 151.2058, 'stop'),
    ]);
    const { app, logs } = testApp({ providers: { transit, places: [stops, places] } });

    await postJson(app, '/v1/plan', planRequest());
    await postJson(app, '/v1/places/search', {
      query: secretQuery,
      near: { lat: -33.8688, lon: 151.2093 },
    });
    await postJson(app, '/v1/plan', { ...planRequest(), origin: PLACES.melbourne });

    const written = logs.lines().join('\n');
    expect(logs.entries.length).toBeGreaterThan(3);
    for (const sensitive of [
      secretQuery,
      'tfnsw-test-key-not-real',
      INSTALL_ID,
      '-33.815',
      '151.0011',
      '-33.8688',
      '151.2093',
      '-37.8183',
      'Parramatta',
      'Melbourne',
      'api.example',
    ]) {
      expect(written).not.toContain(sensitive);
    }
  });
});

describe('journey data passes through unchanged', () => {
  it('returns provider legs as the planner built them', async () => {
    const journey = parramattaToWynyard();
    const { app } = testApp({ providers: { transit: fakeTransit(async () => [journey]) } });

    const plan = (await (await postJson(app, '/v1/plan', planRequest())).json()) as {
      itineraries: { legs: { kind: string; start: string }[] }[];
    };
    const kinds = plan.itineraries[0]?.legs.map((leg) => leg.kind);
    expect(kinds).toEqual(['walk', 'wait', 'transit', 'walk']);
  });
});
