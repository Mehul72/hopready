import type { Coordinate, SavedParkingSpot } from '@hopready/core';

import type { KeyValueBackend } from './backend';
import { type AddResult, isSameSpot, replaceById } from './collections';
import { MAX_SAVED_PARKING_SPOTS, savedParkingSpotsSchema } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

// Spots the person chose to park at themselves. The planner treats them as candidates with unknown
// rules and occupancy, never as documented Park&Ride car parks.
export interface ParkingSpotsStore extends ManagedStoredValue<SavedParkingSpot[]> {
  add: (name: string, coordinate: Coordinate) => AddResult<SavedParkingSpot>;
  rename: (id: string, name: string) => boolean;
  remove: (id: string) => boolean;
}

export function createParkingSpotsStore(
  backend: KeyValueBackend,
  createId: () => string,
): ParkingSpotsStore {
  const stored = createStoredValue(backend, {
    name: 'parking-spots',
    version: 1,
    schema: savedParkingSpotsSchema,
    defaultValue: (): SavedParkingSpot[] => [],
  });

  return {
    ...stored,
    add: (name, coordinate) => {
      const current = stored.get();
      const existing = current.find((spot) => isSameSpot(spot.coordinate, coordinate));
      if (existing) return { status: 'already-saved', item: existing };
      if (current.length >= MAX_SAVED_PARKING_SPOTS) {
        return { status: 'limit-reached', limit: MAX_SAVED_PARKING_SPOTS };
      }
      const item: SavedParkingSpot = { id: createId(), name: name.trim(), coordinate };
      stored.set([...current, item]);
      return { status: 'added', item };
    },
    rename: (id, name) => {
      const spots = replaceById(stored.get(), id, (spot) => ({ ...spot, name: name.trim() }));
      if (!spots) return false;
      stored.set(spots);
      return true;
    },
    remove: (id) => {
      const current = stored.get();
      const spots = current.filter((spot) => spot.id !== id);
      if (spots.length === current.length) return false;
      stored.set(spots);
      return true;
    },
  };
}
