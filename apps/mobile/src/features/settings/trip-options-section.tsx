import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Card, ListRow } from '@/components';
import { usePlanChoices } from '@/features/plan/plan-choices';
import { tripOptionsSummary } from '@/features/plan/trip-option-settings';
import { usePreferences } from '@/storage';

import { SettingsSection } from './settings-section';

// One editor for the limits, buffers, walking speed, modes and preferred stops, shared with the
// Plan tab, so two screens can never disagree about a value or what it means.
export function TripOptionsSection() {
  const router = useRouter();
  const preferences = usePreferences();
  const choices = usePlanChoices();

  return (
    <SettingsSection
      title="Trip options"
      description="Limits, buffers, walking speed, modes to avoid and preferred stops. Every new search uses them, and an option over a limit is shown with a note rather than hidden."
      testID="trip-options-section">
      <Card padded={false} style={styles.card}>
        <ListRow
          title="Trip options"
          subtitle={tripOptionsSummary(preferences, choices)}
          leadingSymbol="slider.horizontal.3"
          onPress={() => router.navigate('/trip-options')}
          accessibilityHint="Opens the trip options, the same ones as on the Plan tab"
          testID="trip-options-row"
        />
      </Card>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
