import type { PlanResponse } from '@hopready/core';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components';
import { MIN_TOUCH_TARGET, SPACING, useTheme } from '@/theme';

import { carParkOutcomeText } from './plan-explanations';

export interface CarParksCheckedProps {
  checkedCarParks: PlanResponse['checkedCarParks'];
  maxDriveMinutes: number;
}

// HopReady checks a small set of car parks rather than all of them. This says which ones and
// what happened to each, so a missing local car park is explained instead of a mystery.
export function CarParksChecked({ checkedCarParks, maxDriveMinutes }: CarParksCheckedProps) {
  const { colours } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (checkedCarParks.length === 0) return null;
  const title = `Car parks checked (${checkedCarParks.length})`;

  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={expanded ? 'Hides the list' : 'Shows what happened at each car park'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.header, pressed ? styles.pressed : null]}>
        <AppText variant="headline" style={styles.title}>
          {title}
        </AppText>
        <SymbolView
          name={expanded ? 'chevron.up' : 'chevron.down'}
          tintColor={colours.textSecondary}
          size={14}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.list, { borderTopColor: colours.separator }]}>
          {checkedCarParks.map((carPark) => {
            const outcome = carParkOutcomeText(carPark.outcome, maxDriveMinutes);
            return (
              <View
                key={carPark.id}
                accessible
                accessibilityLabel={`${carPark.name}: ${outcome}`}
                style={styles.row}>
                <AppText weight="semibold">{carPark.name}</AppText>
                <AppText variant="subheadline" tone="secondary">
                  {outcome}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  title: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },
  row: {
    gap: SPACING.xxs,
  },
});
