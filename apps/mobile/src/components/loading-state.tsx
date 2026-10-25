import { StyleSheet, View } from 'react-native';

import { RADII, SPACING, useTheme } from '@/theme';

export interface LoadingStateProps {
  rows?: number;
  // What is loading, for VoiceOver, such as "Loading trip options".
  accessibilityLabel?: string;
  testID?: string;
}

// Placeholder rows shaped like the list that will replace them, so nothing jumps when it arrives.
// They do not animate: a still placeholder is calmer and needs no reduced-motion handling.
export function LoadingState({
  rows = 3,
  accessibilityLabel = 'Loading',
  testID,
}: LoadingStateProps) {
  const { colours } = useTheme();
  const block = { backgroundColor: colours.skeleton };

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      testID={testID}
      style={styles.container}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          importantForAccessibility="no-hide-descendants"
          style={[styles.row, { backgroundColor: colours.surface }]}>
          <View style={[styles.icon, block]} />
          <View style={styles.lines}>
            <View style={[styles.line, styles.lineLong, block]} />
            <View style={[styles.line, styles.lineShort, block]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderRadius: RADII.lg,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: RADII.pill,
  },
  lines: {
    flex: 1,
    gap: SPACING.sm,
  },
  line: {
    height: 12,
    borderRadius: RADII.sm,
  },
  lineLong: {
    width: '80%',
  },
  lineShort: {
    width: '45%',
  },
});
