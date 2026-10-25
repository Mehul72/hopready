import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { planSession } from '@/state/plan-session';

import { useRefreshActiveTripOnResume } from './use-refresh-active-trip-on-resume';

function captureAppStateListener() {
  const listeners: ((status: AppStateStatus) => void)[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (status: AppStateStatus) => void);
    return { remove };
  });
  return {
    remove,
    emit: (status: AppStateStatus) => {
      for (const listener of listeners) listener(status);
    },
  };
}

describe('useRefreshActiveTripOnResume', () => {
  it('asks for an active trip refresh at launch', async () => {
    captureAppStateListener();
    const refresh = jest.spyOn(planSession, 'refreshActiveTrip').mockResolvedValue(undefined);
    await renderHook(() => useRefreshActiveTripOnResume());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('asks again when the app comes back from the background', async () => {
    const appState = captureAppStateListener();
    const refresh = jest.spyOn(planSession, 'refreshActiveTrip').mockResolvedValue(undefined);
    await renderHook(() => useRefreshActiveTripOnResume());
    refresh.mockClear();

    appState.emit('inactive');
    appState.emit('background');
    appState.emit('inactive');
    appState.emit('active');

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores brief interruptions that never reach the background', async () => {
    const appState = captureAppStateListener();
    const refresh = jest.spyOn(planSession, 'refreshActiveTrip').mockResolvedValue(undefined);
    await renderHook(() => useRefreshActiveTripOnResume());
    refresh.mockClear();

    appState.emit('inactive');
    appState.emit('active');

    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops listening when unmounted', async () => {
    const appState = captureAppStateListener();
    const { unmount } = await renderHook(() => useRefreshActiveTripOnResume());
    await unmount();
    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});
