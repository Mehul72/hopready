import type { PlanRequest, SavedParkingSpot } from '@hopready/core';
import { useSyncExternalStore } from 'react';

import { appStorage } from './instance';
import type {
  ActiveTrip,
  AppPreferences,
  FavouriteRoute,
  ParkedCarState,
  SavedPlaces,
} from './schemas';
import type { AppSettings } from './settings';
import type { StoredValue } from './stored-value';

// Re-renders the caller whenever the stored value changes, from any screen.
export function useStoredValue<T>(store: StoredValue<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function usePreferences(): AppPreferences {
  return useStoredValue(appStorage.preferences);
}

export function useSavedPlaces(): SavedPlaces {
  return useStoredValue(appStorage.places);
}

export function useFavouriteRoutes(): FavouriteRoute[] {
  return useStoredValue(appStorage.favouriteRoutes);
}

export function useRecentRequests(): PlanRequest[] {
  return useStoredValue(appStorage.recentRequests);
}

export function useParkedCar(): ParkedCarState {
  return useStoredValue(appStorage.parkedCar);
}

export function useSavedParkingSpots(): SavedParkingSpot[] {
  return useStoredValue(appStorage.parkingSpots);
}

export function useActiveTrip(): ActiveTrip | null {
  return useStoredValue(appStorage.activeTrip);
}

export function useSettings(): AppSettings {
  return useStoredValue(appStorage.settings);
}
