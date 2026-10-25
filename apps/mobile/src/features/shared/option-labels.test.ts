import type { Itinerary } from '@hopready/core';

import { parkAndRideItinerary, transitItinerary } from '@/test-support/trips';

import { optionLabel } from './option-labels';

const DEPART = '2026-10-26T20:42:00.000Z';

function walkOnly(strategy: Itinerary['strategy']): Pick<Itinerary, 'strategy' | 'legs'> {
  const transit = transitItinerary({ departAt: DEPART });
  return { strategy, legs: transit.legs.filter((leg) => leg.kind === 'walk') };
}

describe('optionLabel', () => {
  it('names an option by its kind of trip', () => {
    expect(optionLabel(parkAndRideItinerary({ departAt: DEPART }))).toBe('Drive and park');
    expect(optionLabel(transitItinerary({ departAt: DEPART }))).toBe('Public transport');
  });

  it('calls a public transport option with no service a walk', () => {
    expect(optionLabel(walkOnly('transit-only'))).toBe('Walk');
    expect(optionLabel(walkOnly('transit-home'))).toBe('Walk home');
  });
});
