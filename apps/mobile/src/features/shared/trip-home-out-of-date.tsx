import { router } from 'expo-router';

import { Banner } from '@/components';
import { useParkedCar } from '@/storage';

// Shown with a trip home that no longer fits the car (withCurrentCar in trip/return-trip.ts).
// Only Take me home knows where the person is now, so it plans the way home again, not a refresh.
// The Car tab offers Take me home only while a car or a drop-off is saved, so once the car is
// removed the way home is planned on the Plan tab instead.
export function TripHomeOutOfDate() {
  const noCar = useParkedCar().status === 'none';
  return (
    <Banner
      tone="warning"
      title="This trip home is out of date"
      message={
        noCar
          ? 'Your car was removed after it was planned. Plan your way home on the Plan tab.'
          : 'Your car details changed after it was planned. Tap Take me home on the Car tab to plan it again.'
      }
      action={
        noCar
          ? {
              label: 'Open the Plan tab',
              onPress: () => router.navigate('/'),
              accessibilityHint: 'Shows where to plan a new trip',
            }
          : {
              label: 'Open the Car tab',
              onPress: () => router.navigate('/car'),
              accessibilityHint: 'Shows Take me home',
            }
      }
      testID="trip-home-out-of-date"
    />
  );
}
