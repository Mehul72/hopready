import { formatSydneyTime } from '@hopready/core';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, ListRow, ModeIcon } from '@/components';
import { SPACING, useTheme } from '@/theme';

import type { VehicleRow } from '../itinerary/vehicle-text';

export interface LivePositionsPanelProps {
  rows: readonly VehicleRow[];
  checkedAt: string | null;
  demo: boolean;
  onShow: (row: VehicleRow) => void;
}

// Under the trip's map: one row per service, saying where its vehicle is and how old that is, or why
// there is no position. A row with a position moves the map to it.
export function LivePositionsPanel({ rows, checkedAt, demo, onShow }: LivePositionsPanelProps) {
  const { colours } = useTheme();
  const { height } = useWindowDimensions();
  const caption = demo
    ? 'Sample positions from the demo timetable'
    : checkedAt
      ? `Live positions from Transport for NSW, checked ${formatSydneyTime(checkedAt)}`
      : 'Live positions from Transport for NSW';

  return (
    <View
      style={[styles.panel, { backgroundColor: colours.surface, borderColor: colours.separator }]}
      testID="live-positions">
      <AppText variant="headline" accessibilityRole="header">
        Live positions
      </AppText>
      <AppText variant="footnote" tone="secondary">
        {caption}
      </AppText>
      {/* A third of the screen at most, so the map stays the larger part even at large text sizes. */}
      <ScrollView style={{ maxHeight: height / 3 }}>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            title={row.title}
            subtitle={row.status.text}
            leading={<ModeIcon mode={row.mode} />}
            accessibilityLabel={`${row.title}. ${row.status.spoken}`}
            {...(row.place
              ? { onPress: () => onShow(row), accessibilityHint: 'Shows it on the map' }
              : {})}
            testID={`live-position-${row.legIndex}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: SPACING.xs,
  },
});
