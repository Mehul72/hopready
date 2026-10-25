import {
  floorToMinute,
  isBefore,
  type PlanRequest,
  secondsBetween,
  toIso,
  type TransitLeg,
} from '@hopready/core';

import type { ActiveTrip, ParkedCarState } from '@/storage';

import { PUBLIC_TRANSPORT_ONLY, withCurrentCar } from './return-trip';
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

export type TripPart =
  | { kind: 'whole-trip' }
  // From the stop of `leg`, the first public transport service that has not left yet.
  | { kind: 'rest-of-trip'; legIndex: number; leg: TransitLeg };

// What checking the followed trip plans again. Until it starts, the whole trip. After that,
// planning from its origin could not find it, but someone driving to the car park still needs to
// hear that their metro was cancelled, so the rest of it from the next service. Null once every
// service has left, as nothing is left to check.
export function partToCheck(
  trip: Pick<ActiveTrip, 'itinerary' | 'mode'>,
  now: Date,
  mode: DataMode,
): TripPart | null {
  // A demo trip is never refreshed against live data, or the other way round.
  if (trip.mode !== mode) return null;
  const { itinerary } = trip;
  if (isBefore(now, itinerary.departAt)) return { kind: 'whole-trip' };
  const legIndex = itinerary.legs.findIndex(
    (leg) => leg.kind === 'transit' && isBefore(now, leg.start),
  );
  const leg = itinerary.legs[legIndex];
  return leg?.kind === 'transit' ? { kind: 'rest-of-trip', legIndex, leg } : null;
}

export function shouldRefreshActiveTripOnResume(
  activeTrip: ActiveTrip | null,
  now: Date,
  mode: DataMode,
  // When a check last got an answer, if newer than plannedAt: one that found the trip no longer
  // offered leaves it as it was.
  lastAnsweredAt: string | null = null,
): boolean {
  if (!activeTrip || !partToCheck(activeTrip, now, mode)) return false;
  const age = secondsBetween(lastAnsweredAt ?? activeTrip.plannedAt, now);
  return age > RESUME_REFRESH_MIN_AGE_SECONDS;
}

// The rest of a trip that has started: from the stop of the next service, leaving when it is
// planned to leave, by public transport only. A trip home still ends with the drive from the car.
// Parking choices are left out, as the rest of the trip never parks.
export function restOfTripRequest(request: PlanRequest, leg: TransitLeg): PlanRequest {
  return {
    origin: leg.from,
    destination: request.destination,
    // The planner rounds a leave-at time up to the minute, which would miss a service at 8:12:30.
    time: { type: 'depart', at: floorToMinute(leg.start) },
    access: request.trip.kind === 'outbound' ? PUBLIC_TRANSPORT_ONLY : request.access,
    preferences: request.preferences,
    trip: request.trip,
  };
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
