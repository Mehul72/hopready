import { StyleSheet, View } from 'react-native';

import { SPACING } from '@/theme';

import { AppText } from './app-text';
import { Button } from './button';

export interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void; accessibilityHint?: string };
}

// VoiceOver users can jump between these with the headings rotor.
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm,
  },
  title: {
    flexShrink: 1,
  },
});
