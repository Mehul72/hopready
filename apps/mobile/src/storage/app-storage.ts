import { type ActiveTripStore, createActiveTripStore } from './active-trip';
import type { KeyValueBackend } from './backend';
import { createFavouriteRoutesStore, type FavouriteRoutesStore } from './favourite-routes';
import { createParkedCarStore, type ParkedCarStore } from './parked-car';
import { createParkingSpotsStore, type ParkingSpotsStore } from './parking-spots';
import { createPlacesStore, type PlacesStore } from './places';
import { createPreferencesStore, type PreferencesStore } from './preferences';
import { createRecentRequestsStore, type RecentRequestsStore } from './recent-requests';
import { createSettingsStore, type SettingsStore } from './settings';
import { STORAGE_KEY_PREFIX, StorageError } from './stored-value';

export interface AppStorage {
  preferences: PreferencesStore;
  places: PlacesStore;
  favouriteRoutes: FavouriteRoutesStore;
  recentRequests: RecentRequestsStore;
  parkedCar: ParkedCarStore;
  parkingSpots: ParkingSpotsStore;
  activeTrip: ActiveTripStore;
  settings: SettingsStore;
  // Removes every HopReady key, then starts afresh with a new install ID.
  deleteAllData: () => void;
  // For state that lives outside storage (the plan session, cached queries) and must go too.
  onDataDeleted: (listener: () => void) => () => void;
}

export function createAppStorage(backend: KeyValueBackend, createId: () => string): AppStorage {
  const activeTrip = createActiveTripStore(backend);
  const stores = {
    preferences: createPreferencesStore(backend),
    places: createPlacesStore(backend, createId),
    favouriteRoutes: createFavouriteRoutesStore(backend, createId),
    recentRequests: createRecentRequestsStore(backend),
    parkedCar: createParkedCarStore(backend),
    parkingSpots: createParkingSpotsStore(backend, createId),
    activeTrip,
    settings: createSettingsStore(backend, { createId, activeTrip }),
  };
  const deletionListeners = new Set<() => void>();

  function removeEveryKey() {
    try {
      for (const key of backend.getAllKeys()) {
        if (key.startsWith(STORAGE_KEY_PREFIX)) backend.removeItem(key);
      }
    } catch (error) {
      throw new StorageError('Could not delete all data', { cause: error });
    }
  }

  return {
    ...stores,
    deleteAllData: () => {
      try {
        removeEveryKey();
      } finally {
        // Even after a partial failure, screens must show what is really left on disk.
        for (const store of Object.values(stores)) store.dropCachedValue();
      }
      // Reading settings saves a fresh install ID, so the old one is never sent again.
      stores.settings.get();
      for (const listener of [...deletionListeners]) listener();
    },
    onDataDeleted: (listener) => {
      deletionListeners.add(listener);
      return () => {
        deletionListeners.delete(listener);
      };
    },
  };
}
