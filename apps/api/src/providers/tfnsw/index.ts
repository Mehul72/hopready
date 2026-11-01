import {
  systemClock,
  type CarParkProvider,
  type Clock,
  type PlaceSearchProvider,
  type TransitProvider,
  type VehicleLocator,
} from '@hopready/core';

import type { FetchImplementation } from '../http';
import { TfnswCarParkProvider } from './car-parks';
import { createTfnswClient } from './client';
import { ignoreDiagnostics, type DiagnosticSink } from './diagnostics';
import { RateGate } from './rate-gate';
import { createStopSearchProvider } from './stop-search';
import { createTransitProvider } from './transit';
import { TfnswVehicleLocator } from './vehicle-positions';

export type { TfnswDiagnostic, DiagnosticSink } from './diagnostics';
export { classifyTfnswFailure, TFNSW_API_ORIGIN } from './client';
export { RateGate, RateGateFullError } from './rate-gate';

// The default Bronze plan allows 5 requests per second. That quota is per API key across every isolate
// and server sharing the key, so this setting only paces the isolate that created the providers.
export const DEFAULT_TFNSW_REQUESTS_PER_SECOND = 5;

export interface TfnswProviderOptions {
  apiKey: string;
  fetchImpl?: FetchImplementation;
  // For the live position feeds, defaulting to fetchImpl. Lets their requests be counted apart.
  vehicleFetchImpl?: FetchImplementation;
  // Asked before each live position feed fetch; throws to refuse it (a spent daily budget).
  beforeVehicleFetch?: () => Promise<void>;
  clock?: Clock;
  requestsPerSecond?: number;
  // Receives what the adapters leave out of TfNSW responses, for logs and metrics.
  onDiagnostic?: DiagnosticSink;
}

export interface TfnswProviders {
  transit: TransitProvider;
  stops: PlaceSearchProvider;
  carParks: CarParkProvider;
  vehicles: VehicleLocator;
}

// Create these once per isolate or process and reuse them: the rate gate and the car park caches live
// inside, so creating them per request would give every request its own gate and empty caches.
export function createTfnswProviders(options: TfnswProviderOptions): TfnswProviders {
  const gate = new RateGate({
    requestsPerSecond: options.requestsPerSecond ?? DEFAULT_TFNSW_REQUESTS_PER_SECOND,
  });
  const client = createTfnswClient({
    apiKey: options.apiKey,
    gate,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const report = options.onDiagnostic ?? ignoreDiagnostics;
  const clock = options.clock ?? systemClock;
  // Its own client only so its requests can be counted apart; the gate, and so TfNSW's per-second
  // limit, is shared with every other TfNSW call.
  const vehicleFetchImpl = options.vehicleFetchImpl ?? options.fetchImpl;
  const vehicleClient = createTfnswClient({
    apiKey: options.apiKey,
    gate,
    ...(vehicleFetchImpl ? { fetchImpl: vehicleFetchImpl } : {}),
  });
  return {
    transit: createTransitProvider(client, report),
    stops: createStopSearchProvider(client, report),
    carParks: new TfnswCarParkProvider(client, clock, report),
    vehicles: new TfnswVehicleLocator({
      client: vehicleClient,
      clock,
      report,
      ...(options.beforeVehicleFetch ? { beforeFetch: options.beforeVehicleFetch } : {}),
    }),
  };
}
