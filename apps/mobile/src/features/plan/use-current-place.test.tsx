import type { Place } from '@hopready/core';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { locationPermission, positionAt } from './test-harness';
import { useCurrentPlace } from './use-current-place';

// Holds the permission answer until the test releases it, like a person reading the prompt.
function deferPermission() {
  let release: (granted: boolean) => void = () => undefined;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = (granted) => resolve(locationPermission(granted ? 'granted' : 'denied', false));
      }),
  );
  return (granted: boolean) => release(granted);
}

describe('useCurrentPlace', () => {
  it('resolves with the place and goes back to idle when allowed', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce(locationPermission('granted'));
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.6955, 150.93));
    const { result } = await renderHook(() => useCurrentPlace());

    let place: Place | null = null;
    await act(async () => {
      place = await result.current.locate();
    });

    expect(place).toMatchObject({ kind: 'current-location' });
    expect(result.current.attempt).toEqual({ status: 'idle' });
  });

  it('reports a refusal, so the screen can offer Settings and typing', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce(locationPermission('denied', false));
    const { result } = await renderHook(() => useCurrentPlace());

    await act(async () => {
      await result.current.locate();
    });

    expect(result.current.attempt).toEqual({ status: 'denied', canAskAgain: false });
  });

  it('ignores an answer that arrives after the person chose something else', async () => {
    const release = deferPermission();
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.6955, 150.93));
    const { result } = await renderHook(() => useCurrentPlace());

    let located: Promise<Place | null> = Promise.resolve(null);
    await act(async () => {
      located = result.current.locate();
    });
    expect(result.current.attempt).toEqual({ status: 'locating' });
    await act(async () => result.current.dismiss());
    await act(async () => release(true));

    await expect(located).resolves.toBeNull();
    expect(result.current.attempt).toEqual({ status: 'idle' });
  });

  it('ignores an answer that arrives after the screen closed', async () => {
    const release = deferPermission();
    const { result, unmount } = await renderHook(() => useCurrentPlace());

    let located: Promise<Place | null> = Promise.resolve(null);
    await act(async () => {
      located = result.current.locate();
    });
    await unmount();
    release(false);

    await expect(located).resolves.toBeNull();
  });

  it('treats a failing location service as an unavailable position, naming only the error', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'NativeError' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useCurrentPlace());

    await act(async () => {
      await result.current.locate();
    });

    expect(result.current.attempt).toEqual({ status: 'unavailable', reason: 'position-failed' });
    expect(warn).toHaveBeenCalledWith(
      'HopReady: could not get the current location (NativeError).',
    );
  });
});
