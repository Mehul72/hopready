import {
  type Place,
  type PlanRequest,
  type Preferences,
  type SavedParkingSpot,
  toIso,
  type TripKind,
} from '@hopready/core';
import { router } from 'expo-router';

import { planSession } from '@/state';
import {
  type AppPreferences,
  type FavouriteRoute,
  type ParkedCarState,
  recentRequestKey,
} from '@/storage';

type Access = PlanRequest['access'];

// HopReady exists to combine driving and public transport, so shortcuts consider both unless the
// person's latest search for the same trip said otherwise.
export const DEFAULT_ACCESS: Access = { transit: true, drive: true, dropOff: false };
const PUBLIC_TRANSPORT_ONLY: Access = { transit: true, drive: false, dropOff: false };
const VIA_PARKED_CAR: Access = { transit: true, drive: true, dropOff: false };

export interface SavedTripSettings {
  preferences: AppPreferences;
  parkingSpots: readonly SavedParkingSpot[];
}

// The planner's preferences without app-only settings such as the navigation app.
export function planningPreferences(preferences: AppPreferences): Preferences {
  return {
    maxDriveMinutes: preferences.maxDriveMinutes,
    maxWalkMinutes: preferences.maxWalkMinutes,
    parkingBufferMinutes: preferences.parkingBufferMinutes,
    dropOffBufferMinutes: preferences.dropOffBufferMinutes,
    transferBufferMinutes: preferences.transferBufferMinutes,
    carRetrievalBufferMinutes: preferences.carRetrievalBufferMinutes,
    walkingSpeed: preferences.walkingSpeed,
    excludedTransitModes: [...preferences.excludedTransitModes],
  };
}

export interface LeaveNowTrip {
  origin: Place;
  destination: Place;
  access: Access;
  trip: TripKind;
  now: Date;
  extras?: Pick<PlanRequest, 'preferredCarParkId' | 'preferredStop'>;
}

// Shortcuts always plan for leaving now with the saved trip defaults.
export function leaveNowRequest(trip: LeaveNowTrip, saved: SavedTripSettings): PlanRequest {
  const offersOwnParking =
    trip.trip.kind === 'outbound' && trip.access.drive && saved.parkingSpots.length > 0;
  return {
    origin: trip.origin,
    destination: trip.destination,
    time: { type: 'depart', at: toIso(trip.now) },
    access: trip.access,
    preferences: planningPreferences(saved.preferences),
    ...trip.extras,
    ...(offersOwnParking ? { savedParkingSpots: [...saved.parkingSpots] } : {}),
    trip: trip.trip,
  };
}

// Going back after the outbound trip: through the car only when the person confirmed parking it.
// After a drop-off, or with no car recorded, the way back is public transport only.
export function returnTripFor(parkedCar: ParkedCarState): { trip: TripKind; access: Access } {
  switch (parkedCar.status) {
    case 'parked':
      return {
        trip: { kind: 'return-via-car', parkedCar: parkedCar.parkedCar },
        access: VIA_PARKED_CAR,
      };
    case 'dropped-off':
    case 'none':
      return { trip: { kind: 'return-without-car' }, access: PUBLIC_TRANSPORT_ONLY };
  }
}

// A recent search, planned again for now. A trip home follows where the car is today, not where it
// was when the search was first made.
export function repeatRecentRequest(
  recent: PlanRequest,
  parkedCar: ParkedCarState,
  now: Date,
  saved: SavedTripSettings,
): PlanRequest {
  const tripAndAccess =
    recent.trip.kind === 'outbound'
      ? { trip: recent.trip, access: recent.access }
      : returnTripFor(parkedCar);
  // A preferred parking spot deleted since is no preference now, as in Trip options.
  const preferredId = recent.preferredCarParkId;
  const preferredSpotDeleted =
    (recent.savedParkingSpots ?? []).some((spot) => spot.id === preferredId) &&
    !saved.parkingSpots.some((spot) => spot.id === preferredId);
  return leaveNowRequest(
    {
      origin: recent.origin,
      destination: recent.destination,
      ...tripAndAccess,
      now,
      extras: {
        ...(preferredId && !preferredSpotDeleted ? { preferredCarParkId: preferredId } : {}),
        ...(recent.preferredStop ? { preferredStop: recent.preferredStop } : {}),
      },
    },
    saved,
  );
}

// The ways of travelling from the latest search between the same places, if there is one.
export function accessForRoute(
  route: Pick<FavouriteRoute, 'origin' | 'destination'>,
  recents: readonly PlanRequest[],
): Access {
  const matching = recents.find(
    (recent) =>
      recentRequestKey(recent) ===
      recentRequestKey({
        ...recent,
        origin: route.origin,
        destination: route.destination,
        trip: { kind: 'outbound' },
      }),
  );
  return matching?.access ?? DEFAULT_ACCESS;
}

// Starts the search and opens the results screen, which shows progress, errors and options.
// plan() never rejects: its outcome, including failures, lands in the plan session.
export function showResultsFor(request: PlanRequest): void {
  void planSession.plan(request);
  router.push('/results');
}
