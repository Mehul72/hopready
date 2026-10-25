import { DEFAULT_PREFERENCES } from '@hopready/core';

import { createSequentialUuids } from '@/test-support/ids';
import { createMemoryBackend } from '@/test-support/memory-kv-store';
import { parkAndRideItinerary, PLACES, planRequest, transitItinerary } from '@/test-support/trips';

import { createAppStorage } from './app-storage';
import { recentRequestKey } from './recent-requests';
import { MAX_FAVOURITE_PLACES, MAX_RECENT_REQUESTS } from './schemas';
import { hasLiveDataConsent, LIVE_DATA_CONSENT_VERSION } from './settings';
import { StorageError, storageKey } from './stored-value';

const NOW = '2026-10-26T20:55:00.000Z';

function freshStorage(initial: Record<string, string> = {}) {
  const backend = createMemoryBackend(initial);
  const storage = createAppStorage(backend, createSequentialUuids());
  return { backend, storage };
}

describe('stored values', () => {
  it('round-trips every kind of saved data through the backend', () => {
    const { backend, storage } = freshStorage();
    const itinerary = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' });

    storage.preferences.change({ maxWalkMinutes: 10, navigationApp: 'waze' });
    storage.places.setHome(PLACES.rouseHillHome);
    storage.places.addFavourite('Office', PLACES.chatswoodOffice);
    storage.favouriteRoutes.add({
      label: 'Work',
      origin: PLACES.rouseHillHome,
      destination: PLACES.chatswoodOffice,
    });
    storage.recentRequests.record(planRequest());
    storage.parkedCar.markParked(
      { location: PLACES.tallawongCarPark, carParkId: '26', confirmedAt: NOW },
      'Tallawong P1',
    );
    storage.parkingSpots.add('Street near the shops', { lat: -33.69, lon: 150.92 });
    storage.activeTrip.start({ request: planRequest(), itinerary, plannedAt: NOW, mode: 'live' });

    // A second instance over the same backend reads only what was persisted.
    const reopened = createAppStorage(backend, createSequentialUuids());
    expect(reopened.preferences.get()).toMatchObject({ maxWalkMinutes: 10, navigationApp: 'waze' });
    expect(reopened.places.get().home).toEqual(PLACES.rouseHillHome);
    expect(reopened.places.get().favourites).toEqual([
      expect.objectContaining({ label: 'Office', place: PLACES.chatswoodOffice }),
    ]);
    expect(reopened.favouriteRoutes.get()).toEqual([
      expect.objectContaining({ label: 'Work', destination: PLACES.chatswoodOffice }),
    ]);
    expect(reopened.recentRequests.get()).toEqual([planRequest()]);
    expect(reopened.parkedCar.get()).toEqual({
      status: 'parked',
      parkedCar: { location: PLACES.tallawongCarPark, carParkId: '26', confirmedAt: NOW },
      carParkName: 'Tallawong P1',
    });
    expect(reopened.parkingSpots.get()).toEqual([
      expect.objectContaining({ name: 'Street near the shops' }),
    ]);
    expect(reopened.activeTrip.get()?.itinerary).toEqual(itinerary);
    expect(reopened.settings.get().installId).toBe(storage.settings.get().installId);
  });

  it('starts from the documented defaults when nothing is saved', () => {
    const { storage } = freshStorage();
    expect(storage.preferences.get()).toEqual({ ...DEFAULT_PREFERENCES, navigationApp: 'ask' });
    expect(storage.places.get()).toEqual({ home: null, work: null, favourites: [] });
    expect(storage.parkedCar.get()).toEqual({ status: 'none' });
    expect(storage.activeTrip.get()).toBeNull();
    expect(storage.settings.get()).toMatchObject({ demoMode: false, demoScenario: null });
  });

  it('returns the same object until the value changes, as useSyncExternalStore needs', () => {
    const { storage } = freshStorage();
    const first = storage.preferences.get();
    expect(storage.preferences.get()).toBe(first);
    storage.preferences.change({ maxDriveMinutes: 40 });
    expect(storage.preferences.get()).not.toBe(first);
  });

  it('tells subscribers about changes and stops after they unsubscribe', () => {
    const { storage } = freshStorage();
    const listener = jest.fn();
    const unsubscribe = storage.places.subscribe(listener);
    storage.places.setWork(PLACES.chatswoodOffice);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    storage.places.setWork(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('refuses to save a value outside the planner limits', () => {
    const { storage } = freshStorage();
    expect(() => storage.preferences.change({ maxWalkMinutes: 500 })).toThrow(StorageError);
    expect(storage.preferences.get().maxWalkMinutes).toBe(DEFAULT_PREFERENCES.maxWalkMinutes);
  });
});

describe('corrupted storage', () => {
  it.each([
    ['not JSON', '{"home": {"name": "12 Example St'],
    ['the wrong shape', JSON.stringify({ home: 'not a place', favourites: 'many' })],
  ])(
    'resets a value that is %s to its default, with a warning that holds no personal data',
    (_, raw) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { backend, storage } = freshStorage({ [storageKey('places', 1)]: raw });

      expect(storage.places.get()).toEqual({ home: null, work: null, favourites: [] });
      expect(JSON.parse(backend.values.get(storageKey('places', 1)) ?? 'null')).toEqual({
        home: null,
        work: null,
        favourites: [],
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('places');
      expect(message).not.toContain('Example');
      expect(message).not.toContain('not a place');
    },
  );

  it('keeps saved preferences when a newer release adds a field', () => {
    const { maxWalkMinutes: _dropped, ...withoutWalk } = {
      ...DEFAULT_PREFERENCES,
      maxDriveMinutes: 45,
    };
    const { storage } = freshStorage({
      [storageKey('preferences', 1)]: JSON.stringify(withoutWalk),
    });
    expect(storage.preferences.get()).toMatchObject({
      maxDriveMinutes: 45,
      maxWalkMinutes: DEFAULT_PREFERENCES.maxWalkMinutes,
      navigationApp: 'ask',
    });
  });

  it('replaces an install ID the server would reject', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { storage } = freshStorage({
      [storageKey('settings', 1)]: JSON.stringify({
        demoMode: true,
        demoScenario: null,
        installId: 'not-a-uuid',
      }),
    });
    expect(storage.settings.get().installId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('deleteAllData', () => {
  it('removes every HopReady key, keeps other keys, and creates a new install ID', () => {
    const { backend, storage } = freshStorage({
      'hopready.places.v0': '{"left": "by an old release"}',
      'another-library.cache': 'kept',
    });
    const oldInstallId = storage.settings.get().installId;
    storage.places.setHome(PLACES.rouseHillHome);
    storage.recentRequests.record(planRequest());
    storage.settings.setDemoMode(true);
    const onDeleted = jest.fn();
    storage.onDataDeleted(onDeleted);

    storage.deleteAllData();

    expect(storage.places.get().home).toBeNull();
    expect(storage.recentRequests.get()).toEqual([]);
    expect(storage.settings.get().demoMode).toBe(false);
    expect(storage.settings.get().installId).not.toBe(oldInstallId);
    expect([...backend.values.keys()].sort()).toEqual([
      'another-library.cache',
      storageKey('settings', 1),
    ]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers so open screens show the cleared values', () => {
    const { storage } = freshStorage();
    storage.places.setHome(PLACES.rouseHillHome);
    const listener = jest.fn();
    storage.places.subscribe(listener);
    storage.deleteAllData();
    expect(listener).toHaveBeenCalled();
    expect(storage.places.get().home).toBeNull();
  });
});

describe('collections', () => {
  it('keeps the last 20 recent requests, newest first, without duplicates', () => {
    const { storage } = freshStorage();
    for (let minute = 0; minute < MAX_RECENT_REQUESTS + 5; minute++) {
      storage.recentRequests.record(
        planRequest({
          destination: {
            ...PLACES.chatswoodOffice,
            coordinate: { lat: -33.79, lon: 151 + minute / 100 },
          },
        }),
      );
    }
    const repeated = planRequest({ time: { type: 'arrive', at: '2026-10-27T22:00:00.000Z' } });
    storage.recentRequests.record(planRequest());
    storage.recentRequests.record(repeated);

    const recents = storage.recentRequests.get();
    expect(recents).toHaveLength(MAX_RECENT_REQUESTS);
    expect(recents[0]).toEqual(repeated);
    expect(
      recents.filter((request) => recentRequestKey(request) === recentRequestKey(repeated)),
    ).toHaveLength(1);
  });

  it('treats every "Current location" origin as the same recent trip', () => {
    const { storage } = freshStorage();
    const fromHere = (lat: number) =>
      planRequest({
        origin: {
          name: 'Current location',
          coordinate: { lat, lon: 150.9 },
          kind: 'current-location',
        },
      });
    storage.recentRequests.record(fromHere(-33.7));
    storage.recentRequests.record(fromHere(-33.71));
    expect(storage.recentRequests.get()).toHaveLength(1);
  });

  it('reports a favourite that is already saved instead of adding it twice', () => {
    const { storage } = freshStorage();
    const first = storage.places.addFavourite('Office', PLACES.chatswoodOffice);
    const nearby = { ...PLACES.chatswoodOffice, coordinate: { lat: -33.79752, lon: 151.18322 } };
    const second = storage.places.addFavourite('Work again', nearby);
    expect(first.status).toBe('added');
    expect(second).toEqual({
      status: 'already-saved',
      item: first.status === 'added' ? first.item : null,
    });
    expect(storage.places.get().favourites).toHaveLength(1);
  });

  it('stops at 30 favourite places and says so', () => {
    const { storage } = freshStorage();
    for (let index = 0; index < MAX_FAVOURITE_PLACES; index++) {
      storage.places.addFavourite(`Place ${index}`, {
        ...PLACES.chatswoodOffice,
        coordinate: { lat: -33.7 - index / 100, lon: 151 },
      });
    }
    expect(storage.places.addFavourite('One more', PLACES.rouseHillHome)).toEqual({
      status: 'limit-reached',
      limit: MAX_FAVOURITE_PLACES,
    });
  });

  it('renames and removes favourites by id, and reports ids that no longer exist', () => {
    const { storage } = freshStorage();
    const added = storage.places.addFavourite('Office', PLACES.chatswoodOffice);
    if (added.status !== 'added') throw new Error('expected the favourite to be added');
    expect(storage.places.renameFavourite(added.item.id, '  Work  ')).toBe(true);
    expect(storage.places.get().favourites[0]?.label).toBe('Work');
    expect(storage.places.removeFavourite(added.item.id)).toBe(true);
    expect(storage.places.removeFavourite(added.item.id)).toBe(false);
    expect(storage.places.renameFavourite(added.item.id, 'Gone')).toBe(false);
  });
});

describe('demo mode switch', () => {
  it('clears an active trip that belongs to the other mode', () => {
    const { storage } = freshStorage();
    const itinerary = transitItinerary({ departAt: '2026-10-26T21:00:00.000Z' });
    storage.activeTrip.start({ request: planRequest(), itinerary, plannedAt: NOW, mode: 'live' });

    storage.settings.setDemoMode(true);

    expect(storage.settings.get().demoMode).toBe(true);
    expect(storage.activeTrip.get()).toBeNull();
  });

  it('keeps an active trip from the mode being switched to', () => {
    const { storage } = freshStorage();
    storage.settings.setDemoMode(true);
    const itinerary = transitItinerary({ departAt: '2026-10-26T21:00:00.000Z' });
    storage.activeTrip.start({ request: planRequest(), itinerary, plannedAt: NOW, mode: 'demo' });

    storage.settings.setDemoMode(true);

    expect(storage.activeTrip.get()?.mode).toBe('demo');
  });
});

describe('live data consent', () => {
  it('starts unanswered on a fresh install', () => {
    const { storage } = freshStorage();

    expect(storage.settings.get().liveDataConsent).toBeNull();
    expect(hasLiveDataConsent(storage.settings.get())).toBe(false);
  });

  it('records the current version and time, and survives a restart', () => {
    const { backend, storage } = freshStorage();

    storage.settings.acceptLiveDataConsent(new Date(NOW));

    const reopened = createAppStorage(backend, createSequentialUuids());
    expect(reopened.settings.get().liveDataConsent).toEqual({
      version: LIVE_DATA_CONSENT_VERSION,
      acceptedAt: NOW,
    });
    expect(hasLiveDataConsent(reopened.settings.get())).toBe(true);
  });

  it('asks again after it is withdrawn', () => {
    const { storage } = freshStorage();
    storage.settings.acceptLiveDataConsent(new Date(NOW));

    storage.settings.withdrawLiveDataConsent();

    expect(hasLiveDataConsent(storage.settings.get())).toBe(false);
  });

  it('keeps settings saved before consent existed, without assuming agreement', () => {
    const { storage } = freshStorage({
      [storageKey('settings', 1)]: JSON.stringify({
        demoMode: true,
        demoScenario: null,
        installId: '00000000-0000-4000-8000-0000000000aa',
      }),
    });

    expect(storage.settings.get()).toMatchObject({
      demoMode: true,
      installId: '00000000-0000-4000-8000-0000000000aa',
      liveDataConsent: null,
    });
  });

  it('treats a damaged record as not agreed, keeping the other settings', () => {
    const { storage } = freshStorage({
      [storageKey('settings', 1)]: JSON.stringify({
        demoMode: true,
        demoScenario: null,
        installId: '00000000-0000-4000-8000-0000000000aa',
        liveDataConsent: { version: 'one', acceptedAt: 'yesterday' },
      }),
    });

    expect(storage.settings.get()).toMatchObject({ demoMode: true, liveDataConsent: null });
  });

  it('only counts agreement to the current explanation', () => {
    const otherVersion = { version: LIVE_DATA_CONSENT_VERSION + 1, acceptedAt: NOW };

    expect(hasLiveDataConsent({ liveDataConsent: otherVersion })).toBe(false);
  });

  it('is forgotten with everything else by delete all data', () => {
    const { storage } = freshStorage();
    storage.settings.acceptLiveDataConsent(new Date(NOW));

    storage.deleteAllData();

    expect(storage.settings.get().liveDataConsent).toBeNull();
  });
});
