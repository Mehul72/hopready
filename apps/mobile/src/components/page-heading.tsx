import { StyleSheet, View } from 'react-native';

import { SPACING } from '@/theme';

import { AppText } from './app-text';

export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      <AppText variant="largeTitle" accessibilityRole="header" style={styles.title}>
        {title}
      </AppText>
      {subtitle ? <AppText tone="secondary">{subtitle}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: SPACING.sm, paddingBottom: SPACING.sm },
  title: { letterSpacing: -0.8 },
});
