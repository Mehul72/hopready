export type { ActiveTripStore } from './active-trip';
export { type AppStorage, createAppStorage } from './app-storage';
export { type KeyValueBackend, sqliteBackend } from './backend';
export { type AddResult, isSamePlace, isSameSpot, SAME_PLACE_METRES } from './collections';
export type { DemoScenario } from './demo-scenario';
export type { FavouriteRoutesStore } from './favourite-routes';
export {
  useActiveTrip,
  useFavouriteRoutes,
  useParkedCar,
  usePreferences,
  useRecentRequests,
  useSavedParkingSpots,
  useSavedPlaces,
  useSettings,
  useStoredValue,
} from './hooks';
export { appStorage } from './instance';
export type { ParkedCarStore } from './parked-car';
export type { ParkingSpotsStore } from './parking-spots';
export type { PlacesStore } from './places';
export type { PreferencesStore } from './preferences';
export { recentRequestKey, type RecentRequestsStore } from './recent-requests';
export {
  type ActiveTrip,
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  type FavouritePlace,
  type FavouriteRoute,
  MAX_FAVOURITE_PLACES,
  MAX_FAVOURITE_ROUTES,
  MAX_RECENT_REQUESTS,
  MAX_SAVED_PARKING_SPOTS,
  NAVIGATION_APPS,
  type NavigationApp,
  type ParkedCarState,
  type SavedPlaces,
} from './schemas';
export {
  type AppSettings,
  hasLiveDataConsent,
  LIVE_DATA_CONSENT_VERSION,
  type LiveDataConsent,
  type SettingsStore,
} from './settings';
export { STORAGE_KEY_PREFIX, StorageError, type StoredValue } from './stored-value';
