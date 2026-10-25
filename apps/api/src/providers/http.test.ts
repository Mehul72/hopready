import { ProviderError } from '@hopready/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { failureForStatus, requestJson, type FetchImplementation } from './http';

const greetingSchema = z.object({ greeting: z.string() });
const parseGreeting = (body: unknown) => greetingSchema.parse(body);

function respondWith(...responses: (Response | Error)[]): FetchImplementation & { calls: number } {
  let index = 0;
  const fetchImpl = vi.fn(async () => {
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as FetchImplementation & { calls: number };
  Object.defineProperty(fetchImpl, 'calls', { get: () => index });
  return fetchImpl;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const baseRequest = {
  provider: 'tfnsw-trip-planner' as const,
  url: 'https://example.test/v1/thing',
  parse: parseGreeting,
};

describe('requestJson', () => {
  it('returns the parsed body on success', async () => {
    const result = await requestJson({
      ...baseRequest,
      signal: new AbortController().signal,
      fetchImpl: respondWith(json({ greeting: 'hi' })),
    });
    expect(result).toEqual({ greeting: 'hi' });
  });

  it('reports a body in the wrong shape as a malformed response', async () => {
    await expect(
      requestJson({
        ...baseRequest,
        signal: new AbortController().signal,
        fetchImpl: respondWith(json({ greeting: 42 })),
      }),
    ).rejects.toMatchObject({ failure: 'malformed-response' });
  });

  it('reports a body that is not JSON as a malformed response', async () => {
    await expect(
      requestJson({
        ...baseRequest,
        signal: new AbortController().signal,
        fetchImpl: respondWith(new Response('<html>oops</html>', { status: 200 })),
      }),
    ).rejects.toMatchObject({ failure: 'malformed-response' });
  });

  it('maps 429 to rate-limited with Retry-After and does not retry it', async () => {
    const fetchImpl = respondWith(
      new Response('', { status: 429, headers: { 'retry-after': '30' } }),
    );
    const error = await requestJson({
      ...baseRequest,
      signal: new AbortController().signal,
      retryOnce: true,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ failure: 'rate-limited', retryAfterSeconds: 30, status: 429 });
    expect(fetchImpl.calls).toBe(1);
  });

  it('retries a server error once when allowed, then succeeds', async () => {
    const fetchImpl = respondWith(
      new Response('', { status: 503 }),
      json({ greeting: 'second time' }),
    );
    const result = await requestJson({
      ...baseRequest,
      signal: new AbortController().signal,
      retryOnce: true,
      fetchImpl,
    });
    expect(result.greeting).toBe('second time');
    expect(fetchImpl.calls).toBe(2);
  });

  it('does not retry unless asked', async () => {
    const fetchImpl = respondWith(new Response('', { status: 503 }), json({ greeting: 'unused' }));
    await expect(
      requestJson({ ...baseRequest, signal: new AbortController().signal, fetchImpl }),
    ).rejects.toMatchObject({ failure: 'unavailable' });
    expect(fetchImpl.calls).toBe(1);
  });

  it('turns an aborted request into a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJson({
        ...baseRequest,
        signal: controller.signal,
        fetchImpl: respondWith(new DOMException('aborted', 'AbortError')),
      }),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('reports a timeout that fires while the body is still arriving as a timeout', async () => {
    const controller = new AbortController();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"greeting": "hel'));
        controller.signal.addEventListener('abort', () => {
          stream.error(new DOMException('aborted', 'AbortError'));
        });
      },
    });
    const pending = requestJson({
      ...baseRequest,
      signal: controller.signal,
      fetchImpl: respondWith(new Response(stalledBody, { status: 200 })),
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ failure: 'timeout', status: 200 });
  });

  it('lets a provider classify its own error responses', async () => {
    await expect(
      requestJson({
        ...baseRequest,
        signal: new AbortController().signal,
        fetchImpl: respondWith(new Response('', { status: 401 })),
        classifyFailure: () => 'rate-limited',
      }),
    ).rejects.toMatchObject({ failure: 'rate-limited' });
  });
});

describe('failureForStatus', () => {
  it.each([
    [401, 'not-configured'],
    [403, 'rate-limited'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'rejected-request'],
    [404, 'rejected-request'],
  ])('maps HTTP %i to %s', (status, failure) => {
    expect(failureForStatus(status)).toBe(failure);
  });
});
