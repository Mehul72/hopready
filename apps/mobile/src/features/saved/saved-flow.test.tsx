import { DEMO_PLACES } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { act, screen, within } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { planSession } from '@/state';
import { appStorage } from '@/storage';

import {
  demoCommuteRequest,
  denyLocation,
  freezeClockAt,
  grantLocationAt,
  holdLocationAt,
  renderApp,
  WEEKDAY_MORNING,
} from '../itinerary/testing';
import { DEMO_SEARCH_ATTRIBUTION } from './place-picker-sheet';
import { describeRecentRequest } from './saved-screen';

// Presses the button with this text in the next alert, as a person would.
function answerNextAlert(buttonText: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const button = (buttons ?? []).find((candidate: AlertButton) => candidate.text === buttonText);
    if (!button) throw new Error(`The alert has no "${buttonText}" button`);
    button.onPress?.();
  });
}

beforeEach(() => {
  freezeClockAt(WEEKDAY_MORNING);
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Home and Work', () => {
  it('sets Home through place search, with an Apple map beside the results', async () => {
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Home, Not set' }));
    expect(screen.getByRole('header', { name: 'Set Home' })).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Search for a place'), 'Rouse Hill');

    const result = await screen.findByRole('button', { name: /^12 Example Street, Rouse Hill/ });
    const picker = screen.getByTestId('place-picker');
    expect(within(picker).getByTestId('map-view')).toBeOnTheScreen();
    expect(within(picker).getByText(DEMO_SEARCH_ATTRIBUTION)).toBeOnTheScreen();
    await user.press(result);

    expect(appStorage.places.get().home).toEqual(DEMO_PLACES.rouseHillHome);
    expect(
      screen.getByRole('button', { name: 'Home, 12 Example Street, Rouse Hill' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Information. Home set to 12 Example Street, Rouse Hill.'),
    ).toBeOnTheScreen();
  });

  it('sets Work from the current location as a fixed address, named by its street in live mode', async () => {
    appStorage.settings.setDemoMode(false);
    grantLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Work, Not set' }));
    await user.press(screen.getByRole('button', { name: 'Use my current location' }));

    expect(
      await screen.findByRole('button', { name: 'Work, 1 Example Street, Chatswood' }),
    ).toBeOnTheScreen();
    expect(appStorage.places.get().work).toEqual({
      name: '1 Example Street, Chatswood',
      coordinate: DEMO_PLACES.chatswoodOffice.coordinate,
      kind: 'address',
    });
  });

  it('pins Work at the current location in demo mode, without asking Apple for the street', async () => {
    grantLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Work, Not set' }));
    await user.press(screen.getByRole('button', { name: 'Use my current location' }));

    expect(await screen.findByRole('button', { name: 'Work, Pinned location' })).toBeOnTheScreen();
    expect(appStorage.places.get().work).toEqual({
      name: 'Pinned location',
      coordinate: DEMO_PLACES.chatswoodOffice.coordinate,
      kind: 'address',
    });
    expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it('keeps the place picked from search when the location arrives late', async () => {
    const location = holdLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Work, Not set' }));
    await user.press(screen.getByRole('button', { name: 'Use my current location' }));
    await user.type(screen.getByLabelText('Search for a place'), 'Macquarie University');
    await user.press(
      await screen.findByRole('button', { name: 'Macquarie University, Macquarie Park' }),
    );
    await act(() => location.release());

    expect(appStorage.places.get().work?.name).toBe('Macquarie University');
  });

  it('removes Home only after confirming', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    await renderApp('/saved');

    answerNextAlert('Cancel');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Remove Home' }));
    expect(appStorage.places.get().home).toEqual(DEMO_PLACES.rouseHillHome);

    const alert = answerNextAlert('Delete');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Remove Home' }));
    expect(alert).toHaveBeenCalledWith('Delete Home?', undefined, expect.any(Array));
    expect(appStorage.places.get().home).toBeNull();
    expect(screen.getByRole('button', { name: 'Home, Not set' })).toBeOnTheScreen();
  });
});

describe('favourite places', () => {
  it('adds a favourite and plans a trip there from the current location', async () => {
    grantLocationAt(DEMO_PLACES.rouseHillHome.coordinate, {
      name: '12 Example Street',
      city: 'Rouse Hill',
    });
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Add a favourite place' }));
    await user.type(screen.getByLabelText('Search for a place'), 'Macquarie University');
    await user.press(
      await screen.findByRole('button', { name: 'Macquarie University, Macquarie Park' }),
    );

    expect(appStorage.places.get().favourites).toEqual([
      expect.objectContaining({
        label: 'Macquarie University',
        place: DEMO_PLACES.macquarieUniversity,
      }),
    ]);

    await user.press(screen.getByRole('button', { name: 'Macquarie University' }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request).toMatchObject({
      // Demo mode never asks Apple for the street name.
      origin: { name: 'Current location', kind: 'current-location' },
      destination: DEMO_PLACES.macquarieUniversity,
      time: { type: 'depart', at: expect.stringMatching(/^2026-10-26T20:30:/) },
      access: { transit: true, drive: true, dropOff: false },
      trip: { kind: 'outbound' },
    });
  });

  it('offers to plan from Home when the location cannot be used', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.addFavourite('Uni', DEMO_PLACES.macquarieUniversity);
    denyLocation(true);
    await renderApp('/saved');
    const alert = answerNextAlert('Plan from Home');

    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Uni, Macquarie University' }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(alert).toHaveBeenCalledWith(
      "Couldn't use your location",
      'HopReady can only use your location if you allow it. You can plan from Home instead.',
      expect.any(Array),
    );
    expect(planSession.getState().request).toMatchObject({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.macquarieUniversity,
    });
  });

  it('deletes a favourite after confirming', async () => {
    appStorage.places.addFavourite('Uni', DEMO_PLACES.macquarieUniversity);
    await renderApp('/saved');
    answerNextAlert('Delete');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete Uni' }));

    expect(appStorage.places.get().favourites).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Uni/ })).not.toBeOnTheScreen();
  });
});

describe('favourite routes', () => {
  it('plans a saved route leaving now, using how the person last travelled it', async () => {
    appStorage.recentRequests.record(
      demoCommuteRequest({ access: { transit: true, drive: false, dropOff: true } }),
    );
    appStorage.favouriteRoutes.add({
      label: 'Commute',
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.chatswoodOffice,
    });
    await renderApp('/saved');

    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Commute, Rouse Hill to Chatswood' }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request).toMatchObject({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.chatswoodOffice,
      time: { type: 'depart', at: expect.stringMatching(/^2026-10-26T20:30:/) },
      access: { transit: true, drive: false, dropOff: true },
    });
  });

  it('deletes a route after confirming', async () => {
    appStorage.favouriteRoutes.add({
      label: 'Commute',
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.chatswoodOffice,
    });
    await renderApp('/saved');
    answerNextAlert('Delete');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete Commute' }));

    expect(appStorage.favouriteRoutes.get()).toEqual([]);
  });
});

describe('recent searches', () => {
  it('plans a recent search again for now', async () => {
    const recent = demoCommuteRequest({ time: { type: 'arrive', at: '2026-10-25T22:00:00.000Z' } });
    appStorage.recentRequests.record(recent);
    await renderApp('/saved');
    const { title, subtitle } = describeRecentRequest(recent);
    expect(title).toBe('Rouse Hill to Chatswood');
    expect(subtitle).toBe('By public transport, driving, drop-off');

    await userEvent.setup().press(screen.getByRole('button', { name: `${title}, ${subtitle}` }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request).toMatchObject({
      origin: recent.origin,
      destination: recent.destination,
      access: recent.access,
      time: { type: 'depart', at: expect.stringMatching(/^2026-10-26T20:30:/) },
    });
  });

  it('plans a recent trip home through where the car is now', async () => {
    appStorage.recentRequests.record(
      demoCommuteRequest({
        origin: DEMO_PLACES.chatswoodOffice,
        destination: DEMO_PLACES.rouseHillHome,
        trip: { kind: 'return-without-car' },
      }),
    );
    appStorage.parkedCar.markParked(
      {
        location: {
          name: 'Kellyville (north)',
          coordinate: { lat: -33.713514, lon: 150.935304 },
          kind: 'car-park',
          carParkId: '29',
        },
        carParkId: '29',
        confirmedAt: '2026-10-26T20:00:00.000Z',
      },
      'Kellyville (north)',
    );
    await renderApp('/saved');

    await userEvent
      .setup()
      .press(
        screen.getByRole('button', { name: 'Chatswood to Rouse Hill, Back by public transport' }),
      );

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request?.trip).toMatchObject({
      kind: 'return-via-car',
      parkedCar: { carParkId: '29' },
    });
  });

  it('deletes one search, or clears them all, after confirming', async () => {
    appStorage.recentRequests.record(demoCommuteRequest());
    appStorage.recentRequests.record(
      demoCommuteRequest({ destination: DEMO_PLACES.macquarieUniversity }),
    );
    await renderApp('/saved');
    const user = userEvent.setup();

    answerNextAlert('Delete');
    await user.press(screen.getByRole('button', { name: 'Delete Rouse Hill to Chatswood' }));
    expect(appStorage.recentRequests.get()).toHaveLength(1);
    expect(appStorage.recentRequests.get()[0]?.destination).toEqual(
      DEMO_PLACES.macquarieUniversity,
    );

    answerNextAlert('Clear');
    await user.press(screen.getByRole('button', { name: 'Clear all' }));
    expect(appStorage.recentRequests.get()).toEqual([]);
    expect(screen.getByText('Trips you plan appear here.')).toBeOnTheScreen();
  });
});

describe('parking spots', () => {
  it('adds a spot from the current location and deletes it after confirming', async () => {
    grantLocationAt({ lat: -33.7, lon: 150.94 }, { name: '9 Example Road', city: 'Kellyville' });
    await renderApp('/saved');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Add a parking spot' }));
    await user.press(screen.getByRole('button', { name: 'Use my current location' }));

    expect(await screen.findByLabelText('Pinned location')).toBeOnTheScreen();
    expect(appStorage.parkingSpots.get()).toEqual([
      expect.objectContaining({ name: 'Pinned location', coordinate: { lat: -33.7, lon: 150.94 } }),
    ]);

    answerNextAlert('Delete');
    await user.press(screen.getByRole('button', { name: 'Delete Pinned location' }));
    expect(appStorage.parkingSpots.get()).toEqual([]);
  });
});
