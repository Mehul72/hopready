import type { Itinerary } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { fireEvent, userEvent } from '@testing-library/react-native';
import { act, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Alert, type AlertButton } from 'react-native';

import { planSession } from '@/state';
import { appStorage, createAppStorage, sqliteBackend } from '@/storage';
import {
  driveOnlyItinerary,
  parkAndRideItinerary,
  planRequest,
  PLACES,
} from '@/test-support/trips';

import {
  denyLocation,
  freezeClockAt,
  grantLocationAt,
  holdLocationAt,
  renderApp,
  WEEKDAY_MORNING,
} from '../itinerary/testing';
import { NUDGE_METRES } from './pin-drop-map';

const KELLYVILLE_NORTH = {
  id: '29',
  name: 'Kellyville (north)',
  coordinate: { lat: -33.713514, lon: 150.935304 },
};

function parkAtKellyvilleNorth() {
  appStorage.parkedCar.markParked(
    {
      location: {
        name: KELLYVILLE_NORTH.name,
        coordinate: KELLYVILLE_NORTH.coordinate,
        kind: 'car-park',
        carParkId: KELLYVILLE_NORTH.id,
      },
      carParkId: KELLYVILLE_NORTH.id,
      confirmedAt: '2026-10-26T20:45:00.000Z',
    },
    KELLYVILLE_NORTH.name,
  );
}

function follow(itinerary: Itinerary) {
  appStorage.activeTrip.start({
    request: planRequest(),
    itinerary,
    plannedAt: WEEKDAY_MORNING.toISOString(),
    mode: 'demo',
  });
}

// Presses the button with this text in the next alert, as a person would.
function answerNextAlert(buttonText: string) {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const button = (buttons ?? []).find((candidate: AlertButton) => candidate.text === buttonText);
    if (!button) throw new Error(`The alert has no "${buttonText}" button`);
    button.onPress?.();
  });
  return alert;
}

beforeEach(() => {
  freezeClockAt(WEEKDAY_MORNING);
  appStorage.deleteAllData();
  appStorage.settings.setDemoMode(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Car tab', () => {
  it('explains how to confirm parking when no car is saved', async () => {
    await renderApp('/car');

    expect(screen.getByRole('header', { name: 'No parked car saved' })).toBeOnTheScreen();
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Tell HopReady where you parked' }));
    expect(await screen.findByTestId('confirm-parking')).toBeOnTheScreen();
  });

  it('shows the parked car on a map with when it was confirmed', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/car');

    expect(
      screen.getByLabelText('Your car is at Kellyville (north). Confirmed 7:45 am today.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('map-view')).toBeOnTheScreen();
    expect(screen.getByLabelText('Map showing your car at Kellyville (north).')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Take me home' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Correct location' })).toBeOnTheScreen();
  });

  it('removes the parked car after asking', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/car');
    const alert = answerNextAlert('Remove');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Remove parked car' }));

    expect(alert).toHaveBeenCalledWith(
      'Remove your parked car?',
      'Take me home will no longer route you back to it.',
      expect.any(Array),
    );
    expect(appStorage.parkedCar.get()).toEqual({ status: 'none' });
    expect(screen.getByRole('header', { name: 'No parked car saved' })).toBeOnTheScreen();
  });
});

describe('confirming where the car is', () => {
  it('saves a documented car park, and the car is still there after a restart', async () => {
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Save where I parked' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Choose another car park' }));
    await user.press(
      await screen.findByRole('radio', { name: 'Kellyville (north), Kellyville Station' }),
    );
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    // A fresh storage over the same device store, as after the app is closed and opened again.
    const afterRestart = createAppStorage(sqliteBackend, () => 'unused-install-id');
    expect(afterRestart.parkedCar.get()).toEqual({
      status: 'parked',
      parkedCar: {
        location: {
          name: 'Kellyville (north)',
          coordinate: KELLYVILLE_NORTH.coordinate,
          kind: 'car-park',
          carParkId: '29',
        },
        carParkId: '29',
        confirmedAt: expect.stringMatching(/^2026-10-26T20:30:/),
      },
      carParkName: 'Kellyville (north)',
    });

    // With nothing underneath the sheet, it closes to the Car tab.
    appStorage.parkedCar.dropCachedValue();
    expect(await screen.findByText('Kellyville (north)')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Take me home' })).toBeOnTheScreen();
  });

  it('records a drop-off, so the way home never involves the car', async () => {
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: 'I was dropped off' }));
    expect(screen.getByText(/Take me home will plan public transport only/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Save that I was dropped off' }));

    expect(createAppStorage(sqliteBackend, () => 'unused').parkedCar.get()).toEqual({
      status: 'dropped-off',
      at: expect.stringMatching(/^2026-10-26T20:30:/),
    });
    expect(await screen.findByText('You were dropped off')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Take me home plans public transport only, because your car isn't with you.",
      ),
    ).toBeOnTheScreen();
  });

  it('can use the current location, labelled as only near the address', async () => {
    // Live mode, where the street name is looked up; demo mode sends the position nowhere.
    appStorage.settings.setDemoMode(false);
    grantLocationAt(
      { lat: -33.742, lon: 150.956 },
      { name: '5 Example Close', city: 'Bella Vista' },
    );
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Where I am now/ }));
    expect(
      await screen.findByRole('radio', { name: 'Where I am now, 5 Example Close, Bella Vista' }),
    ).toBeChecked();
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    expect(appStorage.parkedCar.get()).toMatchObject({
      status: 'parked',
      parkedCar: {
        location: {
          name: 'Near 5 Example Close, Bella Vista',
          coordinate: { lat: -33.742, lon: 150.956 },
          kind: 'parked-car',
        },
        carParkId: null,
      },
      carParkName: null,
    });
  });

  it('keeps the car park chosen while the location was still being found', async () => {
    const location = holdLocationAt({ lat: -33.742, lon: 150.956 });
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Where I am now/ }));
    await user.press(screen.getByRole('button', { name: 'Choose another car park' }));
    await user.press(
      await screen.findByRole('radio', { name: 'Kellyville (north), Kellyville Station' }),
    );
    await act(() => location.release());

    expect(
      screen.getByRole('radio', { name: 'Kellyville (north), Kellyville Station' }),
    ).toBeChecked();
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));
    expect(appStorage.parkedCar.get()).toMatchObject({ carParkName: 'Kellyville (north)' });
  });

  it('says when the location cannot be used and keeps the other choices', async () => {
    denyLocation(false);
    await renderApp('/parked-car/confirm');

    await userEvent.setup().press(screen.getByRole('radio', { name: /^Where I am now/ }));

    expect(
      await screen.findByLabelText(
        'Warning. Location access is off for HopReady. You can turn it on in Settings. Choose a car park or saved spot instead.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save where I parked' })).toBeDisabled();
  });

  it('saves a pinned spot when the location cannot be used', async () => {
    denyLocation(false);
    follow(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Where I am now/ }));
    expect(
      await screen.findByLabelText(
        'Warning. Location access is off for HopReady. You can turn it on in Settings. Choose Somewhere else to put a pin where you parked, or choose a car park or saved spot.',
      ),
    ).toBeOnTheScreen();
    // The pin starts at the trip's car park, and the arrows move it without dragging.
    await user.press(
      screen.getByRole('radio', { name: 'Somewhere else, Put a pin on a map where you parked.' }),
    );
    await user.press(screen.getByRole('button', { name: 'Move pin north' }));
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    const state = appStorage.parkedCar.get();
    if (state.status !== 'parked') throw new Error('Expected the car to be parked');
    // A pin is never taken for the suggested car park, however close to it.
    expect(state).toMatchObject({
      parkedCar: { location: { name: 'Pinned location', kind: 'parked-car' }, carParkId: null },
      carParkName: null,
    });
    const carPark = PLACES.tallawongCarPark.coordinate;
    expect(state.parkedCar.location.coordinate.lon).toBeCloseTo(carPark.lon, 9);
    expect((state.parkedCar.location.coordinate.lat - carPark.lat) * 111_320).toBeCloseTo(
      NUDGE_METRES,
      3,
    );
  });

  it("starts the pin where the followed trip's drive ends when it suggests no car park", async () => {
    follow(driveOnlyItinerary({ departAt: '2026-10-26T20:00:00.000Z' }));
    await renderApp('/parked-car/confirm');

    await userEvent.setup().press(screen.getByRole('radio', { name: /^Somewhere else/ }));

    expect(
      screen.getByRole('radio', {
        name: 'Somewhere else, Pin at 1 Help St, Chatswood. Move it to where you parked.',
      }),
    ).toBeChecked();
    const { lat, lon } = PLACES.chatswoodOffice.coordinate;
    expect(screen.getByTestId('map-marker')).toHaveProp('coordinate', {
      latitude: lat,
      longitude: lon,
    });
  });

  it('says where the pin is, and saves it only once it has been moved', async () => {
    follow(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Somewhere else/ }));
    expect(
      screen.getByRole('radio', {
        name: 'Somewhere else, Pin at Tallawong P1. Move it to where you parked.',
      }),
    ).toBeChecked();
    // Saved unmoved, the pin would only repeat the trip's guess under another name.
    expect(screen.getByRole('button', { name: 'Save where I parked' })).toBeDisabled();

    await user.press(screen.getByRole('button', { name: 'Move pin west' }));
    await user.press(screen.getByRole('button', { name: 'Move pin west' }));

    expect(announce).toHaveBeenLastCalledWith('Pin 20 metres west of Tallawong P1.');
    expect(screen.getByText('Pin 20 m west of Tallawong P1.')).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'Somewhere else, Pin 20 metres west of Tallawong P1.' }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save where I parked' })).toBeEnabled();
  });

  it('keeps a moved pin when Somewhere else is chosen again', async () => {
    follow(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Somewhere else/ }));
    await user.press(screen.getByRole('button', { name: 'Move pin east' }));
    await user.press(screen.getByRole('radio', { name: /^Somewhere else/ }));
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    const state = appStorage.parkedCar.get();
    if (state.status !== 'parked') throw new Error('Expected the car to be parked');
    expect(state.parkedCar.location.coordinate.lon).toBeGreaterThan(
      PLACES.tallawongCarPark.coordinate.lon,
    );
  });

  it('brings back a moved pin after other choices were tried', async () => {
    follow(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Somewhere else/ }));
    for (let presses = 0; presses < 5; presses += 1) {
      await user.press(screen.getByRole('button', { name: 'Move pin west' }));
    }
    await user.press(screen.getByRole('radio', { name: 'I was dropped off' }));
    await user.press(screen.getByRole('radio', { name: 'I parked my car' }));
    await user.press(screen.getByRole('radio', { name: /^Tallawong P1, Suggested by your trip/ }));
    await user.press(screen.getByRole('radio', { name: /^Somewhere else/ }));
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    const state = appStorage.parkedCar.get();
    if (state.status !== 'parked') throw new Error('Expected the car to be parked');
    const carPark = PLACES.tallawongCarPark.coordinate;
    const { lat, lon } = state.parkedCar.location.coordinate;
    expect(lat).toBeCloseTo(carPark.lat, 9);
    expect((carPark.lon - lon) * 111_320 * Math.cos((carPark.lat * Math.PI) / 180)).toBeCloseTo(
      5 * NUDGE_METRES,
      3,
    );
  });

  it("suggests the followed trip's car park when opened from the Car tab", async () => {
    appStorage.activeTrip.start({
      request: planRequest(),
      itinerary: parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }),
      plannedAt: WEEKDAY_MORNING.toISOString(),
      mode: 'demo',
    });
    await renderApp('/car');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Tell HopReady where you parked' }));

    const suggested = await screen.findByRole('radio', {
      name: 'Tallawong P1, Suggested by your trip, Choose it only if this is where you parked.',
    });
    expect(suggested).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save where I parked' })).toBeDisabled();
  });

  it('takes no hints from a trip followed on another day', async () => {
    // Friday's drive and park, still stored on Tuesday morning.
    follow(parkAndRideItinerary({ departAt: '2026-10-22T20:40:00.000Z' }));
    await renderApp('/car');

    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Tell HopReady where you parked' }));

    expect(await screen.findByTestId('confirm-parking')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: /Suggested by your trip/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^Somewhere else/ })).toBeNull();
  });

  it('offers saved parking spots', async () => {
    appStorage.parkingSpots.add('Kerb on Example Road', { lat: -33.7, lon: 150.94 });
    await renderApp('/parked-car/confirm');
    const user = userEvent.setup();

    await user.press(
      screen.getByRole('radio', {
        name: 'Kerb on Example Road, Saved by you. Rules and spaces unknown.',
      }),
    );
    await user.press(screen.getByRole('button', { name: 'Save where I parked' }));

    expect(appStorage.parkedCar.get()).toMatchObject({
      status: 'parked',
      parkedCar: { location: { name: 'Kerb on Example Road', kind: 'saved-parking' } },
      carParkName: 'Kerb on Example Road',
    });
  });
});

describe('correcting the parked car', () => {
  it('moves the pin without dragging and keeps the car park name for a small move', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/parked-car/correct');
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Save new location' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Move pin north' }));
    await user.press(screen.getByRole('button', { name: 'Save new location' }));

    const state = appStorage.parkedCar.get();
    if (state.status !== 'parked') throw new Error('Expected the car to stay parked');
    expect(state.parkedCar.location.name).toBe('Kellyville (north)');
    expect(state.parkedCar.location.coordinate.lon).toBeCloseTo(KELLYVILLE_NORTH.coordinate.lon, 9);
    expect(
      (state.parkedCar.location.coordinate.lat - KELLYVILLE_NORTH.coordinate.lat) * 111_320,
    ).toBeCloseTo(NUDGE_METRES, 3);
    // The car has been there since it was first confirmed.
    expect(state.parkedCar.confirmedAt).toBe('2026-10-26T20:45:00.000Z');
  });

  it('keeps a pin moved while the location was still being found', async () => {
    parkAtKellyvilleNorth();
    const location = holdLocationAt({ lat: -33.7962, lon: 151.1848 });
    await renderApp('/parked-car/correct');
    const user = userEvent.setup();

    await user.press(screen.getByRole('radio', { name: /^Where I am now/ }));
    await user.press(screen.getByRole('button', { name: 'Move pin north' }));
    await act(() => location.release());
    await user.press(screen.getByRole('button', { name: 'Save new location' }));

    const state = appStorage.parkedCar.get();
    if (state.status !== 'parked') throw new Error('Expected the car to stay parked');
    expect(state.parkedCar.location.coordinate.lon).toBeCloseTo(KELLYVILLE_NORTH.coordinate.lon, 9);
  });

  it('puts the pin where the map is tapped', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/parked-car/correct');

    await fireEvent(screen.getByTestId('map-view'), 'press', {
      nativeEvent: { coordinate: { latitude: -33.7301, longitude: 150.944 } },
    });
    await userEvent.setup().press(screen.getByRole('button', { name: 'Save new location' }));

    expect(appStorage.parkedCar.get()).toMatchObject({
      status: 'parked',
      parkedCar: {
        location: {
          name: 'Pinned location',
          coordinate: { lat: -33.7301, lon: 150.944 },
          kind: 'parked-car',
        },
        carParkId: null,
      },
    });
  });

  it("offers the followed trip's car park when the car is saved somewhere else", async () => {
    appStorage.parkingSpots.add('Kerb on Example Road', { lat: -33.7, lon: 150.94 });
    const [spot] = appStorage.parkingSpots.get();
    if (!spot) throw new Error('Expected the saved spot');
    appStorage.parkedCar.markParked(
      {
        location: { name: spot.name, coordinate: spot.coordinate, kind: 'saved-parking' },
        carParkId: null,
        confirmedAt: '2026-10-26T20:45:00.000Z',
      },
      spot.name,
    );
    appStorage.activeTrip.start({
      request: planRequest(),
      itinerary: parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }),
      plannedAt: WEEKDAY_MORNING.toISOString(),
      mode: 'demo',
    });
    await renderApp('/parked-car/correct');
    const user = userEvent.setup();

    await user.press(
      screen.getByRole('radio', {
        name: 'Tallawong P1, Suggested by your trip, Choose it only if this is where you parked.',
      }),
    );
    await user.press(screen.getByRole('button', { name: 'Save new location' }));

    expect(appStorage.parkedCar.get()).toMatchObject({
      status: 'parked',
      parkedCar: { carParkId: '26', confirmedAt: '2026-10-26T20:45:00.000Z' },
      carParkName: 'Tallawong P1',
    });
  });

  it('switches to another documented car park', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/parked-car/correct');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Choose another car park' }));
    await user.press(
      await screen.findByRole('radio', { name: 'Bella Vista, Bella Vista Station' }),
    );
    await user.press(screen.getByRole('button', { name: 'Save new location' }));

    expect(appStorage.parkedCar.get()).toMatchObject({
      status: 'parked',
      parkedCar: { carParkId: '31', location: { name: 'Bella Vista' } },
      carParkName: 'Bella Vista',
    });
  });

  it('removes the parked car after asking', async () => {
    parkAtKellyvilleNorth();
    await renderApp('/parked-car/correct');
    answerNextAlert('Remove');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Remove parked car' }));

    expect(appStorage.parkedCar.get()).toEqual({ status: 'none' });
    expect(await screen.findByRole('header', { name: 'No parked car saved' })).toBeOnTheScreen();
  });

  it('has nothing to correct when no car is parked', async () => {
    await renderApp('/parked-car/correct');
    expect(screen.getByRole('header', { name: 'No parked car' })).toBeOnTheScreen();
  });
});

describe('Take me home', () => {
  it('plans back through the confirmed car to Home', async () => {
    parkAtKellyvilleNorth();
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    grantLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/car');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Take me home' }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    const { request } = planSession.getState();
    expect(request).toMatchObject({
      origin: { name: 'Current location', kind: 'current-location' },
      destination: DEMO_PLACES.rouseHillHome,
      time: { type: 'depart' },
      trip: {
        kind: 'return-via-car',
        parkedCar: appStorage.parkedCar.get().status === 'parked' ? expect.any(Object) : null,
      },
    });
    const parked = appStorage.parkedCar.get();
    if (parked.status !== 'parked') throw new Error('Expected the car to be parked');
    expect(request?.trip).toEqual({ kind: 'return-via-car', parkedCar: parked.parkedCar });

    await waitFor(() => expect(planSession.getState().status).toBe('ready'));
    const itineraries = planSession.getState().response?.itineraries ?? [];
    expect(itineraries.length).toBeGreaterThan(0);
    expect(itineraries.every((itinerary) => itinerary.strategy === 'return-via-car')).toBe(true);
  });

  it('plans public transport only after a drop-off', async () => {
    appStorage.parkedCar.markDroppedOff('2026-10-26T20:40:00.000Z');
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    grantLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/car');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Take me home' }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request).toMatchObject({
      destination: DEMO_PLACES.rouseHillHome,
      access: { transit: true, drive: false, dropOff: false },
      trip: { kind: 'return-without-car' },
    });
    await waitFor(() => expect(planSession.getState().status).toBe('ready'));
    const itineraries = planSession.getState().response?.itineraries ?? [];
    expect(itineraries.length).toBeGreaterThan(0);
    expect(itineraries.every((itinerary) => itinerary.strategy === 'transit-home')).toBe(true);
  });

  it('asks where home is when Home is not set, and can save it', async () => {
    parkAtKellyvilleNorth();
    grantLocationAt(DEMO_PLACES.chatswoodOffice.coordinate);
    await renderApp('/car');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Take me home' }));
    expect(await screen.findByRole('header', { name: "Where's home?" })).toBeOnTheScreen();
    expect(screen.getByRole('togglebutton', { name: 'Also save as Home' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );

    await user.type(screen.getByLabelText('Search for a place'), 'Rouse Hill');
    await user.press(await screen.findByRole('button', { name: /^12 Example Street, Rouse Hill/ }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(appStorage.places.get().home).toEqual(DEMO_PLACES.rouseHillHome);
    expect(planSession.getState().request).toMatchObject({
      destination: DEMO_PLACES.rouseHillHome,
      trip: { kind: 'return-via-car' },
    });
  });

  it('asks where the person is when the location cannot be used', async () => {
    parkAtKellyvilleNorth();
    appStorage.places.setHome(DEMO_PLACES.rouseHillHome);
    denyLocation(true);
    await renderApp('/car');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Take me home' }));
    expect(await screen.findByRole('header', { name: 'Where are you now?' })).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Warning. HopReady can only use your location if you allow it. Where are you now?',
      ),
    ).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Search for a place'), 'Chatswood Station');
    await user.press(await screen.findByRole('button', { name: /^Chatswood Station/ }));

    expect(await screen.findByText('Results screen')).toBeOnTheScreen();
    expect(planSession.getState().request).toMatchObject({
      origin: { name: 'Chatswood Station', kind: 'stop' },
      destination: DEMO_PLACES.rouseHillHome,
      trip: { kind: 'return-via-car' },
    });
  });
});
