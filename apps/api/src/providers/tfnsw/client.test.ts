import { ProviderError } from '@hopready/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { classifyTfnswFailure, createTfnswClient } from './client';
import { RateGate } from './rate-gate';
import { fakeFetch, jsonResponse, neverAborted, type FakeFetch } from './test-support';

const API_KEY = 'test-key-0123456789abcdef';
const greetingSchema = z.object({ greeting: z.string() });

function clientWith(fetchImpl: FakeFetch, gate = new RateGate({ requestsPerSecond: 100 })) {
  return createTfnswClient({ apiKey: API_KEY, gate, fetchImpl });
}

function getGreeting(client: ReturnType<typeof clientWith>, signal = neverAborted()) {
  return client.get({
    provider: 'tfnsw-trip-planner',
    path: '/v1/tp/stop_finder',
    params: { name_sf: 'Chatswood', outputFormat: 'rapidJSON' },
    parse: (body) => greetingSchema.parse(body),
    signal,
  });
}

function respondInTurn(...responses: (() => Response)[]): FakeFetch {
  let index = 0;
  return fakeFetch(() => responses[Math.min(index++, responses.length - 1)]!());
}

const failure =
  (status: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify({ ErrorDetails: { Message: 'from TfNSW' } }), { status, headers });

async function errorFrom(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('classifyTfnswFailure', () => {
  it.each([
    [401, {}, 'not-configured'],
    [401, { 'X-Error-Detail': 'Account Over Rate Limit' }, 'rate-limited'],
    [401, { 'X-Error-Detail': 'Account Over Quota Limit' }, 'rate-limited'],
    [403, { 'X-Error-Detail': 'Account Over Rate Limit' }, 'rate-limited'],
    [403, { 'X-Error-Detail': 'Account Over Quota Limit' }, 'rate-limited'],
    [429, {}, 'rate-limited'],
    [503, {}, 'unavailable'],
  ] as const)('reads HTTP %i with headers %o as %s', (status, headers, expected) => {
    expect(classifyTfnswFailure(new Response(null, { status, headers }))).toBe(expected);
  });

  it('leaves other statuses to the shared mapping', () => {
    expect(classifyTfnswFailure(new Response(null, { status: 403 }))).toBeNull();
    expect(classifyTfnswFailure(new Response(null, { status: 404 }))).toBeNull();
    expect(classifyTfnswFailure(new Response(null, { status: 500 }))).toBeNull();
  });
});

describe('createTfnswClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the key as "apikey <key>" and the parameters as a query string', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ greeting: 'hello' }));

    await expect(getGreeting(clientWith(fetchImpl))).resolves.toEqual({ greeting: 'hello' });

    const [request] = fetchImpl.requests;
    expect(request?.headers.get('authorization')).toBe(`apikey ${API_KEY}`);
    expect(request?.url.origin).toBe('https://api.transport.nsw.gov.au');
    expect(request?.url.pathname).toBe('/v1/tp/stop_finder');
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      name_sf: 'Chatswood',
      outputFormat: 'rapidJSON',
    });
  });

  it.each([
    ['a 401', failure(401), 'not-configured', 401],
    [
      'a 403 over the rate limit',
      failure(403, { 'X-Error-Detail': 'Account Over Rate Limit' }),
      'rate-limited',
      403,
    ],
    [
      'a 401 over the quota',
      failure(401, { 'X-Error-Detail': 'Account Over Quota Limit' }),
      'rate-limited',
      401,
    ],
    ['a 429', failure(429), 'rate-limited', 429],
  ])('reports %s as %s without retrying or leaking the key', async (_, response, kind, status) => {
    const fetchImpl = respondInTurn(response, () => jsonResponse({ greeting: 'unused' }));

    const error = await errorFrom(getGreeting(clientWith(fetchImpl)));

    expect(error).toMatchObject({ failure: kind, status, provider: 'tfnsw-trip-planner' });
    expect(fetchImpl.requests).toHaveLength(1);
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(API_KEY);
  });

  it('retries a 503 once and returns the second answer', async () => {
    const fetchImpl = respondInTurn(failure(503), () => jsonResponse({ greeting: 'second' }));

    await expect(getGreeting(clientWith(fetchImpl))).resolves.toEqual({ greeting: 'second' });
    expect(fetchImpl.requests).toHaveLength(2);
  });

  it('gives up after one retry when TfNSW stays unavailable', async () => {
    const fetchImpl = respondInTurn(failure(503));

    const error = await errorFrom(getGreeting(clientWith(fetchImpl)));

    expect(error).toMatchObject({ failure: 'unavailable', status: 503 });
    expect(fetchImpl.requests).toHaveLength(2);
  });

  it('reports a body that is not JSON as a malformed response', async () => {
    const fetchImpl = fakeFetch(() => new Response('<html>Gateway</html>', { status: 200 }));

    const error = await errorFrom(getGreeting(clientWith(fetchImpl)));

    expect(error.failure).toBe('malformed-response');
  });

  it('reports JSON in the wrong shape as a malformed response', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ greeting: 42 }));

    const error = await errorFrom(getGreeting(clientWith(fetchImpl)));

    expect(error.failure).toBe('malformed-response');
  });

  it('queues the retry behind the rate gate like any other request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-25T21:00:00Z'));
    const sentAtMs: number[] = [];
    let attempt = 0;
    const fetchImpl = fakeFetch(() => {
      sentAtMs.push(Date.now());
      attempt += 1;
      return attempt === 1 ? failure(503)() : jsonResponse({ greeting: 'later' });
    });
    const client = clientWith(fetchImpl, new RateGate({ requestsPerSecond: 1 }));

    const result = getGreeting(client);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual({ greeting: 'later' });
    expect(sentAtMs).toHaveLength(2);
    expect(sentAtMs[1]! - sentAtMs[0]!).toBeGreaterThanOrEqual(1_000);
  });

  it('reports a full queue as rate-limited without calling TfNSW', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ greeting: 'unused' }));
    const gate = new RateGate({ requestsPerSecond: 1, maxQueueMs: 0 });
    const client = clientWith(fetchImpl, gate);
    await getGreeting(client);

    const error = await errorFrom(getGreeting(client));

    expect(error.failure).toBe('rate-limited');
    expect(fetchImpl.requests).toHaveLength(1);
  });

  it('holds later requests for as long as a 429 Retry-After asks', async () => {
    const fetchImpl = respondInTurn(failure(429, { 'Retry-After': '30' }), () =>
      jsonResponse({ greeting: 'unused' }),
    );
    const client = clientWith(fetchImpl);

    await expect(getGreeting(client)).rejects.toMatchObject({
      failure: 'rate-limited',
      retryAfterSeconds: 30,
    });
    const error = await errorFrom(getGreeting(client));

    expect(error.failure).toBe('rate-limited');
    expect(fetchImpl.requests).toHaveLength(1);
  });

  it('turns an abort while waiting for a slot into a timeout', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ greeting: 'unused' }));
    const client = clientWith(fetchImpl, new RateGate({ requestsPerSecond: 1 }));
    await getGreeting(client);
    const controller = new AbortController();

    const waiting = getGreeting(client, controller.signal);
    controller.abort();
    const error = await errorFrom(waiting);

    expect(error.failure).toBe('timeout');
    expect(fetchImpl.requests).toHaveLength(1);
  });

  it.each(['', 'has space', 'line\nbreak'])(
    'refuses a key that cannot go in a header (%j) without repeating it',
    (badKey) => {
      let thrown: unknown;
      try {
        createTfnswClient({
          apiKey: badKey,
          gate: new RateGate({ requestsPerSecond: 1 }),
          fetchImpl: fakeFetch(() => jsonResponse({})),
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toMatch(/TfNSW API key/);
      if (badKey) expect(message).not.toContain(badKey);
    },
  );
});
