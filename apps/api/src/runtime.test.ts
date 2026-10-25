import { ProviderError } from '@hopready/core';
import { describe, expect, it, vi } from 'vitest';

import type { BudgetLedger } from './budget';
import type { DemoProviders, ProviderFactories } from './composition';
import { loadConfig } from './config';
import { SlidingWindowRateLimiter } from './rate-limit';
import type { FetchImplementation } from './providers/http';
import { createRuntime } from './runtime';
import {
  capturingLogger,
  facility,
  fakeCarParks,
  fakeDriving,
  fakePlaces,
  fakeTransit,
  parramattaToWynyard,
  planRequest,
  postJson,
  suggestion,
  testClock,
} from './test-support/fakes';

const ALL_KEYS = {
  TFNSW_API_KEY: 'tfnsw-key-value',
  APPLE_MAPS_TEAM_ID: 'TEAM123456',
  APPLE_MAPS_KEY_ID: 'KEY1234567',
  APPLE_MAPS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

function demoProviders(): DemoProviders {
  return {
    transit: { ...fakeTransit(), name: 'demo-fixture' },
    driving: {
      ...fakeDriving(async () => Promise.reject(new Error('unused'))),
      name: 'demo-fixture',
    },
    carParks: {
      ...fakeCarParks({ facilities: [], occupancy: async () => new Map() }),
      name: 'demo-fixture',
    },
    places: fakePlaces('demo-fixture', async () => [
      suggestion('Wynyard Station', -33.8659, 151.2058, 'stop'),
    ]),
  };
}

// Fake adapters that send one request per transit call through the fetch the runtime hands them,
// the way the real adapters do, so budget counting can be checked without a network.
function factories() {
  let tfnswFetch: FetchImplementation | undefined;
  const transit = fakeTransit(async () => {
    await tfnswFetch?.('https://api.transport.nsw.gov.au/v1/tp/trip');
    return [parramattaToWynyard()];
  });
  const stops = fakePlaces('tfnsw-trip-planner', async () => []);
  const carParks = fakeCarParks({
    facilities: [facility('26', 'Tallawong P1', -33.6913, 150.9061)],
    occupancy: async () => new Map(),
  });
  const driving = fakeDriving(async (from, to) => ({
    durationSeconds: 600,
    distanceMetres: 5_000,
    trafficAware: true,
    path: [from, to],
  }));
  const places = fakePlaces('apple-maps', async () => []);
  const spies = {
    createTfnswProviders: vi.fn<ProviderFactories['createTfnswProviders']>((options) => {
      tfnswFetch = options.fetchImpl;
      return { transit, stops, carParks };
    }),
    createAppleMapsProviders: vi.fn<ProviderFactories['createAppleMapsProviders']>(() => ({
      driving,
      places,
    })),
    createDemoProviders: vi.fn<ProviderFactories['createDemoProviders']>(demoProviders),
  } satisfies ProviderFactories;
  return { spies, transit, stops, carParks, driving, places };
}

function runtimeFor(env: Record<string, unknown>, options: { ledger?: BudgetLedger } = {}) {
  const clock = testClock();
  const logs = capturingLogger();
  const built = factories();
  const network = vi.fn<FetchImplementation>(async () => Response.json({}));
  const runtime = createRuntime({
    config: loadConfig(env),
    factories: built.spies,
    clock,
    logger: logs.logger,
    rateLimiter: new SlidingWindowRateLimiter({ clock }),
    budgetLedger: options.ledger ?? null,
    fetchImpl: network,
  });
  return { runtime, logs, network, ...built };
}

describe('live mode', () => {
  it('never serves fixtures when provider keys are missing', async () => {
    const { runtime, spies, logs } = runtimeFor({ HOPREADY_MODE: 'live' });
    const { app } = runtime;

    expect(spies.createDemoProviders).not.toHaveBeenCalled();
    expect(spies.createTfnswProviders).not.toHaveBeenCalled();
    expect(spies.createAppleMapsProviders).not.toHaveBeenCalled();

    const health = (await (await app.request('/v1/health')).json()) as {
      mode: string;
      providers: Record<string, string>;
    };
    expect(health.mode).toBe('live');
    expect(health.providers).toEqual({
      transit: 'missing',
      driving: 'missing',
      carParks: 'missing',
      places: 'missing',
    });

    for (const response of [
      await postJson(app, '/v1/plan', planRequest()),
      await postJson(app, '/v1/places/search', { query: 'Wynyard' }),
      await app.request('/v1/carparks'),
    ]) {
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('not-configured');
    }
    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        settings: [
          'TFNSW_API_KEY',
          'APPLE_MAPS_TEAM_ID',
          'APPLE_MAPS_KEY_ID',
          'APPLE_MAPS_PRIVATE_KEY',
        ],
      }),
    );
  });

  it('builds the live providers from their keys, stops before places', async () => {
    const { runtime, spies, transit } = runtimeFor(ALL_KEYS);

    expect(spies.createTfnswProviders).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'tfnsw-key-value' }),
    );
    expect(spies.createAppleMapsProviders).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'TEAM123456', keyId: 'KEY1234567' }),
    );
    expect(runtime.providers.places.map((provider) => provider.name)).toEqual([
      'tfnsw-trip-planner',
      'apple-maps',
    ]);

    const response = await postJson(runtime.app, '/v1/plan', planRequest());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mode: string }).mode).toBe('live');
    expect(transit.queries).toHaveLength(1);
  });

  it('counts provider requests against the account budget and stops at the limit', async () => {
    const { runtime, transit, network } = runtimeFor({
      ...ALL_KEYS,
      TFNSW_DAILY_CALL_BUDGET: '1',
    });

    expect((await postJson(runtime.app, '/v1/plan', planRequest())).status).toBe(200);
    const refused = await postJson(runtime.app, '/v1/plan', planRequest());

    expect(refused.status).toBe(503);
    expect(Number(refused.headers.get('retry-after'))).toBe(12_600);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'provider-busy',
    );
    expect(transit.queries).toHaveLength(1);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith('https://api.transport.nsw.gov.au/v1/tp/trip', undefined);
  });

  it('reports used calls to the shared ledger when flushed', async () => {
    const ledger: BudgetLedger = {
      add: vi.fn<BudgetLedger['add']>(async (_budget, _day, calls) => calls),
    };
    const { runtime } = runtimeFor(ALL_KEYS, { ledger });

    await postJson(runtime.app, '/v1/plan', planRequest());
    await runtime.flushBudgets();

    expect(ledger.add).toHaveBeenCalledWith('tfnsw', '2026-10-26', 1);
  });

  it('keeps the other providers when one adapter cannot be created', async () => {
    const { runtime, spies, logs } = runtimeFor(ALL_KEYS);
    spies.createAppleMapsProviders.mockImplementationOnce(() => {
      throw new ProviderError('apple-maps', 'not-configured', 'malformed key id');
    });
    const rebuilt = createRuntime({
      config: loadConfig(ALL_KEYS),
      factories: spies,
      clock: testClock(),
      logger: logs.logger,
      rateLimiter: new SlidingWindowRateLimiter({ clock: testClock() }),
      budgetLedger: null,
    });

    expect(runtime.providers.driving).not.toBeNull();
    expect(rebuilt.providers.driving).toBeNull();
    expect(rebuilt.providers.transit).not.toBeNull();
    expect(rebuilt.providers.places.map((provider) => provider.name)).toEqual([
      'tfnsw-trip-planner',
    ]);
    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        level: 'error',
        providerAccount: 'apple-maps',
        failure: 'not-configured',
      }),
    );
  });
});

describe('TfNSW diagnostics', () => {
  it('reach the logs as structured fields, with expected omissions at info level', () => {
    const { spies, logs } = runtimeFor(ALL_KEYS);
    const options = spies.createTfnswProviders.mock.calls[0]?.[0];

    options?.onDiagnostic?.({ kind: 'journeys-dropped', reason: 'unreadable', count: 2 });
    options?.onDiagnostic?.({
      kind: 'journeys-dropped',
      reason: 'unsupported-mode',
      count: 1,
      productClasses: [104],
    });
    options?.onDiagnostic?.({
      kind: 'occupancy-left-out',
      reason: 'request-failed',
      facilityIds: ['26', '27'],
    });

    const diagnostics = logs.entries.filter((entry) => entry.message === 'tfnsw data left out');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        level: 'warn',
        providerAccount: 'tfnsw',
        diagnostic: 'journeys-dropped',
        reason: 'unreadable',
        count: 2,
      }),
      expect.objectContaining({ level: 'info', reason: 'unsupported-mode', codes: [104] }),
      expect.objectContaining({ level: 'warn', facilityIds: ['26', '27'] }),
    ]);
  });
});

describe('demo mode', () => {
  it('serves the fixture providers and labels every plan as demo', async () => {
    const { runtime, spies } = runtimeFor({ ...ALL_KEYS, HOPREADY_MODE: 'demo' });

    expect(spies.createDemoProviders).toHaveBeenCalledTimes(1);
    expect(spies.createTfnswProviders).not.toHaveBeenCalled();
    expect(spies.createAppleMapsProviders).not.toHaveBeenCalled();

    const health = (await (await runtime.app.request('/v1/health')).json()) as { mode: string };
    expect(health.mode).toBe('demo');

    const plan = await postJson(runtime.app, '/v1/plan', planRequest());
    expect(plan.status).toBe(200);
    expect(((await plan.json()) as { mode: string }).mode).toBe('demo');

    const places = await postJson(runtime.app, '/v1/places/search', { query: 'Wynyard' });
    expect(((await places.json()) as { mode: string }).mode).toBe('demo');
  });
});
