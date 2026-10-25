import { ProviderError } from '@hopready/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  connect,
  deferred,
  fakeAppleMaps,
  generateMapsKey,
  json,
  KEY_ID,
  openSignal,
  settableClock,
  TEAM_ID,
  tokenResponse,
  type MapsKey,
} from './fake-apple-maps';
import { createAppleMapsProviders } from './index';

const CENTRAL = { lat: -33.8832, lon: 151.207 };
const PARRAMATTA = { lat: -33.815, lon: 151.0011 };
const DEPART = { type: 'depart', at: '2026-10-25T08:30:00+11:00' } as const;

const oneEta = () =>
  json({
    etas: [
      {
        destination: { latitude: PARRAMATTA.lat, longitude: PARRAMATTA.lon },
        distanceMeters: 23_140,
        expectedTravelTimeSeconds: 1_690,
        staticTravelTimeSeconds: 1_380,
      },
    ],
  });

function decodeJwt(jwt: string) {
  const [header = '', payload = '', signature = ''] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as unknown,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown,
    signature: Buffer.from(signature, 'base64url'),
    signingInput: `${header}.${payload}`,
  };
}

function signedJwtFrom(authorization: string | null | undefined): string {
  expect(authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  return (authorization ?? '').slice('Bearer '.length);
}

let key: MapsKey;
beforeAll(async () => {
  key = await generateMapsKey();
});

describe('Apple Maps token', () => {
  it('signs an ES256 JWT for the Maps Server API and exchanges it for an access token', async () => {
    const apple = fakeAppleMaps({ '/v1/etas': oneEta });
    const clock = settableClock('2026-10-25T08:00:00+11:00');
    const { driving } = connect(apple, key, clock);

    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());

    const [tokenRequest] = apple.requestsTo('/v1/token');
    const jwt = decodeJwt(signedJwtFrom(tokenRequest?.authorization));
    const issuedAt = Math.floor(clock.now().getTime() / 1000);
    expect(jwt.header).toEqual({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
    expect(jwt.payload).toEqual({
      iss: TEAM_ID,
      iat: issuedAt,
      exp: issuedAt + 3600,
      scope: 'server_api',
    });
    // JWS ES256 signatures are the raw 32-byte r and s values, not DER.
    expect(jwt.signature).toHaveLength(64);
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.publicKey,
      jwt.signature,
      new TextEncoder().encode(jwt.signingInput),
    );
    expect(verified).toBe(true);
    expect(apple.requestsTo('/v1/etas')[0]?.authorization).toBe('Bearer access-1');
  });

  it('accepts a .p8 key stored on one line with literal \\n sequences', async () => {
    const apple = fakeAppleMaps({ '/v1/etas': oneEta });
    const { driving } = createAppleMapsProviders({
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: key.pem.replace(/\n/g, '\\n'),
      fetchImpl: apple.fetchImpl,
    });

    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());

    const jwt = decodeJwt(signedJwtFrom(apple.requestsTo('/v1/token')[0]?.authorization));
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.publicKey,
      jwt.signature,
      new TextEncoder().encode(jwt.signingInput),
    );
    expect(verified).toBe(true);
  });

  it('reports an unreadable private key as not configured without repeating it', async () => {
    const apple = fakeAppleMaps({ '/v1/etas': oneEta });
    const { driving } = createAppleMapsProviders({
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: '-----BEGIN PRIVATE KEY-----\nSECRETbutNOTaKEY\n-----END PRIVATE KEY-----',
      fetchImpl: apple.fetchImpl,
    });

    const error = await driving
      .estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ provider: 'apple-maps', failure: 'not-configured' });
    expect(String((error as ProviderError).message)).not.toContain('SECRET');
    expect(String((error as ProviderError).cause)).not.toContain('SECRET');
    expect(apple.requests).toHaveLength(0);
  });

  it('rejects malformed credentials up front, naming the fields but not their values', () => {
    const thrown = (attempt: () => unknown): unknown => {
      try {
        attempt();
      } catch (caught) {
        return caught;
      }
      return undefined;
    };

    const badIds = thrown(() =>
      createAppleMapsProviders({ teamId: 'team-oops', keyId: 'KEY', privateKey: key.pem }),
    );
    expect(badIds).toBeInstanceOf(ProviderError);
    expect(badIds).toMatchObject({ provider: 'apple-maps', failure: 'not-configured' });
    expect((badIds as ProviderError).message).toContain('teamId, keyId');
    expect((badIds as ProviderError).message).not.toContain('team-oops');

    const blankKey = thrown(() =>
      createAppleMapsProviders({ teamId: TEAM_ID, keyId: KEY_ID, privateKey: '   ' }),
    );
    expect(blankKey).toMatchObject({ failure: 'not-configured' });
    expect((blankKey as ProviderError).message).toContain('privateKey');
  });

  it('reuses the access token until 60 seconds before Apple says it expires', async () => {
    const apple = fakeAppleMaps({ '/v1/etas': oneEta });
    const clock = settableClock('2026-10-25T08:00:00+11:00');
    const { driving } = connect(apple, key, clock);
    const estimate = () => driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());

    await estimate();
    await estimate();
    clock.advanceSeconds(1_739);
    await estimate();
    expect(apple.requestsTo('/v1/token')).toHaveLength(1);

    clock.advanceSeconds(1);
    await estimate();
    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
    expect(apple.requestsTo('/v1/etas').map((request) => request.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-1',
      'Bearer access-1',
      'Bearer access-2',
    ]);
  });

  it('refreshes a short-lived token halfway through its life', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/token': () => tokenResponse('short-lived', 90),
    });
    const clock = settableClock('2026-10-25T08:00:00+11:00');
    const { driving } = connect(apple, key, clock);

    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());
    clock.advanceSeconds(44);
    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());
    expect(apple.requestsTo('/v1/token')).toHaveLength(1);

    clock.advanceSeconds(1);
    await driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());
    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
  });

  it('shares one token exchange between concurrent calls', async () => {
    const pendingToken = deferred<Response>();
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/directions': () =>
        json({ routes: [{ durationSeconds: 1_690, distanceMeters: 23_140 }] }),
      '/v1/token': () => pendingToken.promise,
    });
    const { driving } = connect(apple, key);

    const calls = Promise.all([
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
      driving.routeDrive(CENTRAL, PARRAMATTA, DEPART, openSignal()),
      driving.estimateDrives(PARRAMATTA, [CENTRAL], DEPART, openSignal()),
    ]);
    await vi.waitFor(() => expect(apple.requestsTo('/v1/token')).toHaveLength(1));
    pendingToken.resolve(tokenResponse('shared-token'));
    await calls;

    expect(apple.requestsTo('/v1/token')).toHaveLength(1);
    const dataRequests = apple.requests.filter((request) => request.path !== '/v1/token');
    expect(dataRequests.map((request) => request.authorization)).toEqual([
      'Bearer shared-token',
      'Bearer shared-token',
      'Bearer shared-token',
    ]);
  });

  it('keeps a shared token exchange going when one waiting caller gives up', async () => {
    const pendingToken = deferred<Response>();
    const apple = fakeAppleMaps({ '/v1/etas': oneEta, '/v1/token': () => pendingToken.promise });
    const { driving } = connect(apple, key);
    const impatient = new AbortController();

    const abandoned = driving
      .estimateDrives(CENTRAL, [PARRAMATTA], DEPART, impatient.signal)
      .catch((caught: unknown) => caught);
    const patient = driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());
    await vi.waitFor(() => expect(apple.requestsTo('/v1/token')).toHaveLength(1));
    impatient.abort();

    expect(await abandoned).toMatchObject({ provider: 'apple-maps', failure: 'timeout' });
    pendingToken.resolve(tokenResponse('access-for-patient'));
    expect(await patient).toEqual([
      { durationSeconds: 1_690, distanceMetres: 23_140, trafficAware: true },
    ]);
    expect(apple.requestsTo('/v1/token')).toHaveLength(1);
    expect(apple.requestsTo('/v1/etas')).toHaveLength(1);
  });

  it('starts a new exchange when the shared one has been pending past its deadline', async () => {
    const strandedToken = deferred<Response>();
    let tokenCalls = 0;
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/token': () =>
        ++tokenCalls === 1 ? strandedToken.promise : tokenResponse('replacement'),
    });
    const clock = settableClock('2026-10-25T08:00:00+11:00');
    const { driving } = connect(apple, key, clock);
    const estimate = () => driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal());

    const first = estimate();
    await vi.waitFor(() => expect(apple.requestsTo('/v1/token')).toHaveLength(1));
    clock.advanceSeconds(5);
    const joined = estimate();
    clock.advanceSeconds(1);
    await estimate();

    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
    expect(apple.requestsTo('/v1/etas').map((request) => request.authorization)).toEqual([
      'Bearer replacement',
    ]);
    strandedToken.resolve(tokenResponse('late'));
    await Promise.all([first, joined]);
    expect(apple.requestsTo('/v1/etas').map((request) => request.authorization)).toEqual([
      'Bearer replacement',
      'Bearer late',
      'Bearer late',
    ]);
  });

  it('tries a new exchange after a failed one instead of remembering the failure', async () => {
    let tokenCalls = 0;
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/token': () =>
        ++tokenCalls === 1
          ? json({ message: 'Too many requests' }, { status: 429 })
          : tokenResponse('second'),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'rate-limited', status: 429 });
    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).resolves.toHaveLength(1);
    expect(apple.requestsTo('/v1/token')).toHaveLength(2);
    expect(apple.requestsTo('/v1/etas')).toHaveLength(1);
  });

  it('reports a JWT that Apple refuses as not configured, without retrying', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/token': () => json({ message: 'Unauthorized' }, { status: 401 }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).rejects.toMatchObject({ provider: 'apple-maps', failure: 'not-configured', status: 401 });
    expect(apple.requestsTo('/v1/token')).toHaveLength(1);
    expect(apple.requestsTo('/v1/etas')).toHaveLength(0);
  });

  it('reports a token response in the wrong shape as malformed', async () => {
    const apple = fakeAppleMaps({
      '/v1/etas': oneEta,
      '/v1/token': () => json({ accessToken: '', expiresInSeconds: 1800 }),
    });
    const { driving } = connect(apple, key);

    await expect(
      driving.estimateDrives(CENTRAL, [PARRAMATTA], DEPART, openSignal()),
    ).rejects.toMatchObject({ failure: 'malformed-response' });
  });
});
