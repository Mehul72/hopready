import {
  type Clock,
  type Itinerary,
  type PlanRequest,
  type PlanResponse,
  systemClock,
  toIso,
} from '@hopready/core';
import { useMemo, useSyncExternalStore } from 'react';

import { type ApiError, toApiError } from '@/api';
import {
  type ActiveTrip,
  type AppStorage,
  appStorage,
  useActiveTrip,
  useSettings,
} from '@/storage';
import { matchItinerary } from '@/trip/itinerary-match';
import { type ItinerarySort, sortItineraries } from '@/trip/itinerary-sort';
import {
  manualRefreshAvailability,
  refreshableRequest,
  shouldRefreshActiveTripOnResume,
} from '@/trip/refresh-policy';
import { type TripService, tripService } from '@/trip/trip-service';

// 'refreshing' keeps the previous results on screen while new ones load.
export type PlanStatus = 'idle' | 'planning' | 'refreshing' | 'ready' | 'failed';

export type ActiveTripRefreshStatus =
  | 'idle'
  | 'refreshing'
  // The same services, with updated times.
  | 'updated'
  // The chosen run is gone, but the same option (strategy, car park, first service) is offered
  // on another run, and the active trip now follows that one.
  | 'replaced'
  // Nothing like the chosen option is offered any more; `alternatives` holds what is.
  | 'no-longer-offered'
  | 'failed';

export interface ActiveTripRefresh {
  status: ActiveTripRefreshStatus;
  error: ApiError | null;
  alternatives: Itinerary[];
  // For 'replaced': the run the person chose, so the screen can say what changed.
  previous: Itinerary | null;
  checkedAt: string | null;
}

export interface PlanSessionState {
  // The request behind `response`. A refresh may have moved a past "leave at" time up to now.
  request: PlanRequest | null;
  // Kept during a refresh and after a failed refresh, so the screen can show results with their
  // age (`plannedAt`) next to the error.
  response: PlanResponse | null;
  status: PlanStatus;
  error: ApiError | null;
  plannedAt: string | null;
  sort: ItinerarySort;
  selectedItineraryId: string | null;
  activeTripRefresh: ActiveTripRefresh;
}

export type PlanOutcome =
  | { status: 'ready'; response: PlanResponse }
  | { status: 'failed'; error: ApiError }
  // A newer plan or refresh started before this one finished, or the session was reset.
  | { status: 'superseded' };

export type RefreshOutcome =
  | PlanOutcome
  | { status: 'nothing-to-refresh' }
  | { status: 'busy' }
  | { status: 'too-soon'; retryInSeconds: number };

export interface PlanSession {
  getState: () => PlanSessionState;
  subscribe: (listener: () => void) => () => void;
  // Starts a new search. Any search still running is cancelled and its answer ignored.
  plan: (request: PlanRequest) => Promise<PlanOutcome>;
  // Re-plans the latest request, at most once every 30 seconds.
  refresh: () => Promise<RefreshOutcome>;
  // Makes an option from the latest results the active trip. Returns null if it is not there.
  select: (itineraryId: string) => Itinerary | null;
  // Looks in the latest results first, then in the active trip.
  getItinerary: (itineraryId: string) => Itinerary | null;
  setSort: (sort: ItinerarySort) => void;
  // Re-plans the active trip when the refresh-on-resume rule says so; the outcome lands in
  // `activeTripRefresh`. Never rejects.
  refreshActiveTrip: () => Promise<void>;
  reset: () => void;
}

export interface PlanSessionDependencies {
  trips: Pick<TripService, 'planTrip' | 'currentMode'>;
  storage: Pick<AppStorage, 'activeTrip' | 'recentRequests' | 'settings' | 'onDataDeleted'>;
  clock: Clock;
}

const IDLE_ACTIVE_TRIP_REFRESH: ActiveTripRefresh = {
  status: 'idle',
  error: null,
  alternatives: [],
  previous: null,
  checkedAt: null,
};

const INITIAL_STATE: PlanSessionState = {
  request: null,
  response: null,
  status: 'idle',
  error: null,
  plannedAt: null,
  sort: 'best',
  selectedItineraryId: null,
  activeTripRefresh: IDLE_ACTIVE_TRIP_REFRESH,
};

// A bug, not a network or provider problem. Only the error's type is logged: messages can quote
// the request, which holds places.
function reportUnexpected(error: ApiError) {
  const cause = error.cause;
  const name = cause instanceof Error ? cause.name : typeof cause;
  console.error(`HopReady: unexpected ${name} while planning a trip.`);
}

export function findItinerary(
  response: PlanResponse | null,
  activeTrip: ActiveTrip | null,
  itineraryId: string,
): Itinerary | null {
  const fromResults = response?.itineraries.find((itinerary) => itinerary.id === itineraryId);
  if (fromResults) return fromResults;
  return activeTrip?.itinerary.id === itineraryId ? activeTrip.itinerary : null;
}

export function createPlanSession(dependencies: PlanSessionDependencies): PlanSession {
  const { trips, storage, clock } = dependencies;
  const listeners = new Set<() => void>();
  let state = INITIAL_STATE;
  let currentRun: AbortController | null = null;
  let activeTripRun: AbortController | null = null;

  function setState(patch: Partial<PlanSessionState>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function beginRun(): AbortController {
    currentRun?.abort();
    const run = new AbortController();
    currentRun = run;
    return run;
  }

  function rememberRecent(request: PlanRequest) {
    try {
      storage.recentRequests.record(request);
    } catch (error) {
      // Recents are a convenience; failing to save one must not turn a good plan into an error.
      console.warn(
        `HopReady: could not save a recent trip (${error instanceof Error ? error.name : 'unknown'}).`,
      );
    }
  }

  async function runPlan(request: PlanRequest, run: AbortController): Promise<PlanOutcome> {
    try {
      const response = await trips.planTrip(request, { signal: run.signal });
      if (currentRun !== run) return { status: 'superseded' };
      currentRun = null;
      setState({ request, response, status: 'ready', error: null, plannedAt: toIso(clock.now()) });
      rememberRecent(request);
      return { status: 'ready', response };
    } catch (error) {
      if (currentRun !== run) return { status: 'superseded' };
      currentRun = null;
      const apiError = toApiError(error);
      if (apiError.kind === 'unexpected') reportUnexpected(apiError);
      setState({ status: 'failed', error: apiError });
      return { status: 'failed', error: apiError };
    }
  }

  function reset() {
    currentRun?.abort();
    currentRun = null;
    activeTripRun?.abort();
    activeTripRun = null;
    state = INITIAL_STATE;
    for (const listener of [...listeners]) listener();
  }

  async function refreshActiveTrip(): Promise<void> {
    if (activeTripRun) return;
    const run = new AbortController();
    activeTripRun = run;
    try {
      const trip = storage.activeTrip.get();
      if (!trip || !shouldRefreshActiveTripOnResume(trip, clock.now(), trips.currentMode())) {
        return;
      }
      setState({ activeTripRefresh: { ...IDLE_ACTIVE_TRIP_REFRESH, status: 'refreshing' } });
      const request = refreshableRequest(trip.request, clock.now());
      const response = await trips.planTrip(request, { signal: run.signal });
      // Ignore the answer if the session was reset or the person chose another trip meanwhile.
      if (run.signal.aborted || storage.activeTrip.get() !== trip) return;
      const checkedAt = toIso(clock.now());
      const match = matchItinerary(trip.itinerary, response.itineraries);
      if (!match) {
        setState({
          activeTripRefresh: {
            status: 'no-longer-offered',
            error: null,
            alternatives: response.itineraries,
            previous: null,
            checkedAt,
          },
        });
        return;
      }
      storage.activeTrip.start({
        request,
        itinerary: match.itinerary,
        plannedAt: checkedAt,
        mode: response.mode,
      });
      setState({
        activeTripRefresh: {
          status: match.exact ? 'updated' : 'replaced',
          error: null,
          alternatives: [],
          previous: match.exact ? null : trip.itinerary,
          checkedAt,
        },
      });
    } catch (error) {
      if (run.signal.aborted) return;
      const apiError = toApiError(error);
      if (apiError.kind === 'unexpected') reportUnexpected(apiError);
      setState({
        activeTripRefresh: {
          status: 'failed',
          error: apiError,
          alternatives: [],
          previous: null,
          checkedAt: toIso(clock.now()),
        },
      });
    } finally {
      if (activeTripRun === run) activeTripRun = null;
    }
  }

  storage.onDataDeleted(reset);
  // Results from one mode must never be shown, refreshed or selected after switching to the other.
  let lastMode = trips.currentMode();
  storage.settings.subscribe(() => {
    const mode = trips.currentMode();
    if (mode === lastMode) return;
    lastMode = mode;
    reset();
  });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    plan: (request) => {
      const run = beginRun();
      setState({
        request,
        response: null,
        status: 'planning',
        error: null,
        plannedAt: null,
        selectedItineraryId: null,
      });
      return runPlan(request, run);
    },
    refresh: async () => {
      const { request, response, plannedAt, status } = state;
      if (!request) return { status: 'nothing-to-refresh' };
      if (status === 'planning' || status === 'refreshing') return { status: 'busy' };
      const now = clock.now();
      const availability = manualRefreshAvailability(plannedAt, now);
      if (!availability.allowed) {
        return { status: 'too-soon', retryInSeconds: availability.retryInSeconds };
      }
      const run = beginRun();
      setState({ status: response ? 'refreshing' : 'planning', error: null });
      return runPlan(refreshableRequest(request, now), run);
    },
    select: (itineraryId) => {
      const { request, response, plannedAt } = state;
      const itinerary = response?.itineraries.find((candidate) => candidate.id === itineraryId);
      if (!request || !response || !plannedAt || !itinerary) return null;
      storage.activeTrip.start({ request, itinerary, plannedAt, mode: response.mode });
      setState({ selectedItineraryId: itineraryId, activeTripRefresh: IDLE_ACTIVE_TRIP_REFRESH });
      return itinerary;
    },
    getItinerary: (itineraryId) =>
      findItinerary(state.response, storage.activeTrip.get(), itineraryId),
    setSort: (sort) => {
      if (sort !== state.sort) setState({ sort });
    },
    refreshActiveTrip,
    reset,
  };
}

export const planSession = createPlanSession({
  trips: tripService,
  storage: appStorage,
  clock: systemClock,
});

export function usePlanSession(): PlanSessionState {
  return useSyncExternalStore(planSession.subscribe, planSession.getState, planSession.getState);
}

// The latest results in the order the person picked.
export function useSortedItineraries(): Itinerary[] {
  const { response, sort } = usePlanSession();
  return useMemo(() => sortItineraries(response?.itineraries ?? [], sort), [response, sort]);
}

// For screens opened with an itinerary id, such as itinerary/[id]. Re-renders when either the
// results or the active trip change.
export function useItinerary(itineraryId: string | null): Itinerary | null {
  const { response } = usePlanSession();
  const activeTrip = useActiveTrip();
  return itineraryId === null ? null : findItinerary(response, activeTrip, itineraryId);
}

// True while anything on screen may be sample data: demo mode is on, or the API itself answered
// in demo mode (HOPREADY_MODE=demo, for local end-to-end runs).
export function useShowsDemoData(): boolean {
  const { demoMode } = useSettings();
  const { response } = usePlanSession();
  const activeTrip = useActiveTrip();
  return demoMode || response?.mode === 'demo' || activeTrip?.mode === 'demo';
}
