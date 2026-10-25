import { useEffect } from 'react';
import { AppState } from 'react-native';

import { planSession } from '@/state/plan-session';

// Mount once, in the root layout. When the app launches, and whenever it comes back from the
// background, the active trip is re-planned if the refresh-on-resume rule allows it (see
// refresh-policy.ts). Brief interruptions such as Control Centre leave the app 'inactive', not in
// the background, and do not count.
export function useRefreshActiveTripOnResume(): void {
  useEffect(() => {
    // refreshActiveTrip never rejects: its outcome, including errors, lands in the session.
    void planSession.refreshActiveTrip();
    let wentToBackground = false;
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background') {
        wentToBackground = true;
        return;
      }
      if (status !== 'active' || !wentToBackground) return;
      wentToBackground = false;
      void planSession.refreshActiveTrip();
    });
    return () => subscription.remove();
  }, []);
}
