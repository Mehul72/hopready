import { type SFSymbol, SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';
import { Button } from './button';

export interface ErrorStateProps {
  // Say what to do, not what broke: ApiError messages are written that way.
  message: string;
  title?: string;
  symbol?: SFSymbol;
  onRetry?: () => void;
  // True while the retry is running; the button shows a spinner and ignores taps.
  retrying?: boolean;
  retryLabel?: string;
  // A second way out, such as "Use demo mode" or "Enter a place instead".
  secondaryAction?: { label: string; onPress: () => void; accessibilityHint?: string };
  testID?: string;
}

export function ErrorState({
  message,
  title = "Couldn't load this",
  symbol = 'exclamationmark.circle.fill',
  onRetry,
  retrying = false,
  retryLabel = 'Try again',
  secondaryAction,
  testID,
}: ErrorStateProps) {
  const { colours } = useTheme();
  const spoken = `${title}. ${message}`;

  // The error replaces content the person was waiting for, so VoiceOver says what happened.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  return (
    <View style={styles.container} testID={testID}>
      <SymbolView name={symbol} tintColor={colours.danger} size={36} />
      <View accessible accessibilityLabel={spoken} style={styles.texts}>
        <AppText variant="title3" align="center">
          {title}
        </AppText>
        <AppText tone="secondary" align="center">
          {message}
        </AppText>
      </View>
      <View style={styles.actions}>
        {onRetry ? (
          <Button
            label={retryLabel}
            onPress={onRetry}
            loading={retrying}
            symbol="arrow.clockwise"
          />
        ) : null}
        {secondaryAction ? (
          <Button
            variant="secondary"
            label={secondaryAction.label}
            onPress={secondaryAction.onPress}
            accessibilityHint={secondaryAction.accessibilityHint}
          />
        ) : null}
      </View>
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
  actions: {
    alignSelf: 'stretch',
    gap: SPACING.sm,
  },
});
