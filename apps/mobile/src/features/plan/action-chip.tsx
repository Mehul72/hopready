import { type SFSymbol, SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

export interface ActionChipProps {
  label: string;
  symbol: SFSymbol;
  onPress: () => void;
  accessibilityHint?: string;
  // True while the chip's work runs, such as finding the current location.
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
}

// A chip-shaped button for a one-tap action such as "Home". Unlike the foundation Chip, which is
// an on/off toggle, it does something when pressed, so VoiceOver reads it as a button.
export function ActionChip({
  label,
  symbol,
  onPress,
  accessibilityHint,
  busy = false,
  disabled = false,
  testID,
}: ActionChipProps) {
  const { colours } = useTheme();
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: colours.surface, borderColor: colours.border },
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={colours.brand} />
      ) : (
        <SymbolView name={symbol} tintColor={colours.brand} size={16} />
      )}
      <AppText variant="subheadline" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
  },
  label: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
});
