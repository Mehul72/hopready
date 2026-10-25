import { ProviderError } from '@hopready/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  fakeAppleMaps,
  generateMapsKey,
  json,
  openSignal,
  type AppleRequest,
  type MapsKey,
} from './fake-apple-maps';

const NEAR_CENTRAL = { lat: -33.87, lon: 151.2 };

const MARTIN_PLACE = {
  completionUrl: '/v1/search?q=10%20Martin%20Pl&metadata=AbC',
  displayLines: ['10 Martin Pl', 'Sydney NSW 2000, Australia'],
  location: { latitude: -33.8677, longitude: 151.2093 },
};
// Apple's own autocomplete example spells the location as lat and lng.
const OPERA_HOUSE = {
  displayLines: ['Sydney Opera House', 'Bennelong Point, Sydney NSW 2000, Australia'],
  location: { lat: -33.8568, lng: 151.2153 },
};
const FEDERATION_SQUARE = {
  displayLines: ['Federation Square', 'Swanston St & Flinders St, Melbourne VIC 3000, Australia'],
  location: { latitude: -37.818, longitude: 144.9691 },
};
const PARRAMATTA = {
  displayLines: ['Parramatta', 'NSW, Australia'],
  location: { latitude: -33.8148, longitude: 151.0017 },
  structuredAddress: { locality: 'Parramatta', administrativeArea: 'New South Wales' },
};

function unlocated(name: string, index: number) {
  return {
    completionUrl: `/v1/search?q=${encodeURIComponent(name)}&metadata=Ch8K%2B${index}%3D`,
    displayLines: [name, `${index} Example St, Sydney NSW 2000, Australia`],
  };
}

const placeAt = (latitude: number, longitude: number, poiCategory?: string) =>
  json({ results: [{ name: 'Resolved', coordinate: { latitude, longitude }, poiCategory }] });

let key: MapsKey;
beforeAll(async () => {
  key = await generateMapsKey();
});

describe('Apple Maps place search', () => {
  it('ignores queries shorter than three characters without calling Apple', async () => {
    const apple = fakeAppleMaps();
    const { places } = connect(apple, key);

    await expect(places.search('ab', NEAR_CENTRAL, openSignal())).resolves.toEqual([]);
    await expect(places.search('  a  ', null, openSignal())).resolves.toEqual([]);
    expect(apple.requests).toHaveLength(0);
  });

  it('rejects search text over 200 characters without calling Apple', async () => {
    const apple = fakeAppleMaps();
    const { places } = connect(apple, key);

    await expect(places.search('x'.repeat(201), null, openSignal())).rejects.toMatchObject({
      provider: 'apple-maps',
      failure: 'rejected-request',
    });
    expect(apple.requests).toHaveLength(0);
  });

  it('asks /v1/searchAutocomplete for Australian places and addresses around Greater Sydney', async () => {
    const apple = fakeAppleMaps({ '/v1/searchAutocomplete': () => json({ results: [] }) });
    const { places } = connect(apple, key);

    await places.search('  town hall ', NEAR_CENTRAL, openSignal());
    await places.search('town hall', null, openSignal());

    const [near, anywhere] = apple.requestsTo('/v1/searchAutocomplete');
    expect(Object.fromEntries(near?.params ?? [])).toEqual({
      q: 'town hall',
      resultTypeFilter: 'Address,Poi',
      limitToCountries: 'AU',
      searchRegion: '-32.95,151.7,-34.45,149.95',
      searchRegionPriority: 'required',
      lang: 'en-AU',
      userLocation: '-33.870000,151.200000',
    });
    expect(near?.query).toContain('q=town%20hall');
    expect(anywhere?.params.has('userLocation')).toBe(false);
  });

  it('turns display lines into a name and detail and keeps only Greater Sydney', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({
          results: [
            MARTIN_PLACE,
            OPERA_HOUSE,
            FEDERATION_SQUARE,
            PARRAMATTA,
            {
              displayLines: ['Central Station'],
              location: { latitude: -33.8832, longitude: 151.2063 },
            },
            { displayLines: [], location: { latitude: -33.87, longitude: 151.2 } },
          ],
        }),
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('syd', NEAR_CENTRAL, openSignal());

    expect(suggestions).toEqual([
      {
        place: {
          name: '10 Martin Pl',
          coordinate: { lat: -33.8677, lon: 151.2093 },
          kind: 'address',
        },
        detail: 'Sydney NSW 2000, Australia',
      },
      {
        place: {
          name: 'Sydney Opera House',
          coordinate: { lat: -33.8568, lon: 151.2153 },
          kind: 'poi',
        },
        detail: 'Bennelong Point, Sydney NSW 2000, Australia',
      },
      {
        place: {
          name: 'Parramatta',
          coordinate: { lat: -33.8148, lon: 151.0017 },
          kind: 'address',
        },
        detail: 'NSW, Australia',
      },
      {
        place: {
          name: 'Central Station',
          coordinate: { lat: -33.8832, lon: 151.2063 },
          kind: 'poi',
        },
        detail: null,
      },
    ]);
    expect(apple.requestsTo('/v1/search')).toHaveLength(0);
  });

  it('looks up a suggestion without a coordinate through its completion URL', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({
          results: [
            {
              completionUrl: '/v1/search?q=Taronga%20Zoo&metadata=Ch8K%2BAbc%3D',
              displayLines: ['Taronga Zoo', 'Bradleys Head Rd, Mosman NSW 2088, Australia'],
            },
          ],
        }),
      '/v1/search': () => placeAt(-33.8436, 151.2411, 'Zoo'),
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('taronga', null, openSignal());

    const [lookup] = apple.requestsTo('/v1/search');
    expect(lookup?.host).toBe('maps-api.apple.com');
    // Apple's opaque metadata is sent back exactly as Apple encoded it.
    expect(lookup?.query).toBe('q=Taronga%20Zoo&metadata=Ch8K%2BAbc%3D&lang=en-AU');
    expect(lookup?.authorization).toBe('Bearer access-1');
    expect(suggestions).toEqual([
      {
        place: { name: 'Taronga Zoo', coordinate: { lat: -33.8436, lon: 151.2411 }, kind: 'poi' },
        detail: 'Bradleys Head Rd, Mosman NSW 2088, Australia',
      },
    ]);
  });

  it('never follows a completion URL to another host, and searches Apple by name instead', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({
          results: [
            {
              completionUrl: '//attacker.example/v1/search?q=x',
              displayLines: ['Luna Park', 'Milsons Point NSW 2061'],
            },
            {
              completionUrl: 'https://attacker.example/v1/search?q=x',
              displayLines: ['Bondi Beach'],
            },
            { completionUrl: '/v1/place/123', displayLines: ['Manly Wharf'] },
          ],
        }),
      '/v1/search': () => placeAt(-33.8477, 151.2105),
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('beach', null, openSignal());

    expect(apple.requests.every((request) => request.host === 'maps-api.apple.com')).toBe(true);
    const lookups = apple.requestsTo('/v1/search');
    expect(lookups.map((request) => request.params.get('q'))).toEqual([
      'Luna Park Milsons Point NSW 2061',
      'Bondi Beach',
      'Manly Wharf',
    ]);
    expect(Object.fromEntries(lookups[0]?.params ?? [])).toMatchObject({
      limitToCountries: 'AU',
      searchRegion: '-32.95,151.7,-34.45,149.95',
      lang: 'en-AU',
    });
    expect(suggestions.map((suggestion) => suggestion.place.name)).toEqual([
      'Luna Park',
      'Bondi Beach',
      'Manly Wharf',
    ]);
  });

  it('looks up at most five suggestions, three at a time, and keeps Apple order', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({
          results: [
            MARTIN_PLACE,
            ...Array.from({ length: 8 }, (_, index) => unlocated(`Place ${index}`, index)),
          ],
        }),
      '/v1/search': async (request: AppleRequest) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const index = Number(request.params.get('q')?.replace('Place ', ''));
        return placeAt(-33.8 - index * 0.01, 151.1);
      },
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('place', null, openSignal());

    expect(apple.requestsTo('/v1/search')).toHaveLength(5);
    expect(mostInFlight).toBe(3);
    expect(suggestions.map((suggestion) => suggestion.place.name)).toEqual([
      '10 Martin Pl',
      'Place 0',
      'Place 1',
      'Place 2',
      'Place 3',
      'Place 4',
    ]);
    expect(suggestions[3]?.place.coordinate).toEqual({ lat: -33.82, lon: 151.1 });
  });

  it('drops a looked-up place outside Greater Sydney or one Apple cannot find', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({ results: [unlocated('Far Away', 0), unlocated('Unknown', 1), MARTIN_PLACE] }),
      '/v1/search': (request: AppleRequest) =>
        request.params.get('q') === 'Far Away' ? placeAt(-37.81, 144.96) : json({ results: [] }),
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('place', null, openSignal());

    expect(suggestions.map((suggestion) => suggestion.place.name)).toEqual(['10 Martin Pl']);
  });

  it('hides a suggestion whose lookup fails but keeps the others', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () => json({ results: [unlocated('Broken', 0), MARTIN_PLACE] }),
      '/v1/search': () => json({ message: 'Internal Server Error' }, { status: 500 }),
    });
    const { places } = connect(apple, key);

    const suggestions = await places.search('place', null, openSignal());

    expect(suggestions.map((suggestion) => suggestion.place.name)).toEqual(['10 Martin Pl']);
  });

  it('reports the failure when every lookup fails and nothing else is left to show', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () =>
        json({ results: [unlocated('First', 0), unlocated('Second', 1)] }),
      '/v1/search': () =>
        json({ message: 'Too Many Requests' }, { status: 429, headers: { 'retry-after': '60' } }),
    });
    const { places } = connect(apple, key);

    const error = await places
      .search('place', null, openSignal())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ provider: 'apple-maps', failure: 'rate-limited', status: 429 });
  });

  it('returns an empty list when Apple has nothing', async () => {
    const apple = fakeAppleMaps({ '/v1/searchAutocomplete': () => json({}) });
    const { places } = connect(apple, key);

    await expect(places.search('zzzz', null, openSignal())).resolves.toEqual([]);
  });

  it('reports a results list in the wrong shape as malformed', async () => {
    const apple = fakeAppleMaps({
      '/v1/searchAutocomplete': () => json({ results: [{ displayLines: 'Town Hall' }] }),
    });
    const { places } = connect(apple, key);

    await expect(places.search('town', null, openSignal())).rejects.toMatchObject({
      failure: 'malformed-response',
    });
  });
});
