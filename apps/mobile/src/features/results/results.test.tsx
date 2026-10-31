import { addMinutes, type Itinerary, legSeconds, type ParkedCar } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';
import { AccessibilityInfo, ActionSheetIOS } from 'react-native';

import { ApiError } from '@/api';
import { planDraft } from '@/features/plan/plan-draft';
import { planChoices } from '@/features/plan/plan-choices';
import { freezeClockAt, renderApp, TUESDAY_0730 } from '@/features/plan/test-harness';
import { planSession } from '@/state';
import { appStorage } from '@/storage';
import { fitToCoordinates } from '@/test-support/mocks/react-native-maps';
import { place, PLACES, planRequest, planResponse, transitItinerary } from '@/test-support/trips';
import { tripService } from '@/trip';

import { describeItinerary } from './route-summary';

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

// The sort menu is the system action sheet, so a test picks an entry by answering the sheet.
function answerSortSheetWith(label: string) {
  return jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementationOnce((options, callback) => {
      callback(options.options?.indexOf(label) ?? -1);
    });
}

describe('sorting', () => {
  it('starts with the earliest arrival and re-sorts by driving and changes on request', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);

    expect(screen.getByRole('button', { name: 'Sort by: Earliest arrival' })).toBeOnTheScreen();
    const byArrival = shownItineraries();
    expect(byArrival.length).toBeGreaterThan(2);
    expect(isSortedBy(byArrival, arrival)).toBe(true);

    const sheet = answerSortSheetWith('Least driving');
    await user.press(screen.getByRole('button', { name: 'Sort by: Earliest arrival' }));
    // "Leave latest" only means something for an arrive-by trip.
    expect(sheet.mock.calls[0]?.[0].options).toEqual([
      'Earliest arrival',
      'Least driving',
      'Fewest changes',
      'Cancel',
    ]);
    const byDriving = shownItineraries();
    expect(isSortedBy(byDriving, selfDriving)).toBe(true);
    expect(byDriving[0]?.strategy).toBe('transit-only');
    // Driving the whole way is listed for comparison, marked as a long drive.
    expect(byDriving.at(-1)?.strategy).toBe('drive-only');
    expect(byDriving.at(-1)?.concerns).toEqual(['long-drive']);
    expect(screen.getByRole('button', { name: 'Sort by: Least driving' })).toBeOnTheScreen();

    answerSortSheetWith('Fewest changes');
    await user.press(screen.getByRole('button', { name: 'Sort by: Least driving' }));
    expect(isSortedBy(shownItineraries(), (itinerary) => itinerary.transfers)).toBe(true);
    // Sorting reorders the same options; it never adds or drops one.
    expect(shownItineraries()).toHaveLength(byArrival.length);
  });

  it('shows a long drive as a mark on the option, against the limit', async () => {
    await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const driveOnly = shownItineraries().find((itinerary) => itinerary.strategy === 'drive-only');
    expect(driveOnly).toBeDefined();
    const limit = planSession.getState().request?.preferences.maxDriveMinutes;

    const card = within(screen.getByTestId(`route-card-${driveOnly!.id}`));
    expect(card.getByText(new RegExp(`^Drive .+, over your ${limit} min$`))).toBeOnTheScreen();
  });
});

describe('when nothing works', () => {
  it('keeps options whose changes are shorter than the transfer buffer, marked rather than hidden', async () => {
    appStorage.preferences.change({ transferBufferMinutes: 20 });
    planChoices.setAccess({ drive: false });
    await planFromPlanTab(DEMO_PLACES.warringahMall, DEMO_PLACES.macquarieParkOffice);
    await screen.findAllByTestId(/^route-card-/);

    expect(screen.queryByText('No trip options found')).not.toBeOnTheScreen();
    expect(
      shownItineraries().some((itinerary) => itinerary.concerns.includes('tight-change')),
    ).toBe(true);
  });

  it('offers to plan again once the trip options have changed', async () => {
    appStorage.preferences.change({ transferBufferMinutes: 20 });
    planChoices.setAccess({ drive: false });
    const user = await planFromPlanTab(DEMO_PLACES.warringahMall, DEMO_PLACES.macquarieParkOffice);
    await screen.findAllByTestId(/^route-card-/);
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

  it('lists the car parks it considered, with their estimates, one tap away', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const checked = planSession.getState().response?.checkedCarParks ?? [];
    expect(checked.length).toBeGreaterThan(2);

    await user.press(
      screen.getByRole('button', { name: `Car parks considered, ${checked.length}` }),
    );

    expect(screen).toHavePathname('/car-parks-considered');
    expect(
      await screen.findByLabelText(/^Cherrybrook.*: Further than your 30 min driving limit$/),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        /^Kellyville \(north\), Kellyville Station.*: Exact times in the options$/,
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        /^Kellyville \(south\), Kellyville Station, about .+ door to door: Not among the five tried$/,
      ),
    ).toBeOnTheScreen();
    // Tried car parks come first, then the rest by their estimate.
    const rows = screen.getAllByTestId(/^considered-car-park-/);
    const outcomes = rows.map(
      (row) =>
        checked.find((carPark) => `considered-car-park-${carPark.id}` === row.props.testID)!
          .outcome,
    );
    expect(outcomes.indexOf('used')).toBeLessThan(outcomes.indexOf('not-tried'));
    expect(outcomes.indexOf('not-tried')).toBeLessThan(outcomes.indexOf('too-far-to-drive'));

    await user.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen).toHavePathname('/results');
  });

  it('says why a car park at a listed station has no card of its own', async () => {
    const user = await planFromPlanTab(DEMO_PLACES.boxHillHome, DEMO_PLACES.chatswoodOffice);
    await screen.findAllByTestId(/^route-card-/);
    const carParksWithCards = shownItineraries().map(
      (itinerary) => itinerary.parking?.carPark.name,
    );
    // Both Kellyville car parks serve the same station, so only one is checked and listed.
    expect(carParksWithCards).toContain('Kellyville (north)');
    expect(carParksWithCards).not.toContain('Kellyville (south)');

    await user.press(screen.getByRole('button', { name: /^Car parks considered, \d+$/ }));

    expect(
      await screen.findByLabelText(/^Tallawong P2.*: Exact times in the options$/),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/^Kellyville \(south\).*: Not among the five tried$/),
    ).toBeOnTheScreen();
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

describe('options checked before midnight', () => {
  // 11:58 pm on Monday 26 October 2026 in Sydney.
  const lateMonday = new Date('2026-10-26T12:58:00.000Z');

  async function openLateResults() {
    freezeClockAt(lateMonday);
    appStorage.settings.setDemoMode(false);
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue(
        planResponse([transitItinerary({ departAt: '2026-10-26T13:10:00.000Z' })]),
      );
    await planSession.plan(planRequest({ time: { type: 'depart', at: lateMonday.toISOString() } }));
    await renderApp('/results');
    await screen.findAllByTestId(/^route-card-/);
  }

  async function showLateResults() {
    await openLateResults();
    // Ten minutes on, it is Tuesday.
    await act(() => jest.advanceTimersByTime(10 * 60_000));
  }

  const pullToRefresh = () =>
    act(async () => {
      screen.getByTestId('results-list').props.refreshControl.props.onRefresh();
    });

  it('says the day of the check, in full for VoiceOver', async () => {
    await showLateResults();

    const checked = screen.getByTestId('checked-at');
    expect(checked).toHaveTextContent('Checked Mon 11:58\u00a0pm');
    expect(checked).toHaveProp('accessibilityLabel', 'Checked Monday 11:58\u00a0pm');
  });

  it('says how old the options are when a refresh fails, in full for VoiceOver', async () => {
    await showLateResults();
    jest.spyOn(tripService, 'planTrip').mockRejectedValueOnce(new ApiError('timeout'));
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await pullToRefresh();

    expect(await screen.findByText(/These options are from Mon 11:58\spm\.$/)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        /^Error\. Couldn't refresh\. .*These options are from Monday 11:58\spm\.$/,
      ),
    ).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Error\. Couldn't refresh\. .*These options are from Monday 11:58\spm\.$/,
      ),
    );
  });

  it('says a failed refresh once, though its wording gains the day at midnight', async () => {
    await openLateResults();
    // 40 seconds on, past the 30 second limit, the refresh fails; ten minutes on, it is Tuesday.
    jest.setSystemTime(new Date(lateMonday.getTime() + 40_000));
    jest.spyOn(tripService, 'planTrip').mockRejectedValueOnce(new ApiError('timeout'));
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await pullToRefresh();
    expect(await screen.findByText("Couldn't refresh")).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTime(10 * 60_000));

    expect(screen.getByText(/These options are from Mon 11:58\spm\.$/)).toBeOnTheScreen();
    const failures = announce.mock.calls.filter(([text]) => text.includes("Couldn't refresh"));
    expect(failures).toHaveLength(1);
  });

  it('clears the note about refreshing too soon once a refresh is allowed again', async () => {
    await openLateResults();
    jest.setSystemTime(new Date(lateMonday.getTime() + 10_000));
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByTestId('refresh-too-soon')).toHaveTextContent(
      /^Checked 11:58\spm\. Refresh again in \d+ seconds\.$/,
    );
    await act(() => jest.advanceTimersByTime(10 * 60_000));

    expect(screen.queryByTestId('refresh-too-soon')).not.toBeOnTheScreen();
    expect(screen.getByTestId('checked-at')).toHaveTextContent('Checked Mon 11:58\u00a0pm');
  });
});

describe('refreshing', () => {
  it('holds off a refresh within 30 seconds of the last one and says when it can run', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    const plan = jest.spyOn(tripService, 'planTrip');

    expect(screen.getByTestId('checked-at')).toHaveTextContent('Checked 7:30 am');
    await user.press(screen.getByRole('button', { name: 'Refresh' }));

    expect(plan).not.toHaveBeenCalled();
    expect(screen.getByTestId('refresh-too-soon')).toHaveTextContent(
      /^Checked 7:30 am\. Refresh again in \d+ seconds\.$/,
    );
    // VoiceOver hears the whole note, not just the check time.
    expect(screen.getByTestId('refresh-too-soon')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Checked 7:30\sam\. Refresh again in \d+ seconds\.$/),
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

describe('how live the times are', () => {
  it('stops calling options live once they were checked more than 15 minutes ago', async () => {
    appStorage.settings.setDemoMode(false);
    const live = transitItinerary({ departAt: addMinutes(TUESDAY_0730, 30), realtime: true });
    jest.spyOn(tripService, 'planTrip').mockResolvedValue(planResponse([live]));
    await planSession.plan(planRequest());
    jest.setSystemTime(new Date(addMinutes(TUESDAY_0730, 16)));

    await renderApp('/results');

    const card = within(screen.getByTestId(`route-card-${live.id}`));
    expect(card.getByText('Checked 7:30 am')).toBeOnTheScreen();
    expect(card.queryByText('Live')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: describeItinerary(live, new Date(), TUESDAY_0730.toISOString()),
      }),
    ).toBeOnTheScreen();
  });
});

describe('times on another day', () => {
  it('says the day of a time that is not on the day asked for', async () => {
    // 10:30 pm on Monday in Sydney.
    const mondayNight = new Date('2026-10-26T11:30:00.000Z');
    freezeClockAt(mondayNight);
    appStorage.settings.setDemoMode(false);
    // Leaves 11:20 pm and gets there 12:15 am; the other leaves at 6:40 am on Tuesday.
    const tonight = transitItinerary({ departAt: '2026-10-26T12:20:00.000Z' });
    const tomorrow = transitItinerary({ departAt: '2026-10-26T19:40:00.000Z', service: 'T1' });
    jest.spyOn(tripService, 'planTrip').mockResolvedValue(planResponse([tonight, tomorrow]));
    await planSession.plan(
      planRequest({ time: { type: 'depart', at: mondayNight.toISOString() } }),
    );

    await renderApp('/results');

    expect(
      within(screen.getByTestId(`route-card-${tonight.id}`)).getByText('11:20 pm → Tue 12:15 am'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`route-card-${tomorrow.id}`)).getByText('Tue 6:40 am → 7:35 am'),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: /^Public transport\. Leave Tuesday 6:40\sam, arrive 7:35\sam,/,
      }),
    ).toBeOnTheScreen();
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

  it('asks to plan the way home again, instead of refreshing, once the car is removed', async () => {
    await showTripHome();

    await act(async () => {
      appStorage.parkedCar.clear();
    });

    expect(
      screen.getByLabelText(
        'Warning. This trip home is out of date. Your car was removed after it was planned. Plan your way home on the Plan tab.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Open the Plan tab' }));
    expect(screen).toHavePathname('/');
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

  it('opens a bigger map that can be moved, and comes back', async () => {
    const user = await planFromPlanTab();
    await screen.findAllByTestId(/^route-card-/);
    // The map on the page keeps still so a swipe scrolls the page.
    expect(within(screen.getByTestId('results-map')).getByTestId('map-view')).toHaveProp(
      'scrollEnabled',
      false,
    );

    await user.press(screen.getByRole('button', { name: 'Bigger map' }));

    expect(await screen.findByTestId('map-screen')).toBeOnTheScreen();
    const fullMap = within(screen.getByTestId('full-map'));
    expect(fullMap.getByTestId('map-view')).toHaveProp('scrollEnabled', true);
    expect(fullMap.getAllByTestId('map-polyline').length).toBeGreaterThan(0);

    await user.press(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByTestId('results-screen')).toBeOnTheScreen();
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
