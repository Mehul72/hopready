import { DEMO_PLACES } from '@hopready/core/fixtures';
import * as Location from 'expo-location';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/api';
import { appStorage } from '@/storage';
import { place } from '@/test-support/trips';
import { tripService } from '@/trip';

import { planChoices } from './plan-choices';
import { planDraft } from './plan-draft';
import { DEMO_ATTRIBUTION, LIVE_ATTRIBUTION } from './place-search-screen';
import {
  freezeClockAt,
  locationPermission,
  positionAt,
  renderApp,
  TUESDAY_0730,
} from './test-harness';

const GRANTED = locationPermission('granted');
const UNDETERMINED = locationPermission('undetermined');

const LIVE_RESULTS = {
  results: [
    {
      place: place('Chatswood Station', -33.7969, 151.1803, 'stop', { stopId: '206710' }),
      detail: 'Train and metro station',
    },
    { place: place('Chatswood Chase', -33.7955, 151.1857, 'poi'), detail: 'Shopping centre' },
  ],
  unavailable: [],
};

beforeEach(() => {
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  appStorage.deleteAllData();
  jest.useRealTimers();
  // The location mock is shared by every test in this file; put back "not decided yet".
  jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => UNDETERMINED);
});

function searchInput() {
  return screen.getByLabelText('Search for a place or stop');
}

describe('debouncing and the minimum length', () => {
  it('waits for 3 characters and a 300 ms pause, then searches once for the final text', async () => {
    jest.useFakeTimers({ now: TUESDAY_0730 });
    const search = jest.spyOn(tripService, 'searchPlaces');
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Ch');
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('Type at least 3 characters to search.')).toBeOnTheScreen();

    await user.type(searchInput(), 'ats');
    await act(async () => jest.advanceTimersByTime(299));
    expect(search).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(1));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0]?.[0]).toBe('Chats');
    expect(await screen.findByText('Chatswood Station')).toBeOnTheScreen();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('goes back to the prompt when the text gets shorter than 3 characters', async () => {
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');
    expect(await screen.findByText('Chatswood Station')).toBeOnTheScreen();
    await user.clear(searchInput());
    await user.type(searchInput(), 'Ch');

    expect(screen.getByText('Type at least 3 characters to search.')).toBeOnTheScreen();
    expect(screen.queryByText('Chatswood Station')).not.toBeOnTheScreen();
  });
});

describe('results', () => {
  it('lists stops before places, with an Apple map of the results and the sources', async () => {
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    const stopsHeader = await screen.findByRole('header', { name: 'Stops' });
    const placesHeader = screen.getByRole('header', { name: 'Places' });
    const headers = screen.getAllByRole('header').map((header) => header.props.children);
    expect(headers.indexOf('Stops')).toBeLessThan(headers.indexOf('Places'));
    expect(stopsHeader).toBeOnTheScreen();
    expect(placesHeader).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Chatswood Station, / })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /^1 Example Street, Chatswood, / }),
    ).toBeOnTheScreen();
    const map = screen.getByTestId('search-map');
    expect(within(map).getAllByTestId('map-marker').length).toBeGreaterThan(1);
    expect(screen.getByTestId('search-attribution')).toHaveTextContent(DEMO_ATTRIBUTION);
  });

  it('credits Transport for NSW and Apple Maps for live results, and says when a source is missing', async () => {
    appStorage.settings.setDemoMode(false);
    jest
      .spyOn(tripService, 'searchPlaces')
      .mockResolvedValue({ ...LIVE_RESULTS, unavailable: ['apple-maps'] });
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    expect(await screen.findByTestId('search-attribution')).toHaveTextContent(LIVE_ATTRIBUTION);
    expect(
      screen.getByText("Apple Maps places didn't answer, so some results may be missing."),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Chatswood Chase, Shopping centre' }),
    ).toBeOnTheScreen();
  });

  it('says plainly when nothing matches, also to VoiceOver', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Zzyzx');

    expect(await screen.findByText('No matches')).toBeOnTheScreen();
    expect(screen.queryByTestId('search-map')).not.toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('No matches');
  });

  it('tells VoiceOver how many places were found', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^\d+ places? found$/)),
    );
  });

  it('fills the field the sheet was opened for and closes it', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: 'To: not chosen' }));
    expect(screen).toHavePathname('/place-search');

    await user.type(searchInput(), 'Chatswood');
    await user.press(await screen.findByRole('button', { name: /^Chatswood Station, / }));

    expect(screen).toHavePathname('/');
    expect(planDraft.getState().destination).toMatchObject({
      name: 'Chatswood Station',
      kind: 'stop',
    });
    expect(screen.getByRole('button', { name: 'To: Chatswood Station' })).toBeOnTheScreen();
  });

  it('only offers stations when choosing a preferred station, and saves the choice', async () => {
    const user = userEvent.setup();
    await renderApp('/place-search?field=preferred-station');

    await user.type(screen.getByLabelText('Search for a station'), 'Chatswood');

    await user.press(await screen.findByRole('button', { name: /^Chatswood Station, / }));
    expect(screen.queryByText('1 Example Street, Chatswood')).not.toBeOnTheScreen();
    expect(planChoices.get().preferredStation).toMatchObject({
      name: 'Chatswood Station',
      kind: 'stop',
    });
  });

  it('treats a field it does not know, such as from a mistyped link, as the destination', async () => {
    const user = userEvent.setup();
    await renderApp('/place-search?field=somewhere-else');

    await user.type(searchInput(), 'Chatswood');
    await user.press(await screen.findByRole('button', { name: /^Chatswood Station, / }));

    expect(planDraft.getState().destination).toMatchObject({ name: 'Chatswood Station' });
    expect(planDraft.getState().origin).toBeNull();
  });

  it('offers the sample places in demo mode, so nothing has to be guessed', async () => {
    const user = userEvent.setup();
    await renderApp('/place-search?field=origin');

    expect(screen.getByRole('header', { name: 'Sample places' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Warringah Mall' }));

    expect(planDraft.getState().origin).toEqual(DEMO_PLACES.warringahMall);
  });

  it('does not offer sample places in live mode', async () => {
    appStorage.settings.setDemoMode(false);
    await renderApp('/place-search?field=origin');

    expect(screen.queryByRole('header', { name: 'Sample places' })).not.toBeOnTheScreen();
  });

  it('offers saved places while the search is empty', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.addFavourite('Gym', DEMO_PLACES.castleTowers);
    const user = userEvent.setup();
    await renderApp('/place-search?field=origin');

    await user.press(screen.getByRole('button', { name: 'Gym, Castle Towers' }));

    expect(planDraft.getState().origin).toEqual(DEMO_PLACES.castleTowers);
  });
});

describe('the location hint', () => {
  it('never asks for location, and searches without a hint when access was not granted', async () => {
    appStorage.settings.setDemoMode(false);
    const search = jest.spyOn(tripService, 'searchPlaces').mockResolvedValue(LIVE_RESULTS);
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls[0]?.[1]).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('sends a rounded hint when access was already granted', async () => {
    appStorage.settings.setDemoMode(false);
    jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => GRANTED);
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.796912, 151.180343, 500));
    const search = jest.spyOn(tripService, 'searchPlaces').mockResolvedValue(LIVE_RESULTS);
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[1]).toEqual({ lat: -33.8, lon: 151.18 });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('when search cannot answer', () => {
  it('shows an offline state, and tries again on request', async () => {
    appStorage.settings.setDemoMode(false);
    const search = jest
      .spyOn(tripService, 'searchPlaces')
      .mockRejectedValue(new ApiError('offline'));
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    expect(await screen.findByText("You're offline", {}, { timeout: 3_000 })).toBeOnTheScreen();
    search.mockResolvedValue(LIVE_RESULTS);
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Chatswood Station')).toBeOnTheScreen();
  });

  it('offers demo mode when live search is not set up, and only switches when asked', async () => {
    appStorage.settings.setDemoMode(false);
    const user = userEvent.setup();
    await renderApp('/place-search?field=destination');

    await user.type(searchInput(), 'Chatswood');

    expect(await screen.findByText("Search isn't set up")).toBeOnTheScreen();
    expect(appStorage.settings.get().demoMode).toBe(false);
    await user.press(screen.getByRole('button', { name: 'Turn on demo mode' }));
    expect(appStorage.settings.get().demoMode).toBe(true);
    expect(await screen.findByText('Chatswood Station')).toBeOnTheScreen();
  });
});

describe('using the current location', () => {
  it('uses the position when allowed', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce(GRANTED);
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.6955, 150.93));
    freezeClockAt(TUESDAY_0730);
    const user = userEvent.setup();
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: 'From: not chosen' }));

    await user.press(screen.getByRole('button', { name: 'Use current location' }));

    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(planDraft.getState().origin).toMatchObject({
      kind: 'current-location',
      name: 'Current location',
      coordinate: { lat: -33.6955, lon: 150.93 },
    });
  });

  it('keeps typing available when location is refused', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce(locationPermission('denied', false));
    const user = userEvent.setup();
    await renderApp('/place-search?field=origin');

    await user.press(screen.getByRole('button', { name: 'Use current location' }));

    expect(await screen.findByText('Location is off for HopReady')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Type the place instead' }));
    expect(screen.queryByText('Location is off for HopReady')).not.toBeOnTheScreen();
    await user.type(searchInput(), 'Rouse Hill');
    await user.press(
      await screen.findByRole('button', { name: /^12 Example Street, Rouse Hill, / }),
    );
    expect(planDraft.getState().origin).toEqual(DEMO_PLACES.rouseHillHome);
  });
});
