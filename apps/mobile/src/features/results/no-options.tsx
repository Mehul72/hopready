import type { PlanResponse, Preferences } from '@hopready/core';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components';
import { SPACING, useTheme } from '@/theme';

import { explainRejections, REMEDY_SUGGESTIONS, type Remedy } from './plan-explanations';

export interface NoOptionsProps {
  response: PlanResponse;
  preferences: Preferences;
  onChangeTripOptions: () => void;
  onChangeTrip: () => void;
}

// Says why nothing came back, in the person's own settings, instead of padding the list with
// options that do not work.
export function NoOptions({
  response,
  preferences,
  onChangeTripOptions,
  onChangeTrip,
}: NoOptionsProps) {
  const { colours } = useTheme();
  const explanations = explainRejections(response.rejected, preferences);
  const remedies: Remedy[] = [
    ...new Set(
      explanations.flatMap((explanation) => (explanation.remedy ? [explanation.remedy] : [])),
    ),
  ];
  const intro =
    explanations.length > 0
      ? 'HopReady found some options but left them out:'
      : response.unavailable.length > 0
        ? 'Nothing could be planned for this trip. The notes below say why.'
        : 'Nothing could be planned for this trip at this time.';

  return (
    <View style={styles.container} testID="no-options">
      <SymbolView name="magnifyingglass" tintColor={colours.textSecondary} size={32} />
      <AppText variant="title3" align="center" accessibilityRole="header">
        No trip options found
      </AppText>
      <AppText tone="secondary" align="center">
        {intro}
      </AppText>
      {explanations.length > 0 ? (
        <View style={styles.reasons}>
          {explanations.map((explanation) => (
            <View key={explanation.reason} style={styles.reason}>
              <AppText tone="secondary" importantForAccessibility="no">
                {'•'}
              </AppText>
              <AppText style={styles.reasonText}>{explanation.text}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {remedies.map((remedy) => (
        <AppText key={remedy} tone="secondary" align="center">
          {REMEDY_SUGGESTIONS[remedy]}
        </AppText>
      ))}
      <View style={styles.actions}>
        {remedies.includes('trip-options') ? (
          <Button label="Change trip options" onPress={onChangeTripOptions} />
        ) : null}
        <Button
          variant="secondary"
          label="Change the time or places"
          onPress={onChangeTrip}
          accessibilityHint="Goes back to the trip you planned"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.md,
  },
  reasons: {
    alignSelf: 'stretch',
    gap: SPACING.sm,
  },
  reason: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  reasonText: {
    flex: 1,
  },
  actions: {
    alignSelf: 'stretch',
    gap: SPACING.sm,
  },
});
