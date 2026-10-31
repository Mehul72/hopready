import type { ReactNode } from 'react';
import { type SFSymbol } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { AppText, Disclosure } from '@/components';
import { RADII, SPACING, useTheme } from '@/theme';

// Related settings share one surface; longer groups can disclose their details.
export function SettingsSection({
  title,
  description,
  children,
  testID,
  disclosure,
  showTitle = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testID?: string;
  disclosure?: { symbol: SFSymbol; summary: string };
  showTitle?: boolean;
}) {
  const { colours } = useTheme();
  if (disclosure) {
    return (
      <Disclosure
        title={title}
        summary={disclosure.summary}
        symbol={disclosure.symbol}
        testID={testID}>
        {description ? (
          <AppText variant="footnote" tone="secondary">
            {description}
          </AppText>
        ) : null}
        {children}
      </Disclosure>
    );
  }
  return (
    <View style={[styles.section, { backgroundColor: colours.surface }]} testID={testID}>
      {showTitle ? (
        <AppText variant="headline" accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      {description ? (
        <AppText variant="footnote" tone="secondary">
          {description}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderRadius: RADII.lg,
  },
});
