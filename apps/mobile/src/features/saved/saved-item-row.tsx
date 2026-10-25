import { type SFSymbol, SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

export interface SavedItemRowProps {
  title: string;
  subtitle?: string;
  symbol: SFSymbol;
  // Leave out for items that only list something, such as a parking spot.
  onPress?: () => void;
  // What tapping the row does, such as "Plans a trip there, leaving now".
  accessibilityHint?: string;
  // Leave out for rows that cannot be deleted, such as Home before it is set.
  onDelete?: () => void;
  deleteLabel?: string;
  disabled?: boolean;
  testID?: string;
}

// A saved item: the row itself is one button, and delete is a separate button beside it, so
// VoiceOver reaches both and neither swallows the other's taps.
export function SavedItemRow({
  title,
  subtitle,
  symbol,
  onPress,
  accessibilityHint,
  onDelete,
  deleteLabel,
  disabled = false,
  testID,
}: SavedItemRowProps) {
  const { colours } = useTheme();
  const label = [title, subtitle].filter(Boolean).join(', ');
  const content = (
    <>
      <SymbolView name={symbol} tintColor={colours.brand} size={22} />
      <View style={styles.texts}>
        <AppText>{title}</AppText>
        {subtitle ? (
          <AppText variant="subheadline" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </>
  );
  return (
    <View style={[styles.container, { backgroundColor: colours.surface }]} testID={testID}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.main,
            pressed ? { backgroundColor: colours.surfaceMuted } : null,
          ]}>
          {content}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.main}>
          {content}
        </View>
      )}
      {onDelete ? (
        <IconButton
          symbol="trash"
          tone="danger"
          accessibilityLabel={deleteLabel ?? `Delete ${title}`}
          onPress={onDelete}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADII.lg,
    paddingRight: SPACING.xs,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
  },
});
