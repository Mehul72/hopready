import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { RADII, SPACING, useTheme } from '@/theme';

import { IconButton } from './icon-button';

export interface MapCardProps {
  // The TripMap, which fills the card.
  children: ReactNode;
  // Opens the same map full screen, where it can be panned and zoomed.
  onExpand: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// A map inside a scrolling page, shaped like the cards around it. The page's map keeps still so a
// swipe scrolls; the button in its corner is the way to a map that moves.
export function MapCard({ children, onExpand, style, testID }: MapCardProps) {
  const { colours } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colours.border }, style]} testID={testID}>
      {children}
      <View style={styles.expand}>
        <IconButton
          symbol="arrow.up.left.and.arrow.down.right"
          variant="filled"
          accessibilityLabel="Bigger map"
          accessibilityHint="Opens the map full screen, where it can be moved and zoomed"
          onPress={onExpand}
          testID="expand-map"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  expand: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
  },
});
