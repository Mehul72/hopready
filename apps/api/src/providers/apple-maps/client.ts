import {
  coordinateSchema,
  ProviderError,
  type Coordinate,
  type ProviderFailure,
} from '@hopready/core';

import { requestJson, type FetchImplementation } from '../http';
import type { AppleLocation } from './schemas';

export const APPLE_MAPS_ORIGIN = 'https://maps-api.apple.com';

// Covers one logical Apple call: waiting for a token, the request, and its single retry.
const REQUEST_BUDGET_MS = 6_000;

export type AppleMapsPath = '/v1/etas' | '/v1/directions' | '/v1/searchAutocomplete' | '/v1/search';

export interface AccessTokens {
  accessToken(signal: AbortSignal): Promise<string>;
  // Drops a token Apple refused, so the next caller exchanges a fresh one.
  invalidate(accessToken: string): void;
}

export interface AppleMapsClient {
  // `query` is an already encoded query string. The host is always Apple's.
  get<T>(
    path: AppleMapsPath,
    query: string,
    parse: (body: unknown) => T,
    signal: AbortSignal,
  ): Promise<T>;
}

// Apple documents 429 for its daily quota and never a 403, so a 403 means these credentials
// were refused rather than throttled.
export function classifyAppleFailure(response: Response): ProviderFailure | null {
  return response.status === 403 ? 'not-configured' : null;
}

export function encodeQuery(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .flatMap(([name, value]) =>
      value === undefined ? [] : [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`],
    )
    .join('&');
}

// Apple takes coordinates as "latitude,longitude". Six decimals is about 0.1 m.
export function appleCoordinate(coordinate: Coordinate): string {
  const parsed = coordinateSchema.safeParse(coordinate);
  if (!parsed.success) {
    throw new ProviderError('apple-maps', 'rejected-request', 'A coordinate is out of range');
  }
  return `${parsed.data.lat.toFixed(6)},${parsed.data.lon.toFixed(6)}`;
}

export function toCoordinate(location: AppleLocation): Coordinate {
  return { lat: location.latitude, lon: location.longitude };
}

// Runs `work` with a signal that aborts after `budgetMs` or when the caller's signal does,
// and releases the timer and listener however it ends.
export async function withDeadline<T>(
  budgetMs: number,
  callerSignal: AbortSignal | null,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException(`Timed out after ${budgetMs} ms`, 'TimeoutError')),
    budgetMs,
  );
  const forwardAbort = () => deadline.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    return await work(deadline.signal);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function createAppleMapsClient(
  tokens: AccessTokens,
  fetchImpl: FetchImplementation | undefined,
): AppleMapsClient {
  function send<T>(
    url: string,
    accessToken: string,
    parse: (body: unknown) => T,
    signal: AbortSignal,
    retryOnce: boolean,
  ): Promise<T> {
    return requestJson({
      provider: 'apple-maps',
      url,
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
      signal,
      parse,
      retryOnce,
      classifyFailure: classifyAppleFailure,
      fetchImpl,
    });
  }

  return {
    get(path, query, parse, callerSignal) {
      const url = `${APPLE_MAPS_ORIGIN}${path}?${query}`;
      return withDeadline(REQUEST_BUDGET_MS, callerSignal, async (signal) => {
        const accessToken = await tokens.accessToken(signal);
        try {
          return await send(url, accessToken, parse, signal, true);
        } catch (error) {
          if (!(error instanceof ProviderError) || error.status !== 401) throw error;
          // Apple can stop accepting a token before its stated expiry. One fresh token settles
          // that; a second 401 means the credentials themselves are wrong.
          tokens.invalidate(accessToken);
          return await send(url, await tokens.accessToken(signal), parse, signal, false);
        }
      });
    },
  };
}
