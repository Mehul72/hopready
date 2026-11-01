import { addMinutes, buildItinerary, type VehiclesResponse } from '@hopready/core';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { apiClient, ApiError } from '@/api';
import { appStorage } from '@/storage';
import { metroThenBusItinerary, transitItinerary } from '@/test-support/trips';

import { tripService } from './trip-service';
import {
  trackedLegsOf,
  useVehiclePositions,
  VEHICLE_LOOKAHEAD_MS,
  VEHICLE_REFRESH_MS,
} from './vehicle-positions';

const DEPART = '2026-10-26T21:00:00.000Z';
const DEPART_MS = Date.parse(DEPART);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function answer(response: Partial<VehiclesResponse> = {}): VehiclesResponse {
  return { mode: 'live', checkedAt: DEPART, vehicles: [], ...response };
}

beforeEach(() => {
  client = new QueryClient();
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  client.clear();
  focusManager.setFocused(undefined);
});

describe('trackedLegsOf', () => {
  const trip = metroThenBusItinerary({
    departAt: DEPART,
    tripIds: ['0273-001-152-008:1000', '2703224'],
  });

  it('picks each public transport leg with a trip id, in order', () => {
    const tracked = trackedLegsOf(trip, DEPART_MS);
    expect(tracked.map(({ service }) => service)).toEqual([
      { mode: 'metro', realtimeTripId: '0273-001-152-008:1000' },
      { mode: 'bus', realtimeTripId: '2703224' },
    ]);
    expect(tracked.map(({ legIndex }) => trip.legs[legIndex]?.kind)).toEqual([
      'transit',
      'transit',
    ]);
  });

  it('drops a leg once it has ended, and one without a trip id', () => {
    const metroEnds = Date.parse(trip.legs.find((leg) => leg.kind === 'transit')!.end);
    expect(trackedLegsOf(trip, metroEnds).map(({ service }) => service.mode)).toEqual(['bus']);
    expect(trackedLegsOf(transitItinerary({ departAt: DEPART }), DEPART_MS)).toEqual([]);
  });

  it('leaves out a cancelled service', () => {
    const cancelled = buildItinerary({
      strategy: 'transit-only',
      legs: trip.legs.map((leg) => (leg.kind === 'transit' ? { ...leg, cancelled: true } : leg)),
    });
    expect(trackedLegsOf(cancelled, DEPART_MS)).toEqual([]);
  });

  it('is not due for a service starting more than an hour ahead', () => {
    const boardMs = Date.parse(trip.legs.find((leg) => leg.kind === 'transit')!.start);
    const [tooEarly] = trackedLegsOf(trip, boardMs - VEHICLE_LOOKAHEAD_MS - 1);
    expect(tooEarly?.due).toBe(false);
    const [due] = trackedLegsOf(trip, boardMs - VEHICLE_LOOKAHEAD_MS);
    expect(due?.due).toBe(true);
  });
});

describe('useVehiclePositions', () => {
  const trip = transitItinerary({
    departAt: DEPART,
    mode: 'bus',
    service: '380',
    tripId: '2703224',
  });
  const tracked = trackedLegsOf(trip, DEPART_MS);

  it('asks again every 15 seconds while the map is on screen', async () => {
    jest.useFakeTimers();
    try {
      const locate = jest.spyOn(tripService, 'locateVehicles').mockResolvedValue(answer());
      await renderHook(() => useVehiclePositions(tracked, { active: true }), { wrapper });
      await waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
      expect(locate.mock.calls[0]?.[0]).toEqual([{ mode: 'bus', realtimeTripId: '2703224' }]);

      await act(async () => jest.advanceTimersByTime(VEHICLE_REFRESH_MS));
      expect(locate).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks nothing while the map is not on screen, or while the app is in the background', async () => {
    jest.useFakeTimers();
    try {
      const locate = jest.spyOn(tripService, 'locateVehicles').mockResolvedValue(answer());
      const { rerender } = await renderHook(
        ({ active }: { active: boolean }) => useVehiclePositions(tracked, { active }),
        { wrapper, initialProps: { active: false } },
      );
      await act(async () => jest.advanceTimersByTime(VEHICLE_REFRESH_MS * 3));
      expect(locate).not.toHaveBeenCalled();

      await rerender({ active: true });
      await waitFor(() => expect(locate).toHaveBeenCalledTimes(1));
      await act(async () => focusManager.setFocused(false));
      await act(async () => jest.advanceTimersByTime(VEHICLE_REFRESH_MS * 3));
      expect(locate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks nothing when no service is due yet', async () => {
    const locate = jest.spyOn(tripService, 'locateVehicles');
    const early = trackedLegsOf(trip, DEPART_MS - 2 * VEHICLE_LOOKAHEAD_MS);
    const { result } = await renderHook(() => useVehiclePositions(early, { active: true }), {
      wrapper,
    });
    expect(result.current.checking).toBe(false);
    expect(locate).not.toHaveBeenCalled();
  });

  it('gives each lookup by its service, with when it was checked', async () => {
    jest.spyOn(tripService, 'locateVehicles').mockResolvedValue(
      answer({
        checkedAt: addMinutes(DEPART, 1),
        vehicles: [{ mode: 'bus', realtimeTripId: '2703224', status: 'not-located' }],
      }),
    );
    const { result } = await renderHook(() => useVehiclePositions(tracked, { active: true }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.lookups.get('bus|2703224')?.status).toBe('not-located');
    expect(result.current.checkedAt).toBe(addMinutes(DEPART, 1));
    expect(result.current.mode).toBe('live');
  });

  it('keeps the last positions when a later check fails, and says it failed', async () => {
    jest.useFakeTimers();
    try {
      jest
        .spyOn(tripService, 'locateVehicles')
        .mockResolvedValueOnce(
          answer({ vehicles: [{ mode: 'bus', realtimeTripId: '2703224', status: 'not-located' }] }),
        )
        .mockRejectedValue(new ApiError('offline'));
      const { result } = await renderHook(() => useVehiclePositions(tracked, { active: true }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.lookups.size).toBe(1));

      await act(async () => jest.advanceTimersByTime(VEHICLE_REFRESH_MS));
      await waitFor(() => expect(result.current.failed).toBe(true));
      expect(result.current.lookups.size).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers in demo mode from the demo timetable, never the API', async () => {
    const live = jest.spyOn(apiClient, 'vehicles');
    const { result } = await renderHook(() => useVehiclePositions(tracked, { active: true }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.mode).toBe('demo'));
    expect(result.current.lookups.get('bus|2703224')?.status).toBe('not-located');
    expect(live).not.toHaveBeenCalled();
  });
});
