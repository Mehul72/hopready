import { z } from 'zod';

import type { ActiveTripStore } from './active-trip';
import type { KeyValueBackend } from './backend';
import { type DemoScenario, demoScenarioSchema } from './demo-scenario';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

// Bump when what HopReady sends, or who it goes to, changes: everyone is then asked again.
export const LIVE_DATA_CONSENT_VERSION = 1;

const liveDataConsentSchema = z.object({
  version: z.number().int().positive(),
  acceptedAt: z.iso.datetime({ offset: true }),
});
export type LiveDataConsent = z.infer<typeof liveDataConsentSchema>;

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
  // Live mode sends the places a person searches and plans between to HopReady's server, which
  // passes them to Transport for NSW and Apple. Nothing is sent until they agree. A damaged record
  // reads as "not agreed", so the question is asked again rather than assumed.
  liveDataConsent: liveDataConsentSchema.nullable().catch(null),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsStore extends ManagedStoredValue<AppSettings> {
  setDemoMode: (enabled: boolean) => void;
  setDemoScenario: (scenario: DemoScenario | null) => void;
  acceptLiveDataConsent: (at: Date) => void;
  withdrawLiveDataConsent: () => void;
}

// Agreement to an earlier version of the explanation does not cover what the app does now.
export function hasLiveDataConsent(settings: Pick<AppSettings, 'liveDataConsent'>): boolean {
  return settings.liveDataConsent?.version === LIVE_DATA_CONSENT_VERSION;
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
      liveDataConsent: null,
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
    acceptLiveDataConsent: (at) => {
      stored.update((current) => ({
        ...current,
        liveDataConsent: { version: LIVE_DATA_CONSENT_VERSION, acceptedAt: at.toISOString() },
      }));
    },
    withdrawLiveDataConsent: () => {
      stored.update((current) => ({ ...current, liveDataConsent: null }));
    },
  };
}
