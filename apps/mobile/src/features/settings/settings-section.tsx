import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { SPACING } from '@/theme';

// A titled group of settings. The title is a heading, so VoiceOver users can jump between groups.
export function SettingsSection({
  title,
  description,
  children,
  testID,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <AppText variant="title3" accessibilityRole="header">
        {title}
      </AppText>
      {description ? <AppText tone="secondary">{description}</AppText> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
    paddingTop: SPACING.xl,
  },
});
