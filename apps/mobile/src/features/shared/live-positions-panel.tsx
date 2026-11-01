import { formatSydneyTime } from '@hopready/core';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  // The map screen leaves the bottom inset to its content, and this panel is the last of it.
  const { bottom } = useSafeAreaInsets();
  const caption = demo
    ? 'Sample positions from the demo timetable'
    : checkedAt
      ? `Live positions from Transport for NSW, checked ${formatSydneyTime(checkedAt)}`
      : 'Live positions from Transport for NSW';

  return (
    // Two fifths of the screen at most, heading included, so the map stays usable even at the
    // largest text sizes; what does not fit scrolls. A third left room for only two services on
    // the smallest iPhones at the default size.
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colours.surface,
          borderColor: colours.separator,
          paddingBottom: Math.max(bottom, SPACING.md),
          maxHeight: height * 0.4,
        },
      ]}
      testID="live-positions">
      <ScrollView testID="live-positions-list">
        <View style={styles.heading}>
          <AppText variant="headline" accessibilityRole="header">
            Live positions
          </AppText>
          <AppText variant="footnote" tone="secondary">
            {caption}
          </AppText>
        </View>
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
  },
  heading: {
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
});
