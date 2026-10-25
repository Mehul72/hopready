import { Alert } from 'react-native';

// For logs: the kind of failure only. Messages can quote stored values, which hold places.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export type WriteOutcome<T> = { ok: true; value: T } | { ok: false };

// Runs a write to on-device storage. A failed save is told to the person and logged by error type,
// never dropped silently.
export function writeOrAlert<T>(write: () => T, failureTitle: string): WriteOutcome<T> {
  try {
    return { ok: true, value: write() };
  } catch (error) {
    console.warn(`HopReady: ${failureTitle} (${errorName(error)}).`);
    Alert.alert(failureTitle, 'Nothing was changed. Try again.');
    return { ok: false };
  }
}
