import type {
  CarParkProvider,
  DrivingProvider,
  PlaceSearchProvider,
  ProviderName,
  TransitProvider,
} from '@hopready/core';

import type { DailyCallBudget } from './budget';
import { elapsedMs, errorLogFields, type Logger } from './logger';

// What this server can call. A null or empty entry means the provider is not set up, and the
// endpoints that need it answer 503. Live mode never fills a gap with fixtures.
export interface ProviderSet {
  transit: TransitProvider | null;
  driving: DrivingProvider | null;
  carParks: CarParkProvider | null;
  // In merge order: stops first, then addresses and places.
  places: PlaceSearchProvider[];
}

export type ProviderOperation =
  'planJourneys' | 'estimateDrives' | 'routeDrive' | 'listFacilities' | 'occupancy' | 'search';

export interface ProviderCall {
  provider: ProviderName;
  operation: ProviderOperation;
}

// Runs around every provider call. It must call `proceed` once, or throw instead.
export type ProviderInterceptor = <Result>(
  call: ProviderCall,
  proceed: () => Promise<Result>,
) => Promise<Result>;

export function interceptTransit(
  provider: TransitProvider,
  intercept: ProviderInterceptor,
): TransitProvider {
  return {
    name: provider.name,
    planJourneys: (query, signal) =>
      intercept({ provider: provider.name, operation: 'planJourneys' }, () =>
        provider.planJourneys(query, signal),
      ),
  };
}

export function interceptDriving(
  provider: DrivingProvider,
  intercept: ProviderInterceptor,
): DrivingProvider {
  return {
    name: provider.name,
    estimateDrives: (origin, destinations, time, signal) =>
      intercept({ provider: provider.name, operation: 'estimateDrives' }, () =>
        provider.estimateDrives(origin, destinations, time, signal),
      ),
    routeDrive: (from, to, time, signal) =>
      intercept({ provider: provider.name, operation: 'routeDrive' }, () =>
        provider.routeDrive(from, to, time, signal),
      ),
  };
}

export function interceptCarParks(
  provider: CarParkProvider,
  intercept: ProviderInterceptor,
): CarParkProvider {
  return {
    name: provider.name,
    listFacilities: (signal) =>
      intercept({ provider: provider.name, operation: 'listFacilities' }, () =>
        provider.listFacilities(signal),
      ),
    occupancy: (facilityIds, signal) =>
      intercept({ provider: provider.name, operation: 'occupancy' }, () =>
        provider.occupancy(facilityIds, signal),
      ),
  };
}

export function interceptPlaces(
  provider: PlaceSearchProvider,
  intercept: ProviderInterceptor,
): PlaceSearchProvider {
  return {
    name: provider.name,
    search: (query, near, signal) =>
      intercept({ provider: provider.name, operation: 'search' }, () =>
        provider.search(query, near, signal),
      ),
  };
}

export function interceptProviderSet(
  providers: ProviderSet,
  intercept: ProviderInterceptor,
): ProviderSet {
  return {
    transit: providers.transit && interceptTransit(providers.transit, intercept),
    driving: providers.driving && interceptDriving(providers.driving, intercept),
    carParks: providers.carParks && interceptCarParks(providers.carParks, intercept),
    places: providers.places.map((provider) => interceptPlaces(provider, intercept)),
  };
}

// Refuses a provider call up front once its account's daily budget is spent. The requests the call
// makes are counted by budgetedFetch in composition.ts.
export function budgetInterceptor(budget: DailyCallBudget): ProviderInterceptor {
  return async (call, proceed) => {
    await budget.ensureAvailable(call.provider);
    return proceed();
  };
}

// Records how each provider call went, tied to the request through the logger's request ID.
export function loggingInterceptor(logger: Logger): ProviderInterceptor {
  return async (call, proceed) => {
    const startedAt = performance.now();
    try {
      const result = await proceed();
      logger.debug('provider call finished', {
        provider: call.provider,
        operation: call.operation,
        durationMs: elapsedMs(startedAt),
      });
      return result;
    } catch (error) {
      logger.warn('provider call failed', {
        ...errorLogFields(error),
        provider: call.provider,
        operation: call.operation,
        durationMs: elapsedMs(startedAt),
      });
      throw error;
    }
  };
}
