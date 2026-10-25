import { ProviderError } from '@hopready/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  connect,
  fakeAppleMaps,
  generateMapsKey,
  json,
  openSignal,
  type MapsKey,
} from './fake-apple-maps';

const CENTRAL = { lat: -33.8832, lon: 151.207 };
const PARRAMATTA = { lat: -33.815, lon: 151.0011 };
const DEPART = { type: 'depart', at: '2026-10-25T08:30:00+11:00' } as const;

const ROUTE = { routes: [{ durationSeconds: 1_690, distanceMeters: 23_140 }] };

function respondInTurn(...responses: (() => Response)[]): () => Response {
  let next = 0;
  return () => {
    const respond = responses[Math.min(next, responses.length - 1)];
    next += 1;
    if (!respond) throw new Error('respondInTurn needs at least one response');
    return respond();
  };
}

let key: MapsKey;
beforeAll(async () => {
  key = await generateMapsKey();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Apple Maps requests', () => {
  it("reports Apple's daily quota (429) as rate-limited, with Retry-After, and does not retry", async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': () =>
        json({ message: 'Too Many Requests' }, { status: 429, headers: { 'retry-after': '120' } }),
    });
    const { driving } = connect(apple, key);

    const error = await driving
      .routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      provider: 'apple-maps',
      failure: 'rate-limited',
      status: 429,
      retryAfterSeconds: 120,
    });
    expect(apple.requestsTo('/v1/directions')).toHaveLength(1);
  });

  it('on a 401 fetches a fresh token once and retries with it', async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': respondInTurn(
        () => json({ message: 'Not Authorized' }, { status: 401 }),
        () => json(ROUTE),
      ),
    });
    const { driving } = connect(apple, key);

    const route = await driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal());

    expect(route.durationSeconds).toBe(1_690);
    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
    expect(apple.requestsTo('/v1/directions').map((request) => request.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
  });

  it('gives up as not configured when the fresh token is refused too', async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': () => json({ message: 'Not Authorized' }, { status: 401 }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'not-configured', status: 401 });
    expect(apple.requestsTo('/v1/directions')).toHaveLength(2);
    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
  });

  it('reports a 403 as not configured rather than busy', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => json({}, { status: 403 }) });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'not-configured', status: 403 });
  });

  it('retries a server error once', async () => {
    const apple = fakeAppleMaps({
      '/v1/directions': respondInTurn(
        () => json({ message: 'Internal Server Error' }, { status: 500 }),
        () => json(ROUTE),
      ),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).resolves.toMatchObject({ durationSeconds: 1_690 });
    expect(apple.requestsTo('/v1/directions')).toHaveLength(2);
  });

  it('reports a body in the wrong shape as a malformed response', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': () => json({ etas: [{ distanceMeters: 'a long way' }] }),
      '/v1/directions': () => new Response('<html>maintenance</html>', { status: 200 }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).rejects.toMatchObject({ provider: 'apple-maps', failure: 'malformed-response' });
    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
    ).rejects.toMatchObject({ provider: 'apple-maps', failure: 'malformed-response' });
  });

  it('times out a call Apple never answers after six seconds', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': () => json({ etas: [] }),
      '/v1/directions': () => new Promise<Response>(() => undefined),
    });
    const { driving } = connect(apple, key);
    // Fetch the token first so the only pending work is the hung request.
    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    let outcome: unknown;
    const call = driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()).then(
      () => (outcome = 'resolved'),
      (error: unknown) => (outcome = error),
    );
    await vi.advanceTimersByTimeAsync(5_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await call;

    expect(outcome).toMatchObject({ provider: 'apple-maps', failure: 'timeout' });
  });

  it('stops when the caller aborts', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => new Promise<Response>(() => undefined) });
    const { driving } = connect(apple, key);
    const caller = new AbortController();

    const call = driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, caller.signal);
    await vi.waitFor(() => expect(apple.requestsTo('/v1/directions')).toHaveLength(1));
    caller.abort();

    await expect(call).rejects.toMatchObject({ provider: 'apple-maps', failure: 'timeout' });
  });

  it('does not call Apple at all for a caller that has already given up', async () => {
    const apple = fakeAppleMaps({ '/v1/directions': () => json(ROUTE) });
    const { driving } = connect(apple, key);
    const caller = new AbortController();
    caller.abort();

    await expect(
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, caller.signal),
    ).rejects.toMatchObject({ failure: 'timeout' });
    expect(apple.requests).toHaveLength(0);
  });
});
