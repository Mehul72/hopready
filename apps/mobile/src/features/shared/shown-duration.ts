import { floorToMinute, type Itinerary, secondsBetween } from '@hopready/core';

// The total a person can check against the times on screen. Leave and Arrive are shown to the
// minute with the seconds dropped, so the total is worked out from those same minutes: a
// 7:35:59 to 8:33:10 trip reads "Leave 7:35, Arrive 8:33, 58 min", never "57 min".
export function shownDurationSeconds(itinerary: Pick<Itinerary, 'departAt' | 'arriveAt'>): number {
  return secondsBetween(floorToMinute(itinerary.departAt), floorToMinute(itinerary.arriveAt));
}
