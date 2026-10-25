import { existsSync, readdirSync, readFileSync } from 'node:fs';

import {
  findContinuityIssues,
  legSchema,
  occupancySchema,
  placeSchema,
  type Place,
} from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { occupancyFromFeed } from './car-parks';
import {
  carParkFacilitySchema,
  carParkListSchema,
  stopFinderResponseSchema,
  tripResponseSchema,
} from './schemas';
import { mapStopFinderResponse } from './stop-search';
import { mapTripResponse } from './transit';

// Real responses saved by apps/api/scripts/record-tfnsw-samples.ts. These tests run once someone
// has recorded them with a key, and check the parsers against what TfNSW really sends.
const RECORDINGS = new URL('./__recordings__/', import.meta.url);
const recordedFiles = existsSync(RECORDINGS) ? readdirSync(RECORDINGS) : [];
const recorded = (prefix: string) =>
  recordedFiles.filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
const read = (fileName: string): unknown =>
  JSON.parse(readFileSync(new URL(fileName, RECORDINGS), 'utf8'));

const trips = recorded('trip-');
const stopSearches = recorded('stop-finder-');
const facilityLists = recorded('carpark-list');
const facilities = recorded('carpark-facility-');
const anyRecorded = [...trips, ...stopSearches, ...facilityLists, ...facilities].length > 0;

// The journey's own first and last places stand in for the planner's; only the stops between them
// come from the recording.
const RECORDED_END: Place = {
  name: 'Recorded trip end',
  coordinate: { lat: -33.8688, lon: 151.2093 },
  kind: 'address',
};

describe.skipIf(!anyRecorded)('TfNSW recorded responses', () => {
  for (const fileName of trips) {
    it(`maps ${fileName}`, () => {
      const mapping = mapTripResponse(tripResponseSchema.parse(read(fileName)), {
        from: RECORDED_END,
        to: RECORDED_END,
        time: { type: 'depart', at: '2026-10-25T21:00:00.000Z' },
        maxJourneys: 20,
        maxWalkMinutes: 60,
        walkingSpeed: 'normal',
        excludedModes: [],
      });

      expect(mapping.journeys.length).toBeGreaterThan(0);
      for (const journey of mapping.journeys) {
        for (const leg of journey.legs) expect(() => legSchema.parse(leg)).not.toThrow();
        expect(findContinuityIssues(journey.legs)).toEqual([]);
      }
    });
  }

  for (const fileName of stopSearches) {
    it(`maps ${fileName}`, () => {
      const response = stopFinderResponseSchema.parse(read(fileName));
      const { suggestions } = mapStopFinderResponse(response.locations ?? [], null);

      expect(suggestions.length).toBeGreaterThan(0);
      for (const { place } of suggestions) expect(() => placeSchema.parse(place)).not.toThrow();
    });
  }

  for (const fileName of facilityLists) {
    it(`reads ${fileName}`, () => {
      const list = carParkListSchema.parse(read(fileName));

      expect(Object.keys(list).length).toBeGreaterThan(0);
    });
  }

  for (const fileName of facilities) {
    it(`reads occupancy from ${fileName}`, () => {
      const occupancy = occupancyFromFeed(carParkFacilitySchema.parse(read(fileName)));

      expect(occupancy).not.toBeNull();
      expect(() => occupancySchema.parse(occupancy)).not.toThrow();
    });
  }
});
