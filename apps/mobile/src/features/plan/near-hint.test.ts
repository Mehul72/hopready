import * as Location from 'expo-location';

import { lookUpNearHint, NEAR_HINT_TIMEOUT_MS } from './near-hint';
import { locationPermission, positionAt } from './test-harness';

const GRANTED = locationPermission('granted');
const UNDETERMINED = locationPermission('undetermined');

afterEach(() => {
  jest.useRealTimers();
  jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => UNDETERMINED);
});

describe('lookUpNearHint', () => {
  it('never reads a position, or asks, when access was not granted', async () => {
    await expect(lookUpNearHint()).resolves.toBeNull();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reads a coarse position when access was already granted', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => GRANTED);
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.79, 151.18, 800));

    await expect(lookUpNearHint()).resolves.toEqual({ lat: -33.79, lon: 151.18 });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Low,
    });
  });

  it('gives up on a slow fix so search is not held up', async () => {
    jest.useFakeTimers();
    jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => GRANTED);
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const hint = lookUpNearHint();
    await jest.advanceTimersByTimeAsync(NEAR_HINT_TIMEOUT_MS);

    await expect(hint).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'HopReady: searching without a location hint (NearHintTimeout).',
    );
  });

  it('searches without a hint when the position fails, logging no position', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => GRANTED);
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockRejectedValueOnce(Object.assign(new Error('-33.79,151.18'), { name: 'LocationError' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(lookUpNearHint()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'HopReady: searching without a location hint (LocationError).',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('151.18');
  });
});
