import { type Place, placeSchema } from '@hopready/core';
import { z } from 'zod';

import { appStorage, type KeyValueBackend, sqliteBackend, useStoredValue } from '@/storage';
import { createStoredValue, type StoredValue } from '@/storage/stored-value';

// Planning choices the person expects the app to remember between launches, beyond the
// planner preferences that foundation storage already keeps.
const accessSchema = z.object({ transit: z.boolean(), drive: z.boolean(), dropOff: z.boolean() });
export type TravelAccess = z.infer<typeof accessSchema>;

const preferredCarParkSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
});
export type PreferredCarPark = z.infer<typeof preferredCarParkSchema>;

const planChoicesSchema = z.object({
  access: accessSchema,
  // A stop from Transport for NSW stop search, so storing it is not storing Apple map data.
  preferredStation: placeSchema.nullable(),
  preferredCarPark: preferredCarParkSchema.nullable(),
});
export type PlanChoices = z.infer<typeof planChoicesSchema>;

// HopReady exists to combine driving with public transport, so both start switched on.
export const DEFAULT_PLAN_CHOICES: PlanChoices = {
  access: { transit: true, drive: true, dropOff: false },
  preferredStation: null,
  preferredCarPark: null,
};

export interface PlanChoicesStore extends StoredValue<PlanChoices> {
  setAccess: (change: Partial<TravelAccess>) => void;
  setPreferredStation: (station: Place | null) => void;
  setPreferredCarPark: (carPark: PreferredCarPark | null) => void;
}

export function createPlanChoicesStore(
  backend: KeyValueBackend,
  onDataDeleted: (listener: () => void) => () => void,
): PlanChoicesStore {
  const stored = createStoredValue(backend, {
    name: 'plan-choices',
    version: 1,
    schema: planChoicesSchema,
    defaultValue: (): PlanChoices => ({
      ...DEFAULT_PLAN_CHOICES,
      access: { ...DEFAULT_PLAN_CHOICES.access },
    }),
    fillMissingFromDefaults: true,
  });
  // "Delete all data" removes the key with every other HopReady key; this drops the copy in memory.
  onDataDeleted(() => stored.dropCachedValue());

  return {
    name: stored.name,
    key: stored.key,
    get: stored.get,
    set: stored.set,
    update: stored.update,
    subscribe: stored.subscribe,
    setAccess: (change) => {
      stored.update((current) => ({ ...current, access: { ...current.access, ...change } }));
    },
    setPreferredStation: (station) => {
      stored.update((current) => ({ ...current, preferredStation: station }));
    },
    setPreferredCarPark: (carPark) => {
      stored.update((current) => ({ ...current, preferredCarPark: carPark }));
    },
  };
}

export const planChoices = createPlanChoicesStore(sqliteBackend, appStorage.onDataDeleted);

export function usePlanChoices(): PlanChoices {
  return useStoredValue(planChoices);
}
