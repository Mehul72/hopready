import { ProviderError, type ProviderFailure, type ProviderName } from '@hopready/core';

import { requestJson, type FetchImplementation } from '../http';
import { RateGateFullError, type RateGate } from './rate-gate';

export const TFNSW_API_ORIGIN = 'https://api.transport.nsw.gov.au';

// TfNSW documents 'Account Over Rate Limit' and 'Account Over Quota Limit' in this header, on a 403 and
// sometimes on a 401, so the header is read before the status code.
const OVER_LIMIT_DETAIL = /over rate limit|over quota/i;
// A key goes into a header, so it must be printable ASCII with no spaces.
const HEADER_SAFE_KEY = /^[\x21-\x7e]+$/;

export function classifyTfnswFailure(response: Response): ProviderFailure | null {
  const errorDetail = response.headers.get('x-error-detail') ?? '';
  if ((response.status === 401 || response.status === 403) && OVER_LIMIT_DETAIL.test(errorDetail)) {
    return 'rate-limited';
  }
  if (response.status === 401) return 'not-configured';
  if (response.status === 429) return 'rate-limited';
  if (response.status === 503) return 'unavailable';
  // Anything else, including a 403 without the header, falls back to the shared status mapping.
  return null;
}

export interface TfnswRequest<T> {
  provider: ProviderName;
  path: string;
  params: Readonly<Record<string, string>>;
  parse: (body: unknown) => T;
  signal: AbortSignal;
}

export interface TfnswClient {
  get<T>(request: TfnswRequest<T>): Promise<T>;
}

export interface TfnswClientOptions {
  apiKey: string;
  gate: RateGate;
  fetchImpl?: FetchImplementation;
}

export function createTfnswClient(options: TfnswClientOptions): TfnswClient {
  if (!HEADER_SAFE_KEY.test(options.apiKey)) {
    // The key itself is never echoed, not even in this message.
    throw new Error('The TfNSW API key is empty or has characters that cannot be sent in a header');
  }
  const headers = { Authorization: `apikey ${options.apiKey}`, Accept: 'application/json' };
  const { gate } = options;
  // Workers reject fetch called as a method of another object, so the default is wrapped, not stored.
  const send: FetchImplementation =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  async function takeSlot(provider: ProviderName, signal: AbortSignal): Promise<void> {
    try {
      await gate.acquire(signal);
    } catch (error) {
      if (error instanceof RateGateFullError) {
        throw new ProviderError(
          provider,
          'rate-limited',
          'HopReady is holding TfNSW requests back to stay under the rate limit',
          { cause: error },
        );
      }
      throw new ProviderError(provider, 'timeout', `${provider} did not answer in time`, {
        cause: error,
      });
    }
  }

  return {
    async get<T>(request: TfnswRequest<T>): Promise<T> {
      const url = new URL(request.path, TFNSW_API_ORIGIN);
      for (const [name, value] of Object.entries(request.params)) {
        url.searchParams.set(name, value);
      }

      // The first attempt takes its slot here so a full queue reads as rate-limited. requestJson's
      // single retry queues for its own slot, so the retry is rate limited too.
      await takeSlot(request.provider, request.signal);
      let attempts = 0;
      const sendThroughGate: FetchImplementation = async (input, init) => {
        attempts += 1;
        if (attempts > 1) await gate.acquire(request.signal);
        return send(input, init);
      };

      try {
        return await requestJson({
          provider: request.provider,
          url: url.toString(),
          init: { method: 'GET', headers },
          signal: request.signal,
          parse: request.parse,
          retryOnce: true,
          classifyFailure: classifyTfnswFailure,
          fetchImpl: sendThroughGate,
        });
      } catch (error) {
        if (
          error instanceof ProviderError &&
          error.failure === 'rate-limited' &&
          error.retryAfterSeconds !== undefined
        ) {
          gate.holdFor(error.retryAfterSeconds * 1_000);
        }
        throw error;
      }
    },
  };
}

// Settled outcomes from mapSettled carry `unknown`; every TfNSW call fails with a ProviderError, and this
// keeps that guarantee visible to the type checker instead of assuming it.
export function asProviderError(reason: unknown, provider: ProviderName): ProviderError {
  if (reason instanceof ProviderError) return reason;
  return new ProviderError(provider, 'unavailable', `${provider} call failed`, { cause: reason });
}
