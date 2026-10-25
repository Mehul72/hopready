import type { PlaceSuggestion } from '@hopready/core';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PLACE_RESULTS,
  mergePlaceSuggestions,
  normalisePlaceName,
  searchPlaces,
} from './places';
import { fakePlaces, never, suggestion } from './test-support/fakes';

describe('normalisePlaceName', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    expect(normalisePlaceName('St. Leonards  Station')).toBe('st leonards station');
    expect(normalisePlaceName('st leonards station')).toBe('st leonards station');
    expect(normalisePlaceName('Café Sydney')).toBe('cafe sydney');
  });
});

describe('mergePlaceSuggestions', () => {
  const townHallStop = suggestion('Town Hall Station', -33.8731, 151.2068, 'stop');

  it('keeps the earlier list first and drops a same-named place within 150 m', () => {
    const nearbyDuplicate = suggestion('Town Hall station', -33.8735, 151.2075, 'poi');
    const sameNameElsewhere = suggestion('Town Hall Station', -33.8831, 151.2068, 'poi');
    const differentName = suggestion('Sydney Town Hall', -33.8732, 151.2062, 'poi');

    expect(
      mergePlaceSuggestions([[townHallStop], [nearbyDuplicate, sameNameElsewhere, differentName]]),
    ).toEqual([townHallStop, sameNameElsewhere, differentName]);
  });

  it('leaves out places outside Greater Sydney', () => {
    const newcastle = suggestion('Newcastle Interchange', -32.9253, 151.7625, 'stop');
    expect(mergePlaceSuggestions([[newcastle, townHallStop]])).toEqual([townHallStop]);
  });

  it('returns at most ten results', () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      suggestion(`Stop ${index}`, -33.87 - index * 0.01, 151.2, 'stop'),
    );
    const merged = mergePlaceSuggestions([many, [townHallStop]]);
    expect(merged).toHaveLength(MAX_PLACE_RESULTS);
    expect(merged[0]?.place.name).toBe('Stop 0');
  });
});

describe('searchPlaces', () => {
  it('times out a provider that does not answer and keeps the others', async () => {
    const stop = suggestion('Central Station', -33.8832, 151.2063, 'stop');
    const stops = fakePlaces('tfnsw-trip-planner', async () => [stop]);
    const stuck = fakePlaces('apple-maps', () => never());

    const outcome = await searchPlaces(
      [stops, stuck],
      { query: 'Central', near: null },
      { timeoutMs: 30, signal: new AbortController().signal, onLateOutcome: vi.fn() },
    );

    expect(outcome.results).toEqual([stop]);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toMatchObject({ provider: 'apple-maps', failure: 'timeout' });
  });

  it('drops suggestions the app could not use and counts them', async () => {
    const stop = suggestion('Central Station', -33.8832, 151.2063, 'stop');
    // An adapter bug: an empty name, which the plan endpoint would later refuse.
    const broken = {
      place: { name: '', coordinate: { lat: -33.88, lon: 151.2 }, kind: 'stop' },
      detail: null,
    } as PlaceSuggestion;
    const provider = fakePlaces('tfnsw-trip-planner', async () => [stop, broken]);

    const outcome = await searchPlaces(
      [provider],
      { query: 'Central', near: null },
      { timeoutMs: 1_000, signal: new AbortController().signal, onLateOutcome: vi.fn() },
    );

    expect(outcome.results).toEqual([stop]);
    expect(outcome.droppedCount).toBe(1);
  });
});
