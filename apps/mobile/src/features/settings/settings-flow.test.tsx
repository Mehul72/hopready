import { DEFAULT_PREFERENCES } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { fireEvent, render, userEvent } from '@testing-library/react-native';
import { screen, within } from 'expo-router/testing-library';
import { Alert, type AlertButton, Linking } from 'react-native';

import { appStorage, DEFAULT_APP_PREFERENCES } from '@/storage';
import { parkAndRideItinerary, planRequest } from '@/test-support/trips';

import { freezeClockAt, renderApp, WEEKDAY_MORNING } from '../itinerary/testing';
import { APPLE_ROUTE_GUIDANCE_NOTICE, readAppVersion } from './about-section';
import { DEMO_MODE_EXPLANATION } from './demo-mode-section';
import { LiveDataUseSection } from './live-data-use-section';

// Presses the button with this text in the next alert, as a person would.
function answerNextAlert(buttonText: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const button = (buttons ?? []).find((candidate: AlertButton) => candidate.text === buttonText);
    if (!button) throw new Error(`The alert has no "${buttonText}" button`);
    button.onPress?.();
  });
}

function followLiveTrip() {
  appStorage.activeTrip.start({
    request: planRequest(),
    itinerary: parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }),
    plannedAt: WEEKDAY_MORNING.toISOString(),
    mode: 'live',
  });
}

beforeEach(() => {
  freezeClockAt(WEEKDAY_MORNING);
  appStorage.deleteAllData();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('demo mode', () => {
  it('turns on with a clear explanation and a scenario picker, and turns off again', async () => {
    await renderApp('/settings');
    const demoSwitch = screen.getByRole('switch', { name: 'Demo mode' });
    expect(screen.getByText(DEMO_MODE_EXPLANATION)).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: /^Everything running/ })).not.toBeOnTheScreen();

    await fireEvent(demoSwitch, 'valueChange', true);

    expect(appStorage.settings.get().demoMode).toBe(true);
    expect(
      screen.getByLabelText(
        'Demo. Demo mode is on. Trips, times and car park spaces are sample data, not live information.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: /^Everything running/ })).toBeChecked();

    await userEvent.setup().press(screen.getByRole('radio', { name: /^Old car park counts/ }));
    expect(appStorage.settings.get().demoScenario).toBe('stale-occupancy');
    expect(screen.getByRole('radio', { name: /^Old car park counts/ })).toBeChecked();

    await fireEvent(screen.getByRole('switch', { name: 'Demo mode' }), 'valueChange', false);
    expect(appStorage.settings.get().demoMode).toBe(false);
    expect(screen.queryByRole('radio', { name: /^Old car park counts/ })).not.toBeOnTheScreen();
  });

  it('asks before dropping a live trip that is being followed', async () => {
    followLiveTrip();
    await renderApp('/settings');

    const cancel = answerNextAlert('Cancel');
    await fireEvent(screen.getByRole('switch', { name: 'Demo mode' }), 'valueChange', true);
    expect(cancel).toHaveBeenCalledWith(
      'Turn on demo mode?',
      'The trip you are following uses live data, so HopReady will stop following it.',
      expect.any(Array),
    );
    expect(appStorage.settings.get().demoMode).toBe(false);
    expect(appStorage.activeTrip.get()).not.toBeNull();

    answerNextAlert('Turn on');
    await fireEvent(screen.getByRole('switch', { name: 'Demo mode' }), 'valueChange', true);
    expect(appStorage.settings.get().demoMode).toBe(true);
    expect(appStorage.activeTrip.get()).toBeNull();
  });
});

describe('delete all data', () => {
  function saveSomeData() {
    appStorage.settings.setDemoMode(true);
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.addFavourite('Uni', DEMO_PLACES.macquarieUniversity);
    appStorage.parkedCar.markDroppedOff('2026-10-26T20:00:00.000Z');
    appStorage.preferences.change({ parkingBufferMinutes: 12, navigationApp: 'waze' });
  }

  it('deletes everything after confirming, with a new install ID', async () => {
    saveSomeData();
    const installIdBefore = appStorage.settings.get().installId;
    await renderApp('/settings');
    const alert = answerNextAlert('Delete everything');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete all HopReady data' }));

    expect(alert).toHaveBeenCalledWith(
      'Delete all HopReady data?',
      expect.stringContaining("This can't be undone."),
      expect.any(Array),
    );
    expect(appStorage.places.get()).toEqual({ home: null, work: null, favourites: [] });
    expect(appStorage.parkedCar.get()).toEqual({ status: 'none' });
    expect(appStorage.preferences.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(appStorage.settings.get().demoMode).toBe(false);
    expect(appStorage.settings.get().installId).not.toBe(installIdBefore);
    expect(screen.getByText('All HopReady data was deleted from this iPhone.')).toBeOnTheScreen();
  });

  it('keeps everything when the person cancels', async () => {
    saveSomeData();
    await renderApp('/settings');
    answerNextAlert('Cancel');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete all HopReady data' }));

    expect(appStorage.places.get().home).toEqual(DEMO_PLACES.rouseHillHome);
    expect(appStorage.settings.get().demoMode).toBe(true);
  });
});

describe('navigation app', () => {
  it('saves the preferred app and marks apps that are not installed', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockImplementation(async (url) => url === 'comgooglemaps://');
    await renderApp('/settings');
    const section = screen.getByTestId('navigation-app');

    expect(within(section).getByRole('radio', { name: /^Ask every time/ })).toBeChecked();
    expect(
      await within(section).findByRole('radio', {
        name: 'Waze, Not installed on this iPhone. HopReady will ask instead.',
      }),
    ).toBeOnTheScreen();
    expect(within(section).getByRole('radio', { name: 'Google Maps' })).toBeOnTheScreen();

    await userEvent.setup().press(within(section).getByRole('radio', { name: 'Google Maps' }));

    expect(appStorage.preferences.get().navigationApp).toBe('google');
    expect(within(section).getByRole('radio', { name: 'Google Maps' })).toBeChecked();
  });
});

describe('trip defaults', () => {
  it('saves each change as the default for every plan', async () => {
    await renderApp('/settings');
    const section = screen.getByTestId('trip-defaults');
    const user = userEvent.setup();

    expect(within(section).getByRole('adjustable', { name: 'Parking buffer' })).toHaveProp(
      'accessibilityHint',
      'Time from reaching the car park to walking out of it: finding a space, parking and getting to the exit.',
    );
    await user.press(within(section).getByRole('button', { name: 'Increase Parking buffer' }));
    await user.press(within(section).getByRole('button', { name: 'Decrease Longest drive' }));
    await user.press(within(section).getByRole('radio', { name: 'Fast' }));
    await user.press(within(section).getByRole('togglebutton', { name: 'Bus' }));

    expect(appStorage.preferences.get()).toMatchObject({
      parkingBufferMinutes: DEFAULT_PREFERENCES.parkingBufferMinutes + 1,
      maxDriveMinutes: DEFAULT_PREFERENCES.maxDriveMinutes - 5,
      walkingSpeed: 'fast',
      excludedTransitModes: ['bus'],
    });
    expect(
      within(section).getByRole('adjustable', { name: 'Parking buffer' }),
    ).toHaveAccessibilityValue({
      now: DEFAULT_PREFERENCES.parkingBufferMinutes + 1,
    });
  });

  it('offers only modes that can be avoided, and always leaves one allowed', async () => {
    appStorage.preferences.change({
      excludedTransitModes: ['train', 'metro', 'light-rail', 'bus', 'coach', 'ferry', 'school-bus'],
    });
    await renderApp('/settings');
    const section = screen.getByTestId('trip-defaults');

    expect(within(section).queryByRole('togglebutton', { name: 'Other service' })).toBeNull();
    expect(within(section).getByRole('togglebutton', { name: 'On demand' })).toBeDisabled();
    expect(within(section).getByRole('togglebutton', { name: 'Bus' })).toBeEnabled();
  });

  it('resets to the defaults after confirming, keeping the navigation app', async () => {
    appStorage.preferences.change({
      transferBufferMinutes: 9,
      walkingSpeed: 'slow',
      navigationApp: 'waze',
    });
    await renderApp('/settings');
    answerNextAlert('Reset');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(appStorage.preferences.get()).toEqual({ ...DEFAULT_PREFERENCES, navigationApp: 'waze' });
  });
});

describe('about', () => {
  it('shows the data sources and Apple’s route guidance notice', async () => {
    await renderApp('/settings');
    const about = screen.getByTestId('about');

    expect(
      within(about).getByText(
        /^Public transport times, stops, alerts and car park details come from Transport for NSW Open Data/,
      ),
    ).toBeOnTheScreen();
    expect(
      within(about).getByRole('button', { name: 'Transport for NSW Open Data' }),
    ).toBeOnTheScreen();
    expect(within(about).getByRole('button', { name: 'Park&Ride rules' })).toBeOnTheScreen();
    expect(within(about).getByText(/come from Apple Maps/)).toBeOnTheScreen();
    expect(
      within(about).getByText(
        'YOUR USE OF THIS REAL TIME ROUTE GUIDANCE APPLICATION IS AT YOUR SOLE RISK. LOCATION DATA MAY NOT BE ACCURATE.',
      ),
    ).toBeOnTheScreen();
    expect(APPLE_ROUTE_GUIDANCE_NOTICE).toMatch(/SOLE RISK/);
  });

  it('reads the version from the app config, and says when there is none', () => {
    expect(readAppVersion({ version: '0.1.0' })).toBe('0.1.0');
    expect(readAppVersion({})).toBeNull();
    expect(readAppVersion(null)).toBeNull();
  });
});

describe('live data use', () => {
  it('links to the explanation of what live mode sends, when the build plans live', async () => {
    await render(<LiveDataUseSection livePlanningConfigured />);
    expect(
      screen.getByRole('button', {
        name: 'Live data use, Not agreed yet. Live mode asks before it sends anything.',
      }),
    ).toBeOnTheScreen();
  });

  it('is left out of builds that cannot plan live', async () => {
    await render(<LiveDataUseSection livePlanningConfigured={false} />);
    expect(screen.queryByRole('button', { name: /^Live data use/ })).not.toBeOnTheScreen();
  });
});
