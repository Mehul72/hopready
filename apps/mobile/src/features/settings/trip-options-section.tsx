import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Card, ListRow } from '@/components';
import { usePlanChoices } from '@/features/plan/plan-choices';
import { tripOptionsSummary } from '@/features/plan/trip-option-settings';
import { usePreferences } from '@/storage';

// One editor for the limits, buffers, walking speed, modes and preferred stops, shared with the
// Plan tab, so two screens can never disagree about a value or what it means.
export function TripOptionsSection() {
  const router = useRouter();
  const preferences = usePreferences();
  const choices = usePlanChoices();

  return (
    <Card padded={false} style={styles.card} testID="trip-options-section">
      <ListRow
        title="Trip options"
        subtitle={tripOptionsSummary(preferences, choices)}
        leadingSymbol="slider.horizontal.3"
        onPress={() => router.navigate('/trip-options')}
        accessibilityHint="Opens the trip options, the same ones as on the Plan tab"
        testID="trip-options-row"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
