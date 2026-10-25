import { placeSchema, type Coordinate } from '@hopready/core';
import { describe, expect, it } from 'vitest';

import type { TfnswDiagnostic } from './diagnostics';
import { createTfnswProviders } from './index';
import { fakeFetch, jsonResponse, loadFixture, neverAborted } from './test-support';

const CHATSWOOD_SAMPLE = 'stop-finder-chatswood.schema-sample.json';

async function search(body: unknown, query: string, near: Coordinate | null = null) {
  const diagnostics: TfnswDiagnostic[] = [];
  const fetchImpl = fakeFetch(() => jsonResponse(body));
  const { stops } = createTfnswProviders({
    apiKey: 'test-key',
    fetchImpl,
    requestsPerSecond: 100,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const suggestions = await stops.search(query, near, neverAborted());
  return { suggestions, diagnostics, requests: fetchImpl.requests };
}

describe('TfNSW stop search', () => {
  it.each(['', 'ch', '  ab  ', '   '])(
    'returns nothing for %j without calling TfNSW',
    async (query) => {
      const { suggestions, requests } = await search(loadFixture(CHATSWOOD_SAMPLE), query);

      expect(suggestions).toEqual([]);
      expect(requests).toHaveLength(0);
    },
  );

  it('asks stop_finder for any location type, the way the TfNSW website does', async () => {
    const { requests } = await search(loadFixture(CHATSWOOD_SAMPLE), '  Chatswood ');
    const url = requests[0]!.url;

    expect(url.pathname).toBe('/v1/tp/stop_finder');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      outputFormat: 'rapidJSON',
      type_sf: 'any',
      name_sf: 'Chatswood',
      coordOutputFormat: 'EPSG:4326',
      TfNSWSF: 'true',
    });
  });

  it('keeps stops, platforms and places of interest in Greater Sydney, stops first, at most 8', async () => {
    const { suggestions } = await search(loadFixture(CHATSWOOD_SAMPLE), 'Chatswood');

    expect(suggestions.map(({ place }) => place.name)).toEqual([
      'Chatswood Station',
      'Chatswood Station, Platform 1',
      'Chatswood Station, Platform 2',
      'Chatswood Station, Platform 3',
      'Chatswood Station, Platform 4',
      'Chatswood Station, Stand A',
      'Chatswood Interchange, Stand H',
      'Chatswood Chase',
    ]);
  });

  it('describes stops with their stop ID and places of interest without one', async () => {
    const { suggestions } = await search(loadFixture(CHATSWOOD_SAMPLE), 'Chatswood');
    const station = suggestions[0]!;
    const shoppingCentre = suggestions[7]!;

    expect(station).toEqual({
      place: {
        name: 'Chatswood Station',
        coordinate: { lat: -33.797237, lon: 151.180934 },
        kind: 'stop',
        stopId: '206710',
      },
      detail: 'Chatswood',
    });
    expect(suggestions[1]?.detail).toBe('Chatswood');
    expect(shoppingCentre.place).toEqual({
      name: 'Chatswood Chase',
      coordinate: { lat: -33.79563, lon: 151.18517 },
      kind: 'poi',
    });
    for (const { place } of suggestions) expect(() => placeSchema.parse(place)).not.toThrow();
  });

  it('counts results it cannot read instead of failing the search', async () => {
    const { diagnostics } = await search(loadFixture(CHATSWOOD_SAMPLE), 'Chatswood');

    expect(diagnostics).toEqual([{ kind: 'stops-dropped', reason: 'unreadable', count: 1 }]);
  });

  it('breaks ties in match quality by distance from the traveller', async () => {
    const stop = (id: string, name: string, coord: [number, number]) => ({
      id,
      name,
      type: 'stop',
      coord,
      matchQuality: 950,
    });
    const body = {
      locations: [
        stop('206010', 'North Sydney Station', [-33.84115, 151.207412]),
        stop('206710', 'Chatswood Station', [-33.797237, 151.180934]),
      ],
    };

    const near = { lat: -33.7969, lon: 151.1803 };
    const { suggestions } = await search(body, 'Station', near);

    expect(suggestions.map(({ place }) => place.stopId)).toEqual(['206710', '206010']);
  });

  it('returns nothing when TfNSW has no locations', async () => {
    const { suggestions } = await search({ version: '10.6.21.17' }, 'Nowhere');

    expect(suggestions).toEqual([]);
  });
});
