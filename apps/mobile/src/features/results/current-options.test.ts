import { DEFAULT_PREFERENCES } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';

import { DEFAULT_APP_PREFERENCES } from '@/storage';
import { planRequest } from '@/test-support/trips';

import { optionsChangedSince, withCurrentOptions } from './current-options';

const NO_PREFERRED_STOPS = { preferredStation: null, preferredCarPark: null };

describe('withCurrentOptions', () => {
  it('takes the current preferences and preferred stops, keeping the trip itself', () => {
    const request = planRequest({ preferredCarParkId: '26' });
    const updated = withCurrentOptions(
      request,
      { ...DEFAULT_APP_PREFERENCES, transferBufferMinutes: 6, navigationApp: 'google' },
      { preferredStation: DEMO_PLACES.castleTowers, preferredCarPark: null },
    );

    expect(updated).toEqual({
      ...request,
      preferredCarParkId: undefined,
      preferences: { ...DEFAULT_PREFERENCES, transferBufferMinutes: 6 },
      preferredStop: DEMO_PLACES.castleTowers,
    });
    expect(updated).not.toHaveProperty('preferredCarParkId');
    expect(updated.preferences).not.toHaveProperty('navigationApp');
  });

  it('leaves the preferred stops of a trip home as they were', () => {
    const request = planRequest({ preferredCarParkId: '26', trip: { kind: 'return-without-car' } });
    const updated = withCurrentOptions(request, DEFAULT_APP_PREFERENCES, NO_PREFERRED_STOPS);
    expect(updated.preferredCarParkId).toBe('26');
  });
});

describe('optionsChangedSince', () => {
  it('ignores the order of avoided modes', () => {
    const before = planRequest({
      preferences: { ...DEFAULT_PREFERENCES, excludedTransitModes: ['bus', 'ferry'] },
    });
    const after = planRequest({
      preferences: { ...DEFAULT_PREFERENCES, excludedTransitModes: ['ferry', 'bus'] },
    });
    expect(optionsChangedSince(before, after)).toBe(false);
  });

  it('notices a changed buffer, limit or preferred stop', () => {
    const before = planRequest();
    expect(
      optionsChangedSince(
        before,
        planRequest({ preferences: { ...before.preferences, parkingBufferMinutes: 10 } }),
      ),
    ).toBe(true);
    expect(optionsChangedSince(before, planRequest({ preferredCarParkId: '29' }))).toBe(true);
    expect(
      optionsChangedSince(before, planRequest({ preferredStop: DEMO_PLACES.castleTowers })),
    ).toBe(true);
    expect(optionsChangedSince(before, planRequest())).toBe(false);
  });
});
