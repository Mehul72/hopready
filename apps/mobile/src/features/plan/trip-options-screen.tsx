import type { Preferences, TransitMode } from '@hopready/core';
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  Chip,
  ListRow,
  Screen,
  SegmentedControl,
  Stepper,
} from '@/components';
import { appStorage, usePreferences } from '@/storage';
import { LEG_VISUALS, SPACING, useTheme } from '@/theme';

import { CarParkPicker } from './car-park-picker';
import { closeSheet } from './close-sheet';
import { planChoices, type PreferredCarPark, usePlanChoices } from './plan-choices';
import {
  AVOIDABLE_MODES,
  BUFFER_SETTINGS,
  defaultTripPreferences,
  LIMIT_SETTINGS,
  type MinutesPreference,
  type MinutesSetting,
  WALKING_SPEED_OPTIONS,
} from './trip-option-settings';

export const RESET_CONFIRMATION_TITLE = 'Reset trip options?';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

function minutesPatch(key: MinutesPreference, minutes: number): Partial<Preferences> {
  const patch: Partial<Preferences> = {};
  patch[key] = minutes;
  return patch;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="headline" accessibilityRole="header">
        {title}
      </AppText>
      {note ? (
        <AppText variant="footnote" tone="secondary">
          {note}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

function MinutesStepper({
  setting,
  value,
  onChange,
}: {
  setting: MinutesSetting;
  value: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <Card padded={false} style={styles.clipped}>
      <Stepper
        label={setting.label}
        value={value}
        min={setting.min}
        max={setting.max}
        step={setting.step}
        onChange={onChange}
        accessibilityHint={setting.explanation}
        testID={`stepper-${setting.key}`}
      />
      <AppText variant="footnote" tone="secondary" style={styles.explanation}>
        {setting.explanation}
      </AppText>
    </Card>
  );
}

// Changes save as they are made, like the iOS Settings app, so closing the sheet never loses one.
export function TripOptionsScreen() {
  const router = useRouter();
  const { colours } = useTheme();
  const preferences = usePreferences();
  const choices = usePlanChoices();
  const [saveFailed, setSaveFailed] = useState(false);
  const [choosingCarPark, setChoosingCarPark] = useState(false);

  function save(write: () => void): boolean {
    try {
      write();
      setSaveFailed(false);
      return true;
    } catch (error) {
      console.warn(`HopReady: could not save trip options (${errorName(error)}).`);
      setSaveFailed(true);
      return false;
    }
  }

  function changePreferences(patch: Partial<Preferences>) {
    save(() => {
      appStorage.preferences.change(patch);
    });
  }

  const avoided = preferences.excludedTransitModes;
  const allowedCount = AVOIDABLE_MODES.filter((mode) => !avoided.includes(mode)).length;

  function setAvoided(mode: TransitMode, avoid: boolean) {
    changePreferences({
      excludedTransitModes: avoid
        ? [...avoided.filter((existing) => existing !== mode), mode]
        : avoided.filter((existing) => existing !== mode),
    });
  }

  function chooseCarPark(carPark: PreferredCarPark | null) {
    save(() => planChoices.setPreferredCarPark(carPark));
    setChoosingCarPark(false);
  }

  function resetToDefaults() {
    const reset = save(() => {
      appStorage.preferences.change(defaultTripPreferences());
      planChoices.setPreferredStation(null);
      planChoices.setPreferredCarPark(null);
    });
    setChoosingCarPark(false);
    if (reset) AccessibilityInfo.announceForAccessibility('Trip options are back to the defaults.');
  }

  function confirmReset() {
    Alert.alert(
      RESET_CONFIRMATION_TITLE,
      'Limits, buffers, walking speed, modes to avoid and your preferred station and car park go back to the defaults.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetToDefaults },
      ],
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Done"
          onPress={() => closeSheet(router)}
          fullWidth
          testID="trip-options-done"
        />
      }
      testID="trip-options-screen">
      <AppText variant="footnote" tone="secondary">
        Changes are saved as you make them and apply to your next search.
      </AppText>
      {saveFailed ? (
        <Banner tone="error" message="Couldn't save that change. Try again." announce />
      ) : null}

      <Section title="Limits">
        {LIMIT_SETTINGS.map((setting) => (
          <MinutesStepper
            key={setting.key}
            setting={setting}
            value={preferences[setting.key]}
            onChange={(minutes) => changePreferences(minutesPatch(setting.key, minutes))}
          />
        ))}
      </Section>

      <Section title="Buffers" note="Each buffer is extra time added once, where it applies.">
        {BUFFER_SETTINGS.map((setting) => (
          <MinutesStepper
            key={setting.key}
            setting={setting}
            value={preferences[setting.key]}
            onChange={(minutes) => changePreferences(minutesPatch(setting.key, minutes))}
          />
        ))}
      </Section>

      <Section title="Walking speed" note="Used to time each walk. Slow allows more time.">
        <SegmentedControl
          accessibilityLabel="Walking speed"
          options={WALKING_SPEED_OPTIONS}
          value={preferences.walkingSpeed}
          onChange={(walkingSpeed) => changePreferences({ walkingSpeed })}
          testID="walking-speed"
        />
      </Section>

      <Section
        title="Modes to avoid"
        note="Options that use these are left out. At least one stays allowed. School buses are left out unless you allow them; they run on school days at school times, and anyone with a valid ticket can ride.">
        <View style={styles.chips}>
          {AVOIDABLE_MODES.map((mode) => {
            const isAvoided = avoided.includes(mode);
            return (
              <Chip
                key={mode}
                label={LEG_VISUALS[mode].label}
                symbol={LEG_VISUALS[mode].symbol}
                selected={isAvoided}
                onToggle={(avoid) => setAvoided(mode, avoid)}
                // The last allowed mode cannot be avoided too, or no public transport could be found.
                disabled={!isAvoided && allowedCount <= 1}
                accessibilityHint={
                  isAvoided ? 'Allows this mode again' : 'Leaves out options using it'
                }
                testID={`avoid-${mode}`}
              />
            );
          })}
        </View>
      </Section>

      <Section
        title="Preferred stops"
        note="Tried first when they are within your driving limit. Drop-offs go to the preferred station.">
        <Card padded={false} style={styles.clipped}>
          <ListRow
            title="Preferred station"
            value={choices.preferredStation?.name ?? 'None'}
            leadingSymbol="tram.fill"
            onPress={() =>
              router.navigate({ pathname: '/place-search', params: { field: 'preferred-station' } })
            }
            accessibilityHint="Opens search to choose a station"
            testID="preferred-station"
          />
          <View style={[styles.separator, { backgroundColor: colours.separator }]} />
          <ListRow
            title="Preferred car park"
            value={choices.preferredCarPark?.name ?? 'None'}
            leadingSymbol="parkingsign.circle.fill"
            onPress={() => setChoosingCarPark((current) => !current)}
            accessibilityHint={
              choosingCarPark
                ? 'Hides car parks and your parking spots'
                : 'Shows car parks and your parking spots'
            }
            testID="preferred-car-park"
          />
        </Card>
        {choices.preferredStation ? (
          <Button
            variant="plain"
            label="Remove preferred station"
            onPress={() => save(() => planChoices.setPreferredStation(null))}
          />
        ) : null}
        {choosingCarPark ? (
          <CarParkPicker
            selectedId={choices.preferredCarPark?.id ?? null}
            onSelect={chooseCarPark}
          />
        ) : null}
      </Section>

      <Button
        variant="secondary"
        label="Reset to defaults"
        onPress={confirmReset}
        accessibilityHint="Asks before resetting every trip option"
        testID="reset-trip-options"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  clipped: {
    overflow: 'hidden',
  },
  explanation: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg,
  },
});
