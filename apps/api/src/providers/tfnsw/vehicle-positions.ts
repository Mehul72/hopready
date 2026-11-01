import {
  isTrackedVehicleMode,
  toIso,
  type ProviderError,
  type Clock,
  type TrackedService,
  type TransitMode,
  type VehicleLocator,
  type VehicleLookup,
} from '@hopready/core';

import { callProvider, runWithDeadline, type LateOutcomeHandler } from '../../deadline';
import { asProviderError, type TfnswClient } from './client';
import type { DiagnosticSink } from './diagnostics';
import { decodeVehiclePositions, type VehicleFeed } from './gtfs-realtime';

const PROVIDER = 'tfnsw-realtime';

// One feed per tracked mode covers Sydney, per TfNSW's table of agencies and their feeds
// (2026-09-12). Sydney Trains and Metro moved to v2 in 2025 and 2024; buses are still on v1.
export const VEHICLE_FEED_PATHS = {
  bus: '/v1/gtfs/vehiclepos/buses',
  train: '/v2/gtfs/vehiclepos/sydneytrains',
  metro: '/v2/gtfs/vehiclepos/metro',
} as const satisfies Partial<Record<TransitMode, string>>;
type FeedMode = keyof typeof VEHICLE_FEED_PATHS;

export interface VehicleFeedLimits {
  // TfNSW refreshes these feeds about every 15 s (Open Data FAQ), so a newer copy rarely exists.
  freshForMs: number;
  // After a failed refresh the last copy still answers while it is this young. Every position in it
  // carries its own report time, so the app can say how old it is.
  usableForMs: number;
  // A feed is left alone this long after a failed refresh, or as long as TfNSW asks, up to the cap.
  waitAfterFailureMs: number;
  maxWaitAfterFailureMs: number;
  // The feeds answered in 0.15 s on 2026-11-01; a fetch this slow is a stuck connection.
  timeoutMs: number;
  // The longest a lookup waits on a fetch another request started, and the age past which that
  // fetch is taken as lost. On Workers a fetch and its timers end with the request that started
  // them, so a traveller who closes the map mid-fetch would otherwise leave it pending for good.
  sharedFetchLimitMs: number;
  // The Sunday afternoon bus feed was 242 KB; this leaves room for a weekday peak many times larger.
  maxFeedBytes: number;
  // An older report says where a vehicle was, not where it is. Non-timetabled trains sit in the
  // Sydney Trains feed for days.
  maxReportAgeMs: number;
}

export const DEFAULT_VEHICLE_FEED_LIMITS: VehicleFeedLimits = {
  freshForMs: 15_000,
  usableForMs: 120_000,
  waitAfterFailureMs: 15_000,
  maxWaitAfterFailureMs: 60_000,
  timeoutMs: 5_000,
  sharedFetchLimitMs: 6_000,
  maxFeedBytes: 4 * 1024 * 1024,
  maxReportAgeMs: 30 * 60_000,
};

export interface TfnswVehicleLocatorOptions {
  client: TfnswClient;
  clock: Clock;
  report: DiagnosticSink;
  // Refuses a fetch by throwing a ProviderError, for the daily call budgets. Answers from a copy
  // already held need no fetch, so they go ahead whatever the budgets say.
  beforeFetch?: () => Promise<void>;
  onLateOutcome?: LateOutcomeHandler;
  limits?: Partial<VehicleFeedLimits>;
}

interface FeedCopy {
  feed: VehicleFeed;
  fetchedAtMs: number;
}

interface FeedFetch {
  promise: Promise<FeedCopy>;
  startedAtMs: number;
}

interface FeedState {
  copy: FeedCopy | null;
  inFlight: FeedFetch | null;
  // No fetch before this time, after a failure.
  notBeforeMs: number;
}

function isFeedMode(mode: TransitMode): mode is FeedMode {
  return isTrackedVehicleMode(mode) && mode in VEHICLE_FEED_PATHS;
}

// Where TfNSW's live feeds put the vehicles running given services. One decoded copy of each feed
// per isolate, fetched only when asked for and at most once per freshForMs however many travellers
// ask, one fetch at a time. A trip's services are looked up by the trip id the Trip Planner gave,
// which TfNSW's feeds use as their trip id (checked against real plans for buses and Sydney Trains,
// 2026-11-01).
export class TfnswVehicleLocator implements VehicleLocator {
  readonly name = PROVIDER;
  readonly #options: TfnswVehicleLocatorOptions;
  readonly #limits: VehicleFeedLimits;
  readonly #feeds = new Map<FeedMode, FeedState>();

  constructor(options: TfnswVehicleLocatorOptions) {
    this.#options = options;
    this.#limits = { ...DEFAULT_VEHICLE_FEED_LIMITS, ...options.limits };
  }

  // The caller's signal is not used: the fetch it may start is shared with every other caller.
  async locate(
    services: readonly TrackedService[],
    _signal?: AbortSignal,
  ): Promise<VehicleLookup[]> {
    const modes = [...new Set(services.map((service) => service.mode).filter(isFeedMode))];
    const copies = new Map(
      await Promise.all(modes.map(async (mode) => [mode, await this.#copyOf(mode)] as const)),
    );
    const nowMs = this.#nowMs();
    return services.map((service): VehicleLookup => {
      if (!isFeedMode(service.mode)) return { ...service, status: 'not-tracked' };
      const copy = copies.get(service.mode);
      if (!copy) return { ...service, status: 'unavailable' };
      const fix = copy.feed.fixes.get(service.realtimeTripId);
      if (!fix || nowMs - fix.observedAtMs > this.#limits.maxReportAgeMs) {
        return { ...service, status: 'not-located' };
      }
      return {
        ...service,
        status: 'located',
        position: fix.position,
        bearingDegrees: fix.bearingDegrees,
        // A vehicle clock running ahead would read as a report from the future.
        observedAt: toIso(new Date(Math.min(fix.observedAtMs, nowMs))),
        servingTrip: fix.onPreviousTrip ? 'previous-trip' : 'this-trip',
      };
    });
  }

  // A copy young enough to answer from, fetching a new one when it is due; null when there is none.
  async #copyOf(mode: FeedMode): Promise<FeedCopy | null> {
    const state = this.#stateOf(mode);
    if (state.copy && this.#nowMs() - state.copy.fetchedAtMs < this.#limits.freshForMs) {
      return state.copy;
    }
    const nowMs = this.#nowMs();
    const lost =
      state.inFlight && nowMs - state.inFlight.startedAtMs > this.#limits.sharedFetchLimitMs;
    if (lost) state.inFlight = null;
    if (!state.inFlight && nowMs < state.notBeforeMs) return this.#usable(state.copy);
    // The shared fetch carries no single request's signal, so one traveller leaving cannot cancel
    // it for the rest. Each waiter bounds its own wait, with a timer of its own.
    const attempt = state.inFlight ?? this.#startFetch(mode, state);
    try {
      return await runWithDeadline(() => attempt.promise, {
        deadlineMs: this.#limits.sharedFetchLimitMs,
        onLateOutcome: () => undefined,
      });
    } catch {
      return this.#usable(state.copy);
    }
  }

  #startFetch(mode: FeedMode, state: FeedState): FeedFetch {
    const attempt: FeedFetch = {
      promise: this.#fetch(mode, state, () => state.inFlight === attempt).finally(() => {
        if (state.inFlight === attempt) state.inFlight = null;
      }),
      startedAtMs: this.#nowMs(),
    };
    // A fetch nobody waits for any more must not surface as an unhandled rejection.
    attempt.promise.catch(() => undefined);
    state.inFlight = attempt;
    return attempt;
  }

  // `isCurrent` is false once a newer fetch has replaced this one; its failure then changes nothing,
  // and its feed is kept only if it is newer than the copy held.
  async #fetch(mode: FeedMode, state: FeedState, isCurrent: () => boolean): Promise<FeedCopy> {
    try {
      await this.#options.beforeFetch?.();
      const feed = await callProvider(
        PROVIDER,
        (signal) =>
          this.#options.client.getBytes({
            provider: PROVIDER,
            path: VEHICLE_FEED_PATHS[mode],
            parse: decodeVehiclePositions,
            maxBytes: this.#limits.maxFeedBytes,
            // The next refresh, 15 s later, is the retry; retrying here would double the calls a
            // TfNSW outage costs.
            retryOnce: false,
            signal,
          }),
        {
          timeoutMs: this.#limits.timeoutMs,
          onLateOutcome: this.#options.onLateOutcome ?? (() => undefined),
        },
      );
      const copy = { feed, fetchedAtMs: this.#nowMs() };
      if (!state.copy || state.copy.fetchedAtMs <= copy.fetchedAtMs) state.copy = copy;
      if (isCurrent()) state.notBeforeMs = 0;
      if (feed.skipped > 0) {
        this.#options.report({
          kind: 'vehicles-dropped',
          reason: 'incomplete',
          count: feed.skipped,
        });
      }
      return copy;
    } catch (error) {
      const failure = asProviderError(error, PROVIDER);
      if (isCurrent()) state.notBeforeMs = this.#nowMs() + this.#waitAfter(failure);
      this.#options.report({
        kind: 'vehicle-feed-unavailable',
        feed: mode,
        reason: failure.failure,
      });
      throw failure;
    }
  }

  #waitAfter(failure: ProviderError): number {
    const askedMs = failure.retryAfterSeconds === undefined ? 0 : failure.retryAfterSeconds * 1_000;
    return Math.min(
      this.#limits.maxWaitAfterFailureMs,
      Math.max(this.#limits.waitAfterFailureMs, askedMs),
    );
  }

  #usable(copy: FeedCopy | null): FeedCopy | null {
    if (!copy) return null;
    return this.#nowMs() - copy.fetchedAtMs < this.#limits.usableForMs ? copy : null;
  }

  #stateOf(mode: FeedMode): FeedState {
    let state = this.#feeds.get(mode);
    if (!state) {
      state = { copy: null, inFlight: null, notBeforeMs: 0 };
      this.#feeds.set(mode, state);
    }
    return state;
  }

  #nowMs(): number {
    return this.#options.clock.now().getTime();
  }
}
