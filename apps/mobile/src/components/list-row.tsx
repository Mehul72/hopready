import { type SFSymbol, SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MIN_TOUCH_TARGET, SPACING, STACKED_LAYOUT_FONT_SCALE, useTheme } from '@/theme';

import { AppText } from './app-text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  // Short trailing text, such as "8 min" or "On".
  value?: string;
  // An icon or ModeIcon. It is decorative: the row's label carries the meaning.
  leading?: ReactNode;
  leadingSymbol?: SFSymbol;
  onPress?: () => void;
  // Defaults to the title, subtitle and value read together.
  accessibilityLabel?: string;
  accessibilityHint?: string;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  value,
  leading,
  leadingSymbol,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  destructive = false,
  disabled = false,
  testID,
}: ListRowProps) {
  const { colours } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACKED_LAYOUT_FONT_SCALE;
  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');

  const content = (
    <View style={styles.row}>
      {leading ?? null}
      {!leading && leadingSymbol ? (
        <SymbolView
          name={leadingSymbol}
          tintColor={destructive ? colours.danger : colours.brand}
          size={22}
        />
      ) : null}
      <View style={styles.texts}>
        <AppText tone={destructive ? 'danger' : 'primary'}>{title}</AppText>
        {subtitle ? (
          <AppText variant="subheadline" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
        {stacked && value ? (
          <AppText variant="subheadline" tone="secondary" tabularNumbers>
            {value}
          </AppText>
        ) : null}
      </View>
      {!stacked && value ? (
        <AppText tone="secondary" tabularNumbers style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {onPress ? (
        <SymbolView name="chevron.right" tintColor={colours.textSecondary} size={14} />
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        testID={testID}
        style={[styles.container, { backgroundColor: colours.surface }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: pressed ? colours.surfaceMuted : colours.surface },
        disabled ? styles.disabled : null,
      ]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
  },
  value: {
    flexShrink: 0,
    maxWidth: '45%',
    textAlign: 'right',
  },
  disabled: {
    opacity: 0.45,
  },
});
