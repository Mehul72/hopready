import { type Itinerary, legSeconds, type ParkedCar } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';

import { ApiError } from '@/api';
import { planDraft } from '@/features/plan/plan-draft';
import { planChoices } from '@/features/plan/plan-choices';
import { freezeClockAt, renderApp, TUESDAY_0730 } from '@/features/plan/test-harness';
import { planSession } from '@/state';
import { appStorage } from '@/storage';
import { fitToCoordinates } from '@/test-support/mocks/react-native-maps';
import { place, PLACES, planRequest, planResponse, transitItinerary } from '@/test-support/trips';
import { tripService } from '@/trip';

beforeEach(() => {
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
  freezeClockAt(TUESDAY_0730);
});

afterEach(() => {
  appStorage.deleteAllData();
  jest.useRealTimers();
});

// Opens the Plan tab with a route already chosen and presses Plan trip.
async function planFromPlanTab(
  origin = DEMO_PLACES.rouseHillHome,
  destination = DEMO_PLACES.barangarooOffice,
) {
  const user = userEvent.setup();
  await act(async () => {
    planDraft.setRoute(origin, destination);
  });
  await renderApp('/');
  await user.press(screen.getByRole('button', { name: 'Plan trip' }));
  expect(screen).toHavePathname('/results');
  return user;
}

function shownItineraries(): Itinerary[] {
  const byId = new Map(
    (planSession.getState().response?.itineraries ?? []).map((itinerary) => [
      itinerary.id,
      itinerary,
    ]),
  );
  return screen.getAllByTestId(/^route-card-/).map((card) => {
    const itinerary = byId.get(String(card.props.testID).replace('route-card-', ''));
    if (!itinerary) throw new Error('A card shows an option that is not in the results');
    return itinerary;
  });
}

function isSortedBy(itineraries: readonly Itinerary[], key: (itinerary: Itinerary) => number) {
  return itineraries.every(
    (itinerary, index) => index === 0 || key(itineraries[index - 1]!) <= key(itinerary),
  );
}

const arrival = (itinerary: Itinerary) => Date.parse(itinerary.arriveAt);
const selfDriving = (itinerary: Itinerary) =>
  itinerary.legs
    .filter((leg) => leg.kind === 'drive')
    .reduce((total, leg) => total + legSeconds(leg), 0);

describe('sorting', () => {
  it('starts with the earliest arrival and re-sorts by driving and changes on request', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);

    expect(screen.getByRole('radio', { name: 'Earliest arrival' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Leave latest' })).not.toBeOnTheScreen();
    const byArrival = shownItineraries();
    expect(byArrival.length).toBeGreaterThan(2);
    expect(isSortedBy(byArrival, arrival)).toBe(true);

    await user.press(screen.getByRole('radio', { name: 'Least driving' }));
    const byDriving = shownItineraries();
    expect(isSortedBy(byDriving, selfDriving)).toBe(true);
    expect(byDriving[0]?.strategy).toBe('transit-only');
    expect(byDriving.at(-1)?.strategy).toBe('park-and-ride');
    expect(screen.getByRole('radio', { name: 'Least driving' })).toBeChecked();

    await user.press(screen.getByRole('radio', { name: 'Fewest changes' }));
    expect(isSortedBy(shownItineraries(), (itinerary) => itinerary.transfers)).toBe(true);
    // Sorting reorders the same options; it never adds or drops one.
    expect(shownItineraries()).toHaveLength(byArrival.length);
  });
});

describe('when nothing works', () => {
  it("explains the rejection reasons in the person's own settings and suggests a change", async () => {
    appStorage.preferences.change({ transferBufferMinutes: 20 });
    planChoices.setAccess({ drive: false });
    const user = await planFromPlanTab(DEMO_PLACES.warringahMall, DEMO_PLACES.macquarieParkOffice);

    expect(await screen.findByText('No trip options found')).toBeOnTheScreen();
    expect(
      screen.getByText('Some connections were shorter than your 20 min transfer buffer.'),
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);

    await user.press(screen.getByRole('button', { name: 'Change trip options' }));
    expect(screen).toHavePathname('/trip-options');
  });

  it('offers to plan again once the trip options have changed', async () => {
    appStorage.preferences.change({ transferBufferMinutes: 20 });
    planChoices.setAccess({ drive: false });
    const user = await planFromPlanTab(DEMO_PLACES.warringahMall, DEMO_PLACES.macquarieParkOffice);
    expect(await screen.findByText('No trip options found')).toBeOnTheScreen();
    expect(screen.queryByTestId('options-changed')).not.toBeOnTheScreen();

    await act(async () => {
      appStorage.preferences.change({ transferBufferMinutes: 5 });
    });
    expect(screen.getByText('Trip options changed')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Plan again' }));

    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
    expect(planSession.getState().request?.preferences.transferBufferMinutes).toBe(5);
    expect(screen.queryByTestId('options-changed')).not.toBeOnTheScreen();
  });

  it('says which ways to travel were not included and why', async () => {
    await planFromPlanTab(DEMO_PLACES.boxHillHome, DEMO_PLACES.chatswoodOffice);
    await screen.findAllByTestId(/^route-card-/);

    expect(
      screen.getByLabelText(
        'Information. Public transport the whole way: not included. No public transport journeys were found for this time.',
      ),
    ).toBeOnTheScreen();
  });

  it('lists the car parks it checked and what happened at each', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const disclosure = screen.getByRole('button', { name: /^Car parks checked \(\d+\)$/ });
    expect(disclosure).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ expanded: false }),
    );

    await user.press(disclosure);

    expect(disclosure).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ expanded: true }),
    );
    expect(
      screen.getByLabelText('Tallawong P2: Not on the way to your destination'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Cherrybrook: Further than your 30 min driving limit'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Kellyville (north): A connection was found from here'),
    ).toBeOnTheScreen();
  });

  it('says why a car park that worked has no card of its own', async () => {
    const user = await planFromPlanTab(DEMO_PLACES.boxHillHome, DEMO_PLACES.chatswoodOffice);
    await screen.findAllByTestId(/^route-card-/);

    await user.press(screen.getByRole('button', { name: /^Car parks checked \(\d+\)$/ }));

    expect(
      screen.getByLabelText('Tallawong P2: A connection was found from here'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Kellyville (north): A car park shown above gets you there as early, with no more driving',
      ),
    ).toBeOnTheScreen();
    expect(
      shownItineraries().some(
        (itinerary) => itinerary.parking?.carPark.name === 'Kellyville (north)',
      ),
    ).toBe(false);
  });
});

describe('error states', () => {
  it('shows an offline state and plans again on request', async () => {
    jest.spyOn(tripService, 'planTrip').mockRejectedValueOnce(new ApiError('offline'));
    const user = await planFromPlanTab();

    expect(await screen.findByText("You're offline")).toBeOnTheScreen();
    expect(
      screen.getByText("You're offline. Connect to the internet, then try again."),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
  });

  it('shows a server error with a retry', async () => {
    jest
      .spyOn(tripService, 'planTrip')
      .mockRejectedValueOnce(new ApiError('server', { status: 502 }));
    const user = await planFromPlanTab();

    expect(await screen.findByText("Couldn't get trip options")).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
  });

  it('says how long to wait when rate limited, and only offers a retry after that', async () => {
    jest.useFakeTimers({ now: TUESDAY_0730 });
    appStorage.settings.setDemoScenario('rate-limited');
    planChoices.setAccess({ drive: false });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await act(async () => {
      planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    });
    await renderApp('/');
    await user.press(screen.getByRole('button', { name: 'Plan trip' }));

    expect(await screen.findByText('HopReady is busy')).toBeOnTheScreen();
    expect(
      screen.getByText('Demo mode: the sample travel service is busy. Try again in 30 seconds.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      appStorage.settings.setDemoScenario('normal');
    });
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
  });

  it('explains that HopReady only covers Greater Sydney and goes back to change the trip', async () => {
    const user = await planFromPlanTab(DEMO_PLACES.rouseHillHome, PLACES.melbourne);

    expect(await screen.findByText('Outside Greater Sydney')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Change the trip' }));

    expect(screen).toHavePathname('/');
  });

  it('offers demo mode when live planning is not set up, and switches only when asked', async () => {
    appStorage.settings.setDemoMode(false);
    const user = await planFromPlanTab();

    expect(await screen.findByText("Live planning isn't set up")).toBeOnTheScreen();
    expect(appStorage.settings.get().demoMode).toBe(false);
    await user.press(screen.getByRole('button', { name: 'Turn on demo mode' }));

    expect(appStorage.settings.get().demoMode).toBe(true);
    expect(await screen.findAllByTestId(/^route-card-/)).not.toHaveLength(0);
    expect(planSession.getState().response?.mode).toBe('demo');
  });

  it('keeps the options on screen when a refresh fails, and says so', async () => {
    await planFromPlanTab();
    const cards = await screen.findAllByTestId(/^route-card-/);
    jest.spyOn(tripService, 'planTrip').mockRejectedValueOnce(new ApiError('timeout'));
    jest.setSystemTime(new Date(TUESDAY_0730.getTime() + 31_000));

    await act(async () => {
      screen.getByTestId('results-list').props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByText("Couldn't refresh")).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(cards.length);
  });
});

describe('refreshing', () => {
  it('holds off a refresh within 30 seconds of the last one and says when it can run', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const plan = jest.spyOn(tripService, 'planTrip');

    await user.press(screen.getByRole('button', { name: 'Refresh' }));

    expect(plan).not.toHaveBeenCalled();
    expect(screen.getByTestId('refresh-too-soon')).toHaveTextContent(
      /These options are less than 30 seconds old\. You can refresh again in \d+ seconds\./,
    );
  });

  it('plans again once 30 seconds have passed', async () => {
    await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const firstPlannedAt = planSession.getState().plannedAt;
    const plan = jest.spyOn(tripService, 'planTrip');
    jest.setSystemTime(new Date(TUESDAY_0730.getTime() + 31_000));

    await act(async () => {
      screen.getByTestId('results-list').props.refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(planSession.getState().status).toBe('ready'));
    expect(plan).toHaveBeenCalledTimes(1);
    expect(planSession.getState().plannedAt).not.toBe(firstPlannedAt);
  });
});

describe('a trip home', () => {
  const car: ParkedCar = {
    location: PLACES.tallawongCarPark,
    carParkId: '26',
    confirmedAt: TUESDAY_0730.toISOString(),
  };

  async function showTripHome() {
    appStorage.parkedCar.markParked(car, 'Tallawong P1');
    jest.spyOn(tripService, 'planTrip').mockResolvedValue(
      planResponse([transitItinerary({ departAt: TUESDAY_0730.toISOString() })], {
        mode: 'demo',
      }),
    );
    await planSession.plan(
      planRequest({
        origin: PLACES.chatswoodOffice,
        destination: PLACES.rouseHillHome,
        trip: { kind: 'return-via-car', parkedCar: car },
      }),
    );
    await renderApp('/results');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeOnTheScreen();
  }

  it('says the options are out of date as soon as the car is moved', async () => {
    await showTripHome();

    await act(async () => {
      appStorage.parkedCar.markParked(
        { ...car, location: place('Pinned location', -33.6951, 150.9071), carParkId: null },
        null,
      );
    });

    expect(screen.getByTestId('trip-home-out-of-date')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen();
  });

  it('asks for Take me home again, instead of refreshing, once the car is removed', async () => {
    await showTripHome();

    await act(async () => {
      appStorage.parkedCar.clear();
    });

    expect(screen.getByTestId('trip-home-out-of-date')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Open the Car tab' }));
    expect(await screen.findByText('Car screen')).toBeOnTheScreen();
  });
});

describe('without a trip', () => {
  it('says no trip is planned and leads back to the Plan tab', async () => {
    const user = userEvent.setup();
    await renderApp('/results');

    expect(screen.getByText('No trip planned yet')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Plan a trip' }));

    expect(screen).toHavePathname('/');
  });
});

describe('the results map', () => {
  it('keeps its framing when nothing about the options changed', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const framedTimes = fitToCoordinates.mock.calls.length;
    expect(framedTimes).toBeGreaterThan(0);

    // A refresh that is too soon re-renders the screen with the same options.
    await user.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByTestId('refresh-too-soon')).toBeOnTheScreen();

    expect(fitToCoordinates.mock.calls.length).toBe(framedTimes);
  });

  it('shows every option on an Apple map, with the highlighted one drawn on top', async () => {
    await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const map = screen.getByTestId('results-map');

    expect(within(map).getAllByTestId('map-polyline').length).toBeGreaterThan(0);
    expect(
      within(map).getByLabelText(/^Map of \d+ trip options\. Highlighted: /),
    ).toBeOnTheScreen();
  });
});
