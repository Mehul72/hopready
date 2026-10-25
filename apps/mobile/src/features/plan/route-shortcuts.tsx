import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ListRow } from '@/components';
import { SPACING, useTheme } from '@/theme';

import type { RouteShortcut } from './place-labels';

export interface RouteShortcutsProps {
  title: string;
  shortcuts: readonly RouteShortcut[];
  onPlan: (shortcut: RouteShortcut) => void;
  // A real action for the whole list, such as clearing recent trips.
  action?: { label: string; onPress: () => void; accessibilityHint: string };
  testID?: string;
}

// Saved and recent routes, each planned with one tap using the time and options above.
export function RouteShortcuts({ title, shortcuts, onPlan, action, testID }: RouteShortcutsProps) {
  const { colours } = useTheme();
  if (shortcuts.length === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <AppText variant="headline" accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        {action ? (
          <Button
            variant="plain"
            label={action.label}
            onPress={action.onPress}
            accessibilityHint={action.accessibilityHint}
          />
        ) : null}
      </View>
      <Card padded={false} style={styles.card}>
        {shortcuts.map((shortcut, index) => (
          <View key={shortcut.key}>
            {index > 0 ? (
              <View style={[styles.separator, { backgroundColor: colours.separator }]} />
            ) : null}
            <ListRow
              title={shortcut.title}
              subtitle={shortcut.subtitle}
              leadingSymbol="arrow.triangle.turn.up.right.diamond.fill"
              onPress={() => onPlan(shortcut)}
              accessibilityHint="Plans this trip now, with the time and options above"
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  title: {
    flexShrink: 1,
  },
  card: {
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg,
  },
});
