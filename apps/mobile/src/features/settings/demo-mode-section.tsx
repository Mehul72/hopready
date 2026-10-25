import { DEMO_SCENARIOS, type DemoScenario } from '@hopready/core/fixtures';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { readDemoScenariosAllowed } from '@/api';
import { AppText, Banner } from '@/components';
import { appStorage, useSettings } from '@/storage';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

import { writeOrAlert } from '../saved/storage-writes';
import { ChoiceRow } from './choice-row';
import { SettingsSection } from './settings-section';

const demoScenariosAllowed = readDemoScenariosAllowed();

export const DEMO_MODE_EXPLANATION =
  "Demo mode plans trips with sample timetables, drive times and car park spaces built into the app. None of it is live, so don't use it to catch a real service.";

function applyDemoMode(enabled: boolean) {
  writeOrAlert(
    () => appStorage.settings.setDemoMode(enabled),
    enabled ? "Couldn't turn on demo mode" : "Couldn't turn off demo mode",
  );
}

// Switching modes drops a trip planned in the other mode (src/storage/settings.ts), so the person
// is asked first when that would happen.
function changeDemoMode(enabled: boolean) {
  const activeTrip = appStorage.activeTrip.get();
  if (!activeTrip || activeTrip.mode === (enabled ? 'demo' : 'live')) {
    applyDemoMode(enabled);
    return;
  }
  Alert.alert(
    enabled ? 'Turn on demo mode?' : 'Turn off demo mode?',
    enabled
      ? 'The trip you are following uses live data, so HopReady will stop following it.'
      : 'The trip you are following uses sample data, so HopReady will stop following it.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: enabled ? 'Turn on' : 'Turn off', onPress: () => applyDemoMode(enabled) },
    ],
  );
}

export function DemoModeSection() {
  const { colours } = useTheme();
  const { demoMode, demoScenario } = useSettings();
  const selectedScenario = demoScenario ?? 'normal';

  return (
    <SettingsSection title="Demo mode" testID="demo-mode">
      <View style={[styles.switchRow, { backgroundColor: colours.surface }]}>
        <AppText
          style={styles.switchLabel}
          importantForAccessibility="no"
          accessibilityElementsHidden>
          Demo mode
        </AppText>
        <Switch
          accessibilityLabel="Demo mode"
          accessibilityHint="Uses sample data instead of live information"
          value={demoMode}
          onValueChange={changeDemoMode}
          trackColor={{ true: colours.brand }}
        />
      </View>
      <AppText tone="secondary">{DEMO_MODE_EXPLANATION}</AppText>
      {demoMode ? (
        <>
          <Banner
            tone="demo"
            title="Demo mode is on"
            message="Trips, times and car park spaces are sample data, not live information."
          />
          {demoScenariosAllowed ? <ScenarioPicker selected={selectedScenario} /> : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

function ScenarioPicker({ selected }: { selected: DemoScenario }) {
  return (
    <>
      <AppText variant="headline" style={styles.subheading}>
        Sample situation
      </AppText>
      <AppText variant="footnote" tone="secondary">
        Pick what the sample data should show. None of these describe a real disruption.
      </AppText>
      {DEMO_SCENARIOS.map((scenario) => (
        <ChoiceRow
          key={scenario.id}
          title={scenario.title}
          subtitle={scenario.description}
          selected={selected === scenario.id}
          onPress={() => {
            writeOrAlert(
              () => appStorage.settings.setDemoScenario(scenario.id),
              "Couldn't change the sample situation",
            );
          }}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADII.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  switchLabel: {
    flex: 1,
  },
  subheading: {
    paddingTop: SPACING.md,
  },
});
