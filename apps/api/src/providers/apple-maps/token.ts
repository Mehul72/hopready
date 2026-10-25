import { ProviderError, type Clock } from '@hopready/core';

import { requestJson, type FetchImplementation } from '../http';
import { APPLE_MAPS_ORIGIN, classifyAppleFailure, withDeadline, type AccessTokens } from './client';
import { tokenResponseSchema } from './schemas';

export interface AppleMapsCredentials {
  teamId: string;
  keyId: string;
  // Contents of the .p8 file from the Apple Developer account.
  privateKey: string;
}

// The signed JWT is only shown to Apple's token endpoint. An hour leaves room for an access
// token lifetime tied to it while keeping a leaked JWT short-lived.
const SIGNED_TOKEN_LIFETIME_SECONDS = 60 * 60;
const REFRESH_MARGIN_SECONDS = 60;
const TOKEN_REQUEST_TIMEOUT_MS = 5_000;
// Cloudflare Workers may cancel a finished request's I/O and timers, stranding its exchange.
// One still pending after this is abandoned, and the next caller starts afresh.
const STRANDED_EXCHANGE_MS = TOKEN_REQUEST_TIMEOUT_MS + 1_000;

interface Exchange {
  startedAtMs: number;
  accessToken: Promise<string>;
}

export class AppleMapsTokenSource implements AccessTokens {
  readonly #credentials: AppleMapsCredentials;
  readonly #fetchImpl: FetchImplementation | undefined;
  readonly #clock: Clock;
  #signingKey: CryptoKey | undefined;
  #current: { accessToken: string; refreshAtMs: number } | undefined;
  #exchanging: Exchange | undefined;

  constructor(options: {
    credentials: AppleMapsCredentials;
    fetchImpl: FetchImplementation | undefined;
    clock: Clock;
  }) {
    this.#credentials = options.credentials;
    this.#fetchImpl = options.fetchImpl;
    this.#clock = options.clock;
  }

  accessToken(signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(tokenWaitTimedOut(signal));
    const nowMs = this.#clock.now().getTime();
    const current = this.#current;
    if (current && nowMs < current.refreshAtMs) return Promise.resolve(current.accessToken);

    // One exchange serves everyone waiting. It runs on its own deadline rather than any caller's
    // signal, so one request giving up does not fail the others.
    let exchange = this.#exchanging;
    if (!exchange || nowMs - exchange.startedAtMs >= STRANDED_EXCHANGE_MS) {
      exchange = this.#startExchange(nowMs);
    }
    return waitUnlessAborted(exchange.accessToken, signal);
  }

  invalidate(accessToken: string): void {
    if (this.#current?.accessToken === accessToken) this.#current = undefined;
  }

  #startExchange(startedAtMs: number): Exchange {
    const exchange: Exchange = { startedAtMs, accessToken: this.#exchange(startedAtMs) };
    const finish = () => {
      if (this.#exchanging === exchange) this.#exchanging = undefined;
    };
    // Waiters see the outcome through their own handlers; this only clears the slot.
    exchange.accessToken.then(finish, finish);
    this.#exchanging = exchange;
    return exchange;
  }

  async #exchange(startedAtMs: number): Promise<string> {
    const signedJwt = await signMapsJwt(
      this.#credentials,
      await this.#key(),
      Math.floor(startedAtMs / 1000),
    );
    const token = await withDeadline(TOKEN_REQUEST_TIMEOUT_MS, null, (signal) =>
      requestJson({
        provider: 'apple-maps',
        url: `${APPLE_MAPS_ORIGIN}/v1/token`,
        init: { headers: { Authorization: `Bearer ${signedJwt}` } },
        signal,
        parse: (body) => tokenResponseSchema.parse(body),
        retryOnce: true,
        classifyFailure: classifyAppleFailure,
        fetchImpl: this.#fetchImpl,
      }),
    );
    // Counting from before the request keeps the refresh ahead of Apple's real expiry.
    const marginSeconds = Math.min(REFRESH_MARGIN_SECONDS, token.expiresInSeconds / 2);
    this.#current = {
      accessToken: token.accessToken,
      refreshAtMs: startedAtMs + (token.expiresInSeconds - marginSeconds) * 1000,
    };
    return token.accessToken;
  }

  // Only the imported key is kept, never a pending import, so nothing a finished request started
  // is left for later requests to wait on.
  async #key(): Promise<CryptoKey> {
    this.#signingKey ??= await importSigningKey(this.#credentials.privateKey);
    return this.#signingKey;
  }
}

function tokenWaitTimedOut(signal: AbortSignal): ProviderError {
  return new ProviderError('apple-maps', 'timeout', 'Apple Maps did not issue a token in time', {
    cause: signal.reason,
  });
}

function waitUnlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const giveUp = () => reject(tokenWaitTimedOut(signal));
    signal.addEventListener('abort', giveUp, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', giveUp));
  });
}

async function importSigningKey(pem: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8FromPem(pem),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch (error) {
    // The cause never holds key material: atob and importKey report only that decoding failed.
    throw new ProviderError(
      'apple-maps',
      'not-configured',
      'The Apple Maps private key is not the PKCS #8 P-256 key from a .p8 file',
      { cause: error },
    );
  }
}

// Secret stores often hold the .p8 file on one line, with literal "\n" in place of line breaks.
function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function signMapsJwt(
  credentials: AppleMapsCredentials,
  signingKey: CryptoKey,
  issuedAtSeconds: number,
): Promise<string> {
  const header = { alg: 'ES256', kid: credentials.keyId, typ: 'JWT' };
  const payload = {
    iss: credentials.teamId,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + SIGNED_TOKEN_LIFETIME_SECONDS,
    scope: 'server_api',
  };
  const signingInput = `${base64UrlOfJson(header)}.${base64UrlOfJson(payload)}`;
  // WebCrypto returns ECDSA signatures as raw r||s, which is exactly what JWS ES256 expects.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function base64UrlOfJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
