import type { Itinerary } from '@hopready/core';

import {
  hangingUntilAborted,
  jsonResponse,
  scriptedFetch,
  textResponse,
} from '@/test-support/fetch';
import { PLACES, planRequest, planResponse, transitItinerary } from '@/test-support/trips';

import { API_ROUTES, createApiClient } from './client';
import { ApiError, type ApiErrorKind } from './errors';
import { type FetchFunction, type HttpTransport, INSTALL_ID_HEADER } from './http';

const BASE_URL = 'https://api.hopready.test';
const INSTALL_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-26T20:55:00.000Z');

function clientWith(fetch: FetchFunction, overrides: Partial<HttpTransport> = {}) {
  return createApiClient({
    baseUrl: BASE_URL,
    fetch,
    installId: () => INSTALL_ID,
    isOffline: async () => false,
    now: () => NOW,
    ...overrides,
  });
}

async function failureOf(work: Promise<unknown>): Promise<ApiError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

function serverError(code: string) {
  return { error: { code, message: 'Server wording the app never shows', retryable: false } };
}

describe('plan', () => {
  it('posts the request with JSON and install headers and returns the parsed response', async () => {
    const itinerary: Itinerary = transitItinerary({ departAt: '2026-10-26T21:00:00.000Z' });
    const fetch = scriptedFetch(async () => jsonResponse(200, planResponse([itinerary])));

    const response = await clientWith(fetch).plan(planRequest());

    expect(response.itineraries).toEqual([itinerary]);
    const [request] = fetch.requests;
    expect(request?.url).toBe(`${BASE_URL}${API_ROUTES.plan}`);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [INSTALL_ID_HEADER]: INSTALL_ID,
    });
    expect(JSON.parse(request?.init.body ?? 'null')).toEqual(planRequest());
  });

  it('gives up after the timeout and reports a timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetch = scriptedFetch(hangingUntilAborted);
      const pending = failureOf(clientWith(fetch, { timeoutMs: 15_000 }).plan(planRequest()));
      await jest.advanceTimersByTimeAsync(15_000);
      const error = await pending;
      expect(error.kind).toBe('timeout');
      expect(error.message).toBe('HopReady took too long to answer. Try again.');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a cancelled request as cancelled, not as a timeout', async () => {
    const controller = new AbortController();
    const fetch = scriptedFetch(hangingUntilAborted);
    const pending = failureOf(clientWith(fetch).plan(planRequest(), controller.signal));
    controller.abort();
    expect((await pending).kind).toBe('cancelled');
  });

  it.each<[string, number, Record<string, string>, unknown, ApiErrorKind, number | null]>([
    [
      '429 with Retry-After seconds',
      429,
      { 'Retry-After': '30' },
      serverError('too-many-requests'),
      'rate-limited',
      30,
    ],
    [
      '429 with a Retry-After date',
      429,
      { 'Retry-After': 'Mon, 26 Oct 2026 20:56:30 GMT' },
      serverError('too-many-requests'),
      'rate-limited',
      90,
    ],
    ['429 without Retry-After', 429, {}, {}, 'rate-limited', null],
    [
      '503 provider busy',
      503,
      { 'Retry-After': '45' },
      serverError('provider-busy'),
      'rate-limited',
      45,
    ],
    ['503 not-configured', 503, {}, serverError('not-configured'), 'not-configured', null],
    ['503 without a code', 503, {}, {}, 'server', null],
    ['422 outside coverage', 422, {}, serverError('outside-coverage'), 'outside-coverage', null],
    ['422 without a code', 422, {}, {}, 'outside-coverage', null],
    ['422 provider rejected', 422, {}, serverError('provider-rejected'), 'rejected', null],
    ['400 invalid request', 400, {}, serverError('invalid-request'), 'rejected', null],
    ['500 internal error', 500, {}, serverError('internal-error'), 'server', null],
    ['502 provider unavailable', 502, {}, serverError('provider-unavailable'), 'server', null],
    ['504 deadline exceeded', 504, {}, serverError('deadline-exceeded'), 'timeout', null],
  ])('maps %s', async (_, status, headers, body, kind, retryAfterSeconds) => {
    const fetch = scriptedFetch(async () => jsonResponse(status, body, headers));
    const error = await failureOf(clientWith(fetch).plan(planRequest()));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.retryAfterSeconds).toBe(retryAfterSeconds);
    expect(error.message).not.toContain('Server wording');
  });

  it('suggests demo mode only for a not-configured server', async () => {
    const notConfigured = await failureOf(
      clientWith(scriptedFetch(async () => jsonResponse(503, serverError('not-configured')))).plan(
        planRequest(),
      ),
    );
    const busy = await failureOf(
      clientWith(scriptedFetch(async () => jsonResponse(503, serverError('provider-busy')))).plan(
        planRequest(),
      ),
    );
    expect(notConfigured.suggestsDemoMode).toBe(true);
    expect(notConfigured.message).toMatch(/turn on demo mode in Settings/);
    expect(busy.suggestsDemoMode).toBe(false);
  });

  it('says rate limits in words with the wait time', async () => {
    const fetch = scriptedFetch(async () => jsonResponse(429, {}, { 'Retry-After': '30' }));
    const error = await failureOf(clientWith(fetch).plan(planRequest()));
    expect(error.message).toBe('HopReady is busy right now. Try again in 30 seconds.');
  });

  it('treats a body that is not JSON as an invalid response', async () => {
    const fetch = scriptedFetch(async () => textResponse(200, '<html>Gateway</html>'));
    const error = await failureOf(clientWith(fetch).plan(planRequest()));
    expect(error.kind).toBe('invalid-response');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('treats JSON in the wrong shape as an invalid response', async () => {
    const fetch = scriptedFetch(async () =>
      jsonResponse(200, { ...planResponse([]), itineraries: [{ id: 'missing everything' }] }),
    );
    const error = await failureOf(clientWith(fetch).plan(planRequest()));
    expect(error.kind).toBe('invalid-response');
    expect(error.status).toBe(200);
  });

  it('reports offline when the request fails and the device has no network', async () => {
    const fetch = scriptedFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const error = await failureOf(
      clientWith(fetch, { isOffline: async () => true }).plan(planRequest()),
    );
    expect(error.kind).toBe('offline');
    expect(error.message).toBe("You're offline. Connect to the internet, then try again.");
  });

  it('reports the server as unreachable when the device is online', async () => {
    const fetch = scriptedFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const error = await failureOf(clientWith(fetch).plan(planRequest()));
    expect(error.kind).toBe('unreachable');
  });

  it('reports unreachable when the connectivity check itself fails', async () => {
    const fetch = scriptedFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const isOffline = async (): Promise<boolean> => {
      throw new Error('expo-network unavailable');
    };
    const error = await failureOf(clientWith(fetch, { isOffline }).plan(planRequest()));
    expect(error.kind).toBe('unreachable');
  });

  it('fails as not configured, without a request, when the build has no API address', async () => {
    const fetch = scriptedFetch();
    const error = await failureOf(clientWith(fetch, { baseUrl: null }).plan(planRequest()));
    expect(error.kind).toBe('not-configured');
    expect(error.suggestsDemoMode).toBe(true);
    expect(fetch.requests).toHaveLength(0);
  });
});

describe('searchPlaces', () => {
  it('posts the text and location hint in the body and parses the suggestions', async () => {
    const fetch = scriptedFetch(async () =>
      jsonResponse(200, {
        mode: 'live',
        results: [{ place: PLACES.chatswoodStation, detail: 'Train and metro station' }],
        unavailable: ['apple-maps'],
      }),
    );
    const near = { lat: -33.8, lon: 151.18 };

    const results = await clientWith(fetch).searchPlaces('  Chatswood ', near);

    expect(results).toEqual({
      results: [{ place: PLACES.chatswoodStation, detail: 'Train and metro station' }],
      unavailable: ['apple-maps'],
    });
    const [request] = fetch.requests;
    expect(request?.url).toBe(`${BASE_URL}${API_ROUTES.placeSearch}`);
    expect(request?.url).not.toContain('Chatswood');
    expect(JSON.parse(request?.init.body ?? 'null')).toEqual({ query: 'Chatswood', near });
  });

  it('returns no results without a request for text shorter than the server accepts', async () => {
    const fetch = scriptedFetch();
    expect(await clientWith(fetch).searchPlaces(' C ', null)).toEqual({
      results: [],
      unavailable: [],
    });
    expect(fetch.requests).toHaveLength(0);
  });
});

describe('carParks', () => {
  it('parses facilities with their occupancy and notices', async () => {
    const carPark = {
      id: '26',
      name: 'Tallawong P1',
      coordinate: PLACES.tallawongCarPark.coordinate,
      kind: 'transport-park-and-ride',
      stationName: 'Tallawong Station',
      totalSpaces: 121,
      rules: { status: 'unknown' },
      station: PLACES.tallawongStation,
      occupancy: {
        status: 'known',
        spacesAvailable: 12,
        totalSpaces: 121,
        observedAt: '2026-10-26T20:50:00.000Z',
      },
    };
    const fetch = scriptedFetch(async () =>
      jsonResponse(200, {
        mode: 'live',
        fetchedAt: '2026-10-26T20:54:00.000Z',
        carParks: [carPark],
        notices: [],
      }),
    );

    const listing = await clientWith(fetch).carParks();

    expect(listing).toEqual({ carParks: [carPark], notices: [] });
    expect(fetch.requests[0]?.init.method).toBe('GET');
    expect(fetch.requests[0]?.init.body).toBeUndefined();
  });

  it('rejects occupancy reported as zero spaces of zero, which the model treats as unknown', async () => {
    const fetch = scriptedFetch(async () =>
      jsonResponse(200, {
        carParks: [
          {
            id: '26',
            name: 'Tallawong P1',
            coordinate: PLACES.tallawongCarPark.coordinate,
            kind: 'transport-park-and-ride',
            stationName: null,
            totalSpaces: null,
            rules: { status: 'unknown' },
            station: null,
            occupancy: {
              status: 'known',
              spacesAvailable: 0,
              totalSpaces: 0,
              observedAt: NOW.toISOString(),
            },
          },
        ],
      }),
    );
    expect((await failureOf(clientWith(fetch).carParks())).kind).toBe('invalid-response');
  });
});

describe('live data agreement', () => {
  it('sends nothing at all until the person agrees', async () => {
    const fetch = scriptedFetch(async () => jsonResponse(200, planResponse([])));
    const client = clientWith(fetch, { hasLiveDataConsent: () => false });

    const failures = [
      await failureOf(client.plan(planRequest())),
      await failureOf(client.searchPlaces('Chatswood')),
      await failureOf(client.carParks()),
    ];

    for (const error of failures) {
      expect(error.kind).toBe('consent-required');
      expect(error.suggestsDemoMode).toBe(true);
    }
    expect(fetch.requests).toHaveLength(0);
  });

  it('sends once the person has agreed', async () => {
    const fetch = scriptedFetch(async () => jsonResponse(200, planResponse([])));

    await clientWith(fetch, { hasLiveDataConsent: () => true }).plan(planRequest());

    expect(fetch.requests).toHaveLength(1);
  });

  it('says live planning is not set up, rather than asking, when there is no server', async () => {
    const fetch = scriptedFetch(async () => jsonResponse(200, planResponse([])));
    const client = clientWith(fetch, { baseUrl: null, hasLiveDataConsent: () => false });

    expect((await failureOf(client.plan(planRequest()))).kind).toBe('not-configured');
  });
});
