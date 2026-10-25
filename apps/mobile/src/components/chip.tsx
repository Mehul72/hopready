import { type SFSymbol, SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';

export interface ChipProps {
  label: string;
  selected: boolean;
  onToggle: (selected: boolean) => void;
  symbol?: SFSymbol;
  // For a symbol in a mode colour; the label still names the mode.
  symbolTint?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
}

// A toggle such as "Bus" in "Modes to avoid". Selection shows as a tick, a thicker outline and a
// tinted fill, so it never depends on colour alone, and VoiceOver reads it as checked or unchecked.
export function Chip({
  label,
  selected,
  onToggle,
  symbol,
  symbolTint,
  accessibilityHint,
  disabled = false,
  testID,
}: ChipProps) {
  const { colours } = useTheme();
  const textTone = selected ? 'onBrandSoft' : 'primary';
  const foreground = selected ? colours.onBrandSoft : colours.text;

  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => onToggle(!selected)}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colours.brandSoft : colours.surface,
          borderColor: selected ? colours.brand : colours.border,
          borderWidth: selected ? 2 : 1,
        },
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}>
      <View style={styles.content}>
        {selected ? <SymbolView name="checkmark" tintColor={foreground} size={14} /> : null}
        {symbol ? (
          <SymbolView name={symbol} tintColor={symbolTint ?? foreground} size={16} />
        ) : null}
        <AppText variant="subheadline" tone={textTone} weight={selected ? 'semibold' : 'regular'}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
