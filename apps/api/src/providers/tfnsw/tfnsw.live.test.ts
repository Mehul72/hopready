import {
  isWithinGreaterSydney,
  legSchema,
  occupancySchema,
  placeSchema,
  systemClock,
} from '@hopready/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createTfnswProviders, type TfnswProviders } from './index';
import { nextWeekdayAt, tallawongP1Entrance } from './sample-trips';

// Real calls, run only with a key: TFNSW_API_KEY=... pnpm --filter @hopready/api test tfnsw.live
// Assertions check shapes only, because live answers change from minute to minute.
const apiKey = process.env.TFNSW_API_KEY;
const LIVE_TIMEOUT_MS = 60_000;

describe.skipIf(!apiKey)('TfNSW live', () => {
  // One set of providers, so every call shares one rate gate and stays under the key's limit.
  let providers: TfnswProviders;
  beforeAll(() => {
    providers = createTfnswProviders({ apiKey: apiKey ?? '' });
  });
  const timeout = () => AbortSignal.timeout(LIVE_TIMEOUT_MS - 5_000);

  it(
    'finds Chatswood Station with stop search',
    async () => {
      const suggestions = await providers.stops.search('Chatswood', null, timeout());

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.length).toBeLessThanOrEqual(8);
      for (const { place } of suggestions) {
        expect(() => placeSchema.parse(place)).not.toThrow();
        expect(isWithinGreaterSydney(place.coordinate)).toBe(true);
      }
      expect(suggestions.some(({ place }) => place.kind === 'stop' && place.stopId)).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'plans journeys from the Tallawong P1 entrance to Chatswood',
    async () => {
      const [chatswood] = await providers.stops.search('Chatswood Station', null, timeout());
      expect(chatswood?.place.kind).toBe('stop');

      const journeys = await providers.transit.planJourneys(
        {
          from: tallawongP1Entrance(),
          to: chatswood!.place,
          time: { type: 'depart', at: nextWeekdayAt(systemClock.now(), 8, 0) },
          maxJourneys: 4,
          maxWalkMinutes: 15,
          walkingSpeed: 'normal',
          excludedModes: [],
        },
        timeout(),
      );

      expect(journeys.length).toBeGreaterThan(0);
      for (const journey of journeys) {
        expect(journey.legs.length).toBeGreaterThan(0);
        for (const leg of journey.legs) expect(() => legSchema.parse(leg)).not.toThrow();
        expect(journey.fare).toEqual({ status: 'unknown' });
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'lists Park&Ride car parks in Greater Sydney',
    async () => {
      const facilities = await providers.carParks.listFacilities(timeout());

      expect(facilities.length).toBeGreaterThan(0);
      for (const facility of facilities) {
        expect(facility.kind).toBe('transport-park-and-ride');
        expect(isWithinGreaterSydney(facility.coordinate)).toBe(true);
        expect(facility.rules.status).toBe('documented');
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'reads occupancy for Tallawong P1',
    async () => {
      const occupancy = await providers.carParks.occupancy(['26'], timeout());

      for (const value of occupancy.values()) {
        expect(() => occupancySchema.parse(value)).not.toThrow();
      }
    },
    LIVE_TIMEOUT_MS,
  );
});
