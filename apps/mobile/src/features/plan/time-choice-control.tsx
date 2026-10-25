import { floorToMinute, SYDNEY_TIME_ZONE } from '@hopready/core';
import DateTimePicker from '@react-native-community/datetimepicker';
import { StyleSheet, View } from 'react-native';

import { AppText, SegmentedControl } from '@/components';
import { SPACING, useTheme } from '@/theme';

import {
  describeRequestTime,
  phoneUsesSydneyTime,
  type TimeChoice,
  TIME_TYPE_LABELS,
  TIME_TYPES,
  type TimeType,
} from './time-choice';

export interface TimeChoiceControlProps {
  choice: TimeChoice;
  now: Date;
  onChangeType: (type: TimeType) => void;
  onChangeTime: (at: string) => void;
}

const TIME_OPTIONS = TIME_TYPES.map((type) => ({ value: type, label: TIME_TYPE_LABELS[type] }));

export function TimeChoiceControl({
  choice,
  now,
  onChangeType,
  onChangeTime,
}: TimeChoiceControlProps) {
  const { colours, scheme } = useTheme();
  return (
    <View style={styles.container}>
      <SegmentedControl
        accessibilityLabel="When"
        options={TIME_OPTIONS}
        value={choice.type}
        onChange={onChangeType}
        testID="time-type"
      />
      {choice.type === 'now' ? null : (
        <View style={styles.picker}>
          <View style={styles.pickerRow}>
            <AppText style={styles.pickerLabel}>
              {choice.type === 'depart' ? 'Leave after' : 'Arrive by'}
            </AppText>
            {/* Shown in Sydney time, like every time in the app, whatever zone the phone is in. */}
            <DateTimePicker
              value={new Date(choice.at)}
              mode="datetime"
              display="compact"
              timeZoneName={SYDNEY_TIME_ZONE}
              minimumDate={new Date(floorToMinute(now))}
              accentColor={colours.brand}
              themeVariant={scheme}
              onValueChange={(_event, date) => onChangeTime(date.toISOString())}
              accessibilityLabel={choice.type === 'depart' ? 'Departure time' : 'Arrival time'}
              testID="time-picker"
            />
          </View>
          <AppText variant="footnote" tone="secondary">
            {describeRequestTime(choice, now)}
            {phoneUsesSydneyTime(now) ? '' : '. Times are Sydney time.'}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  picker: {
    gap: SPACING.xs,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  pickerLabel: {
    flexShrink: 1,
  },
});
