import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MIN_TOUCH_TARGET, RADII, SPACING, STACKED_LAYOUT_FONT_SCALE, useTheme } from '@/theme';

import { AppText } from './app-text';

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedControlProps<Value extends string> {
  // Names the choice for VoiceOver, for example "Time".
  accessibilityLabel: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  testID?: string;
}

// One choice out of a few, such as "Leave at" or "Arrive by". Each segment is a radio button.
// iOS does not read a group's label, so every segment's hint carries it ("Time, 1 of 2"). The
// selected segment is raised and bold, not only coloured.
export function SegmentedControl<Value extends string>({
  accessibilityLabel,
  options,
  value,
  onChange,
  testID,
}: SegmentedControlProps<Value>) {
  const { colours } = useTheme();
  const { fontScale } = useWindowDimensions();
  // At large text sizes three segments side by side split words ("Depar / t at"), so the
  // segments stack into a list instead.
  const stacked = fontScale >= STACKED_LAYOUT_FONT_SCALE;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.track,
        stacked ? styles.stackedTrack : null,
        { backgroundColor: colours.surfaceMuted },
      ]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityHint={`${accessibilityLabel}, ${index + 1} of ${options.length}`}
            accessibilityState={{ checked: selected }}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              selected
                ? [
                    styles.selected,
                    { backgroundColor: colours.surface, borderColor: colours.border },
                  ]
                : null,
              pressed && !selected ? styles.pressed : null,
            ]}>
            <AppText
              variant="subheadline"
              weight={selected ? 'semibold' : 'regular'}
              align="center">
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: RADII.md,
    padding: SPACING.xxs,
    gap: SPACING.xxs,
  },
  stackedTrack: {
    flexDirection: 'column',
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md - SPACING.xxs,
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  selected: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pressed: {
    opacity: 0.6,
  },
});
