import { type SFSymbol, SymbolView } from 'expo-symbols';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';

export function Disclosure({
  title,
  summary,
  symbol,
  children,
  testID,
}: {
  title: string;
  summary?: string;
  symbol: SFSymbol;
  children: ReactNode;
  testID?: string;
}) {
  const { colours } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.container, { backgroundColor: colours.surface }]} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, summary].filter(Boolean).join(', ')}
        accessibilityHint={expanded ? 'Hides these options' : 'Shows these options'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        testID={testID ? `${testID}-toggle` : undefined}
        style={({ pressed }) => [
          styles.row,
          pressed ? { backgroundColor: colours.surfaceMuted } : null,
        ]}>
        <View style={[styles.symbol, { backgroundColor: colours.surfaceMuted }]}>
          <SymbolView name={symbol} tintColor={colours.textSecondary} size={18} />
        </View>
        <View style={styles.texts}>
          <AppText variant="callout" weight="semibold">
            {title}
          </AppText>
          {summary ? (
            <AppText variant="footnote" tone="secondary">
              {summary}
            </AppText>
          ) : null}
        </View>
        <SymbolView
          name={expanded ? 'chevron.up' : 'chevron.down'}
          tintColor={colours.textSecondary}
          size={12}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.details, { borderTopColor: colours.separator }]}>{children}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: RADII.lg, overflow: 'hidden' },
  row: {
    minHeight: MIN_TOUCH_TARGET + SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  symbol: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, gap: SPACING.xxs },
  details: { padding: SPACING.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACING.md },
});
