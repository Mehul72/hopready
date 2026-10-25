import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { hasLocationPermission } from './current-place';

// Whether location access is already granted, without ever asking. Checked again when the app
// returns to the foreground, because the person may have changed it in Settings meanwhile.
export function useHasLocationPermission(): boolean {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => {
      hasLocationPermission().then(
        (value) => {
          if (active) setGranted(value);
        },
        (error: unknown) => {
          // Treated as not granted: the map then simply leaves out the blue dot.
          console.warn(
            `HopReady: could not read location permission (${error instanceof Error ? error.name : 'unknown'}).`,
          );
          if (active) setGranted(false);
        },
      );
    };
    check();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return granted;
}
