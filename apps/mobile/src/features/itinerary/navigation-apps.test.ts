import {
  drivingDirectionsUrl,
  findInstalledNavigationApps,
  planNavigationLaunch,
} from './navigation-apps';

const KELLYVILLE_NORTH = { lat: -33.713514, lon: 150.935304 };

describe('drivingDirectionsUrl', () => {
  it('uses Apple’s unified Maps URL from iOS 18.4', () => {
    expect(drivingDirectionsUrl('apple', KELLYVILLE_NORTH, '18.4')).toBe(
      'https://maps.apple.com/directions?destination=-33.713514,150.935304&mode=driving',
    );
    expect(drivingDirectionsUrl('apple', KELLYVILLE_NORTH, '26.1')).toBe(
      'https://maps.apple.com/directions?destination=-33.713514,150.935304&mode=driving',
    );
  });

  it('falls back to the daddr form before iOS 18.4, or when the version is unknown', () => {
    const legacy = 'https://maps.apple.com/?daddr=-33.713514,150.935304&dirflg=d';
    expect(drivingDirectionsUrl('apple', KELLYVILLE_NORTH, '18.3.2')).toBe(legacy);
    expect(drivingDirectionsUrl('apple', KELLYVILLE_NORTH, '16.4')).toBe(legacy);
    expect(drivingDirectionsUrl('apple', KELLYVILLE_NORTH, undefined)).toBe(legacy);
  });

  it('builds the Google Maps and Waze driving links', () => {
    expect(drivingDirectionsUrl('google', KELLYVILLE_NORTH, '18.4')).toBe(
      'comgooglemaps://?daddr=-33.713514,150.935304&directionsmode=driving',
    );
    expect(drivingDirectionsUrl('waze', KELLYVILLE_NORTH, '18.4')).toBe(
      'https://waze.com/ul?ll=-33.713514,150.935304&navigate=yes',
    );
  });
});

describe('findInstalledNavigationApps', () => {
  it('always offers Apple Maps and adds only the apps iOS says are installed', async () => {
    const canOpenURL = jest.fn(async (url: string) => url === 'waze://');
    await expect(findInstalledNavigationApps(canOpenURL)).resolves.toEqual(['apple', 'waze']);
    expect(canOpenURL.mock.calls.map(([url]) => url).sort()).toEqual([
      'comgooglemaps://',
      'waze://',
    ]);
  });

  it('leaves out an app whose check fails, and logs only the error type', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const canOpenURL = jest.fn(async (url: string) => {
      if (url === 'comgooglemaps://') throw new TypeError('Unable to open URL');
      return true;
    });
    await expect(findInstalledNavigationApps(canOpenURL)).resolves.toEqual(['apple', 'waze']);
    expect(warn).toHaveBeenCalledWith(
      'HopReady: could not check whether Google Maps is installed (TypeError).',
    );
  });
});

describe('planNavigationLaunch', () => {
  it('opens the preferred app straight away when it is installed', () => {
    expect(planNavigationLaunch('waze', ['apple', 'waze'])).toEqual({ kind: 'open', app: 'waze' });
    expect(planNavigationLaunch('apple', ['apple', 'google'])).toEqual({
      kind: 'open',
      app: 'apple',
    });
  });

  it('asks when the preference is to ask, listing installed apps only', () => {
    expect(planNavigationLaunch('ask', ['apple', 'google', 'waze'])).toEqual({
      kind: 'choose',
      apps: ['apple', 'google', 'waze'],
    });
  });

  it('asks when the preferred app is not installed', () => {
    expect(planNavigationLaunch('google', ['apple', 'waze'])).toEqual({
      kind: 'choose',
      apps: ['apple', 'waze'],
    });
  });

  it('opens Apple Maps without asking when it is the only app', () => {
    expect(planNavigationLaunch('ask', ['apple'])).toEqual({ kind: 'open', app: 'apple' });
    expect(planNavigationLaunch('google', ['apple'])).toEqual({ kind: 'open', app: 'apple' });
  });
});
