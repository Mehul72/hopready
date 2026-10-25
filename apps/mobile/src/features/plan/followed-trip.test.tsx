import { addMinutes } from '@hopready/core';
import { userEvent } from '@testing-library/react-native';
import { act, screen } from 'expo-router/testing-library';

import { FOLLOWED_TRIP_SHOWN_AFTER_ARRIVAL_MINUTES } from '@/features/itinerary';
import { planSession } from '@/state';
import { appStorage } from '@/storage';
import { parkAndRideItinerary, planRequest, planResponse } from '@/test-support/trips';
import { tripService } from '@/trip';

import { freezeClockAt, renderApp, TUESDAY_0730 } from './test-harness';

function followTrip() {
  const itinerary = parkAndRideItinerary({ departAt: addMinutes(TUESDAY_0730, 10) });
  appStorage.activeTrip.start({
    request: planRequest(),
    itinerary,
    plannedAt: TUESDAY_0730.toISOString(),
    mode: 'demo',
  });
  return itinerary;
}

beforeEach(() => {
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
  freezeClockAt(TUESDAY_0730);
});

afterEach(() => {
  appStorage.deleteAllData();
  jest.useRealTimers();
});

describe('the followed trip on the Plan tab', () => {
  it('is not shown when no trip is followed', async () => {
    await renderApp('/');

    expect(screen.queryByTestId('followed-trip')).not.toBeOnTheScreen();
  });

  it('leads back to the trip being followed', async () => {
    const itinerary = followTrip();
    await renderApp('/');

    await userEvent.setup().press(screen.getByTestId('followed-trip'));

    expect(screen.getByText(`Itinerary ${itinerary.id}`)).toBeOnTheScreen();
  });

  it('says when the check on resume found the trip changed', async () => {
    const itinerary = followTrip();
    const laterRun = { ...itinerary, id: 'later-run', departAt: addMinutes(itinerary.departAt, 4) };
    jest
      .spyOn(tripService, 'planTrip')
      .mockResolvedValue(planResponse([laterRun], { mode: 'demo' }));
    await renderApp('/');
    jest.setSystemTime(new Date(addMinutes(TUESDAY_0730, 2)));

    await act(() => planSession.refreshActiveTrip());

    expect(screen.getByLabelText(/^Your trip\..*Your trip changed\./)).toBeOnTheScreen();
  });

  it('drops off the Plan tab an hour after arriving', async () => {
    const itinerary = followTrip();
    jest.setSystemTime(
      new Date(addMinutes(itinerary.arriveAt, FOLLOWED_TRIP_SHOWN_AFTER_ARRIVAL_MINUTES + 1)),
    );

    await renderApp('/');

    expect(screen.queryByTestId('followed-trip')).not.toBeOnTheScreen();
  });
});
