import type { Itinerary, Strategy } from '@hopready/core';

export const STRATEGY_LABELS: Readonly<Record<Strategy, string>> = {
  'transit-only': 'Public transport',
  'park-and-ride': 'Drive and park',
  'drop-off': 'Drop-off',
  'drive-only': 'Drive',
  'return-via-car': 'Back via your car',
  'transit-home': 'Public transport home',
};

// The name of one option. A public transport option can be a walk on its own when the place is
// close by, so it is named for what it is rather than promising a service.
export function optionLabel(itinerary: Pick<Itinerary, 'strategy' | 'legs'>): string {
  const walkOnly = itinerary.legs.every((leg) => leg.kind === 'walk' || leg.kind === 'wait');
  if (walkOnly && itinerary.strategy === 'transit-only') return 'Walk';
  if (walkOnly && itinerary.strategy === 'transit-home') return 'Walk home';
  return STRATEGY_LABELS[itinerary.strategy];
}
