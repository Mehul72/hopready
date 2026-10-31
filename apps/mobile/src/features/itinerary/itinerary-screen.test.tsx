import {
  addMinutes,
  buildItinerary,
  DEFAULT_PREFERENCES,
  type DriveLeg,
  type Itinerary,
  type Leg,
  legSeconds,
  type ParkedCar,
  type PlanRequest,
  type PlanResponse,
} from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import { act, screen, waitFor, within } from 'expo-router/testing-library';
import { ActionSheetIOS, Linking } from 'react-native';

import { ApiError } from '@/api';
import { planSession } from '@/state';
import { appStorage } from '@/storage';
import {
  laterRunOf,
  metroThenBusItinerary,
  parkAndRideItinerary,
  place,
  PLACES,
  planRequest,
  planResponse,
  transitItinerary,
} from '@/test-support/trips';
import { tripService } from '@/trip';

import { APPLE_ATTRIBUTION, DEMO_ATTRIBUTION, TFNSW_ATTRIBUTION } from './data-attribution';
import { demoCommuteRequest, freezeClockAt, renderApp, WEEKDAY_MORNING } from './testing';
import { describeTripSummary } from './trip-summary-card';
import { duration, STRATEGY_LABELS } from './trip-text';

beforeEach(() => {
  freezeClockAt(WEEKDAY_MORNING);
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  jest.useRealTimers();
});

async function planDemoCommute(overrides: Partial<PlanRequest> = {}): Promise<PlanResponse> {
  const outcome = await planSession.plan(demoCommuteRequest(overrides));
  if (outcome.status !== 'ready')
    throw new Error(`The demo plan did not finish: ${outcome.status}`);
  return outcome.response;
}

function firstWithStrategy(response: PlanResponse, strategy: Itinerary['strategy']): Itinerary {
  const itinerary = response.itineraries.find((candidate) => candidate.strategy === strategy);
  if (!itinerary) throw new Error(`The demo plan offered no ${strategy} option`);
  return itinerary;
}

function driveLegOf(itinerary: Itinerary): DriveLeg {
  const leg = itinerary.legs.find((candidate) => candidate.kind === 'drive');
  if (!leg || leg.kind !== 'drive') throw new Error('Expected a drive leg');
  return leg;
}

describe('itinerary screen', () => {
  it('opens its map full screen, where it can be moved, and comes back', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'park-and-ride');
    await renderApp(`/itinerary/${itinerary.id}`);
    expect(screen.getByTestId('map-view')).toHaveProp('scrollEnabled', false);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Bigger map' }));

    expect(await screen.findByTestId('map-screen')).toBeOnTheScreen();
    const fullMap = within(screen.getByTestId('full-map'));
    expect(fullMap.getByTestId('map-view')).toHaveProp('scrollEnabled', true);
    expect(fullMap.getByRole('image', { name: /^Map of the trip from/ })).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByTestId('itinerary-screen')).toBeOnTheScreen();
  });

  it('keeps the marks the option carried in the list, worded against the limits', async () => {
    const driveOnly = firstWithStrategy(await planDemoCommute(), 'drive-only');
    expect(driveOnly.concerns).toEqual(['long-drive']);
    const limit = planSession.getState().request?.preferences.maxDriveMinutes;
    await renderApp(`/itinerary/${driveOnly.id}`);

    expect(screen.getByTestId('trip-concern')).toHaveTextContent(
      new RegExp(`driving, over your ${limit} minute driving limit\\.$`),
    );
  });

  it('shows the leave and arrive times, the map, every step and the data sources', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'park-and-ride');
    await renderApp(`/itinerary/${itinerary.id}`);

    expect(screen.getByLabelText(describeTripSummary(itinerary))).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-summary')).getByText('Drive and park'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('map-view')).toBeOnTheScreen();

    const drive = driveLegOf(itinerary);
    expect(
      screen.getByText(`Drive ${duration(legSeconds(drive)).text} to ${drive.to.name}`),
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^leg-/)).toHaveLength(itinerary.legs.length);
    expect(screen.getByTestId('leg-park')).toBeOnTheScreen();
    expect(screen.getByTestId('leg-transit')).toBeOnTheScreen();
    expect(screen.getByTestId('arrival')).toBeOnTheScreen();
    expect(screen.getByText(DEMO_ATTRIBUTION)).toBeOnTheScreen();
  });

  it('sets a change against the transfer buffer the trip was planned with', async () => {
    // Settings now say 4 min, but the trip on screen was planned with 5.
    appStorage.preferences.change({ transferBufferMinutes: 4 });
    const response = await planDemoCommute({
      origin: DEMO_PLACES.collaroyHome,
      destination: DEMO_PLACES.waterlooOffice,
      access: { transit: true, drive: false, dropOff: false },
      preferences: { ...DEFAULT_PREFERENCES, transferBufferMinutes: 5, excludedTransitModes: [] },
    });
    const itinerary = response.itineraries.find((option) => option.transfers > 0);
    if (!itinerary) throw new Error('The demo plan offered no option with a change');
    await renderApp(`/itinerary/${itinerary.id}`);

    expect(
      screen.getByText(
        /^Change at Wynyard Station: \d+ min including the walk; your transfer buffer is 5 min\.$/,
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        /Change at Wynyard Station: \d+ minutes including the walk; your transfer buffer is 5 minutes\./,
      ),
    ).toBeOnTheScreen();
  });

  it('says the station entrance is not provided when a drop-off leads straight onto the metro', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'drop-off');
    await renderApp(`/itinerary/${itinerary.id}`);

    const metro = screen.getByTestId('leg-transit');
    expect(
      within(metro).getByText('Entrance details not provided. Follow the station signs.'),
    ).toBeOnTheScreen();
    expect(
      within(metro).getByLabelText(/Entrance details not provided\. Follow the station signs\.$/),
    ).toBeOnTheScreen();
  });

  it('credits Transport for NSW and Apple on live trips', async () => {
    appStorage.settings.setDemoMode(false);
    const live = parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' });
    jest.spyOn(tripService, 'planTrip').mockResolvedValue(planResponse([live]));
    await planSession.plan(planRequest());

    await renderApp(`/itinerary/${live.id}`);

    expect(screen.getByText(TFNSW_ATTRIBUTION)).toBeOnTheScreen();
    expect(screen.getByText(APPLE_ATTRIBUTION)).toBeOnTheScreen();
    expect(screen.queryByText(DEMO_ATTRIBUTION)).not.toBeOnTheScreen();
  });

  it('starts the trip, which becomes the active trip', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'transit-only');
    await renderApp(`/itinerary/${itinerary.id}`);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Start this trip' }));

    expect(appStorage.activeTrip.get()).toMatchObject({
      itinerary: { id: itinerary.id },
      mode: 'demo',
      plannedAt: WEEKDAY_MORNING.toISOString(),
    });
    expect(screen.getByText("You're following this trip")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Start this trip' })).not.toBeOnTheScreen();
  });

  it('saves the route as a favourite once', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'transit-only');
    await renderApp(`/itinerary/${itinerary.id}`);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Save route' }));

    expect(appStorage.favouriteRoutes.get()).toEqual([
      expect.objectContaining({
        label: 'Rouse Hill to Chatswood',
        origin: demoCommuteRequest().origin,
        destination: demoCommuteRequest().destination,
      }),
    ]);
    expect(screen.getByRole('button', { name: 'Route saved' })).toBeDisabled();
  });

  it('offers only installed navigation apps when asked to start driving', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'park-and-ride');
    jest.spyOn(Linking, 'canOpenURL').mockImplementation(async (url) => url === 'comgooglemaps://');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const showSheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    await renderApp(`/itinerary/${itinerary.id}`);

    const drive = driveLegOf(itinerary);
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: `Start driving to ${drive.to.name}` }));

    await waitFor(() => expect(showSheet).toHaveBeenCalledTimes(1));
    const [options, choose] = showSheet.mock.calls[0] ?? [];
    expect(options?.options).toEqual(['Apple Maps', 'Google Maps', 'Cancel']);
    expect(options?.cancelButtonIndex).toBe(2);

    await act(async () => choose?.(1));
    const target = `${drive.to.coordinate.lat.toFixed(6)},${drive.to.coordinate.lon.toFixed(6)}`;
    expect(openURL).toHaveBeenCalledWith(`comgooglemaps://?daddr=${target}&directionsmode=driving`);
  });

  it('opens the saved navigation app straight away when it is installed', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'park-and-ride');
    appStorage.preferences.change({ navigationApp: 'waze' });
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const showSheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
    await renderApp(`/itinerary/${itinerary.id}`);

    const drive = driveLegOf(itinerary);
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: `Start driving to ${drive.to.name}` }));

    const target = `${drive.to.coordinate.lat.toFixed(6)},${drive.to.coordinate.lon.toFixed(6)}`;
    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith(`https://waze.com/ul?ll=${target}&navigate=yes`),
    );
    expect(showSheet).not.toHaveBeenCalled();
  });

  it('confirms the suggested car park only when the person chooses it', async () => {
    const itinerary = firstWithStrategy(await planDemoCommute(), 'park-and-ride');
    const carPark = itinerary.parking?.carPark;
    if (!carPark) throw new Error('Expected the park-and-ride option to have a car park');
    await renderApp(`/itinerary/${itinerary.id}`);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'I parked here' }));
    expect(await screen.findByTestId('confirm-parking')).toBeOnTheScreen();

    const save = screen.getByRole('button', { name: 'Save where I parked' });
    expect(save).toBeDisabled();
    const suggested = screen.getByRole('radio', {
      name: `${carPark.name}, Suggested by your trip, Choose it only if this is where you parked.`,
    });
    expect(suggested).not.toBeChecked();

    await user.press(suggested);
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    expect(appStorage.parkedCar.get()).toEqual({
      status: 'parked',
      parkedCar: {
        location: {
          name: carPark.name,
          coordinate: carPark.coordinate,
          kind: 'car-park',
          carParkId: carPark.id,
        },
        carParkId: carPark.id,
        // renderRouter runs Jest's fake timers, and pressing advances them by milliseconds.
        confirmedAt: expect.stringMatching(/^2026-10-26T20:30:/),
      },
      carParkName: carPark.name,
    });
    expect(await screen.findByTestId('itinerary-screen')).toBeOnTheScreen();
  });

  it('says so when the trip is no longer available', async () => {
    await renderApp('/itinerary/not-a-trip');
    expect(screen.getByRole('header', { name: "This trip isn't available" })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Plan a trip' })).toBeOnTheScreen();
  });
});

describe('the followed trip after a refresh', () => {
  async function followParkAndRide() {
    const response = await planDemoCommute();
    const itinerary = firstWithStrategy(response, 'park-and-ride');
    planSession.select(itinerary.id);
    await renderApp(`/itinerary/${itinerary.id}`);
    // Two minutes on, the trip is old enough to be checked again but has not started.
    jest.setSystemTime(new Date(addMinutes(WEEKDAY_MORNING, 2)));
    return { response, itinerary };
  }

  it('stops calling the alternatives live once the check that found them is old', async () => {
    const { response } = await followParkAndRide();
    const alternative = transitItinerary({
      departAt: addMinutes(WEEKDAY_MORNING, 30),
      realtime: true,
    });
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [alternative] });
    await act(() => planSession.refreshActiveTrip());
    const { checkedAt } = planSession.getState().activeTripRefresh;
    expect(
      screen.getByRole('button', { name: describeTripSummary(alternative) }),
    ).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTime(15 * 60_000 + 1_000));

    expect(
      screen.getByRole('button', { name: describeTripSummary(alternative, checkedAt) }),
    ).toBeOnTheScreen();
  });

  it('offers the alternatives when the chosen option is no longer offered', async () => {
    const { response } = await followParkAndRide();
    const alternative = firstWithStrategy(response, 'transit-only');
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [alternative] });

    await act(() => planSession.refreshActiveTrip());

    expect(screen.getByLabelText(/^Error\. This trip is no longer offered\./)).toBeOnTheScreen();
    const option = screen.getByRole('button', { name: describeTripSummary(alternative) });
    await userEvent.setup().press(option);

    expect(appStorage.activeTrip.get()?.itinerary.id).toBe(alternative.id);
    expect(await screen.findByLabelText(describeTripSummary(alternative))).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-summary')).getByText(STRATEGY_LABELS['transit-only']),
    ).toBeOnTheScreen();
  });

  it('still finds a car park chosen as a fallback once the nearly full one has room', async () => {
    // A Tuesday afternoon in the demo: at 3.25 pm Tallawong P2 is nearly full, so the slower
    // Kellyville car parks are listed as somewhere else to park. By 3.30 pm P2 has room again.
    const plannedAt = new Date('2026-10-27T04:25:00.000Z');
    jest.setSystemTime(plannedAt);
    const outcome = await planSession.plan(
      demoCommuteRequest({
        origin: DEMO_PLACES.boxHillHome,
        time: { type: 'depart', at: '2026-10-27T05:30:00.000Z' },
      }),
    );
    if (outcome.status !== 'ready')
      throw new Error(`The demo plan did not finish: ${outcome.status}`);
    const fallback = outcome.response.itineraries.find(
      (itinerary) => itinerary.parking?.carPark.name === 'Kellyville (north)',
    );
    if (!fallback) throw new Error('The demo plan offered no Kellyville (north) option');
    planSession.select(fallback.id);
    await renderApp(`/itinerary/${fallback.id}`);
    jest.setSystemTime(new Date(addMinutes(plannedAt, 5)));

    await act(() => planSession.refreshActiveTrip());

    expect(
      screen.getByLabelText('Information. This trip is still on, with the latest times.'),
    ).toBeOnTheScreen();
    expect(appStorage.activeTrip.get()?.itinerary.id).toBe(fallback.id);
  });

  it('follows a later run of the same option and says what changed', async () => {
    const { response, itinerary } = await followParkAndRide();
    const laterRun = laterRunOf(itinerary, 4);
    jest.spyOn(tripService, 'planTrip').mockResolvedValue({ ...response, itineraries: [laterRun] });

    await act(() => planSession.refreshActiveTrip());

    expect(appStorage.activeTrip.get()?.itinerary.id).toBe(laterRun.id);
    expect(screen.getByLabelText(/^Warning\. Your trip changed\./)).toBeOnTheScreen();
    expect(screen.getByLabelText(describeTripSummary(laterRun))).toBeOnTheScreen();
  });

  it('shows the latest times after a check that found the same trip running late', async () => {
    const { response, itinerary } = await followParkAndRide();
    const runningLate: Itinerary = { ...itinerary, arriveAt: addMinutes(itinerary.arriveAt, 3) };
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [runningLate] });

    await act(() => planSession.refreshActiveTrip());

    expect(appStorage.activeTrip.get()?.itinerary.arriveAt).toBe(runningLate.arriveAt);
    expect(screen.getByLabelText(describeTripSummary(runningLate))).toBeOnTheScreen();
    expect(screen.queryByLabelText(describeTripSummary(itinerary))).not.toBeOnTheScreen();
  });

  it('shows the newer results after a pull to refresh, not the older followed copy', async () => {
    const { response, itinerary } = await followParkAndRide();
    const refreshed: Itinerary = { ...itinerary, arriveAt: addMinutes(itinerary.arriveAt, 2) };
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [refreshed] });

    await act(async () => {
      await planSession.refresh();
    });

    expect(screen.getByLabelText(describeTripSummary(refreshed))).toBeOnTheScreen();
    expect(screen.getByText("You're following this trip")).toBeOnTheScreen();
  });

  it('stops treating a trip as followed an hour after it arrived', async () => {
    const response = await planDemoCommute();
    const itinerary = firstWithStrategy(response, 'park-and-ride');
    planSession.select(itinerary.id);
    jest.setSystemTime(new Date(addMinutes(itinerary.arriveAt, 61)));

    await renderApp(`/itinerary/${itinerary.id}`);

    expect(screen.queryByText("You're following this trip")).not.toBeOnTheScreen();
  });

  it('reports a failed check with a way to try again', async () => {
    await followParkAndRide();
    jest.spyOn(tripService, 'planTrip').mockRejectedValue(new ApiError('offline'));

    await act(() => planSession.refreshActiveTrip());

    expect(
      screen.getByLabelText(
        "Error. Couldn't check this trip. You're offline. Connect to the internet, then try again.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});

describe('checking a followed trip for changes', () => {
  async function followParkAndRide() {
    const response = await planDemoCommute();
    const itinerary = firstWithStrategy(response, 'park-and-ride');
    planSession.select(itinerary.id);
    await renderApp(`/itinerary/${itinerary.id}`);
    return { response, itinerary };
  }

  it('says when the times were checked, and holds off another check for 30 seconds', async () => {
    await followParkAndRide();
    const plan = jest.spyOn(tripService, 'planTrip');

    expect(screen.getByLabelText('Times checked at 7:30 am')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(plan).not.toHaveBeenCalled();
    expect(screen.getByTestId('check-too-soon')).toHaveTextContent(
      /This trip was checked less than 30 seconds ago\. You can check again in \d+ seconds\./,
    );
  });

  it('says when a check found the trip gone, as that check counts for the 30 seconds', async () => {
    const { response } = await followParkAndRide();
    const alternative = firstWithStrategy(response, 'transit-only');
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [alternative] });
    const firstCheck = new Date(addMinutes(WEEKDAY_MORNING, 2));
    jest.setSystemTime(firstCheck);
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Check for changes' }));
    expect(
      await screen.findByLabelText(/^Error\. This trip is no longer offered\./),
    ).toBeOnTheScreen();

    jest.setSystemTime(new Date(firstCheck.getTime() + 10_000));
    await user.press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(screen.getByLabelText('Times checked at 7:32 am')).toBeOnTheScreen();
    expect(screen.getByTestId('check-too-soon')).toHaveTextContent(
      /This trip was checked less than 30 seconds ago\. You can check again in \d+ seconds\./,
    );
  });

  it('notices at the car park that the metro was cancelled during the drive', async () => {
    const { itinerary } = await followParkAndRide();
    const metro = itinerary.legs.find((leg) => leg.kind === 'transit');
    if (!metro) throw new Error('Expected a metro leg');
    // The demo cancels this run once the scenario starts, while the person is driving.
    await act(async () => {
      appStorage.settings.setDemoScenario('cancelled-service');
    });
    jest.setSystemTime(new Date(addMinutes(itinerary.departAt, 1)));

    await userEvent.setup().press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(
      await screen.findByLabelText(/^Error\. This trip is no longer offered\./),
    ).toBeOnTheScreen();
    const { alternatives } = planSession.getState().activeTripRefresh;
    expect(alternatives.length).toBeGreaterThan(0);
    expect(
      alternatives.every((alternative) => alternative.legs[0]?.from.name === metro.from.name),
    ).toBe(true);
    // Each option says it leaves from the station, not from home.
    for (const alternative of alternatives) {
      expect(
        screen.getByRole('button', {
          name: `From ${metro.from.name}. ${describeTripSummary(alternative)}`,
        }),
      ).toBeOnTheScreen();
    }
    expect(
      screen.getAllByText(`${STRATEGY_LABELS['transit-only']} from ${metro.from.name}`),
    ).toHaveLength(alternatives.length);
  });

  it('still finds the metro after it makes up the time it had lost', async () => {
    const { itinerary } = await followParkAndRide();
    const followed = appStorage.activeTrip.get();
    const metro = itinerary.legs.find((leg) => leg.kind === 'transit');
    if (!followed || !metro) throw new Error('Expected a followed trip with a metro');
    // The last check found the metro three minutes late. It now runs to time again.
    await act(async () => {
      appStorage.activeTrip.start({
        ...followed,
        itinerary: {
          ...itinerary,
          legs: itinerary.legs.map((leg) =>
            leg.kind === 'transit'
              ? { ...leg, start: addMinutes(leg.start, 3), end: addMinutes(leg.end, 3) }
              : leg,
          ),
        },
      });
    });
    jest.setSystemTime(new Date(addMinutes(itinerary.departAt, 1)));

    await userEvent.setup().press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(
      await screen.findByLabelText('Information. This trip is still on, with the latest times.'),
    ).toBeOnTheScreen();
    expect(
      appStorage.activeTrip.get()?.itinerary.legs.find((leg) => leg.kind === 'transit')?.start,
    ).toBe(metro.start);
  });

  it('says a service that has already left could not be checked', async () => {
    // On the metro since five minutes ago, with the bus from Chatswood still to come.
    const onTheMetro = metroThenBusItinerary({ departAt: addMinutes(WEEKDAY_MORNING, -15) });
    const busIndex = onTheMetro.legs.findIndex(
      (leg) => leg.kind === 'transit' && leg.mode === 'bus',
    );
    // Checked 45 seconds ago: too recent for the check on launch, old enough to ask for one.
    appStorage.activeTrip.start({
      request: demoCommuteRequest(),
      itinerary: onTheMetro,
      plannedAt: new Date(WEEKDAY_MORNING.getTime() - 45_000).toISOString(),
      mode: 'demo',
    });
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue(
        planResponse(
          [buildItinerary({ strategy: 'transit-only', legs: onTheMetro.legs.slice(busIndex) })],
          { mode: 'demo' },
        ),
      );
    await renderApp(`/itinerary/${onTheMetro.id}`);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(
      await screen.findByLabelText(
        "Information. Your next services are still running, with the latest times. A service that has already left can't be checked, so a delay on it could still make you miss a connection.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('This trip is still on, with the latest times.'),
    ).not.toBeOnTheScreen();
  });

  it('checks the rest of the trip after leaving, and offers what still runs', async () => {
    const { response, itinerary } = await followParkAndRide();
    const metro = itinerary.legs.find((leg) => leg.kind === 'transit');
    if (!metro || metro.kind !== 'transit') throw new Error('Expected a metro leg');
    const laterMetro = {
      ...metro,
      start: addMinutes(metro.start, 10),
      end: addMinutes(metro.end, 10),
      scheduledStart: addMinutes(metro.scheduledStart, 10),
      scheduledEnd: addMinutes(metro.scheduledEnd, 10),
    };
    const alternative = buildItinerary({ strategy: 'transit-only', legs: [laterMetro] });
    const plan = jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue({ ...response, itineraries: [alternative] });
    // A minute into the drive to the car park.
    jest.setSystemTime(new Date(addMinutes(itinerary.departAt, 1)));
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Check for changes' }));

    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: metro.from,
        access: { transit: true, drive: false, dropOff: false },
      }),
      expect.anything(),
    );
    expect(
      await screen.findByLabelText(/^Error\. This trip is no longer offered\./),
    ).toBeOnTheScreen();
    await user.press(
      screen.getByRole('button', {
        name: `From ${metro.from.name}. ${describeTripSummary(alternative)}`,
      }),
    );

    // Still the drive and park trip from home: the drive, the car park and I parked here stay.
    const followed = appStorage.activeTrip.get();
    expect(followed?.request).toEqual(demoCommuteRequest());
    expect(followed?.itinerary).toMatchObject({
      strategy: 'park-and-ride',
      parking: itinerary.parking,
      departAt: itinerary.departAt,
      arriveAt: alternative.arriveAt,
    });
    const notWaiting = (leg: Leg) => leg.kind !== 'wait';
    expect(followed?.itinerary.legs.filter(notWaiting)).toEqual([
      ...itinerary.legs.slice(0, itinerary.legs.indexOf(metro)).filter(notWaiting),
      ...alternative.legs,
    ]);
    expect(await screen.findByRole('button', { name: 'I parked here' })).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-summary')).getByText(STRATEGY_LABELS['park-and-ride']),
    ).toBeOnTheScreen();
    // The warning was about the trip it replaced.
    expect(screen.queryByLabelText(/This trip is no longer offered/)).not.toBeOnTheScreen();
  });
});

describe('how live the times are', () => {
  it('stops calling the times live once they were checked more than 15 minutes ago', async () => {
    appStorage.settings.setDemoMode(false);
    const live = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z', realtime: true });
    // A check on resume, if one starts, never answers, so the times stay as first planned.
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValueOnce(planResponse([live]))
      .mockReturnValue(new Promise<PlanResponse>(() => undefined));
    await planSession.plan(planRequest());
    planSession.select(live.id);
    jest.setSystemTime(new Date(addMinutes(WEEKDAY_MORNING, 16)));

    await renderApp(`/itinerary/${live.id}`);

    const summary = within(screen.getByTestId('trip-summary'));
    expect(summary.getByText('Checked 7:30 am')).toBeOnTheScreen();
    expect(summary.queryByText('Live times')).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText(describeTripSummary(live, WEEKDAY_MORNING.toISOString())),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Live')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Times checked at 7:30 am')).toBeOnTheScreen();
  });

  it('stops calling them live the moment the check turns 15 minutes old', async () => {
    appStorage.settings.setDemoMode(false);
    const live = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z', realtime: true });
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValueOnce(planResponse([live]))
      .mockReturnValue(new Promise<PlanResponse>(() => undefined));
    // Checked half way through a minute, which the screen's minute clock would round away.
    jest.setSystemTime(new Date(WEEKDAY_MORNING.getTime() + 30_000));
    await planSession.plan(planRequest());
    planSession.select(live.id);
    await renderApp(`/itinerary/${live.id}`);
    const summary = within(screen.getByTestId('trip-summary'));
    expect(summary.getByText('Live times')).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTime(15 * 60_000 + 1_000));

    expect(summary.queryByText('Live times')).not.toBeOnTheScreen();
    expect(summary.getByText('Checked 7:30 am')).toBeOnTheScreen();
  });
});

describe('a trip home after the car changes', () => {
  const car: ParkedCar = {
    location: PLACES.tallawongCarPark,
    carParkId: '26',
    confirmedAt: WEEKDAY_MORNING.toISOString(),
  };

  // Plans a trip home through the car and opens its option, following it if asked.
  async function openTripHome({ follow }: { follow: boolean }) {
    appStorage.parkedCar.markParked(car, 'Tallawong P1');
    const home = transitItinerary({ departAt: addMinutes(WEEKDAY_MORNING, 10) });
    jest.spyOn(tripService, 'planTrip').mockResolvedValue(planResponse([home], { mode: 'demo' }));
    await planSession.plan(
      planRequest({
        origin: PLACES.chatswoodOffice,
        destination: PLACES.rouseHillHome,
        trip: { kind: 'return-via-car', parkedCar: car },
      }),
    );
    if (follow) planSession.select(home.id);
    await renderApp(`/itinerary/${home.id}`);
    expect(screen.queryByTestId('trip-home-out-of-date')).not.toBeOnTheScreen();
  }

  it('warns on an option opened from the results too, and does not start it', async () => {
    await openTripHome({ follow: false });
    expect(screen.getByRole('button', { name: 'Start this trip' })).toBeEnabled();

    await act(async () => {
      appStorage.parkedCar.markDroppedOff(WEEKDAY_MORNING.toISOString());
    });

    expect(screen.getByTestId('trip-home-out-of-date')).toBeOnTheScreen();
    const start = screen.getByRole('button', { name: 'Start this trip' });
    expect(start).toBeDisabled();
    expect(start).toHaveProp('accessibilityHint', 'Plan your trip home again first');
  });

  it('says straight away that the trip home is out of date once the car is moved', async () => {
    await openTripHome({ follow: true });

    await act(async () => {
      appStorage.parkedCar.markParked(
        { ...car, location: place('Pinned location', -33.6951, 150.9071), carParkId: null },
        null,
      );
    });

    expect(
      screen.getByLabelText(
        'Warning. This trip home is out of date. Your car details changed after it was planned. Tap Take me home on the Car tab to plan it again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Check for changes' })).not.toBeOnTheScreen();
  });

  it.each([
    [
      'the car is moved',
      () =>
        appStorage.parkedCar.markParked(
          { ...car, location: place('Pinned location', -33.6951, 150.9071), carParkId: null },
          null,
        ),
    ],
    [
      'the person says they were dropped off',
      () => appStorage.parkedCar.markDroppedOff(WEEKDAY_MORNING.toISOString()),
    ],
  ])('leads to Take me home on the Car tab when %s', async (_, change) => {
    await openTripHome({ follow: true });
    await act(async () => {
      change();
    });

    const open = screen.getByRole('button', { name: 'Open the Car tab' });
    expect(open).toHaveProp('accessibilityHint', 'Shows Take me home');
    await userEvent.setup().press(open);

    expect(screen).toHavePathname('/car');
    expect(screen.getByRole('button', { name: 'Take me home' })).toBeOnTheScreen();
  });

  it('asks to plan the way home on the Plan tab once the parked car is removed', async () => {
    await openTripHome({ follow: true });

    await act(async () => {
      appStorage.parkedCar.clear();
    });

    expect(
      screen.getByLabelText(
        'Warning. This trip home is out of date. Your car was removed after it was planned. Plan your way home on the Plan tab.',
      ),
    ).toBeOnTheScreen();
    // With no car saved, the Car tab has no Take me home to send the person to.
    expect(screen.queryByRole('button', { name: 'Open the Car tab' })).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Open the Plan tab' }));
    expect(screen).toHavePathname('/');
  });
});
