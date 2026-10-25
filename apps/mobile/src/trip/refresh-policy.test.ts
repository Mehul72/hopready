import { addMinutes } from '@hopready/core';

import type { ActiveTrip } from '@/storage';
import { parkAndRideItinerary, planRequest, transitItinerary } from '@/test-support/trips';

import { matchItinerary } from './itinerary-match';
import {
  manualRefreshAvailability,
  refreshableRequest,
  shouldRefreshActiveTripOnResume,
} from './refresh-policy';

const NOW = new Date('2026-10-26T20:55:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

function activeTrip(overrides: Partial<ActiveTrip> = {}): ActiveTrip {
  return {
    request: planRequest(),
    itinerary: transitItinerary({ departAt: addMinutes(NOW, 20) }),
    plannedAt: secondsAgo(120),
    mode: 'live',
    ...overrides,
  };
}

describe('manual refresh', () => {
  it('is allowed when nothing has been planned yet', () => {
    expect(manualRefreshAvailability(null, NOW)).toEqual({ allowed: true });
  });

  it('waits until 30 seconds after the last results arrived', () => {
    expect(manualRefreshAvailability(secondsAgo(10), NOW)).toEqual({
      allowed: false,
      retryInSeconds: 20,
    });
    expect(manualRefreshAvailability(secondsAgo(29), NOW)).toEqual({
      allowed: false,
      retryInSeconds: 1,
    });
    expect(manualRefreshAvailability(secondsAgo(30), NOW)).toEqual({ allowed: true });
  });

  it('is allowed after the clock was set backwards, rather than blocking for hours', () => {
    expect(manualRefreshAvailability(addMinutes(NOW, 90), NOW)).toEqual({ allowed: true });
  });
});

describe('refresh on resume', () => {
  it('refreshes an active trip planned more than 60 seconds ago that has not started', () => {
    expect(shouldRefreshActiveTripOnResume(activeTrip(), NOW, 'live')).toBe(true);
  });

  it('does nothing without an active trip', () => {
    expect(shouldRefreshActiveTripOnResume(null, NOW, 'live')).toBe(false);
  });

  it('leaves a trip planned in the last 60 seconds alone', () => {
    expect(
      shouldRefreshActiveTripOnResume(activeTrip({ plannedAt: secondsAgo(60) }), NOW, 'live'),
    ).toBe(false);
    expect(
      shouldRefreshActiveTripOnResume(activeTrip({ plannedAt: secondsAgo(61) }), NOW, 'live'),
    ).toBe(true);
  });

  it('never refreshes a demo trip with live data, or a live trip with demo data', () => {
    expect(shouldRefreshActiveTripOnResume(activeTrip({ mode: 'demo' }), NOW, 'live')).toBe(false);
    expect(shouldRefreshActiveTripOnResume(activeTrip({ mode: 'live' }), NOW, 'demo')).toBe(false);
  });

  it('skips a trip that has already started, which planning again could not find', () => {
    const started = activeTrip({ itinerary: transitItinerary({ departAt: addMinutes(NOW, -5) }) });
    expect(shouldRefreshActiveTripOnResume(started, NOW, 'live')).toBe(false);
  });
});

describe('refreshableRequest', () => {
  it('moves a "leave at" time that has passed up to now', () => {
    const request = planRequest({ time: { type: 'depart', at: addMinutes(NOW, -10) } });
    expect(refreshableRequest(request, NOW).time).toEqual({
      type: 'depart',
      at: NOW.toISOString(),
    });
  });

  it('keeps a future "leave at" time and every "arrive by" time', () => {
    const later = planRequest({ time: { type: 'depart', at: addMinutes(NOW, 30) } });
    const arriveBy = planRequest({ time: { type: 'arrive', at: addMinutes(NOW, -10) } });
    expect(refreshableRequest(later, NOW)).toBe(later);
    expect(refreshableRequest(arriveBy, NOW)).toBe(arriveBy);
  });
});

describe('matchItinerary', () => {
  const chosen = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' });

  it('finds the very same trip, with its updated times', () => {
    const live = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z', realtime: true });
    expect(live.id).toBe(chosen.id);
    expect(
      matchItinerary(chosen, [transitItinerary({ departAt: NOW.toISOString() }), live]),
    ).toEqual({
      itinerary: live,
      exact: true,
    });
  });

  it('falls back to the same strategy, car park and first service on the closest run', () => {
    const muchLater = parkAndRideItinerary({ departAt: '2026-10-26T22:00:00.000Z' });
    const nextRun = parkAndRideItinerary({ departAt: '2026-10-26T21:10:00.000Z' });
    const otherService = parkAndRideItinerary({
      departAt: '2026-10-26T21:05:00.000Z',
      service: 'T1',
    });
    expect(matchItinerary(chosen, [muchLater, otherService, nextRun])).toEqual({
      itinerary: nextRun,
      exact: false,
    });
  });

  it('reports nothing when the chosen option is no longer offered', () => {
    expect(matchItinerary(chosen, [transitItinerary({ departAt: NOW.toISOString() })])).toBeNull();
  });
});
