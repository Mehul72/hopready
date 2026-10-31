import { describe, expect, it } from 'vitest';

import { PARK_AND_RIDE_CATALOGUE } from './park-and-ride';
import { HUB_PERIODS, HUB_TIMES_BY_STATION, HUBS } from './park-and-ride-hub-times';

describe('Park&Ride hub times', () => {
  it('cover every station in the catalogue, every hub and every period', () => {
    const stations = new Set(PARK_AND_RIDE_CATALOGUE.map((carPark) => carPark.station.stopId));

    for (const stopId of stations) {
      const byHub = HUB_TIMES_BY_STATION[stopId];
      expect(byHub, `station ${stopId}`).toBeDefined();
      for (const hub of HUBS) {
        const byPeriod = byHub?.[hub.id];
        expect(byPeriod, `station ${stopId} to ${hub.id}`).toBeDefined();
        for (const period of HUB_PERIODS) expect(byPeriod?.[period]).not.toBeUndefined();
      }
    }
  });

  it('hold plausible on-board times and headways', () => {
    for (const [stopId, byHub] of Object.entries(HUB_TIMES_BY_STATION)) {
      for (const [hubId, byPeriod] of Object.entries(byHub)) {
        for (const period of HUB_PERIODS) {
          const time = byPeriod[period];
          if (time === null) continue;
          const [rideMinutes, headwayMinutes] = time;
          expect(rideMinutes, `${stopId} to ${hubId} ${period}`).toBeGreaterThanOrEqual(0);
          // Kiama to the city is the longest ride among the catalogued stations.
          expect(rideMinutes, `${stopId} to ${hubId} ${period}`).toBeLessThanOrEqual(240);
          expect(headwayMinutes, `${stopId} to ${hubId} ${period}`).toBeGreaterThanOrEqual(0);
          // Gosford to the city runs about every two and a half hours late in the evening.
          expect(headwayMinutes, `${stopId} to ${hubId} ${period}`).toBeLessThanOrEqual(240);
        }
      }
    }
  });

  it('name distinct hubs with stop ids', () => {
    expect(new Set(HUBS.map((hub) => hub.id)).size).toBe(HUBS.length);
    for (const hub of HUBS) expect(hub.stopId).toMatch(/^\d+$/);
  });
});
