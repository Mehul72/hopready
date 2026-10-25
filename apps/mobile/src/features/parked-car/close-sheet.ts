import { router } from 'expo-router';

// Parking sheets normally open over a screen; opened from a link with nothing underneath, they
// close to the Car tab, which shows what was just saved.
export function closeParkingSheet(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/car');
}
