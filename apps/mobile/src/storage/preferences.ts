import type { KeyValueBackend } from './backend';
import { type AppPreferences, appPreferencesSchema, DEFAULT_APP_PREFERENCES } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface PreferencesStore extends ManagedStoredValue<AppPreferences> {
  // Merges the given fields; the result is validated against the planner's limits.
  change: (patch: Partial<AppPreferences>) => AppPreferences;
}

// Version 2 leaves school buses out by default, as Transport for NSW's own trip planner does. Trip
// options saved under version 1 kept the old empty list, so they gain the exclusion once; anyone
// who wants school buses turns them back on in Trip options.
function avoidSchoolBuses(previous: unknown): unknown {
  if (typeof previous !== 'object' || previous === null || Array.isArray(previous)) return previous;
  const saved = previous as Record<string, unknown>;
  if (!Array.isArray(saved.excludedTransitModes)) return previous;
  return {
    ...saved,
    excludedTransitModes: [...new Set([...saved.excludedTransitModes, 'school-bus'])],
  };
}

export function createPreferencesStore(backend: KeyValueBackend): PreferencesStore {
  const stored = createStoredValue(backend, {
    name: 'preferences',
    version: 2,
    migrateFrom: { version: 1, migrate: avoidSchoolBuses },
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
