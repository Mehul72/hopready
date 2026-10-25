import { z } from 'zod';

import type { ActiveTripStore } from './active-trip';
import type { KeyValueBackend } from './backend';
import { type DemoScenario, demoScenarioSchema } from './demo-scenario';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export const appSettingsSchema = z.object({
  // Off until the person turns it on. Live mode never switches to demo data by itself.
  demoMode: z.boolean(),
  // Null runs the fixtures' default scenario. A scenario a later release no longer has falls back
  // to the default, rather than resetting every setting.
  demoScenario: demoScenarioSchema.nullable().catch(null),
  // A random identifier sent with API requests so the server can rate limit per install without
  // accounts. It is not tied to the person and is replaced when they delete all data. The server
  // only accepts version 4 UUIDs, so anything else is treated as corrupt and replaced.
  installId: z.uuidv4(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsStore extends ManagedStoredValue<AppSettings> {
  setDemoMode: (enabled: boolean) => void;
  setDemoScenario: (scenario: DemoScenario | null) => void;
}

export function createSettingsStore(
  backend: KeyValueBackend,
  dependencies: { createId: () => string; activeTrip: ActiveTripStore },
): SettingsStore {
  const stored = createStoredValue(backend, {
    name: 'settings',
    version: 1,
    schema: appSettingsSchema,
    defaultValue: (): AppSettings => ({
      demoMode: false,
      demoScenario: null,
      installId: dependencies.createId(),
    }),
    fillMissingFromDefaults: true,
    persistDefault: true,
  });

  return {
    ...stored,
    setDemoMode: (enabled) => {
      const current = stored.get();
      if (current.demoMode === enabled) return;
      // A trip planned in the other mode would otherwise be shown, or refreshed, as if it were
      // this mode's data.
      const activeTrip = dependencies.activeTrip.get();
      if (activeTrip && activeTrip.mode !== (enabled ? 'demo' : 'live')) {
        dependencies.activeTrip.clear();
      }
      stored.set({ ...current, demoMode: enabled });
    },
    setDemoScenario: (scenario) => {
      stored.update((current) => ({ ...current, demoScenario: scenario }));
    },
  };
}
