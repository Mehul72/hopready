import type {
  CarParkProvider,
  Clock,
  DrivingProvider,
  PlaceSearchProvider,
  TransitProvider,
} from '@hopready/core';

import { DailyCallBudget, type BudgetLedger } from './budget';
import type { ApiConfig } from './config';
import { errorLogFields, type Logger } from './logger';
import {
  budgetInterceptor,
  interceptCarParks,
  interceptDriving,
  interceptPlaces,
  interceptTransit,
  type ProviderSet,
} from './provider-set';
import type { FetchImplementation } from './providers/http';

// Signatures of the adapter factories in src/providers. Only the composition roots (worker.ts,
// node-server.ts) import the real ones; everything else, tests included, receives them.

// What the TfNSW adapters report leaving out of a response (providers/tfnsw/diagnostics.ts).
// Events never carry places, coordinates or search text.
export interface TfnswDiagnosticEvent {
  kind: string;
  reason?: string;
  count?: number;
  productClasses?: readonly number[];
  systemMessageCodes?: readonly number[];
  facilityIds?: readonly string[];
  ageHours?: number;
}

export interface TfnswProviders {
  transit: TransitProvider;
  stops: PlaceSearchProvider;
  carParks: CarParkProvider;
}

export interface AppleMapsProviders {
  driving: DrivingProvider;
  places: PlaceSearchProvider;
}

export interface LiveProviderFactories {
  createTfnswProviders(options: {
    apiKey: string;
    fetchImpl?: FetchImplementation;
    clock?: Clock;
    onDiagnostic?: (event: TfnswDiagnosticEvent) => void;
  }): TfnswProviders;
  createAppleMapsProviders(options: {
    teamId: string;
    keyId: string;
    privateKey: string;
    fetchImpl?: FetchImplementation;
    clock?: Clock;
  }): AppleMapsProviders;
}

export interface DemoProviders {
  transit: TransitProvider;
  driving: DrivingProvider;
  carParks: CarParkProvider;
  places: PlaceSearchProvider;
}

export interface ProviderFactories extends LiveProviderFactories {
  createDemoProviders(options?: { clock?: Clock }): DemoProviders;
}

export interface ProviderBudgets {
  tfnsw: DailyCallBudget;
  appleMaps: DailyCallBudget;
}

export function createProviderBudgets(
  config: ApiConfig,
  options: { clock: Clock; ledger: BudgetLedger | null; logger: Logger },
): ProviderBudgets {
  const { clock, ledger, logger } = options;
  const budget = (name: 'tfnsw' | 'apple-maps', dailyLimit: number) =>
    new DailyCallBudget({
      name,
      dailyLimit,
      clock,
      ledger,
      onLedgerError: (error) =>
        logger.warn('budget ledger unreachable, using this isolate count', {
          ...errorLogFields(error),
          budget: name,
        }),
      onExhausted: () =>
        logger.warn('daily provider call budget used up', {
          budget: name,
          budgetLimit: dailyLimit,
        }),
    });
  return {
    tfnsw: budget('tfnsw', config.dailyCallBudgets.tfnsw),
    appleMaps: budget('apple-maps', config.dailyCallBudgets.appleMaps),
  };
}

export async function flushProviderBudgets(budgets: ProviderBudgets): Promise<void> {
  await Promise.all([budgets.tfnsw.flush(), budgets.appleMaps.flush()]);
}

// The fetch the adapters send through, so every request they make is counted, retries included.
// Called through a closure because Workers refuses a detached `fetch` ("Illegal invocation").
const platformFetch: FetchImplementation = (input, init) => fetch(input, init);

export function budgetedFetch(
  budget: DailyCallBudget,
  baseFetch: FetchImplementation = platformFetch,
): FetchImplementation {
  return (input, init) => {
    budget.recordRequest();
    return baseFetch(input, init);
  };
}

// Leaving out a mode the traveller excluded, or one HopReady cannot show, is expected; anything
// unreadable or stale points at drift in TfNSW's data and is worth a look.
// Omissions that happen by design: modes the traveller excluded or HopReady cannot show, and real
// car parks outside the area HopReady covers (Kiama). They are logged as information, not warnings.
const EXPECTED_TFNSW_OMISSIONS = new Set(['excluded-mode', 'unsupported-mode', 'outside-coverage']);

function logTfnswDiagnostic(logger: Logger, event: TfnswDiagnosticEvent): void {
  const expected =
    event.kind === 'no-journeys' ||
    (event.reason !== undefined && EXPECTED_TFNSW_OMISSIONS.has(event.reason));
  const fields = {
    providerAccount: 'tfnsw' as const,
    diagnostic: event.kind,
    reason: event.reason,
    count: event.count,
    codes: event.productClasses ?? event.systemMessageCodes,
    facilityIds: event.facilityIds,
    ageHours: event.ageHours,
  };
  if (expected) logger.info('tfnsw data left out', fields);
  else logger.warn('tfnsw data left out', fields);
}

// A factory that throws (for example on a malformed private key) takes out only its own providers.
function createOrReport<Providers>(
  family: 'tfnsw' | 'apple-maps',
  create: () => Providers,
  logger: Logger,
): Providers | null {
  try {
    return create();
  } catch (error) {
    logger.error('provider setup failed, its endpoints will answer 503', {
      ...errorLogFields(error),
      providerAccount: family,
    });
    return null;
  }
}

export function buildLiveProviders(
  config: ApiConfig,
  adapters: LiveProviderFactories,
  options: {
    clock: Clock;
    budgets: ProviderBudgets;
    logger: Logger;
    // The fetch under the budget counting. Tests replace it; the platform fetch otherwise.
    fetchImpl?: FetchImplementation;
  },
): ProviderSet {
  const { clock, budgets, logger } = options;
  const tfnswSettings = config.tfnsw;
  const appleSettings = config.appleMaps;

  const tfnsw = tfnswSettings
    ? createOrReport(
        'tfnsw',
        () =>
          adapters.createTfnswProviders({
            apiKey: tfnswSettings.apiKey,
            clock,
            fetchImpl: budgetedFetch(budgets.tfnsw, options.fetchImpl),
            onDiagnostic: (event) => logTfnswDiagnostic(logger, event),
          }),
        logger,
      )
    : null;
  const apple = appleSettings
    ? createOrReport(
        'apple-maps',
        () =>
          adapters.createAppleMapsProviders({
            teamId: appleSettings.teamId,
            keyId: appleSettings.keyId,
            privateKey: appleSettings.privateKey,
            clock,
            fetchImpl: budgetedFetch(budgets.appleMaps, options.fetchImpl),
          }),
        logger,
      )
    : null;

  const tfnswBudget = budgetInterceptor(budgets.tfnsw);
  const appleBudget = budgetInterceptor(budgets.appleMaps);
  const places: PlaceSearchProvider[] = [];
  if (tfnsw) places.push(interceptPlaces(tfnsw.stops, tfnswBudget));
  if (apple) places.push(interceptPlaces(apple.places, appleBudget));

  return {
    transit: tfnsw && interceptTransit(tfnsw.transit, tfnswBudget),
    driving: apple && interceptDriving(apple.driving, appleBudget),
    carParks: tfnsw && interceptCarParks(tfnsw.carParks, tfnswBudget),
    places,
  };
}

// Demo mode serves the labelled on-device fixtures from @hopready/core and never calls a provider.
export function buildDemoProviders(
  createDemoProviders: ProviderFactories['createDemoProviders'],
  clock: Clock,
): ProviderSet {
  const demo = createDemoProviders({ clock });
  return {
    transit: demo.transit,
    driving: demo.driving,
    carParks: demo.carParks,
    places: [demo.places],
  };
}
