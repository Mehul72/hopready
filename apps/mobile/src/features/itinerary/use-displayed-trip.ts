import type { Itinerary, PlanRequest } from '@hopready/core';

import { type ActiveTripRefresh, type PlanSessionState, usePlanSession } from '@/state';
import { type ActiveTrip, useActiveTrip } from '@/storage';

import { isFollowedTripOver } from './followed-trip-window';
import { useCurrentMinute } from './use-current-minute';

export interface DisplayedTrip {
  itinerary: Itinerary;
  // The search it came from, for saving the route. Null only if the session lost it.
  request: PlanRequest | null;
  // When these times arrived, from the search or the latest check of the followed trip.
  plannedAt: string | null;
  mode: 'live' | 'demo';
  // The person chose to follow this trip; it is refreshed when the app comes back.
  isActive: boolean;
  // Still among the latest results, so it can be started from here.
  inResults: boolean;
  activeTripRefresh: ActiveTripRefresh;
}

function followedTrip(activeTrip: ActiveTrip, session: PlanSessionState): DisplayedTrip {
  return {
    itinerary: activeTrip.itinerary,
    request: activeTrip.request,
    plannedAt: activeTrip.plannedAt,
    mode: activeTrip.mode,
    isActive: true,
    inResults: false,
    activeTripRefresh: session.activeTripRefresh,
  };
}

export function findDisplayedTrip(
  itineraryId: string,
  session: PlanSessionState,
  storedTrip: ActiveTrip | null,
  nowMs: number,
): DisplayedTrip | null {
  const { response, request, activeTripRefresh } = session;
  // Ids describe an option, not a day: yesterday's followed drive has the same id as today's.
  const activeTrip = storedTrip && !isFollowedTripOver(storedTrip, nowMs) ? storedTrip : null;
  // A refresh moved the followed trip to another run of the same option. A screen still open on
  // the old run follows the new one, even if the old run is in the results, and the status
  // banner says what changed.
  if (
    activeTrip &&
    activeTripRefresh.status === 'replaced' &&
    activeTripRefresh.previous?.id === itineraryId
  ) {
    return followedTrip(activeTrip, session);
  }

  const fromResults = response?.itineraries.find((itinerary) => itinerary.id === itineraryId);
  // The newer copy wins. A check on resume stores fresher live times under the same id, while a
  // pull to refresh on the results makes the search the newer one.
  if (activeTrip?.itinerary.id === itineraryId) {
    const resultsAreNewer =
      fromResults !== undefined &&
      session.plannedAt !== null &&
      Date.parse(session.plannedAt) > Date.parse(activeTrip.plannedAt);
    if (!resultsAreNewer) {
      return { ...followedTrip(activeTrip, session), inResults: Boolean(fromResults) };
    }
  }
  if (response && fromResults) {
    return {
      itinerary: fromResults,
      request,
      plannedAt: session.plannedAt,
      mode: response.mode,
      isActive: activeTrip?.itinerary.id === itineraryId,
      inResults: true,
      activeTripRefresh,
    };
  }
  return activeTrip?.itinerary.id === itineraryId ? followedTrip(activeTrip, session) : null;
}

// The itinerary for itinerary/[id]: from the latest results, or the trip being followed.
export function useDisplayedTrip(itineraryId: string): DisplayedTrip | null {
  const session = usePlanSession();
  const activeTrip = useActiveTrip();
  const nowMs = useCurrentMinute();
  return findDisplayedTrip(itineraryId, session, activeTrip, nowMs);
}
