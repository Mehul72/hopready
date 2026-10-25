import { type SFSymbol, SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { type ColourTokens, MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

import { AppText, colourForTone, type TextTone } from './app-text';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'plain';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  // Shows a spinner, keeps the label, and ignores presses until the work finishes.
  loading?: boolean;
  disabled?: boolean;
  symbol?: SFSymbol;
  // Only when the visible label is not enough on its own, such as "Remove" in a list.
  accessibilityLabel?: string;
  accessibilityHint?: string;
  fullWidth?: boolean;
  // Plain buttons only: the label colour when the button sits on a tinted surface such as a
  // banner, so it keeps that surface's contrast.
  labelTone?: TextTone;
  testID?: string;
}

const VARIANT_COLOURS: Readonly<
  Record<ButtonVariant, { background: keyof ColourTokens | null; tone: TextTone }>
> = {
  primary: { background: 'brand', tone: 'onBrand' },
  secondary: { background: 'brandSoft', tone: 'onBrandSoft' },
  destructive: { background: 'danger', tone: 'onDanger' },
  plain: { background: null, tone: 'brand' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  symbol,
  accessibilityLabel,
  accessibilityHint,
  fullWidth = false,
  labelTone,
  testID,
}: ButtonProps) {
  const { colours } = useTheme();
  const { background } = VARIANT_COLOURS[variant];
  const tone = variant === 'plain' && labelTone ? labelTone : VARIANT_COLOURS[variant].tone;
  const foreground = colourForTone(colours, tone);
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variant === 'plain' ? styles.plain : styles.filled,
        background ? { backgroundColor: colours[background] } : null,
        fullWidth ? styles.fullWidth : null,
        pressed ? styles.pressed : null,
        disabled && !loading ? styles.disabled : null,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={foreground} />
        ) : symbol ? (
          <SymbolView name={symbol} tintColor={foreground} size={18} />
        ) : null}
        <AppText variant="headline" tone={tone} align="center" style={styles.label}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    justifyContent: 'center',
  },
  filled: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  plain: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  label: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.75,
  },
  // WCAG exempts inactive controls from contrast, but they must still look inactive.
  disabled: {
    opacity: 0.45,
  },
});
