import { isBefore, type PlanRequest, secondsBetween, toIso } from '@hopready/core';

import type { ActiveTrip, ParkedCarState } from '@/storage';

import { withCurrentCar } from './return-trip';
import type { DataMode } from './trip-service';

// Each refresh costs provider quota shared by every HopReady user, and times rarely change
// faster than this (docs/design/routing.md, "Refreshing").
export const MANUAL_REFRESH_MIN_INTERVAL_SECONDS = 30;
export const RESUME_REFRESH_MIN_AGE_SECONDS = 60;

export type RefreshAvailability = { allowed: true } | { allowed: false; retryInSeconds: number };

// `lastPlannedAt` is when the shown results arrived. A failed attempt does not count, so
// "Try again" after an error is never blocked.
export function manualRefreshAvailability(
  lastPlannedAt: string | null,
  now: Date,
): RefreshAvailability {
  if (lastPlannedAt === null) return { allowed: true };
  const elapsedSeconds = secondsBetween(lastPlannedAt, now);
  // A clock set backwards would otherwise block refreshing for as long as it was moved.
  if (elapsedSeconds < 0 || elapsedSeconds >= MANUAL_REFRESH_MIN_INTERVAL_SECONDS) {
    return { allowed: true };
  }
  return { allowed: false, retryInSeconds: MANUAL_REFRESH_MIN_INTERVAL_SECONDS - elapsedSeconds };
}

export function shouldRefreshActiveTripOnResume(
  activeTrip: ActiveTrip | null,
  now: Date,
  mode: DataMode,
): boolean {
  if (!activeTrip) return false;
  // A demo trip is never refreshed against live data, or the other way round.
  if (activeTrip.mode !== mode) return false;
  if (secondsBetween(activeTrip.plannedAt, now) <= RESUME_REFRESH_MIN_AGE_SECONDS) return false;
  // Once the trip has started, planning again from its origin cannot find it, so a refresh would
  // only report it as gone.
  return isBefore(now, activeTrip.itinerary.departAt);
}

// A "leave at" time that has passed cannot be planned again (the planner rejects departures in
// the past), so a refresh asks for options from now instead. Arrive-by targets stay as they are.
export function refreshableRequest(request: PlanRequest, now: Date): PlanRequest {
  if (request.time.type !== 'depart' || !isBefore(request.time.at, now)) return request;
  return { ...request, time: { type: 'depart', at: toIso(now) } };
}

// A search planned again: refreshable, and a trip home through the car as it is now. Null when the
// trip home no longer fits the car (see withCurrentCar).
export function replanRequest(
  request: PlanRequest,
  parkedCar: ParkedCarState,
  now: Date,
): PlanRequest | null {
  const current = withCurrentCar(request, parkedCar);
  return current ? refreshableRequest(current, now) : null;
}
