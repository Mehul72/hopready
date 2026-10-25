import {
  DEFAULT_PREFERENCES,
  type Preferences,
  TRANSIT_MODES,
  type TransitMode,
  WALKING_SPEEDS,
} from '@hopready/core';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Button, Chip, SegmentedControl, Stepper } from '@/components';
import { type AppPreferences, appStorage, usePreferences } from '@/storage';
import { LEG_VISUALS, RADII, SPACING, useTheme } from '@/theme';

import { writeOrAlert } from '../saved/storage-writes';
import { SettingsSection } from './settings-section';

type MinutesSetting = Exclude<keyof Preferences, 'walkingSpeed' | 'excludedTransitModes'>;

interface MinutesControl {
  setting: MinutesSetting;
  label: string;
  explanation: string;
  // The planner's limits (core preferencesSchema).
  min: number;
  max: number;
  step: number;
}

// Plain explanations of each default. Buffers are applied once each, never stacked on a provider's
// own estimate (docs/design/routing.md, "Buffers, applied once").
export const MINUTES_CONTROLS: readonly MinutesControl[] = [
  {
    setting: 'maxDriveMinutes',
    label: 'Longest drive',
    explanation: 'The most you want to drive, to a car park or station or all the way.',
    min: 5,
    max: 120,
    step: 5,
  },
  {
    setting: 'maxWalkMinutes',
    label: 'Longest walk',
    explanation: 'The longest single walk HopReady will plan.',
    min: 1,
    max: 60,
    step: 1,
  },
  {
    setting: 'parkingBufferMinutes',
    label: 'Parking buffer',
    explanation:
      'Time from reaching the car park to walking out of it: finding a space, parking and getting to the exit.',
    min: 0,
    max: 30,
    step: 1,
  },
  {
    setting: 'dropOffBufferMinutes',
    label: 'Drop-off buffer',
    explanation: 'Time to get out of the car and head for the platform after a drop-off.',
    min: 0,
    max: 15,
    step: 1,
  },
  {
    setting: 'transferBufferMinutes',
    label: 'Transfer buffer',
    explanation:
      'The least time between arriving on one service and the next one leaving, including any walk between them. It is counted once, not added to the walk.',
    min: 0,
    max: 20,
    step: 1,
  },
  {
    setting: 'carRetrievalBufferMinutes',
    label: 'Car retrieval buffer',
    explanation: 'Time from reaching your car to driving off on the way home.',
    min: 0,
    max: 30,
    step: 1,
  },
];

const WALKING_SPEED_LABELS: Readonly<Record<Preferences['walkingSpeed'], string>> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};
const WALKING_SPEED_OPTIONS = WALKING_SPEEDS.map((speed) => ({
  value: speed,
  label: WALKING_SPEED_LABELS[speed],
}));

function minutesPatch(setting: MinutesSetting, value: number): Partial<AppPreferences> {
  const patch: Partial<AppPreferences> = {};
  patch[setting] = value;
  return patch;
}

// "leave out bus services", and "other services" rather than "other service services".
function servicesName(mode: TransitMode): string {
  return mode === 'other' ? 'other' : LEG_VISUALS[mode].label.toLowerCase();
}

function savePreferences(patch: Partial<AppPreferences>) {
  writeOrAlert(() => appStorage.preferences.change(patch), "Couldn't save this setting");
}

function toggleMode(current: readonly TransitMode[], mode: TransitMode, avoid: boolean) {
  const without = current.filter((excluded) => excluded !== mode);
  savePreferences({ excludedTransitModes: avoid ? [...without, mode] : without });
}

function resetToDefaults() {
  Alert.alert(
    'Reset trip defaults?',
    'Limits, buffers, walking speed and modes go back to how HopReady started.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () =>
          savePreferences({
            ...DEFAULT_PREFERENCES,
            excludedTransitModes: [...DEFAULT_PREFERENCES.excludedTransitModes],
          }),
      },
    ],
  );
}

// The saved defaults every plan starts from. Trip options on the Plan tab edit the same values.
export function TripDefaultsSection() {
  const { colours, modeColours } = useTheme();
  const preferences = usePreferences();

  return (
    <SettingsSection
      title="Trip defaults"
      description="HopReady plans every trip with these. Trip options on the Plan tab change the same settings."
      testID="trip-defaults">
      <View style={[styles.group, { backgroundColor: colours.surface }]}>
        {MINUTES_CONTROLS.map((control) => (
          <View key={control.setting}>
            <Stepper
              label={control.label}
              value={preferences[control.setting]}
              min={control.min}
              max={control.max}
              step={control.step}
              accessibilityHint={control.explanation}
              onChange={(value) => savePreferences(minutesPatch(control.setting, value))}
            />
            {/* VoiceOver already hears this as the stepper's hint. */}
            <AppText
              variant="footnote"
              tone="secondary"
              importantForAccessibility="no"
              accessibilityElementsHidden
              style={styles.explanation}>
              {control.explanation}
            </AppText>
          </View>
        ))}
      </View>

      <AppText variant="headline" style={styles.subheading}>
        Walking speed
      </AppText>
      <SegmentedControl
        accessibilityLabel="Walking speed"
        options={WALKING_SPEED_OPTIONS}
        value={preferences.walkingSpeed}
        onChange={(walkingSpeed) => savePreferences({ walkingSpeed })}
      />
      <AppText variant="footnote" tone="secondary">
        Walking times in public transport trips are adjusted to your pace.
      </AppText>

      <AppText variant="headline" style={styles.subheading}>
        Modes to avoid
      </AppText>
      <View style={styles.chips}>
        {TRANSIT_MODES.map((mode) => {
          const avoided = preferences.excludedTransitModes.includes(mode);
          return (
            <Chip
              key={mode}
              label={LEG_VISUALS[mode].label}
              symbol={LEG_VISUALS[mode].symbol}
              symbolTint={avoided ? undefined : modeColours[mode]}
              selected={avoided}
              accessibilityHint={`When ticked, trips leave out ${servicesName(mode)} services`}
              onToggle={(avoid) => toggleMode(preferences.excludedTransitModes, mode, avoid)}
            />
          );
        })}
      </View>

      <View style={styles.reset}>
        <Button variant="plain" label="Reset to defaults" onPress={resetToDefaults} />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: RADII.lg,
    paddingVertical: SPACING.xs,
  },
  explanation: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  subheading: {
    paddingTop: SPACING.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  reset: {
    alignItems: 'flex-start',
  },
});
