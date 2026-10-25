import {
  toIso,
  type CarParkFacility,
  type CarParkProvider,
  type Clock,
  type Occupancy,
} from '@hopready/core';

import { callProvider, type LateOutcomeHandler } from './deadline';

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

// Facilities for the "which car park did you use?" picker. One cached copy per isolate, and one
// upstream fetch at a time however many requests arrive while it runs.
export class CarParkCatalogue {
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #onLateOutcome: LateOutcomeHandler;
  #cached: { listing: CarParkListing; expiresAtMs: number } | null = null;
  #inFlight: Promise<CarParkListing> | null = null;

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
    // The shared fetch carries no single request's signal, so one caller leaving cannot cancel it for the rest.
    this.#inFlight ??= this.#fetch(provider).finally(() => {
      this.#inFlight = null;
    });
    return { listing: await this.#inFlight, cache: 'miss' };
  }

  async #fetch(provider: CarParkProvider): Promise<CarParkListing> {
    const facilities = await callProvider(
      provider.name,
      (signal) => provider.listFacilities(signal),
      { timeoutMs: this.#timeoutMs, onLateOutcome: this.#onLateOutcome },
    );
    const fetchedAt = this.#clock.now();
    const listing: CarParkListing = {
      fetchedAt: toIso(fetchedAt),
      carParks: facilities.map((facility) => ({ ...facility, occupancy: OCCUPANCY_NOT_CHECKED })),
    };
    // Sydney always has Park&Ride car parks, so an empty answer is a provider hiccup. Keeping it
    // for ten minutes would leave everyone with an empty picker long after the provider recovers.
    if (listing.carParks.length > 0) {
      this.#cached = { listing, expiresAtMs: fetchedAt.getTime() + this.#ttlMs };
    }
    return listing;
  }
}
