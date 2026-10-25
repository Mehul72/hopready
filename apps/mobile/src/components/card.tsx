import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { RADII, SPACING, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  // A pressable card is one button: VoiceOver reads its text as the name unless a label is given.
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  selected = false,
  padded = true,
  style,
  testID,
}: CardProps) {
  const { colours } = useTheme();
  const cardStyle = [
    styles.card,
    padded ? styles.padded : null,
    {
      backgroundColor: colours.surface,
      // A selected card gets a thicker brand outline, not just a colour change.
      borderColor: selected ? colours.brand : colours.separator,
      borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
    },
    style,
  ];

  if (!onPress) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [cardStyle, pressed ? styles.pressed : null]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
  },
  padded: {
    padding: SPACING.lg,
  },
  pressed: {
    opacity: 0.8,
  },
});
