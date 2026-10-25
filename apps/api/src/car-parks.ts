import {
  DEFAULT_PLANNER_LIMITS,
  ProviderError,
  secondsBetween,
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
  occupancyAvailable: boolean;
}

export interface CatalogueRead {
  listing: CarParkListing;
  cache: 'hit' | 'miss';
}

export const OCCUPANCY_UNAVAILABLE_NOTICE = 'Car park occupancy figures are unavailable right now.';

// Facilities and their occupancy for the "which car park did you use?" picker. One cached copy per
// isolate for a minute, which matches how often TfNSW updates most counters, and one upstream
// fetch at a time however many requests arrive while it runs.
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
    const callOptions = { timeoutMs: this.#timeoutMs, onLateOutcome: this.#onLateOutcome };
    const facilities = await callProvider(
      provider.name,
      (signal) => provider.listFacilities(signal),
      callOptions,
    );

    const liveIds = facilities
      .filter((facility) => facility.kind === 'transport-park-and-ride')
      .map((facility) => facility.id);
    let occupancy: Map<string, Occupancy> | null;
    try {
      occupancy =
        liveIds.length === 0
          ? new Map()
          : await callProvider(
              provider.name,
              (signal) => provider.occupancy(liveIds, signal),
              callOptions,
            );
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // The facilities are still worth showing; each one says its occupancy is unknown.
      occupancy = null;
    }

    const fetchedAt = this.#clock.now();
    const listing: CarParkListing = {
      fetchedAt: toIso(fetchedAt),
      carParks: facilities.map((facility) => ({
        ...facility,
        occupancy: occupancy
          ? (occupancy.get(facility.id) ?? {
              status: 'unknown',
              reason: 'No occupancy figures are published for this car park.',
            })
          : { status: 'unknown', reason: 'Occupancy figures are unavailable right now.' },
      })),
      occupancyAvailable: occupancy !== null,
    };
    // A listing without occupancy is not kept, so the next request tries the counts again.
    if (occupancy) this.#cached = { listing, expiresAtMs: fetchedAt.getTime() + this.#ttlMs };
    return listing;
  }
}

// Counts older than the planner's freshness limit are shown as stale, judged when they are served
// rather than when they were cached.
export function withCurrentFreshness(occupancy: Occupancy, now: Date): Occupancy {
  if (occupancy.status !== 'known') return occupancy;
  const ageMinutes = secondsBetween(occupancy.observedAt, now) / 60;
  return ageMinutes > DEFAULT_PLANNER_LIMITS.occupancyFreshMinutes
    ? { ...occupancy, status: 'stale' }
    : occupancy;
}
