import { router } from 'expo-router';

import { Banner } from '@/components';

// Shown with a trip home that no longer fits the car (withCurrentCar in trip/return-trip.ts).
// Only Take me home knows where the person is now, so it plans the way home again, not a refresh.
export function TripHomeOutOfDate() {
  return (
    <Banner
      tone="warning"
      title="This trip home is out of date"
      message="Your car details changed after it was planned. Tap Take me home on the Car tab to plan it again."
      action={{
        label: 'Open the Car tab',
        onPress: () => router.navigate('/car'),
        accessibilityHint: 'Shows your car and Take me home',
      }}
      testID="trip-home-out-of-date"
    />
  );
}
