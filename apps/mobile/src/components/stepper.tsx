import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';
import { IconButton } from './icon-button';

export interface StepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  accessibilityHint?: string;
  testID?: string;
}

// From this text size on, the label sits above the controls instead of beside them.
const STACKED_LAYOUT_FONT_SCALE = 1.35;

export function spokenMinutes(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

// A whole number of minutes, such as the parking buffer. VoiceOver users swipe up or down on the
// value; everyone else uses the minus and plus buttons, which stop at the limits.
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  accessibilityHint,
  testID,
}: StepperProps) {
  const { colours } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACKED_LAYOUT_FONT_SCALE;
  const canDecrease = value - step >= min;
  const canIncrease = value + step <= max;
  const decrease = () => {
    if (canDecrease) onChange(value - step);
  };
  const increase = () => {
    if (canIncrease) onChange(value + step);
  };

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        stacked ? styles.stacked : styles.inline,
        { backgroundColor: colours.surface },
      ]}>
      {/* Read as part of the adjustable value below, so VoiceOver does not hear it twice. */}
      <AppText
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={stacked ? null : styles.inlineLabel}>
        {label}
      </AppText>
      <View style={styles.controls}>
        <IconButton
          symbol="minus"
          accessibilityLabel={`Decrease ${label}`}
          onPress={decrease}
          disabled={!canDecrease}
        />
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityValue={{ min, max, now: value, text: spokenMinutes(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') increase();
            if (event.nativeEvent.actionName === 'decrement') decrease();
          }}
          style={styles.value}>
          <AppText variant="headline" tabularNumbers align="center">
            {`${value} min`}
          </AppText>
        </View>
        <IconButton
          symbol="plus"
          accessibilityLabel={`Increase ${label}`}
          onPress={increase}
          disabled={!canIncrease}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  inlineLabel: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  value: {
    minWidth: 72,
    paddingHorizontal: SPACING.xs,
  },
});
