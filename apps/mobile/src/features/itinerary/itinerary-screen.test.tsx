import {
  addMinutes,
  DEFAULT_PREFERENCES,
  type DriveLeg,
  type Itinerary,
  legSeconds,
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
import { parkAndRideItinerary, planRequest, planResponse } from '@/test-support/trips';
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

  it('follows a later run of the same option and says what changed', async () => {
    const { response, itinerary } = await followParkAndRide();
    const laterRun: Itinerary = {
      ...itinerary,
      id: 'later-run',
      departAt: addMinutes(itinerary.departAt, 4),
      arriveAt: addMinutes(itinerary.arriveAt, 4),
    };
    jest.spyOn(tripService, 'planTrip').mockResolvedValue({ ...response, itineraries: [laterRun] });

    await act(() => planSession.refreshActiveTrip());

    expect(appStorage.activeTrip.get()?.itinerary.id).toBe('later-run');
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
