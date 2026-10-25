import { type SFSymbol, SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import { MIN_TOUCH_TARGET, RADII, useTheme } from '@/theme';

export interface IconButtonProps {
  symbol: SFSymbol;
  // Required: an icon has no visible text, so this is the only name VoiceOver can read.
  accessibilityLabel: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  tone?: 'brand' | 'neutral' | 'danger';
  // 'filled' sits on a tinted circle, for buttons floating over a map.
  variant?: 'plain' | 'filled';
  testID?: string;
}

const SYMBOL_SIZE = 22;
// Icons grow with Dynamic Type, but not so far that a row of them stops fitting.
const MAX_SYMBOL_SCALE = 1.5;

export function IconButton({
  symbol,
  accessibilityLabel,
  onPress,
  accessibilityHint,
  disabled = false,
  tone = 'brand',
  variant = 'plain',
  testID,
}: IconButtonProps) {
  const { colours } = useTheme();
  const { fontScale } = useWindowDimensions();
  const tint = tone === 'brand' ? colours.brand : tone === 'danger' ? colours.danger : colours.text;
  const symbolSize = SYMBOL_SIZE * Math.min(Math.max(fontScale, 1), MAX_SYMBOL_SCALE);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        variant === 'filled'
          ? { backgroundColor: colours.surface, borderColor: colours.border }
          : null,
        variant === 'filled' ? styles.filled : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}>
      <SymbolView name={symbol} tintColor={tint} size={symbolSize} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
  },
  filled: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
