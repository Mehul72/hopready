import type { Coordinate } from '@hopready/core';
import { Accuracy, getCurrentPositionAsync } from 'expo-location';
import { useEffect, useState } from 'react';

import { hasLocationPermission } from '@/location';

// Search waits this long at most for the hint, so a slow fix delays results only briefly.
export const NEAR_HINT_TIMEOUT_MS = 2_000;

export type NearHint = { status: 'looking' } | { status: 'ready'; coordinate: Coordinate | null };

class NearHintTimeout extends Error {
  constructor() {
    super('No position in time');
    this.name = 'NearHintTimeout';
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

// Where the person is, roughly, to rank nearby search results first. It only ever reads a position
// when location access was already granted: a search must never trigger the permission prompt.
export async function lookUpNearHint(): Promise<Coordinate | null> {
  let granted: boolean;
  try {
    granted = await hasLocationPermission();
  } catch (error) {
    console.warn(`HopReady: could not read location permission (${errorName(error)}).`);
    return null;
  }
  if (!granted) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new NearHintTimeout()), NEAR_HINT_TIMEOUT_MS);
    });
    // About a kilometre is all the hint needs, and a coarse fix arrives quickly.
    const position = await Promise.race([
      getCurrentPositionAsync({ accuracy: Accuracy.Low }),
      timeout,
    ]);
    return { lat: position.coords.latitude, lon: position.coords.longitude };
  } catch (error) {
    // Search works without the hint; only the reason is logged, never a position.
    console.warn(`HopReady: searching without a location hint (${errorName(error)}).`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function useNearHint(): NearHint {
  const [hint, setHint] = useState<NearHint>({ status: 'looking' });
  useEffect(() => {
    let active = true;
    void lookUpNearHint().then((coordinate) => {
      if (active) setHint({ status: 'ready', coordinate });
    });
    return () => {
      active = false;
    };
  }, []);
  return hint;
}
