import type { KeyValueBackend } from './backend';
import { type AppPreferences, appPreferencesSchema, DEFAULT_APP_PREFERENCES } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface PreferencesStore extends ManagedStoredValue<AppPreferences> {
  // Merges the given fields; the result is validated against the planner's limits.
  change: (patch: Partial<AppPreferences>) => AppPreferences;
}

export function createPreferencesStore(backend: KeyValueBackend): PreferencesStore {
  const stored = createStoredValue(backend, {
    name: 'preferences',
    version: 1,
    schema: appPreferencesSchema,
    defaultValue: () => ({
      ...DEFAULT_APP_PREFERENCES,
      excludedTransitModes: [...DEFAULT_APP_PREFERENCES.excludedTransitModes],
    }),
    fillMissingFromDefaults: true,
  });

  return {
    ...stored,
    change: (patch) => stored.update((current) => ({ ...current, ...patch })),
  };
}
