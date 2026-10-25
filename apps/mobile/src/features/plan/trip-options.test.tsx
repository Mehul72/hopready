import { DEFAULT_PREFERENCES, type SavedParkingSpot } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { planSession } from '@/state';
import { appStorage } from '@/storage';

import { planChoices } from './plan-choices';
import { planDraft } from './plan-draft';
import { freezeClockAt, renderApp, TUESDAY_0730 } from './test-harness';
import { RESET_CONFIRMATION_TITLE } from './trip-options-screen';

beforeEach(() => {
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  appStorage.deleteAllData();
  jest.useRealTimers();
});

function pressAlertButton(text: string) {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  const buttons: AlertButton[] = call?.[2] ?? [];
  const button = buttons.find((candidate) => candidate.text === text);
  if (!button?.onPress) throw new Error(`The alert has no "${text}" button`);
  button.onPress();
}

// By Rouse Hill Station, away from Chatswood, so it is used for a trip from Kellyville to
// Chatswood only when preferred.
function saveStreetSpot(): SavedParkingSpot {
  const added = appStorage.parkingSpots.add('Street spot by Rouse Hill Station', {
    lat: -33.6925,
    lon: 150.9235,
  });
  if (added.status !== 'added') throw new Error('The parking spot was not saved');
  return added.item;
}

describe('trip options', () => {
  it('explains every setting, and buffers are described as applied once', async () => {
    await renderApp('/trip-options');

    expect(
      screen.getByText(
        'The least time between arriving on one service and the next one leaving, including any walk between them. Applied once, never on top of the walk.',
      ),
    ).toBeOnTheScreen();
    for (const label of [
      'Longest drive',
      'Longest walk',
      'Parking time',
      'Drop-off time',
      'Transfer time',
      'Back at the car',
    ]) {
      expect(screen.getByRole('adjustable', { name: label })).toBeOnTheScreen();
    }
    expect(screen.getAllByText(/Added once\./)).toHaveLength(3);
  });

  it('saves each change as it is made', async () => {
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: 'Increase Transfer time' }));
    await user.press(screen.getByRole('button', { name: 'Increase Longest drive' }));
    await user.press(screen.getByRole('radio', { name: 'Slow' }));
    await user.press(screen.getByRole('togglebutton', { name: 'Bus' }));

    expect(appStorage.preferences.get()).toMatchObject({
      transferBufferMinutes: DEFAULT_PREFERENCES.transferBufferMinutes + 1,
      maxDriveMinutes: DEFAULT_PREFERENCES.maxDriveMinutes + 5,
      walkingSpeed: 'slow',
      excludedTransitModes: ['bus'],
    });
    expect(screen.getByRole('adjustable', { name: 'Transfer time' })).toHaveAccessibilityValue({
      now: DEFAULT_PREFERENCES.transferBufferMinutes + 1,
    });
  });

  it('keeps at least one mode allowed', async () => {
    appStorage.preferences.change({
      excludedTransitModes: ['train', 'metro', 'light-rail', 'bus', 'coach', 'ferry', 'school-bus'],
    });
    await renderApp('/trip-options');

    expect(screen.getByRole('togglebutton', { name: 'On demand' })).toBeDisabled();
    expect(screen.getByRole('togglebutton', { name: 'Bus' })).not.toBeDisabled();
  });

  it('uses the saved options for the next plan', async () => {
    freezeClockAt(TUESDAY_0730);
    const user = userEvent.setup();
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: /^Trip options, / }));
    await user.press(screen.getByRole('button', { name: 'Increase Transfer time' }));
    await user.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen).toHavePathname('/');

    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(planSession.getState().request?.preferences.transferBufferMinutes).toBe(
      DEFAULT_PREFERENCES.transferBufferMinutes + 1,
    );
    // The app-only navigation choice is not sent to the planner.
    expect(planSession.getState().request?.preferences).not.toHaveProperty('navigationApp');
  });

  it('resets to the defaults after confirming, keeping app-only settings', async () => {
    jest.spyOn(Alert, 'alert');
    appStorage.preferences.change({
      transferBufferMinutes: 9,
      walkingSpeed: 'fast',
      excludedTransitModes: ['ferry'],
      navigationApp: 'waze',
    });
    planChoices.setPreferredCarPark({ id: '29', name: 'Kellyville (north)', kind: 'car-park' });
    planChoices.setPreferredStation(DEMO_PLACES.castleTowers);
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(Alert.alert).toHaveBeenCalledWith(
      RESET_CONFIRMATION_TITLE,
      expect.any(String),
      expect.any(Array),
    );
    // Nothing changes until the person confirms.
    expect(appStorage.preferences.get().transferBufferMinutes).toBe(9);
    await act(async () => pressAlertButton('Reset'));

    expect(appStorage.preferences.get()).toEqual({ ...DEFAULT_PREFERENCES, navigationApp: 'waze' });
    expect(planChoices.get().preferredCarPark).toBeNull();
    expect(planChoices.get().preferredStation).toBeNull();
    expect(screen.getByRole('adjustable', { name: 'Transfer time' })).toHaveAccessibilityValue({
      now: DEFAULT_PREFERENCES.transferBufferMinutes,
    });
  });

  it('leaves everything as it was when the reset is cancelled', async () => {
    jest.spyOn(Alert, 'alert');
    appStorage.preferences.change({ transferBufferMinutes: 9 });
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: 'Reset to defaults' }));
    const buttons: AlertButton[] = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? [];
    expect(buttons.find((button) => button.text === 'Cancel')?.style).toBe('cancel');

    expect(appStorage.preferences.get().transferBufferMinutes).toBe(9);
  });
});

describe('preferred stops', () => {
  it('chooses a preferred station through station search', async () => {
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: /^Preferred station, None/ }));
    expect(screen).toHavePathname('/place-search');
    await user.type(screen.getByLabelText('Search for a station'), 'Kellyville');
    await user.press(await screen.findByRole('button', { name: /^Kellyville Station, / }));

    expect(screen).toHavePathname('/trip-options');
    expect(planChoices.get().preferredStation).toMatchObject({ name: 'Kellyville Station' });
    expect(
      screen.getByRole('button', { name: /^Preferred station, Kellyville Station/ }),
    ).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Remove preferred station' }));
    expect(planChoices.get().preferredStation).toBeNull();
  });

  it('chooses a preferred car park from the car park list', async () => {
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: /^Preferred car park, None/ }));
    const picker = await screen.findByTestId('car-park-picker');
    await user.type(within(picker).getByLabelText('Filter car parks'), 'Kellyville');
    await user.press(within(picker).getByRole('button', { name: /^Kellyville \(north\)/ }));

    expect(planChoices.get().preferredCarPark).toEqual({
      id: '29',
      name: 'Kellyville (north)',
      kind: 'car-park',
    });
    await waitFor(() => expect(screen.queryByTestId('car-park-picker')).not.toBeOnTheScreen());
    expect(
      screen.getByRole('button', { name: /^Preferred car park, Kellyville \(north\)/ }),
    ).toBeOnTheScreen();
  });

  it('offers saved parking spots beside the car parks, and plans with the one chosen', async () => {
    freezeClockAt(TUESDAY_0730);
    const spot = saveStreetSpot();
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.kellyvilleHome, DEMO_PLACES.chatswoodOffice);
    });
    const user = userEvent.setup();
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: /^Trip options, / }));

    await user.press(screen.getByRole('button', { name: /^Preferred car park, None/ }));
    const picker = await screen.findByTestId('car-park-picker');
    expect(within(picker).getByRole('header', { name: 'Your parking spots' })).toBeOnTheScreen();
    expect(within(picker).getByRole('header', { name: 'Park&Ride car parks' })).toBeOnTheScreen();
    expect(
      await within(picker).findByRole('button', { name: /^Kellyville \(north\)/ }),
    ).toBeOnTheScreen();
    await user.press(
      within(picker).getByRole('button', {
        name: 'Street spot by Rouse Hill Station, Saved by you. Rules and spaces unknown.',
      }),
    );

    expect(planChoices.get().preferredCarPark).toEqual({
      id: spot.id,
      name: 'Street spot by Rouse Hill Station',
      kind: 'saved-spot',
    });
    expect(
      screen.getByRole('button', {
        name: /^Preferred car park, Street spot by Rouse Hill Station/,
      }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Done' }));
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(planSession.getState().request).toMatchObject({
      preferredCarParkId: spot.id,
      savedParkingSpots: [spot],
    });
    await screen.findAllByTestId(/^route-card-/);
    const parkedAt = planSession
      .getState()
      .response?.itineraries.map((itinerary) => itinerary.parking?.carPark.id);
    expect(parkedAt).toContain(spot.id);
  });

  it('treats a preferred parking spot as no preference once it is deleted', async () => {
    freezeClockAt(TUESDAY_0730);
    const spot = saveStreetSpot();
    planChoices.setPreferredCarPark({ id: spot.id, name: spot.name, kind: 'saved-spot' });
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.kellyvilleHome, DEMO_PLACES.chatswoodOffice);
    });
    const user = userEvent.setup();
    await renderApp('/trip-options');
    expect(
      screen.getByRole('button', {
        name: /^Preferred car park, Street spot by Rouse Hill Station/,
      }),
    ).toBeOnTheScreen();

    // As when the person deletes it in Saved.
    await act(async () => {
      appStorage.parkingSpots.remove(spot.id);
    });
    await user.press(screen.getByRole('button', { name: /^Preferred car park, None/ }));
    const picker = await screen.findByTestId('car-park-picker');
    expect(
      within(picker).getByRole('button', { name: 'No preferred car park, selected' }),
    ).toBeOnTheScreen();
    expect(
      within(picker).getByText('Parking spots you add in Saved appear here.'),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('button', { name: /prefers Street spot/ })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));
    expect(planSession.getState().request).not.toHaveProperty('preferredCarParkId');
  });

  it('explains when the car park list cannot load in live mode, and offers demo mode', async () => {
    appStorage.settings.setDemoMode(false);
    saveStreetSpot();
    const user = userEvent.setup();
    await renderApp('/trip-options');

    await user.press(screen.getByRole('button', { name: /^Preferred car park, None/ }));

    expect(await screen.findByText("Couldn't load car parks")).toBeOnTheScreen();
    // Saved spots are on the phone, so they can still be chosen.
    expect(
      screen.getByRole('button', { name: /^Street spot by Rouse Hill Station, / }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Turn on demo mode' }));
    expect(await screen.findByRole('button', { name: /^Kellyville \(north\)/ })).toBeOnTheScreen();
  });
});
