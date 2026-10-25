import { DEFAULT_PREFERENCES, type Place, type PlanRequest } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';

import type { SavedPlaces } from '@/storage';

import {
  buildQuickPicks,
  placeTitle,
  recentPlaces,
  recentTripShortcuts,
  savedLabelFor,
} from './place-labels';

const SAVED: SavedPlaces = {
  home: DEMO_PLACES.rouseHillHome,
  work: DEMO_PLACES.barangarooOffice,
  favourites: [{ id: 'f1', label: 'Gym', place: DEMO_PLACES.castleTowers }],
};

function trip(origin: Place, destination: Place, kind: PlanRequest['trip'] = { kind: 'outbound' }) {
  return {
    origin,
    destination,
    time: { type: 'depart', at: '2026-10-20T20:00:00.000Z' },
    access: { transit: true, drive: true, dropOff: false },
    preferences: DEFAULT_PREFERENCES,
    trip: kind,
  } satisfies PlanRequest;
}

describe('place names', () => {
  it('calls saved places by the name the person gave them', () => {
    expect(savedLabelFor({ ...DEMO_PLACES.rouseHillHome, name: 'Somewhere' }, SAVED)).toBe('Home');
    expect(savedLabelFor(DEMO_PLACES.castleTowers, SAVED)).toBe('Gym');
    expect(savedLabelFor(DEMO_PLACES.warringahMall, SAVED)).toBeNull();
    expect(placeTitle(DEMO_PLACES.barangarooOffice, SAVED)).toEqual({
      title: 'Work',
      detail: '200 Example Avenue, Barangaroo',
    });
  });

  it('shows the current location with its address when one was found', () => {
    expect(
      placeTitle(
        {
          name: '12 Example St, Rouse Hill',
          coordinate: { lat: -33.69, lon: 150.93 },
          kind: 'current-location',
        },
        SAVED,
      ),
    ).toEqual({ title: 'Current location', detail: '12 Example St, Rouse Hill' });
  });
});

describe('quick picks', () => {
  it('offers the current location, saved places, then recent places not saved under a name', () => {
    const recents = [
      trip(DEMO_PLACES.rouseHillHome, DEMO_PLACES.warringahMall),
      trip(DEMO_PLACES.macquarieUniversity, DEMO_PLACES.barangarooOffice),
    ];
    expect(
      buildQuickPicks(SAVED, recents, { includeCurrentLocation: true }).map((pick) => pick.label),
    ).toEqual([
      'Current location',
      'Home',
      'Work',
      'Gym',
      'Warringah Mall',
      'Macquarie University',
    ]);
  });

  it('skips repeats and places only the planner uses', () => {
    const parkedCar: Place = {
      name: 'Your car',
      coordinate: { lat: -33.71, lon: 150.93 },
      kind: 'parked-car',
    };
    const recents = [
      trip(parkedCar, DEMO_PLACES.warringahMall),
      trip(DEMO_PLACES.warringahMall, DEMO_PLACES.queenVictoriaBuilding),
    ];
    expect(recentPlaces(recents, SAVED, 5).map((place) => place.name)).toEqual([
      'Warringah Mall',
      'Queen Victoria Building',
    ]);
  });
});

describe('recent trips', () => {
  it('offers outbound trips only, labelled with saved names', () => {
    const parkedCar = {
      location: DEMO_PLACES.rouseHillTownCentre,
      carParkId: null,
      confirmedAt: '2026-10-26T08:00:00.000Z',
    };
    const shortcuts = recentTripShortcuts(
      [
        trip(DEMO_PLACES.barangarooOffice, DEMO_PLACES.rouseHillHome, {
          kind: 'return-via-car',
          parkedCar,
        }),
        trip(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice),
      ],
      SAVED,
      5,
    );
    expect(shortcuts.map(({ title, subtitle }) => ({ title, subtitle }))).toEqual([
      { title: 'To Work', subtitle: 'From Home' },
    ]);
  });
});
