import type { Itinerary, Leg } from '@hopready/core';

// Demo trips replay a made-up live feed so the screens can show delays and live badges. Their
// times must never be called "live": that would claim a real feed from the operator.
export function isSampleLeg(leg: Leg): boolean {
  return leg.source === 'demo-fixture';
}

export function isSampleItinerary(itinerary: Itinerary): boolean {
  return itinerary.legs.some(isSampleLeg);
}
