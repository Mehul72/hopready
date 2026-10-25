import type { Place } from '@hopready/core';
import { useEffect, useRef, useState } from 'react';

import { type CurrentPlaceResult, requestCurrentPlace } from '@/location';
import { tripService } from '@/trip';

export type LocationAttempt =
  { status: 'idle' } | { status: 'locating' } | Exclude<CurrentPlaceResult, { status: 'granted' }>;

export interface CurrentPlaceRequest {
  attempt: LocationAttempt;
  // Resolves with the place, or null when it could not be used; `attempt` then says why. Also
  // null when the answer arrives too late to matter: after `dismiss`, a newer request, or the
  // screen closing.
  locate: () => Promise<Place | null>;
  dismiss: () => void;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

// Asks for the person's position only when they tap something that needs it, which is also
// when iOS shows the permission prompt.
export function useCurrentPlace(): CurrentPlaceRequest {
  const [attempt, setAttempt] = useState<LocationAttempt>({ status: 'idle' });
  // A fix can take seconds. Each request, dismissal and the screen closing moves this on, so a
  // late answer cannot overwrite a place the person chose meanwhile, or act on a closed screen.
  const generation = useRef(0);

  useEffect(() => {
    const requests = generation;
    return () => {
      requests.current += 1;
    };
  }, []);

  async function locate(): Promise<Place | null> {
    generation.current += 1;
    const mine = generation.current;
    setAttempt({ status: 'locating' });
    let result: CurrentPlaceResult;
    try {
      result = await requestCurrentPlace({
        lookUpStreetName: tripService.currentMode() === 'live',
      });
    } catch (error) {
      if (generation.current !== mine) return null;
      // The permission or position call itself failed. Typing a place still works, so this is
      // reported as an unavailable position. Only the error type is logged.
      console.warn(`HopReady: could not get the current location (${errorName(error)}).`);
      setAttempt({ status: 'unavailable', reason: 'position-failed' });
      return null;
    }
    if (generation.current !== mine) return null;
    if (result.status === 'granted') {
      setAttempt({ status: 'idle' });
      return result.place;
    }
    setAttempt(result);
    return null;
  }

  function dismiss() {
    generation.current += 1;
    setAttempt({ status: 'idle' });
  }

  return { attempt, locate, dismiss };
}
