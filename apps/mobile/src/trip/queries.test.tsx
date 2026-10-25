import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appStorage } from '@/storage';

import { PLACE_SEARCH_DEBOUNCE_MS, useCarParks, usePlaceSearch } from './queries';
import { tripService } from './trip-service';

let client: QueryClient;

function withQueryClient() {
  return function QueryClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  // Removes cached queries and their garbage-collection timers, so Jest can exit.
  client.clear();
});

describe('usePlaceSearch', () => {
  it('waits for a pause in typing and searches once for the final text', async () => {
    jest.useFakeTimers();
    try {
      const search = jest.spyOn(tripService, 'searchPlaces');
      const { result, rerender } = await renderHook(
        ({ text }: { text: string }) => usePlaceSearch(text, null),
        { initialProps: { text: 'Ch' }, wrapper: withQueryClient() },
      );
      await rerender({ text: 'Chat' });
      await act(async () => jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS - 1));
      await rerender({ text: 'Chatswood' });
      await act(async () => jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS));

      await waitFor(() => expect(result.current.data?.results.length).toBeGreaterThan(0));
      // The first text is searched straight away; "Chat" was replaced before the pause ended.
      expect(search.mock.calls.map(([query]) => query)).toEqual(['Ch', 'Chatswood']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not search for text shorter than two characters', async () => {
    const search = jest.spyOn(tripService, 'searchPlaces');
    const { result } = await renderHook(() => usePlaceSearch(' C ', null), {
      wrapper: withQueryClient(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(search).not.toHaveBeenCalled();
  });

  it('sends a location hint rounded to about a kilometre', async () => {
    const search = jest.spyOn(tripService, 'searchPlaces');
    await renderHook(() => usePlaceSearch('Chatswood', { lat: -33.796912, lon: 151.180343 }), {
      wrapper: withQueryClient(),
    });
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls[0]?.[1]).toEqual({ lat: -33.8, lon: 151.18 });
  });
});

describe('useCarParks', () => {
  it('lists car parks from the current mode', async () => {
    const { result } = await renderHook(() => useCarParks(), { wrapper: withQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.carParks.length).toBeGreaterThan(0);
  });

  it('reports a live failure as an ApiError, never as demo data', async () => {
    await act(async () => appStorage.settings.setDemoMode(false));
    const { result } = await renderHook(() => useCarParks(), { wrapper: withQueryClient() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ kind: 'not-configured', suggestsDemoMode: true });
    expect(result.current.data).toBeUndefined();
  });
});
