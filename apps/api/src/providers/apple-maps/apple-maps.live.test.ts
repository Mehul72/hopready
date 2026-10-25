import { addMinutes, isWithinGreaterSydney, systemClock, type DriveTime } from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { createAppleMapsProviders, type AppleMapsProviders } from './index';

// Calls the real Apple Maps Server API, which counts against the team's 25,000 calls a day.
// Runs only when all three credentials are in the environment.
const teamId = process.env.APPLE_MAPS_TEAM_ID;
const keyId = process.env.APPLE_MAPS_KEY_ID;
const privateKey = process.env.APPLE_MAPS_PRIVATE_KEY;
const hasCredentials = Boolean(teamId && keyId && privateKey);

const CENTRAL = { lat: -33.8832, lon: 151.2063 };
const PARRAMATTA_STATION = { lat: -33.8173, lon: 151.0045 };
const HORNSBY_STATION = { lat: -33.7032, lon: 151.0989 };
const LIVE_TIMEOUT_MS = 20_000;

let providers: AppleMapsProviders | undefined;
// Created on first use, because a skipped suite still collects its tests.
function liveApple(): AppleMapsProviders {
  providers ??= createAppleMapsProviders({
    teamId: teamId ?? '',
    keyId: keyId ?? '',
    privateKey: privateKey ?? '',
  });
  return providers;
}

const departSoon = (): DriveTime => ({ type: 'depart', at: addMinutes(systemClock.now(), 10) });

describe.runIf(hasCredentials)('Apple Maps Server API (live)', () => {
  it(
    'estimates drives to two stations',
    async () => {
      const estimates = await liveApple().driving.estimateDrives(
        CENTRAL,
        [PARRAMATTA_STATION, HORNSBY_STATION],
        departSoon(),
        AbortSignal.timeout(LIVE_TIMEOUT_MS),
      );

      expect(estimates).toHaveLength(2);
      for (const estimate of estimates) {
        expect(estimate?.durationSeconds).toBeGreaterThan(5 * 60);
        expect(estimate?.distanceMetres).toBeGreaterThan(10_000);
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'routes a drive with a path inside Greater Sydney',
    async () => {
      const route = await liveApple().driving.routeDrive(
        CENTRAL,
        PARRAMATTA_STATION,
        departSoon(),
        AbortSignal.timeout(LIVE_TIMEOUT_MS),
      );

      expect(route.durationSeconds).toBeGreaterThan(5 * 60);
      expect(route.trafficAware).toBe(true);
      expect(route.path.length).toBeGreaterThan(10);
      expect(route.path.every((point) => isWithinGreaterSydney(point))).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'finds Sydney places by name',
    async () => {
      const suggestions = await liveApple().places.search(
        'Town Hall',
        CENTRAL,
        AbortSignal.timeout(LIVE_TIMEOUT_MS),
      );

      expect(suggestions.length).toBeGreaterThan(0);
      for (const suggestion of suggestions) {
        expect(isWithinGreaterSydney(suggestion.place.coordinate)).toBe(true);
        expect(suggestion.place.name.length).toBeGreaterThan(0);
      }
    },
    LIVE_TIMEOUT_MS,
  );
});
