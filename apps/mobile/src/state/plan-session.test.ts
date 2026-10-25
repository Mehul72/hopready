import {
  addMinutes,
  buildItinerary,
  type Itinerary,
  type ParkedCar,
  type PlanRequest,
  type PlanResponse,
  type TransitLeg,
} from '@hopready/core';

import { ApiError } from '@/api/errors';
import { type AppStorage, createAppStorage } from '@/storage/app-storage';
import { StorageError } from '@/storage/stored-value';
import { createSequentialUuids } from '@/test-support/ids';
import { createMemoryBackend } from '@/test-support/memory-kv-store';
import {
  parkAndRideItinerary,
  place,
  PLACES,
  planRequest,
  planResponse,
  transitItinerary,
} from '@/test-support/trips';
import type { RequestOptions } from '@/trip/trip-service';

import { createPlanSession } from './plan-session';

const START = new Date('2026-10-26T20:55:00.000Z');

interface PendingPlan {
  request: PlanRequest;
  signal: AbortSignal | undefined;
  resolve: (response: PlanResponse) => void;
  reject: (error: unknown) => void;
}

// A trip service whose answers the test releases one by one, in any order.
function controllableTrips() {
  const pending: PendingPlan[] = [];
  let mode: 'live' | 'demo' = 'live';
  return {
    pending,
    setMode: (next: 'live' | 'demo') => {
      mode = next;
    },
    service: {
      currentMode: () => mode,
      planTrip: jest.fn(
        (request: PlanRequest, options: RequestOptions = {}) =>
          new Promise<PlanResponse>((resolve, reject) => {
            pending.push({ request, signal: options.signal, resolve, reject });
          }),
      ),
    },
  };
}

function setUp() {
  let now = START;
  const clock = { now: () => now };
  const trips = controllableTrips();
  const storage = createAppStorage(createMemoryBackend(), createSequentialUuids());
  const session = createPlanSession({ trips: trips.service, storage, clock });
  return {
    session,
    storage,
    trips,
    advanceSeconds: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
    now: () => now,
  };
}

function lastPending(pending: PendingPlan[]): PendingPlan {
  const last = pending[pending.length - 1];
  if (!last) throw new Error('No plan request is waiting');
  return last;
}

const departAt = addMinutes(START, 20);
const transit = transitItinerary({ departAt });
const parkAndRide = parkAndRideItinerary({ departAt });

describe('plan', () => {
  it('shows planning, then the results, and remembers the request as recent', async () => {
    const { session, storage, trips } = setUp();
    const request = planRequest();

    const outcome = session.plan(request);
    expect(session.getState()).toMatchObject({ status: 'planning', request, response: null });

    const response = planResponse([transit, parkAndRide]);
    lastPending(trips.pending).resolve(response);

    await expect(outcome).resolves.toEqual({ status: 'ready', response });
    expect(session.getState()).toMatchObject({
      status: 'ready',
      response,
      error: null,
      plannedAt: START.toISOString(),
    });
    expect(storage.recentRequests.get()).toEqual([request]);
  });

  it('ignores an older search that answers after a newer one, and cancels it', async () => {
    const { session, trips } = setUp();
    const first = session.plan(planRequest());
    const second = session.plan(
      planRequest({ time: { type: 'arrive', at: addMinutes(START, 90) } }),
    );
    const [older, newer] = trips.pending;

    expect(older?.signal?.aborted).toBe(true);
    newer?.resolve(planResponse([parkAndRide]));
    older?.resolve(planResponse([transit]));

    await expect(first).resolves.toEqual({ status: 'superseded' });
    await expect(second).resolves.toMatchObject({ status: 'ready' });
    expect(session.getState().response?.itineraries).toEqual([parkAndRide]);
  });

  it('keeps a typed error for the screen', async () => {
    const { session, trips } = setUp();
    const outcome = session.plan(planRequest());
    const failure = new ApiError('offline');
    lastPending(trips.pending).reject(failure);

    await expect(outcome).resolves.toEqual({ status: 'failed', error: failure });
    expect(session.getState()).toMatchObject({ status: 'failed', error: failure, response: null });
  });

  it('reports a bug as unexpected and logs only its type', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, trips } = setUp();
    const outcome = session.plan(planRequest());
    lastPending(trips.pending).reject(new TypeError("Cannot read 'coordinate' of 12 Example St"));

    const result = await outcome;

    expect(result).toMatchObject({ status: 'failed', error: { kind: 'unexpected' } });
    expect(consoleError).toHaveBeenCalledWith(
      'HopReady: unexpected TypeError while planning a trip.',
    );
  });
});

describe('refresh', () => {
  async function plannedSession() {
    const context = setUp();
    const outcome = context.session.plan(
      planRequest({ time: { type: 'depart', at: START.toISOString() } }),
    );
    lastPending(context.trips.pending).resolve(planResponse([transit]));
    await outcome;
    return context;
  }

  it('waits 30 seconds between refreshes', async () => {
    const { session, trips, advanceSeconds } = await plannedSession();
    advanceSeconds(10);
    await expect(session.refresh()).resolves.toEqual({ status: 'too-soon', retryInSeconds: 20 });
    expect(trips.service.planTrip).toHaveBeenCalledTimes(1);
  });

  it('keeps the results visible while refreshing and plans from now', async () => {
    const { session, trips, advanceSeconds, now } = await plannedSession();
    advanceSeconds(45);

    const outcome = session.refresh();
    expect(session.getState()).toMatchObject({
      status: 'refreshing',
      response: planResponse([transit]),
    });
    const refreshed = lastPending(trips.pending);
    expect(refreshed.request.time).toEqual({ type: 'depart', at: now().toISOString() });

    refreshed.resolve(planResponse([parkAndRide]));
    await expect(outcome).resolves.toMatchObject({ status: 'ready' });
    expect(session.getState()).toMatchObject({
      status: 'ready',
      plannedAt: now().toISOString(),
      request: refreshed.request,
    });
  });

  it('keeps the previous results next to the error when a refresh fails', async () => {
    const { session, trips, advanceSeconds } = await plannedSession();
    advanceSeconds(31);
    const outcome = session.refresh();
    lastPending(trips.pending).reject(new ApiError('timeout'));
    await outcome;
    expect(session.getState()).toMatchObject({
      status: 'failed',
      error: { kind: 'timeout' },
      response: planResponse([transit]),
      plannedAt: START.toISOString(),
    });
  });

  it('has nothing to refresh before the first search', async () => {
    const { session } = setUp();
    await expect(session.refresh()).resolves.toEqual({ status: 'nothing-to-refresh' });
  });

  it('fails, rather than rejecting, when the parked car cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, storage, trips, advanceSeconds } = await plannedSession();
    advanceSeconds(31);
    jest.spyOn(storage.parkedCar, 'get').mockImplementation(() => {
      throw new StorageError('Could not read parked-car', { cause: new Error('disk') });
    });

    await expect(session.refresh()).resolves.toMatchObject({
      status: 'failed',
      error: { kind: 'unexpected' },
    });
    expect(trips.service.planTrip).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: 'failed',
      response: planResponse([transit]),
    });
  });
});

describe('select', () => {
  it('makes the chosen option the active trip, with its request and mode', async () => {
    const { session, storage, trips } = setUp();
    const request = planRequest();
    const outcome = session.plan(request);
    lastPending(trips.pending).resolve(planResponse([transit, parkAndRide], { mode: 'demo' }));
    await outcome;

    expect(session.select(parkAndRide.id)).toEqual(parkAndRide);
    expect(session.getState().selectedItineraryId).toBe(parkAndRide.id);
    expect(storage.activeTrip.get()).toEqual({
      request,
      itinerary: parkAndRide,
      plannedAt: START.toISOString(),
      mode: 'demo',
    });
    expect(session.select('not-an-option')).toBeNull();
  });
});

describe('refreshActiveTrip', () => {
  function withActiveTrip(plannedSecondsAgo: number) {
    const context = setUp();
    context.storage.activeTrip.start({
      request: planRequest({ time: { type: 'depart', at: START.toISOString() } }),
      itinerary: parkAndRide,
      plannedAt: new Date(START.getTime() - plannedSecondsAgo * 1000).toISOString(),
      mode: 'live',
    });
    return context;
  }

  it('updates the active trip with the same services from a new plan', async () => {
    const { session, storage, trips } = withActiveTrip(120);
    const refreshed = session.refreshActiveTrip();
    expect(session.getState().activeTripRefresh.status).toBe('refreshing');
    const live = parkAndRideItinerary({ departAt, realtime: true });
    lastPending(trips.pending).resolve(planResponse([transit, live]));
    await refreshed;

    expect(session.getState().activeTripRefresh).toMatchObject({ status: 'updated', error: null });
    expect(storage.activeTrip.get()).toMatchObject({
      itinerary: live,
      plannedAt: START.toISOString(),
    });
  });

  it('follows the same option on another run, and keeps the run that was chosen', async () => {
    const { session, storage, trips } = withActiveTrip(120);
    const refreshed = session.refreshActiveTrip();
    const nextRun = parkAndRideItinerary({ departAt: addMinutes(departAt, 10) });
    lastPending(trips.pending).resolve(planResponse([transit, nextRun]));
    await refreshed;

    expect(session.getState().activeTripRefresh).toMatchObject({
      status: 'replaced',
      previous: parkAndRide,
    });
    expect(storage.activeTrip.get()?.itinerary).toEqual(nextRun);
  });

  it('says when the chosen option is no longer offered and keeps the alternatives', async () => {
    const { session, storage, trips } = withActiveTrip(120);
    const refreshed = session.refreshActiveTrip();
    const searched = lastPending(trips.pending);
    searched.resolve(planResponse([transit]));
    await refreshed;

    expect(session.getState().activeTripRefresh).toMatchObject({
      status: 'no-longer-offered',
      alternatives: [transit],
      request: searched.request,
    });
    expect(storage.activeTrip.get()?.itinerary).toEqual(parkAndRide);
  });

  it('leaves a trip planned in the last minute alone', async () => {
    const { session, trips } = withActiveTrip(30);
    await session.refreshActiveTrip();
    expect(trips.service.planTrip).not.toHaveBeenCalled();
    expect(session.getState().activeTripRefresh.status).toBe('idle');
  });

  it('records a failed refresh without rejecting', async () => {
    const { session, trips } = withActiveTrip(120);
    const refreshed = session.refreshActiveTrip();
    lastPending(trips.pending).reject(new ApiError('offline'));
    await expect(refreshed).resolves.toBeUndefined();
    expect(session.getState().activeTripRefresh).toMatchObject({
      status: 'failed',
      error: { kind: 'offline' },
    });
  });
});

describe('a followed trip that has started', () => {
  // Left five minutes ago and driving to the car park; the metro leaves in twelve minutes.
  const started = parkAndRideItinerary({ departAt: addMinutes(START, -5) });
  const metro = started.legs.find((leg): leg is TransitLeg => leg.kind === 'transit')!;
  const request = planRequest();

  function followingStartedTrip(plannedSecondsAgo = 120) {
    const context = setUp();
    context.storage.activeTrip.start({
      request,
      itinerary: started,
      plannedAt: new Date(START.getTime() - plannedSecondsAgo * 1000).toISOString(),
      mode: 'live',
    });
    return context;
  }

  // What planning from the station offers: the rest of `trip`, `lateMinutes` late.
  function restFromStation(trip: Itinerary, lateMinutes = 0): Itinerary {
    const fromMetro = trip.legs.slice(trip.legs.findIndex((leg) => leg.kind === 'transit'));
    return buildItinerary({
      strategy: 'transit-only',
      legs: fromMetro.map((leg) => ({
        ...leg,
        start: addMinutes(leg.start, lateMinutes),
        end: addMinutes(leg.end, lateMinutes),
      })),
    });
  }

  it('checks the rest of it on resume, from the station the metro leaves', () => {
    const { session, trips } = followingStartedTrip();

    void session.refreshActiveTrip();

    expect(lastPending(trips.pending).request).toEqual({
      origin: metro.from,
      destination: request.destination,
      time: { type: 'depart', at: metro.start },
      access: { transit: true, drive: false, dropOff: false },
      preferences: request.preferences,
      trip: { kind: 'outbound' },
    });
  });

  it('keeps following the whole trip, with the latest times, while its services run', async () => {
    const { session, storage, trips } = followingStartedTrip();
    const checked = session.refreshActiveTrip();
    lastPending(trips.pending).resolve(planResponse([restFromStation(started, 3)]));
    await checked;

    expect(session.getState().activeTripRefresh).toMatchObject({ status: 'updated' });
    expect(storage.activeTrip.get()).toMatchObject({
      request,
      itinerary: {
        id: started.id,
        departAt: started.departAt,
        arriveAt: addMinutes(started.arriveAt, 3),
      },
      plannedAt: START.toISOString(),
    });
  });

  it('offers what runs from the station when a service still to come is cancelled', async () => {
    const { session, storage, trips } = followingStartedTrip();
    const checked = session.refreshActiveTrip();
    const searched = lastPending(trips.pending);
    const nextRun = restFromStation(parkAndRideItinerary({ departAt: START.toISOString() }));
    searched.resolve(planResponse([nextRun]));
    await checked;

    expect(session.getState().activeTripRefresh).toMatchObject({
      status: 'no-longer-offered',
      alternatives: [nextRun],
      request: searched.request,
    });
    expect(storage.activeTrip.get()?.itinerary).toEqual(started);
  });

  it('has nothing to check once the metro has left', async () => {
    const { session, trips, advanceSeconds } = followingStartedTrip();
    advanceSeconds(13 * 60);

    await session.refreshActiveTrip();

    await expect(session.checkActiveTrip()).resolves.toEqual({ status: 'nothing-to-check' });
    expect(trips.service.planTrip).not.toHaveBeenCalled();
  });
});

describe('checkActiveTrip', () => {
  function following(plannedSecondsAgo: number) {
    const context = setUp();
    context.storage.activeTrip.start({
      request: planRequest(),
      itinerary: parkAndRide,
      plannedAt: new Date(START.getTime() - plannedSecondsAgo * 1000).toISOString(),
      mode: 'live',
    });
    return context;
  }

  it('checks when asked, at most every 30 seconds', async () => {
    const { session, trips, advanceSeconds } = following(10);
    await expect(session.checkActiveTrip()).resolves.toEqual({
      status: 'too-soon',
      retryInSeconds: 20,
    });
    advanceSeconds(20);

    const checked = session.checkActiveTrip();
    lastPending(trips.pending).resolve(planResponse([parkAndRide]));

    await expect(checked).resolves.toEqual({ status: 'checked' });
    expect(session.getState().activeTripRefresh.status).toBe('updated');
  });

  it('counts a check that found the trip no longer offered, but never a failed one', async () => {
    const { session, trips, advanceSeconds } = following(120);
    const failed = session.checkActiveTrip();
    lastPending(trips.pending).reject(new ApiError('offline'));
    await failed;

    const retried = session.checkActiveTrip();
    lastPending(trips.pending).resolve(planResponse([transit]));
    await retried;
    expect(session.getState().activeTripRefresh.status).toBe('no-longer-offered');

    advanceSeconds(10);
    await expect(session.checkActiveTrip()).resolves.toEqual({
      status: 'too-soon',
      retryInSeconds: 20,
    });
    await session.refreshActiveTrip();
    expect(trips.service.planTrip).toHaveBeenCalledTimes(2);
  });
});

describe('a trip home after the parked car changed', () => {
  const PARKED: ParkedCar = {
    location: PLACES.tallawongCarPark,
    carParkId: '26',
    confirmedAt: '2026-10-26T08:00:00.000Z',
  };
  // A correction moves the car and keeps when it was parked.
  const CORRECTED: ParkedCar = {
    ...PARKED,
    location: place('Pinned location', -33.6951, 150.9071),
    carParkId: null,
  };
  const tripHome = planRequest({
    origin: PLACES.chatswoodOffice,
    destination: PLACES.rouseHillHome,
    time: { type: 'depart', at: START.toISOString() },
    access: { transit: true, drive: true, dropOff: false },
    trip: { kind: 'return-via-car', parkedCar: PARKED },
  });
  const CHANGES: [string, (storage: AppStorage) => void][] = [
    ['the car is moved', (storage) => storage.parkedCar.markParked(CORRECTED, null)],
    ['the car is removed', (storage) => storage.parkedCar.clear()],
    [
      'the person says they were dropped off',
      (storage) => storage.parkedCar.markDroppedOff(START.toISOString()),
    ],
  ];

  async function plannedTripHome() {
    const context = setUp();
    context.storage.parkedCar.markParked(PARKED, 'Tallawong P1');
    const outcome = context.session.plan(tripHome);
    lastPending(context.trips.pending).resolve(planResponse([transit]));
    await outcome;
    context.advanceSeconds(31);
    return context;
  }

  function followedTripHome() {
    const context = setUp();
    context.storage.parkedCar.markParked(PARKED, 'Tallawong P1');
    context.storage.activeTrip.start({
      request: tripHome,
      itinerary: transit,
      plannedAt: new Date(START.getTime() - 120_000).toISOString(),
      mode: 'live',
    });
    return context;
  }

  it('still refreshes and checks a trip home after the car is confirmed again in its spot', async () => {
    const again: ParkedCar = { ...PARKED, confirmedAt: START.toISOString() };
    const planned = await plannedTripHome();
    planned.storage.parkedCar.markParked(again, 'Tallawong P1');

    void planned.session.refresh();

    expect(lastPending(planned.trips.pending).request.trip).toEqual({
      kind: 'return-via-car',
      parkedCar: again,
    });

    const followed = followedTripHome();
    followed.storage.parkedCar.markParked(again, 'Tallawong P1');

    void followed.session.refreshActiveTrip();

    expect(lastPending(followed.trips.pending).request.trip).toEqual({
      kind: 'return-via-car',
      parkedCar: again,
    });
  });

  it.each(CHANGES)('never refreshes the results back to the old car when %s', async (_, change) => {
    const { session, storage, trips } = await plannedTripHome();
    change(storage);

    await expect(session.refresh()).resolves.toEqual({ status: 'car-changed' });

    expect(trips.service.planTrip).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ status: 'ready', request: tripHome });
  });

  it.each(CHANGES)(
    'never checks the followed trip against the old car when %s',
    async (_, change) => {
      const { session, storage, trips } = followedTripHome();
      change(storage);

      await session.refreshActiveTrip();

      expect(trips.service.planTrip).not.toHaveBeenCalled();
      expect(session.getState().activeTripRefresh.status).toBe('idle');
    },
  );
});

describe('reset', () => {
  it('forgets results when all data is deleted', async () => {
    const { session, storage, trips } = setUp();
    const outcome = session.plan(planRequest());
    lastPending(trips.pending).resolve(planResponse([transit]));
    await outcome;

    storage.deleteAllData();

    expect(session.getState()).toMatchObject({ status: 'idle', request: null, response: null });
  });

  it('drops results and cancels a search when demo mode is switched', async () => {
    const { session, storage, trips } = setUp();
    const outcome = session.plan(planRequest());

    trips.setMode('demo');
    storage.settings.setDemoMode(true);

    expect(lastPending(trips.pending).signal?.aborted).toBe(true);
    expect(session.getState().status).toBe('idle');
    lastPending(trips.pending).resolve(planResponse([transit]));
    await expect(outcome).resolves.toEqual({ status: 'superseded' });
    expect(session.getState().response).toBeNull();
  });
});
