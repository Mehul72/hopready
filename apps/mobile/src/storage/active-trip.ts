import type { KeyValueBackend } from './backend';
import { type ActiveTrip, activeTripSchema } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

// The option the person chose to follow. It survives restarts so the itinerary and the
// refresh-on-resume rule keep working after the app is closed.
export interface ActiveTripStore extends ManagedStoredValue<ActiveTrip | null> {
  start: (trip: ActiveTrip) => void;
  clear: () => void;
}

export function createActiveTripStore(backend: KeyValueBackend): ActiveTripStore {
  const stored = createStoredValue(backend, {
    name: 'active-trip',
    version: 1,
    schema: activeTripSchema,
    defaultValue: (): ActiveTrip | null => null,
  });

  return {
    ...stored,
    start: (trip) => {
      stored.set(trip);
    },
    clear: () => {
      stored.set(null);
    },
  };
}
