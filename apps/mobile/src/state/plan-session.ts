import {
  type Clock,
  type Itinerary,
  laterOf,
  type PlanRequest,
  type PlanResponse,
  systemClock,
  toIso,
} from '@hopready/core';
import { useSyncExternalStore } from 'react';

import { type ApiError, toApiError } from '@/api';
import {
  type ActiveTrip,
  type AppStorage,
  appStorage,
  useActiveTrip,
  useSettings,
} from '@/storage';
import { matchItinerary, matchRestOfTrip } from '@/trip/itinerary-match';
import {
  manualRefreshAvailability,
  partToCheck,
  refreshableRequest,
  replanRequest,
  restOfTripRequest,
  shouldRefreshActiveTripOnResume,
} from '@/trip/refresh-policy';
import { withCurrentCar } from '@/trip/return-trip';
import { type TripService, tripService } from '@/trip/trip-service';

import { useApiAnswerMode } from './api-answer-mode';

// 'refreshing' keeps the previous results on screen while new ones load.
export type PlanStatus = 'idle' | 'planning' | 'refreshing' | 'ready' | 'failed';

export type ActiveTripRefreshStatus =
  | 'idle'
  | 'refreshing'
  // The same services, with updated times.
  | 'updated'
  // The chosen run is gone, but the same option (strategy, car park, first service) is offered
  // on another run, and the active trip now follows that one. Only before the trip starts.
  | 'replaced'
  // Nothing like the chosen option is offered any more, or once it has started, the services
  // still to come are not; `alternatives` holds what is.
  | 'no-longer-offered'
  | 'failed';

export interface ActiveTripRefresh {
  status: ActiveTripRefreshStatus;
  error: ApiError | null;
  alternatives: Itinerary[];
  // For 'no-longer-offered': the search the alternatives answer, so following one or planning
  // again uses the same places and car.
  request: PlanRequest | null;
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
  | { status: 'too-soon'; retryInSeconds: number }
  // A trip home that no longer fits the car (withCurrentCar). It is not planned again.
  | { status: 'car-changed' };

export type CheckOutcome =
  // The check ran, or the trip changed while it did. What it found, a failure included, is in
  // `activeTripRefresh`.
  | { status: 'checked' }
  | { status: 'nothing-to-check' }
  | { status: 'busy' }
  | { status: 'too-soon'; retryInSeconds: number }
  | { status: 'car-changed' };

export interface PlanSession {
  getState: () => PlanSessionState;
  subscribe: (listener: () => void) => () => void;
  // Starts a new search. Any search still running is cancelled and its answer ignored.
  plan: (request: PlanRequest) => Promise<PlanOutcome>;
  // Re-plans the latest request, at most once every 30 seconds. A trip home goes through the car
  // as it is now. Never rejects.
  refresh: () => Promise<RefreshOutcome>;
  // Makes an option from the latest results the active trip. Returns null if it is not there.
  select: (itineraryId: string) => Itinerary | null;
  // Re-plans the active trip, or the rest of it once it has started, when the refresh-on-resume
  // rule says so; the outcome lands in `activeTripRefresh`. Never rejects.
  refreshActiveTrip: () => Promise<void>;
  // The same check when the person asks for it, at most once every 30 seconds. Never rejects.
  checkActiveTrip: () => Promise<CheckOutcome>;
  reset: () => void;
}

export interface PlanSessionDependencies {
  trips: Pick<TripService, 'planTrip' | 'currentMode'>;
  storage: Pick<
    AppStorage,
    'activeTrip' | 'parkedCar' | 'recentRequests' | 'settings' | 'onDataDeleted'
  >;
  clock: Clock;
}

const IDLE_ACTIVE_TRIP_REFRESH: ActiveTripRefresh = {
  status: 'idle',
  error: null,
  alternatives: [],
  request: null,
  previous: null,
  checkedAt: null,
};

const INITIAL_STATE: PlanSessionState = {
  request: null,
  response: null,
  status: 'idle',
  error: null,
  plannedAt: null,
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

  // Results already on screen stay there, next to the error.
  function fail(error: unknown): PlanOutcome {
    const apiError = toApiError(error);
    if (apiError.kind === 'unexpected') reportUnexpected(apiError);
    setState({ status: 'failed', error: apiError });
    return { status: 'failed', error: apiError };
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
      return fail(error);
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

  // When the active trip last got an answer. A check that found it no longer offered leaves the
  // trip and its plannedAt as they were, so that check counts too. A failed one never does, so
  // "Try again" is never held back.
  function lastAnsweredAt(trip: ActiveTrip): string {
    const { status, checkedAt } = state.activeTripRefresh;
    return status === 'no-longer-offered' && checkedAt
      ? laterOf(trip.plannedAt, checkedAt)
      : trip.plannedAt;
  }

  // Plans the active trip again, or the rest of it once it has started, and records what changed
  // in `activeTripRefresh`. On resume it waits a minute after the last answer; when the person
  // asks, 30 seconds. Never rejects.
  async function checkActiveTrip(trigger: 'resume' | 'asked'): Promise<CheckOutcome> {
    if (activeTripRun) return { status: 'busy' };
    const run = new AbortController();
    activeTripRun = run;
    try {
      const trip = storage.activeTrip.get();
      const now = clock.now();
      const mode = trips.currentMode();
      const part = trip ? partToCheck(trip, now, mode) : null;
      if (!trip || !part) return { status: 'nothing-to-check' };
      const answeredAt = lastAnsweredAt(trip);
      if (trigger === 'resume') {
        if (!shouldRefreshActiveTripOnResume(trip, now, mode, answeredAt)) {
          return { status: 'nothing-to-check' };
        }
      } else {
        const availability = manualRefreshAvailability(answeredAt, now);
        if (!availability.allowed) {
          return { status: 'too-soon', retryInSeconds: availability.retryInSeconds };
        }
      }
      const tripWithCar = withCurrentCar(trip.request, storage.parkedCar.get());
      // The trip screen asks for Take me home again instead.
      if (!tripWithCar) return { status: 'car-changed' };
      const request =
        part.kind === 'whole-trip'
          ? refreshableRequest(tripWithCar, now)
          : restOfTripRequest(tripWithCar, part.leg, now);
      setState({ activeTripRefresh: { ...IDLE_ACTIVE_TRIP_REFRESH, status: 'refreshing' } });
      const response = await trips.planTrip(request, { signal: run.signal });
      // Ignore the answer if the session was reset or the person chose another trip meanwhile.
      if (run.signal.aborted || storage.activeTrip.get() !== trip) return { status: 'checked' };
      const checkedAt = toIso(clock.now());
      const match =
        part.kind === 'whole-trip'
          ? matchItinerary(trip.itinerary, response.itineraries)
          : matchRestOfTrip(trip.itinerary, part.legIndex, response.itineraries);
      if (!match) {
        setState({
          activeTripRefresh: {
            status: 'no-longer-offered',
            error: null,
            alternatives: response.itineraries,
            request,
            previous: null,
            checkedAt,
          },
        });
        return { status: 'checked' };
      }
      storage.activeTrip.start({
        // Only the rest was planned, but the trip followed is still the whole one.
        request: part.kind === 'whole-trip' ? request : tripWithCar,
        itinerary: match.itinerary,
        plannedAt: checkedAt,
        mode: response.mode,
      });
      setState({
        activeTripRefresh: {
          status: match.exact ? 'updated' : 'replaced',
          error: null,
          alternatives: [],
          request: null,
          previous: match.exact ? null : trip.itinerary,
          checkedAt,
        },
      });
      return { status: 'checked' };
    } catch (error) {
      if (run.signal.aborted) return { status: 'checked' };
      const apiError = toApiError(error);
      if (apiError.kind === 'unexpected') reportUnexpected(apiError);
      setState({
        activeTripRefresh: {
          status: 'failed',
          error: apiError,
          alternatives: [],
          request: null,
          previous: null,
          checkedAt: toIso(clock.now()),
        },
      });
      return { status: 'checked' };
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
      let next: PlanRequest | null;
      try {
        next = replanRequest(request, storage.parkedCar.get(), now);
      } catch (error) {
        // An unreadable parked car fails the refresh like any other error, so it never rejects.
        return fail(error);
      }
      if (!next) return { status: 'car-changed' };
      const availability = manualRefreshAvailability(plannedAt, now);
      if (!availability.allowed) {
        return { status: 'too-soon', retryInSeconds: availability.retryInSeconds };
      }
      const run = beginRun();
      setState({ status: response ? 'refreshing' : 'planning', error: null });
      return runPlan(next, run);
    },
    select: (itineraryId) => {
      const { request, response, plannedAt } = state;
      const itinerary = response?.itineraries.find((candidate) => candidate.id === itineraryId);
      if (!request || !response || !plannedAt || !itinerary) return null;
      storage.activeTrip.start({ request, itinerary, plannedAt, mode: response.mode });
      setState({ selectedItineraryId: itineraryId, activeTripRefresh: IDLE_ACTIVE_TRIP_REFRESH });
      return itinerary;
    },
    refreshActiveTrip: async () => {
      await checkActiveTrip('resume');
    },
    checkActiveTrip: () => checkActiveTrip('asked'),
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

// True while anything on screen may be sample data: demo mode is on, or the API itself answered
// in demo mode (HOPREADY_MODE=demo, for local end-to-end runs). Its latest answer covers searches
// and car park lists; the plan results and followed trip keep the mode they were planned in.
export function useShowsDemoData(): boolean {
  const { demoMode } = useSettings();
  const { response } = usePlanSession();
  const activeTrip = useActiveTrip();
  const apiMode = useApiAnswerMode();
  return demoMode || apiMode === 'demo' || response?.mode === 'demo' || activeTrip?.mode === 'demo';
}
