// Test support: a scripted stand-in for maps-api.apple.com, a settable clock and a real P-256 key.
import type { FetchImplementation } from '../http';
import { createAppleMapsProviders, type AppleMapsProviders } from './index';

export const TEAM_ID = 'TEAMID1234';
export const KEY_ID = 'KEYID12345';

export interface AppleRequest {
  host: string;
  path: string;
  // The query exactly as sent, without the leading "?".
  query: string;
  params: URLSearchParams;
  authorization: string | null;
}

export type AppleHandler = (request: AppleRequest) => Response | Promise<Response>;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export function tokenResponse(accessToken: string, expiresInSeconds = 1800): Response {
  return json({ accessToken, expiresInSeconds });
}

export interface FakeAppleMaps {
  fetchImpl: FetchImplementation;
  requests: AppleRequest[];
  requestsTo(path: string): AppleRequest[];
}

// Paths without a handler fail the request. /v1/token issues access-1, access-2 and so on unless
// a test replaces it.
export function fakeAppleMaps(handlers: Record<string, AppleHandler> = {}): FakeAppleMaps {
  const requests: AppleRequest[] = [];
  let tokensIssued = 0;
  const issueToken: AppleHandler = () => tokenResponse(`access-${++tokensIssued}`);

  const fetchImpl: FetchImplementation = (input, init) => {
    const url = new URL(input);
    const request: AppleRequest = {
      host: url.host,
      path: url.pathname,
      query: url.search.slice(1),
      params: url.searchParams,
      authorization: new Headers(init?.headers).get('authorization'),
    };
    requests.push(request);
    const handler =
      url.host === 'maps-api.apple.com'
        ? (handlers[url.pathname] ?? (url.pathname === '/v1/token' ? issueToken : undefined))
        : undefined;
    if (!handler) return Promise.reject(new Error(`No fake for ${url.host}${url.pathname}`));
    return settleUnlessAborted(
      Promise.resolve().then(() => handler(request)),
      init?.signal,
    );
  };

  return {
    fetchImpl,
    requests,
    requestsTo: (path) => requests.filter((request) => request.path === path),
  };
}

// Behaves like fetch: an abort rejects the pending response.
function settleUnlessAborted(
  response: Promise<Response>,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (!signal) return response;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    response.then(resolve, reject);
  });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export interface SettableClock {
  now(): Date;
  advanceSeconds(seconds: number): void;
}

export function settableClock(startIso: string): SettableClock {
  let nowMs = Date.parse(startIso);
  return {
    now: () => new Date(nowMs),
    advanceSeconds: (seconds) => {
      nowMs += seconds * 1000;
    },
  };
}

export interface MapsKey {
  pem: string;
  publicKey: CryptoKey;
}

export async function generateMapsKey(): Promise<MapsKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const lines = pkcs8.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    pem: ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n'),
    publicKey: pair.publicKey,
  };
}

export function connect(
  apple: FakeAppleMaps,
  key: MapsKey,
  clock: SettableClock = settableClock('2026-10-25T08:00:00+11:00'),
): AppleMapsProviders {
  return createAppleMapsProviders({
    teamId: TEAM_ID,
    keyId: KEY_ID,
    privateKey: key.pem,
    fetchImpl: apple.fetchImpl,
    clock,
  });
}

export function openSignal(): AbortSignal {
  return new AbortController().signal;
}
