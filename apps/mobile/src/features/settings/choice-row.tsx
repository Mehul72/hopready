import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

export interface ChoiceRowProps {
  title: string;
  subtitle?: string;
  // A short tag such as "Suggested" or "Not installed", read before the subtitle.
  badge?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
}

// One option in a list where exactly one is chosen. It is a radio button for VoiceOver, and the
// choice shows as a filled tick, not by colour alone.
export function ChoiceRow({
  title,
  subtitle,
  badge,
  selected,
  onPress,
  accessibilityHint,
  disabled = false,
  testID,
}: ChoiceRowProps) {
  const { colours } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[title, badge, subtitle].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colours.surfaceMuted : colours.surface,
          borderColor: selected ? colours.brand : colours.separator,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
        disabled ? styles.disabled : null,
      ]}>
      <SymbolView
        name={selected ? 'checkmark.circle.fill' : 'circle'}
        tintColor={selected ? colours.brand : colours.border}
        size={22}
      />
      <View style={styles.texts}>
        <AppText weight={selected ? 'semibold' : 'regular'}>{title}</AppText>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colours.brandSoft }]}>
            <AppText variant="caption" tone="onBrandSoft" weight="semibold">
              {badge}
            </AppText>
          </View>
        ) : null}
        {subtitle ? (
          <AppText variant="subheadline" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADII.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
    alignItems: 'flex-start',
  },
  badge: {
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
  disabled: {
    opacity: 0.45,
  },
});
