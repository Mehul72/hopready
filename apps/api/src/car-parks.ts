import {
  ProviderError,
  toIso,
  type CarParkFacility,
  type CarParkProvider,
  type Clock,
  type Occupancy,
} from '@hopready/core';

import {
  callProvider,
  runWithDeadline,
  toProviderError,
  type LateOutcomeHandler,
} from './deadline';

export interface CarParkWithOccupancy extends CarParkFacility {
  occupancy: Occupancy;
}

export interface CarParkListing {
  fetchedAt: string;
  carParks: CarParkWithOccupancy[];
}

export interface CatalogueRead {
  listing: CarParkListing;
  cache: 'hit' | 'miss';
}

// The picker answers "which car park did you use?", so live space counts add nothing there. Counting
// every facility would cost one TfNSW request each, about 40 a refresh, so this list never asks for
// them; plans fetch counts for the few car parks they actually use.
const OCCUPANCY_NOT_CHECKED: Occupancy = {
  status: 'unknown',
  reason: 'Space counts are checked when you plan a trip.',
};

// On Workers a fetch, and the timer bounding it, end with the request that started it. A request
// joining that fetch waits this much longer than the fetch's own timeout, on a timer of its own.
const SHARED_FETCH_GRACE_MS = 1_000;

// Facilities for the "which car park did you use?" picker. One cached copy per isolate, and one
// upstream fetch at a time however many requests arrive while it runs.
export class CarParkCatalogue {
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #onLateOutcome: LateOutcomeHandler;
  #cached: { listing: CarParkListing; expiresAtMs: number } | null = null;
  #inFlight: { listing: Promise<CarParkListing>; startedAtMs: number } | null = null;

  constructor(options: {
    clock: Clock;
    ttlMs: number;
    timeoutMs: number;
    onLateOutcome: LateOutcomeHandler;
  }) {
    this.#clock = options.clock;
    this.#ttlMs = options.ttlMs;
    this.#timeoutMs = options.timeoutMs;
    this.#onLateOutcome = options.onLateOutcome;
  }

  async read(provider: CarParkProvider): Promise<CatalogueRead> {
    const nowMs = this.#clock.now().getTime();
    if (this.#cached && nowMs < this.#cached.expiresAtMs) {
      return { listing: this.#cached.listing, cache: 'hit' };
    }
    // The shared fetch carries no single request's signal, so one caller leaving cannot cancel it
    // for the rest. One still pending past the waiting limit was lost with its request: replaced.
    const limitMs = this.#timeoutMs + SHARED_FETCH_GRACE_MS;
    if (this.#inFlight && nowMs - this.#inFlight.startedAtMs > limitMs) this.#inFlight = null;
    const attempt = this.#inFlight ?? this.#start(provider, nowMs);
    try {
      const listing = await runWithDeadline(() => attempt.listing, {
        deadlineMs: limitMs,
        onLateOutcome: this.#onLateOutcome,
      });
      return { listing, cache: 'miss' };
    } catch (error) {
      throw toProviderError(error, provider.name);
    }
  }

  #start(
    provider: CarParkProvider,
    nowMs: number,
  ): { listing: Promise<CarParkListing>; startedAtMs: number } {
    const attempt = {
      listing: this.#fetch(provider).finally(() => {
        if (this.#inFlight === attempt) this.#inFlight = null;
      }),
      startedAtMs: nowMs,
    };
    // A fetch nobody waits for any more must not surface as an unhandled rejection; its waiters
    // already got their answer, and the next request starts afresh.
    attempt.listing.catch(() => undefined);
    this.#inFlight = attempt;
    return attempt;
  }

  async #fetch(provider: CarParkProvider): Promise<CarParkListing> {
    const facilities = await callProvider(
      provider.name,
      (signal) => provider.listFacilities(signal),
      { timeoutMs: this.#timeoutMs, onLateOutcome: this.#onLateOutcome },
    );
    // Sydney always has Park&Ride car parks, so an empty answer is a provider hiccup, not data.
    // Reported as a failure, the app offers Try again; kept, it would leave an empty picker for ten
    // minutes after the provider recovers.
    if (facilities.length === 0) {
      throw new ProviderError(provider.name, 'unavailable', 'The car park list came back empty');
    }
    const fetchedAt = this.#clock.now();
    const listing: CarParkListing = {
      fetchedAt: toIso(fetchedAt),
      carParks: facilities.map((facility) => ({ ...facility, occupancy: OCCUPANCY_NOT_CHECKED })),
    };
    this.#cached = { listing, expiresAtMs: fetchedAt.getTime() + this.#ttlMs };
    return listing;
  }
}
