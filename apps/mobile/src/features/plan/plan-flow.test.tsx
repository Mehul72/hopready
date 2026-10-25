import { DEMO_PLACES } from '@hopready/core/fixtures';
import * as Location from 'expo-location';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';
import { Alert, Linking } from 'react-native';

import { planSession } from '@/state';
import { appStorage } from '@/storage';

import { planDraft } from './plan-draft';
import {
  freezeClockAt,
  isMomentsAfter,
  locationPermission,
  positionAt,
  renderApp,
  TUESDAY_0730,
} from './test-harness';

beforeEach(() => {
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
  freezeClockAt(TUESDAY_0730);
});

afterEach(() => {
  // Clears the session, the draft and cached queries (and their timers) with everything else.
  appStorage.deleteAllData();
  jest.useRealTimers();
});

describe('planning a trip from the Plan tab', () => {
  it('plans a demo trip from quick picks and lists the options on the results screen', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.setWork(DEMO_PLACES.barangarooOffice);
    const user = userEvent.setup();
    await renderApp('/');

    expect(screen.getByText('Quick picks for From')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByText('Quick picks for To')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Work' }));
    expect(
      screen.getByRole('button', { name: 'From: Home, 12 Example Street, Rouse Hill' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'To: Work, 200 Example Avenue, Barangaroo' }),
    ).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(screen).toHavePathname('/results');
    const request = planSession.getState().request;
    expect(request).toMatchObject({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
      time: { type: 'depart' },
      access: { transit: true, drive: true, dropOff: false },
      trip: { kind: 'outbound' },
    });
    // "Leave now" means the moment Plan trip was pressed.
    expect(isMomentsAfter(request?.time.at, TUESDAY_0730)).toBe(true);

    const cards = await screen.findAllByTestId(/^route-card-/);
    const response = planSession.getState().response;
    expect(response?.mode).toBe('demo');
    expect(cards).toHaveLength(response?.itineraries.length ?? -1);
    expect(cards.length).toBeGreaterThan(1);
    // Both ways the demo world offers for this trip are listed, each with big leave and arrive times.
    expect(screen.getAllByText('Public transport').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drive and park').length).toBeGreaterThan(0);
    expect(within(cards[0]!).getByText('Leave')).toBeOnTheScreen();
    expect(within(cards[0]!).getByText('Arrive')).toBeOnTheScreen();
    expect(screen.getByTestId('results-map')).toBeOnTheScreen();
    expect(
      screen.getByText('12 Example Street, Rouse Hill to 200 Example Avenue, Barangaroo'),
    ).toBeOnTheScreen();
  });

  it('reads each option to VoiceOver as one sentence', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.setWork(DEMO_PLACES.barangarooOffice);
    const user = userEvent.setup();
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: 'Home' }));
    await user.press(screen.getByRole('button', { name: 'Work' }));
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    const parkAndRide = (await screen.findAllByRole('button', { name: /^Drive and park\./ }))[0];
    expect(parkAndRide).toBeDefined();
    const label = parkAndRide?.props.accessibilityLabel as string;
    expect(label).toMatch(
      /^Drive and park\. Leave \d{1,2}:\d{2}\u00a0am, arrive \d{1,2}:\d{2}\u00a0am, /,
    );
    expect(label).toContain('Drive for');
    expect(label).toMatch(
      /Parking at [^:]+: About \d+ spaces? free, updated (just now|\d+ minutes? ago)\./,
    );
    expect(label).toContain('Spaces can fill before you arrive.');
    // Demo trips replay a made-up live feed, so they are never called live.
    expect(label).toContain('Sample times for demo mode, not live.');
    expect(label).not.toContain('Live times');
  });

  it('opens the chosen option without following it yet', async () => {
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    appStorage.places.setWork(DEMO_PLACES.barangarooOffice);
    const user = userEvent.setup();
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: 'Home' }));
    await user.press(screen.getByRole('button', { name: 'Work' }));
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));
    const [firstCard] = await screen.findAllByTestId(/^route-card-/);
    const id = String(firstCard?.props.testID).replace('route-card-', '');

    await user.press(firstCard!);

    expect(screen).toHavePathname(`/itinerary/${id}`);
    expect(screen.getByText(`Itinerary ${id}`)).toBeOnTheScreen();
    expect(appStorage.activeTrip.get()).toBeNull();
  });

  it('asks for what is missing instead of planning, and clears the message once fixed', async () => {
    const user = userEvent.setup();
    await renderApp('/');

    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(screen).toHavePathname('/');
    expect(screen.getByLabelText(/^Error\. Before you plan\. /)).toBeOnTheScreen();
    expect(screen.getByText(/Choose where you're starting from\./)).toBeOnTheScreen();
    expect(planSession.getState().request).toBeNull();

    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    expect(screen.queryByTestId('plan-problems')).not.toBeOnTheScreen();
  });

  it('refuses a drop-off without public transport, which the planner cannot plan', async () => {
    const user = userEvent.setup();
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    await renderApp('/');

    await user.press(screen.getByRole('togglebutton', { name: 'Public transport' }));
    await user.press(screen.getByRole('togglebutton', { name: "I'll drive and park" }));
    await user.press(screen.getByRole('togglebutton', { name: 'Someone will drop me off' }));
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(screen.getByText(/turn on Public transport for the rest of the trip/)).toBeOnTheScreen();
    expect(planSession.getState().request).toBeNull();
  });

  it('swaps From and To', async () => {
    const user = userEvent.setup();
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    await renderApp('/');

    await user.press(screen.getByRole('button', { name: 'Swap From and To' }));

    expect(planDraft.getState().origin).toEqual(DEMO_PLACES.barangarooOffice);
    expect(planDraft.getState().destination).toEqual(DEMO_PLACES.rouseHillHome);
    expect(
      screen.getByRole('button', { name: 'From: 200 Example Avenue, Barangaroo' }),
    ).toBeOnTheScreen();
  });

  it('plans an arrive-by trip with the chosen time', async () => {
    const user = userEvent.setup();
    // Rouse Hill has several ways to arrive by 9 am, so the results come with an order to choose.
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.chatswoodOffice);
    });
    await renderApp('/');

    await user.press(screen.getByRole('radio', { name: 'Arrive by' }));
    // The first suggestion is an hour away, rounded up to five minutes: 8:30 am.
    expect(screen.getByText(/^Arrive by 8:30\sam/)).toBeOnTheScreen();
    await act(async () => {
      screen.getByTestId('time-picker').props.onChange({
        nativeEvent: { timestamp: Date.parse('2026-10-26T22:00:00.000Z'), utcOffset: 660 },
      });
    });
    expect(screen.getByText(/^Arrive by 9:00\sam/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(planSession.getState().request?.time).toEqual({
      type: 'arrive',
      at: '2026-10-26T22:00:00.000Z',
    });
    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
    // Arrive-by results start sorted by the latest departure.
    expect(screen.getByRole('radio', { name: 'Leave latest' })).toBeChecked();
  });

  it('says when the chosen time has passed instead of planning a trip in the past', async () => {
    const user = userEvent.setup();
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    await renderApp('/');
    await user.press(screen.getByRole('radio', { name: 'Depart at' }));
    await act(async () => {
      screen.getByTestId('time-picker').props.onChange({
        nativeEvent: { timestamp: Date.parse('2026-10-26T19:00:00.000Z'), utcOffset: 660 },
      });
    });

    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(screen.getByText(/That time has passed\./)).toBeOnTheScreen();
    expect(planSession.getState().request).toBeNull();
  });
});

describe('one-tap routes', () => {
  it('plans a favourite route straight away with the current time and options', async () => {
    appStorage.favouriteRoutes.add({
      label: 'To the office',
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
    });
    const user = userEvent.setup();
    await renderApp('/');

    await user.press(screen.getByRole('button', { name: /^To the office, / }));

    expect(screen).toHavePathname('/results');
    expect(planSession.getState().request).toMatchObject({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
    });
    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
  });

  it('replans a recent trip with how the person travelled last time', async () => {
    appStorage.recentRequests.record({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
      time: { type: 'depart', at: '2026-10-20T20:00:00.000Z' },
      access: { transit: true, drive: false, dropOff: false },
      preferences: {
        maxDriveMinutes: 30,
        maxWalkMinutes: 15,
        parkingBufferMinutes: 8,
        dropOffBufferMinutes: 2,
        transferBufferMinutes: 3,
        carRetrievalBufferMinutes: 5,
        walkingSpeed: 'normal',
        excludedTransitModes: [],
      },
      trip: { kind: 'outbound' },
    });
    const user = userEvent.setup();
    await renderApp('/');
    const recents = screen.getByTestId('recent-trips');

    await user.press(
      within(recents).getByRole('button', { name: /^To 200 Example Avenue, Barangaroo/ }),
    );

    expect(screen).toHavePathname('/results');
    expect(planSession.getState().request).toMatchObject({
      time: { type: 'depart' },
      access: { transit: true, drive: false, dropOff: false },
    });
    // A fresh time, not the one from last week.
    expect(isMomentsAfter(planSession.getState().request?.time.at, TUESDAY_0730)).toBe(true);
    const cards = await screen.findAllByTestId(/^route-card-/);
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.queryByText('Drive and park')).not.toBeOnTheScreen();
  });

  it('removes recent trips when asked', async () => {
    appStorage.recentRequests.record({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
      time: { type: 'depart', at: '2026-10-20T20:00:00.000Z' },
      access: { transit: true, drive: true, dropOff: false },
      preferences: {
        maxDriveMinutes: 30,
        maxWalkMinutes: 15,
        parkingBufferMinutes: 8,
        dropOffBufferMinutes: 2,
        transferBufferMinutes: 3,
        carRetrievalBufferMinutes: 5,
        walkingSpeed: 'normal',
        excludedTransitModes: [],
      },
      trip: { kind: 'outbound' },
    });
    const user = userEvent.setup();
    await renderApp('/');
    const confirm = jest.spyOn(Alert, 'alert');

    confirm.mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Cancel')?.onPress?.();
    });
    await user.press(
      within(screen.getByTestId('recent-trips')).getByRole('button', { name: 'Clear' }),
    );
    expect(appStorage.recentRequests.get()).not.toEqual([]);

    confirm.mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Clear')?.onPress?.();
    });
    await user.press(
      within(screen.getByTestId('recent-trips')).getByRole('button', { name: 'Clear' }),
    );

    await waitFor(() => expect(screen.queryByTestId('recent-trips')).not.toBeOnTheScreen());
    expect(appStorage.recentRequests.get()).toEqual([]);
  });
});

describe('when location is refused', () => {
  it('offers Settings and manual entry, and planning still works', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce(locationPermission('denied', false));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    appStorage.places.setWork(DEMO_PLACES.barangarooOffice);
    const user = userEvent.setup();
    await renderApp('/');

    await user.press(screen.getByRole('button', { name: 'Current location' }));

    expect(await screen.findByText('Location is off for HopReady')).toBeOnTheScreen();
    expect(planDraft.getState().origin).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);

    await user.press(screen.getByRole('button', { name: 'Enter a starting point' }));
    expect(screen).toHavePathname('/place-search');
    await user.type(screen.getByLabelText('Search for a place or stop'), 'Rouse Hill');
    await user.press(
      await screen.findByRole('button', { name: /^12 Example Street, Rouse Hill, / }),
    );
    expect(screen).toHavePathname('/');
    expect(screen.queryByText('Location is off for HopReady')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Work' }));
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
    expect(planSession.getState().request?.origin).toEqual(DEMO_PLACES.rouseHillHome);
  });

  it('fills From with the current place when location is allowed', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce(locationPermission('granted'));
    jest
      .mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce(positionAt(-33.6955, 150.93));
    const user = userEvent.setup();
    await renderApp('/');

    await user.press(screen.getByRole('button', { name: 'Current location' }));

    await waitFor(() =>
      expect(planDraft.getState().origin).toMatchObject({ kind: 'current-location' }),
    );
    expect(screen.getByRole('button', { name: 'From: Current location' })).toBeOnTheScreen();
    expect(screen.getByText('Quick picks for To')).toBeOnTheScreen();
  });
});
