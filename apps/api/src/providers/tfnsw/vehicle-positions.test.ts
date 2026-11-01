import { ProviderError, type TrackedService, type VehicleLookup } from '@hopready/core';
import { describe, expect, it, vi } from 'vitest';

import type { FetchImplementation } from '../http';
import { createTfnswClient } from './client';
import type { TfnswDiagnostic } from './diagnostics';
import { RateGate } from './rate-gate';
import { loadRecordedFeed, syntheticVehicleFeed } from './test-support';
import {
  DEFAULT_VEHICLE_FEED_LIMITS,
  TfnswVehicleLocator,
  VEHICLE_FEED_PATHS,
  type TfnswVehicleLocatorOptions,
} from './vehicle-positions';

// The recorded feeds' header time: Sunday 1 November 2026, 14:41:42 AEDT.
const FEED_TIME_MS = 1_793_504_502_000;
const BUS_380: TrackedService = { mode: 'bus', realtimeTripId: '2703224' };
const T1: TrackedService = { mode: 'train', realtimeTripId: '814P.1417.150.2.A.8.91974280' };
const METRO: TrackedService = { mode: 'metro', realtimeTripId: '0273-001-152-008:1000' };

interface Harness {
  locator: TfnswVehicleLocator;
  fetches: string[];
  diagnostics: TfnswDiagnostic[];
  advance: (ms: number) => void;
  respond: (handler: (path: string) => Response | Promise<Response>) => void;
}

function harness(
  options: Partial<TfnswVehicleLocatorOptions> = {},
  gate = new RateGate({ requestsPerSecond: 100 }),
): Harness {
  let nowMs = FEED_TIME_MS + 5_000;
  const fetches: string[] = [];
  const diagnostics: TfnswDiagnostic[] = [];
  let handler: (path: string) => Response | Promise<Response> = (path) =>
    recorded(path.split('/').at(-1)!);
  const fetchImpl: FetchImplementation = async (input) => {
    const path = new URL(input).pathname;
    fetches.push(path);
    return handler(path);
  };
  const locator = new TfnswVehicleLocator({
    client: createTfnswClient({
      apiKey: 'test-key-0123456789abcdef',
      gate,
      fetchImpl,
    }),
    clock: { now: () => new Date(nowMs) },
    report: (diagnostic) => diagnostics.push(diagnostic),
    ...options,
  });
  return {
    locator,
    fetches,
    diagnostics,
    advance: (ms) => {
      nowMs += ms;
    },
    respond: (next) => {
      handler = next;
    },
  };
}

function recorded(feedName: string): Response {
  return new Response(loadRecordedFeed(`vehiclepos-${feedName}.pb`));
}

const statusesOf = (lookups: VehicleLookup[]) => lookups.map((lookup) => lookup.status);

describe('TfnswVehicleLocator', () => {
  it('locates services from the feed for their mode, in the order asked', async () => {
    const { locator, fetches } = harness();

    const lookups = await locator.locate([T1, BUS_380], new AbortController().signal);

    expect(lookups).toEqual([
      expect.objectContaining({ ...T1, status: 'located', bearingDegrees: null }),
      expect.objectContaining({
        ...BUS_380,
        status: 'located',
        bearingDegrees: 78,
        servingTrip: 'this-trip',
      }),
    ]);
    expect([...fetches].sort()).toEqual([VEHICLE_FEED_PATHS.bus, VEHICLE_FEED_PATHS.train].sort());
  });

  it('gives each position the time the vehicle reported it', async () => {
    const { locator } = harness();
    const [bus] = await locator.locate([BUS_380], new AbortController().signal);
    expect(bus?.status === 'located' && Date.parse(bus.observedAt)).toBeLessThan(FEED_TIME_MS);
  });

  it('says which modes have no feed without fetching anything for them', async () => {
    const { locator, fetches } = harness();
    const lookups = await locator.locate(
      [
        { mode: 'ferry', realtimeTripId: 'F1' },
        { mode: 'light-rail', realtimeTripId: 'L2' },
      ],
      new AbortController().signal,
    );
    expect(statusesOf(lookups)).toEqual(['not-tracked', 'not-tracked']);
    expect(fetches).toEqual([]);
  });

  it('finds no vehicle for a trip the feed does not have', async () => {
    const { locator } = harness();
    const [lookup] = await locator.locate(
      [{ mode: 'bus', realtimeTripId: 'not-in-the-feed' }],
      new AbortController().signal,
    );
    expect(lookup?.status).toBe('not-located');
  });

  it('fetches each feed once however many lookups arrive together', async () => {
    const { locator, fetches } = harness();
    await Promise.all(
      Array.from({ length: 10 }, () => locator.locate([BUS_380], new AbortController().signal)),
    );
    expect(fetches).toEqual([VEHICLE_FEED_PATHS.bus]);
  });

  it('answers from its copy for 15 seconds, then fetches a new one', async () => {
    const { locator, fetches, advance } = harness();
    const signal = new AbortController().signal;
    await locator.locate([METRO], signal);
    advance(DEFAULT_VEHICLE_FEED_LIMITS.freshForMs - 1);
    await locator.locate([METRO], signal);
    expect(fetches).toHaveLength(1);

    advance(1);
    await locator.locate([METRO], signal);
    expect(fetches).toHaveLength(2);
  });

  it('answers from its last copy while a refresh fails, then says unavailable', async () => {
    const { locator, fetches, advance, respond, diagnostics } = harness();
    const signal = new AbortController().signal;
    await locator.locate([BUS_380], signal);
    respond(() => new Response(null, { status: 503 }));

    advance(DEFAULT_VEHICLE_FEED_LIMITS.freshForMs);
    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['located']);
    expect(diagnostics).toContainEqual({
      kind: 'vehicle-feed-unavailable',
      feed: 'bus',
      reason: 'unavailable',
    });

    advance(DEFAULT_VEHICLE_FEED_LIMITS.usableForMs);
    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['unavailable']);
    // The first fetch, then one try per refresh: the next refresh is the retry.
    expect(fetches).toHaveLength(3);
  });

  it('leaves a failed feed alone for 15 seconds instead of trying on every lookup', async () => {
    const { locator, fetches, advance, respond } = harness();
    const signal = new AbortController().signal;
    respond(() => new Response(null, { status: 503 }));

    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['unavailable']);
    const afterFirstTry = fetches.length;
    advance(DEFAULT_VEHICLE_FEED_LIMITS.waitAfterFailureMs - 1);
    await locator.locate([BUS_380], signal);
    expect(fetches).toHaveLength(afterFirstTry);

    advance(1);
    await locator.locate([BUS_380], signal);
    expect(fetches.length).toBeGreaterThan(afterFirstTry);
  });

  it('waits as long as TfNSW asks after a rate limit, up to a minute', async () => {
    // The gate's own hold uses real time; with it out of the way, only the locator's wait counts.
    const gate = new RateGate({ requestsPerSecond: 100 });
    vi.spyOn(gate, 'holdFor').mockImplementation(() => undefined);
    const signal = new AbortController().signal;
    for (const [retryAfterSeconds, expectedWaitMs] of [
      [30, 30_000],
      [600, DEFAULT_VEHICLE_FEED_LIMITS.maxWaitAfterFailureMs],
    ] as const) {
      const { locator, fetches, advance, respond } = harness({}, gate);
      respond(
        () =>
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': String(retryAfterSeconds) },
          }),
      );
      await locator.locate([BUS_380], signal);
      advance(expectedWaitMs - 1);
      await locator.locate([BUS_380], signal);
      expect(fetches).toHaveLength(1);
      advance(1);
      await locator.locate([BUS_380], signal);
      expect(fetches).toHaveLength(2);
    }
  });

  it('stops waiting on a fetch another request started once it is overdue, and replaces it', async () => {
    // On Workers a fetch dies with the request that started it; a hung budget check stands in here.
    let calls = 0;
    const { locator, fetches, advance } = harness({
      beforeFetch: () => {
        calls += 1;
        return calls === 1 ? new Promise<void>(() => undefined) : Promise.resolve();
      },
      limits: { sharedFetchLimitMs: 30 },
    });
    const signal = new AbortController().signal;

    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['unavailable']);
    expect(fetches).toEqual([]);

    advance(31);
    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['located']);
    expect(calls).toBe(2);
    expect(fetches).toEqual([VEHICLE_FEED_PATHS.bus]);
  });

  it('lets a lookup join a fetch still within its time rather than start another', async () => {
    let release = () => undefined as void;
    const { locator, fetches, advance } = harness({
      beforeFetch: () => new Promise<void>((resolve) => (release = resolve)),
      limits: { sharedFetchLimitMs: 5_000 },
    });
    const signal = new AbortController().signal;
    const first = locator.locate([BUS_380], signal);
    advance(1_000);
    const second = locator.locate([BUS_380], signal);
    release();
    expect(statusesOf(await first)).toEqual(['located']);
    expect(statusesOf(await second)).toEqual(['located']);
    expect(fetches).toEqual([VEHICLE_FEED_PATHS.bus]);
  });

  it('refuses a feed larger than the cap', async () => {
    const { locator } = harness({ limits: { maxFeedBytes: 100 } });
    const [lookup] = await locator.locate([METRO], new AbortController().signal);
    expect(lookup?.status).toBe('unavailable');
  });

  it('gives up on a fetch that takes longer than its timeout', async () => {
    const { locator, respond, diagnostics } = harness({ limits: { timeoutMs: 20 } });
    respond(() => new Promise<Response>(() => undefined));

    const [lookup] = await locator.locate([BUS_380], new AbortController().signal);
    expect(lookup?.status).toBe('unavailable');
    expect(diagnostics).toContainEqual({
      kind: 'vehicle-feed-unavailable',
      feed: 'bus',
      reason: 'timeout',
    });
  });

  it('asks before each fetch, and answers unavailable when refused', async () => {
    let refuse = false;
    let asked = 0;
    const { locator, fetches, advance } = harness({
      beforeFetch: async () => {
        asked += 1;
        if (refuse) throw new ProviderError('tfnsw-realtime', 'rate-limited', 'budget used up');
      },
    });
    const signal = new AbortController().signal;
    await locator.locate([BUS_380], signal);
    expect(asked).toBe(1);

    // A copy already held answers without asking, so a spent budget costs nothing.
    refuse = true;
    await locator.locate([BUS_380], signal);
    expect(asked).toBe(1);

    advance(DEFAULT_VEHICLE_FEED_LIMITS.usableForMs);
    expect(statusesOf(await locator.locate([BUS_380], signal))).toEqual(['unavailable']);
    expect(asked).toBe(2);
    expect(fetches).toHaveLength(1);
  });

  it('treats a report older than 30 minutes as no vehicle', async () => {
    const { locator, respond } = harness();
    respond(
      () =>
        new Response(
          syntheticVehicleFeed(
            [
              {
                tripId: 'old',
                lat: -33.87,
                lon: 151.21,
                timestampSeconds: FEED_TIME_MS / 1_000 - 1_801,
              },
              {
                tripId: 'recent',
                lat: -33.87,
                lon: 151.21,
                timestampSeconds: FEED_TIME_MS / 1_000,
              },
            ],
            { headerTimestampSeconds: FEED_TIME_MS / 1_000 },
          ),
        ),
    );
    const lookups = await locator.locate(
      [
        { mode: 'bus', realtimeTripId: 'old' },
        { mode: 'bus', realtimeTripId: 'recent' },
      ],
      new AbortController().signal,
    );
    expect(statusesOf(lookups)).toEqual(['not-located', 'located']);
  });

  it('never dates a position after the moment it answers', async () => {
    const { locator, respond } = harness();
    respond(
      () =>
        new Response(
          syntheticVehicleFeed([
            {
              tripId: 'ahead',
              lat: -33.87,
              lon: 151.21,
              timestampSeconds: FEED_TIME_MS / 1_000 + 600,
            },
          ]),
        ),
    );
    const [lookup] = await locator.locate(
      [{ mode: 'bus', realtimeTripId: 'ahead' }],
      new AbortController().signal,
    );
    expect(lookup?.status === 'located' && Date.parse(lookup.observedAt)).toBe(
      FEED_TIME_MS + 5_000,
    );
  });

  it('says it is following a vehicle still on its previous trip', async () => {
    const { locator, respond } = harness();
    respond(
      () =>
        new Response(
          syntheticVehicleFeed([
            {
              tripId: 'next',
              lat: -33.87,
              lon: 151.21,
              timestampSeconds: FEED_TIME_MS / 1_000,
              onPreviousTrip: true,
            },
          ]),
        ),
    );
    const [lookup] = await locator.locate(
      [{ mode: 'bus', realtimeTripId: 'next' }],
      new AbortController().signal,
    );
    expect(lookup).toMatchObject({ status: 'located', servingTrip: 'previous-trip' });
  });

  it('reports vehicles the feed held without a trip or position, never their trip ids', async () => {
    const { locator, respond, diagnostics } = harness();
    respond(
      () =>
        new Response(
          syntheticVehicleFeed([
            { lat: -33.87, lon: 151.21, timestampSeconds: FEED_TIME_MS / 1_000 },
            { tripId: 'kept', lat: -33.87, lon: 151.21, timestampSeconds: FEED_TIME_MS / 1_000 },
          ]),
        ),
    );
    await locator.locate([{ mode: 'bus', realtimeTripId: 'kept' }], new AbortController().signal);
    expect(diagnostics).toEqual([{ kind: 'vehicles-dropped', reason: 'incomplete', count: 1 }]);
  });
});
