import type { ParkedCar } from '@hopready/core';

import type { KeyValueBackend } from './backend';
import { type ParkedCarState, parkedCarStateSchema } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface ParkedCarStore extends ManagedStoredValue<ParkedCarState> {
  // Only after the person confirms where the car is: "Take me home" routes to exactly this spot.
  markParked: (parkedCar: ParkedCar, carParkName: string | null) => void;
  markDroppedOff: (at: string) => void;
  clear: () => void;
}

export function createParkedCarStore(backend: KeyValueBackend): ParkedCarStore {
  const stored = createStoredValue(backend, {
    name: 'parked-car',
    version: 1,
    schema: parkedCarStateSchema,
    defaultValue: (): ParkedCarState => ({ status: 'none' }),
  });

  return {
    ...stored,
    markParked: (parkedCar, carParkName) => {
      stored.set({ status: 'parked', parkedCar, carParkName });
    },
    markDroppedOff: (at) => {
      stored.set({ status: 'dropped-off', at });
    },
    clear: () => {
      stored.set({ status: 'none' });
    },
  };
}
