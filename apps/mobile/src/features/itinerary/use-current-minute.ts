import { useSyncExternalStore } from 'react';

const MS_PER_MINUTE = 60_000;
// Checked more often than once a minute so "updated 3 min ago" never lags by a whole minute.
const TICK_MS = 15_000;

function currentMinuteMs(): number {
  return Math.floor(Date.now() / MS_PER_MINUTE) * MS_PER_MINUTE;
}

function subscribeToMinutes(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

// The current time, rounded down to the minute, for ages such as "updated 3 min ago". Reading the
// clock here, outside render, keeps components pure; they re-render only when the minute changes.
export function useCurrentMinute(): number {
  return useSyncExternalStore(subscribeToMinutes, currentMinuteMs, currentMinuteMs);
}
