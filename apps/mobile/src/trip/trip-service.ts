import {
  type CarParkProvider,
  type Clock,
  type Coordinate,
  isWithinGreaterSydney,
  type Occupancy,
  type PlanRequest,
  planRequestSchema,
  type PlanResponse,
  planTrip as planWithProviders,
  ProviderError,
  type ProviderFailure,
  systemClock,
} from '@hopready/core';
import { createDemoProviders } from '@hopready/core/fixtures';

import {
  type ApiClient,
  apiClient,
  ApiError,
  type ApiErrorKind,
  type ApiMode,
  type CarParkListing,
  describeWait,
  PLACE_QUERY_MIN_LENGTH,
  type PlaceSearchResults,
  readDemoScenariosAllowed,
} from '@/api';
import { apiAnswerMode } from '@/state/api-answer-mode';
import { appStorage, type AppSettings } from '@/storage';

export type DataMode = 'live' | 'demo';

export interface RequestOptions {
  signal?: AbortSignal;
}

// Where every screen gets trip data. In demo mode the real planner runs on the device against
// labelled fixtures; in live mode everything comes from the HopReady API. Neither ever falls back
// to the other: a live failure is reported as a live failure.
export interface TripService {
  currentMode: () => DataMode;
  planTrip: (request: PlanRequest, options?: RequestOptions) => Promise<PlanResponse>;
  searchPlaces: (
    query: string,
    near?: Coordinate | null,
    options?: RequestOptions,
  ) => Promise<PlaceSearchResults>;
  listCarParks: (options?: RequestOptions) => Promise<CarParkListing>;
}

export interface TripServiceDependencies {
  api: ApiClient;
  settings: () => Pick<AppSettings, 'demoMode' | 'demoScenario'>;
  clock: Clock;
  // Told the mode of every answer from the API. It is 'demo' when the API serves sample data,
  // which must be labelled even though the app is in live mode.
  onApiAnswer: (mode: ApiMode) => void;
}

const KIND_FOR_DEMO_FAILURE: Readonly<Record<ProviderFailure, ApiErrorKind>> = {
  timeout: 'timeout',
  'rate-limited': 'rate-limited',
  unavailable: 'server',
  'malformed-response': 'server',
  'not-configured': 'server',
  'rejected-request': 'rejected',
};

const DEMO_FAILURE_DESCRIPTIONS: Readonly<Record<ProviderFailure, string>> = {
  timeout: 'took too long to respond',
  'rate-limited': 'is busy',
  unavailable: 'is unavailable',
  'malformed-response': 'sent data that could not be read',
  'not-configured': 'is not set up',
  'rejected-request': 'could not handle this request',
};

// Demo scenarios simulate failures on purpose (DEMO_SCENARIOS in the fixtures). Every demo
// provider shares one name, so the message names the sample service rather than a real provider:
// nobody should mistake it for a real outage, and demo mode is never suggested as the fix.
export function demoFailure(error: ProviderError): ApiError {
  const retryAfterSeconds = error.retryAfterSeconds ?? null;
  const wait =
    retryAfterSeconds === null ? '' : ` Try again in ${describeWait(retryAfterSeconds)}.`;
  return new ApiError(KIND_FOR_DEMO_FAILURE[error.failure], {
    message: `Demo mode: the sample travel service ${DEMO_FAILURE_DESCRIPTIONS[error.failure]}.${wait}`,
    retryAfterSeconds,
    cause: error,
  });
}

// The live API lists facilities without space counts: counting all of them would cost one TfNSW
// request each, and plans fetch counts for the few car parks they use. Demo mode answers the same
// way, so both modes show the same states.
export const OCCUPANCY_NOT_CHECKED: Occupancy = {
  status: 'unknown',
  reason: 'Space counts are checked when you plan a trip.',
};

async function demoCarParkListing(
  carParks: CarParkProvider,
  signal: AbortSignal | undefined,
): Promise<CarParkListing> {
  const facilities = await carParks.listFacilities(signal ?? new AbortController().signal);
  return {
    mode: 'demo',
    carParks: facilities.map((facility) => ({ ...facility, occupancy: OCCUPANCY_NOT_CHECKED })),
    notices: [],
  };
}

function validated(request: PlanRequest): PlanRequest {
  const parsed = planRequestSchema.safeParse(request);
  if (!parsed.success) throw new ApiError('rejected', { cause: parsed.error });
  const { origin, destination, trip } = parsed.data;
  const points = [origin.coordinate, destination.coordinate];
  if (trip.kind === 'return-via-car') points.push(trip.parkedCar.location.coordinate);
  if (!points.every(isWithinGreaterSydney)) throw new ApiError('outside-coverage');
  return parsed.data;
}

export function createTripService(dependencies: TripServiceDependencies): TripService {
  const { api, clock, onApiAnswer } = dependencies;

  function demoProviders() {
    const scenario = dependencies.settings().demoScenario ?? undefined;
    return createDemoProviders({ clock, scenario });
  }

  // Runs a demo call and reports a simulated provider failure in demo wording. Cancellation wins
  // over whatever the providers reported once the caller has given up.
  async function inDemo<T>(signal: AbortSignal | undefined, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (signal?.aborted) throw new ApiError('cancelled', { cause: error });
      if (error instanceof ProviderError) throw demoFailure(error);
      throw error;
    }
  }

  const currentMode = (): DataMode => (dependencies.settings().demoMode ? 'demo' : 'live');

  // Only answers that came from the API are passed on: the demo planner never asks it anything.
  function fromApi<T extends { mode: ApiMode }>(answer: T): T {
    onApiAnswer(answer.mode);
    return answer;
  }

  return {
    currentMode,
    planTrip: async (request, { signal } = {}) => {
      // Checked here as well as on the server, so both modes reject the same requests and an
      // out-of-area trip fails before any network call.
      const checked = validated(request);
      if (currentMode() === 'live') return fromApi(await api.plan(checked, signal));
      const providers = demoProviders();
      return inDemo(signal, () =>
        planWithProviders(
          checked,
          {
            mode: 'demo',
            transit: providers.transit,
            driving: providers.driving,
            carParks: providers.carParks,
            clock,
          },
          signal,
        ),
      );
    },
    searchPlaces: async (query, near, { signal } = {}) => {
      const trimmed = query.trim();
      if (trimmed.length < PLACE_QUERY_MIN_LENGTH) {
        return { mode: currentMode(), results: [], unavailable: [] };
      }
      if (currentMode() === 'live') return fromApi(await api.searchPlaces(trimmed, near, signal));
      const providers = demoProviders();
      const results = await inDemo(signal, () =>
        providers.places.search(trimmed, near ?? null, signal ?? new AbortController().signal),
      );
      return { mode: 'demo', results, unavailable: [] };
    },
    listCarParks: async ({ signal } = {}) => {
      if (currentMode() === 'live') return fromApi(await api.carParks(signal));
      const providers = demoProviders();
      return inDemo(signal, () => demoCarParkListing(providers.carParks, signal));
    },
  };
}

// A scenario chosen in a development build must not follow the install into a store build, where
// nothing on screen would explain the staged failures.
export function withAllowedDemoScenario(
  settings: Pick<AppSettings, 'demoMode' | 'demoScenario'>,
  demoScenariosAllowed: boolean,
): Pick<AppSettings, 'demoMode' | 'demoScenario'> {
  return demoScenariosAllowed ? settings : { ...settings, demoScenario: null };
}

const demoScenariosAllowed = readDemoScenariosAllowed();

export const tripService = createTripService({
  api: apiClient,
  settings: () => withAllowedDemoScenario(appStorage.settings.get(), demoScenariosAllowed),
  clock: systemClock,
  onApiAnswer: apiAnswerMode.record,
});
