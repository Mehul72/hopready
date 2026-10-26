import { useCallback, useSyncExternalStore } from 'react';

import { LIVE_TIMES_FRESH_MS, staleCheckOf } from './trip-text';

// staleCheckOf as a hook: times stop being called live the moment their check is too old, rather
// than at the next tick of a screen's clock. As in useCurrentMinute, the clock is read outside
// render.
export function useStaleCheckAt(checkedAt: string | null): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (checkedAt === null) return () => undefined;
      const msUntilStale = Date.parse(checkedAt) + LIVE_TIMES_FRESH_MS - Date.now();
      if (msUntilStale < 0) return () => undefined;
      // A millisecond past the limit, so the check already reads as old when the timer fires.
      const timer = setTimeout(onChange, msUntilStale + 1);
      return () => clearTimeout(timer);
    },
    [checkedAt],
  );
  const readStaleCheck = useCallback(() => staleCheckOf(checkedAt, Date.now()), [checkedAt]);
  return useSyncExternalStore(subscribe, readStaleCheck, readStaleCheck);
}
