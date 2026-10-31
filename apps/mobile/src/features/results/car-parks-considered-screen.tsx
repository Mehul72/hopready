import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Screen } from '@/components';
import { usePlanSession } from '@/state';
import { SPACING, useTheme } from '@/theme';

import { closeSheet } from '../plan/close-sheet';
import {
  type CheckedCarPark,
  describeCheckedCarPark,
  orderCheckedCarParks,
} from './plan-explanations';

function CarParkRow({
  carPark,
  maxDriveMinutes,
}: {
  carPark: CheckedCarPark;
  maxDriveMinutes: number;
}) {
  const { colours } = useTheme();
  const described = describeCheckedCarPark(carPark, maxDriveMinutes);
  return (
    <View
      accessible
      accessibilityLabel={described.spoken}
      style={[styles.row, { borderTopColor: colours.separator }]}
      testID={`considered-car-park-${carPark.id}`}>
      <AppText weight="semibold">{described.title}</AppText>
      {described.detail ? (
        <AppText variant="subheadline" tone="secondary" tabularNumbers>
          {described.detail}
        </AppText>
      ) : null}
      <AppText variant="subheadline" tone={carPark.outcome === 'used' ? 'primary' : 'secondary'}>
        {described.outcome}
      </AppText>
    </View>
  );
}

// Every car park within the driving limit, with its rough door-to-door estimate and what happened
// to it, so a missing local car park is explained instead of a mystery. Opened from the results.
export function CarParksConsideredScreen() {
  const router = useRouter();
  const { request, response } = usePlanSession();
  const carParks = response?.checkedCarParks ?? [];

  if (!request || carParks.length === 0) {
    return (
      <Screen testID="car-parks-considered-screen">
        <EmptyState
          title="No car parks to show"
          message="Plan a trip with driving first, then open this from its options."
          symbol="parkingsign.circle"
          action={{ label: 'Done', onPress: () => closeSheet(router) }}
          testID="car-parks-considered-empty"
        />
      </Screen>
    );
  }

  const maxDriveMinutes = request.preferences.maxDriveMinutes;
  return (
    <Screen
      footer={
        <Button
          label="Done"
          onPress={() => closeSheet(router)}
          fullWidth
          testID="car-parks-considered-done"
        />
      }
      testID="car-parks-considered-screen">
      <AppText variant="footnote" tone="secondary">
        {`HopReady estimates every documented car park within your ${maxDriveMinutes} min driving limit, door to door, and asks for exact times from the five most promising, one per station. The estimates are rough; the options list has the exact times.`}
      </AppText>
      <Card padded={false} style={styles.list}>
        {orderCheckedCarParks(carParks).map((carPark) => (
          <CarParkRow key={carPark.id} carPark={carPark} maxDriveMinutes={maxDriveMinutes} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    overflow: 'hidden',
    paddingVertical: SPACING.xs,
  },
  row: {
    gap: SPACING.xxs,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
