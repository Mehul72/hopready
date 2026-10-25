import { addMinutes, isBefore } from '@hopready/core';

import type { ActiveTrip } from '@/storage';

// Long enough to come back for the trip details after arriving, short enough that yesterday's
// trip is never mistaken for today's.
export const FOLLOWED_TRIP_SHOWN_AFTER_ARRIVAL_MINUTES = 60;

export function isFollowedTripOver(activeTrip: ActiveTrip, nowMs: number): boolean {
  const over = addMinutes(activeTrip.itinerary.arriveAt, FOLLOWED_TRIP_SHOWN_AFTER_ARRIVAL_MINUTES);
  return isBefore(over, new Date(nowMs));
}
