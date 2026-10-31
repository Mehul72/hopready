import {
  DEFAULT_PREFERENCES,
  type Preferences,
  preferencesSchema,
  type TransitMode,
} from '@hopready/core';

import type { AppPreferences } from '@/storage';

import type { PlanChoices } from './plan-choices';

export type MinutesPreference =
  | 'maxDriveMinutes'
  | 'maxWalkMinutes'
  | 'parkingBufferMinutes'
  | 'dropOffBufferMinutes'
  | 'transferBufferMinutes'
  | 'carRetrievalBufferMinutes';

export interface MinutesSetting {
  key: MinutesPreference;
  label: string;
  // One plain line on what the number changes.
  explanation: string;
  min: number;
  max: number;
  step: number;
}

// The planner's own limits, so the steppers can never offer a value the planner would refuse.
function limitsOf(key: MinutesPreference): { min: number; max: number } {
  const field = preferencesSchema.shape[key];
  const { minValue, maxValue } = field;
  if (minValue === null || maxValue === null) {
    throw new Error(`Preference ${key} has no limits in the core schema`);
  }
  return { min: minValue, max: maxValue };
}

function setting(
  key: MinutesPreference,
  label: string,
  explanation: string,
  step = 1,
): MinutesSetting {
  return { key, label, explanation, step, ...limitsOf(key) };
}

export const LIMIT_SETTINGS: readonly MinutesSetting[] = [
  setting(
    'maxDriveMinutes',
    'Longest drive',
    'Car parks further than this are not tried. A longer drive is shown with a note, not hidden.',
    5,
  ),
  setting(
    'maxWalkMinutes',
    'Longest walk',
    'Sent to Transport for NSW as a preference. An option with a longer single walk is shown with a note, not hidden.',
  ),
];

export const BUFFER_SETTINGS: readonly MinutesSetting[] = [
  setting(
    'parkingBufferMinutes',
    'Parking time',
    'Time to find a space and leave the car park before walking to the station. Added once.',
  ),
  setting(
    'dropOffBufferMinutes',
    'Drop-off time',
    'Time to get out of the car and away from the kerb before walking on. Added once.',
  ),
  setting(
    'transferBufferMinutes',
    'Transfer time',
    'The least time between arriving on one service and the next one leaving, including any walk between them. Applied once, never on top of the walk.',
  ),
  setting(
    'carRetrievalBufferMinutes',
    'Back at the car',
    'Time from reaching your parked car to driving off, on trips home. Added once.',
  ),
];

export const WALKING_SPEED_OPTIONS = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
] as const satisfies readonly { value: Preferences['walkingSpeed']; label: string }[];

// Modes a person might reasonably avoid. "Other" covers services Transport for NSW cannot
// classify, so avoiding it would hide trips for no reason the person could know.
export const AVOIDABLE_MODES: readonly TransitMode[] = [
  'train',
  'metro',
  'light-rail',
  'bus',
  'coach',
  'ferry',
  'school-bus',
  'on-demand',
];

// Resetting trip options leaves app-only settings, such as the navigation app, as they are.
export function defaultTripPreferences(): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    excludedTransitModes: [...DEFAULT_PREFERENCES.excludedTransitModes],
  };
}

export function tripOptionsSummary(
  preferences: AppPreferences,
  choices: Pick<PlanChoices, 'preferredStation' | 'preferredCarPark'>,
): string {
  const parts = [
    `Drive up to ${preferences.maxDriveMinutes} min`,
    `walk up to ${preferences.maxWalkMinutes} min`,
    `${preferences.transferBufferMinutes} min to change`,
  ];
  // A stored mode that can no longer be chosen (such as "Other", from an earlier version) is not
  // counted, because Trip options would show nothing ticked for it. School buses are left out by
  // default, so only allowing them is worth a mention.
  const avoidedCount = AVOIDABLE_MODES.filter(
    (mode) => mode !== 'school-bus' && preferences.excludedTransitModes.includes(mode),
  ).length;
  if (avoidedCount > 0) {
    parts.push(`avoiding ${avoidedCount} ${avoidedCount === 1 ? 'mode' : 'modes'}`);
  }
  if (!preferences.excludedTransitModes.includes('school-bus')) {
    parts.push('school buses allowed');
  }
  if (choices.preferredStation) parts.push(`prefers ${choices.preferredStation.name}`);
  if (choices.preferredCarPark) parts.push(`prefers ${choices.preferredCarPark.name}`);
  return parts.join(', ');
}
