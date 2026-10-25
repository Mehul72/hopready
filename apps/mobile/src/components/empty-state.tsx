import { type SFSymbol, SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';
import { Button } from './button';

export interface EmptyStateProps {
  title: string;
  message?: string;
  symbol?: SFSymbol;
  // The next step, such as "Add a favourite". Leave out rather than offer a button that does nothing.
  action?: { label: string; onPress: () => void; accessibilityHint?: string };
  testID?: string;
}

// An answer with nothing in it, said plainly, so it never looks like a screen that failed to load.
export function EmptyState({ title, message, symbol = 'tray', action, testID }: EmptyStateProps) {
  const { colours } = useTheme();
  return (
    <View style={styles.container} testID={testID}>
      <SymbolView name={symbol} tintColor={colours.textSecondary} size={36} />
      <View style={styles.texts}>
        <AppText variant="title3" align="center" accessibilityRole="header">
          {title}
        </AppText>
        {message ? (
          <AppText tone="secondary" align="center">
            {message}
          </AppText>
        ) : null}
      </View>
      {action ? (
        <Button
          variant="secondary"
          label={action.label}
          onPress={action.onPress}
          accessibilityHint={action.accessibilityHint}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
    gap: SPACING.md,
  },
  texts: {
    alignItems: 'center',
    gap: SPACING.xs,
  },
});
