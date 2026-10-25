import { useEffect, useState } from 'react';

// The current time, refreshed on an interval, for wording such as "updated 3 min ago" that would
// otherwise freeze at the moment the screen first rendered.
export function useNow(refreshIntervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), refreshIntervalMs);
    return () => clearInterval(timer);
  }, [refreshIntervalMs]);
  return now;
}
