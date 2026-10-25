import type { Itinerary } from '@hopready/core';

import { parkAndRideItinerary, PLACES, transitItinerary } from '@/test-support/trips';

import { buildMapModel, describeItineraryRoute } from './trip-map-model';

const DEPART_AT = '2026-10-26T21:00:00.000Z';

describe('buildMapModel for one itinerary', () => {
  const itinerary = parkAndRideItinerary({ departAt: DEPART_AT });
  const model = buildMapModel({ itinerary });

  it('draws one line per moving leg in its mode, and none for parking', () => {
    expect(model.lines.map((line) => line.mode)).toEqual(['drive', 'walk', 'metro', 'walk']);
    expect(model.lines.every((line) => line.emphasis === 'selected')).toBe(true);
  });

  it('dashes walking, follows the provider path, and dots a leg without one', () => {
    const [drive, walkToPlatform, metro] = model.lines;
    expect(drive?.pattern).toBe('solid');
    expect(drive?.coordinates).toHaveLength(3);
    expect(walkToPlatform?.pattern).toBe('dashed');
    expect(metro?.pattern).toBe('dotted');
    expect(metro?.coordinates).toEqual([
      PLACES.tallawongStation.coordinate,
      PLACES.chatswoodStation.coordinate,
    ]);
  });

  it('marks the start, the car park and the destination with spoken labels', () => {
    expect(model.markers.map((marker) => [marker.kind, marker.accessibilityLabel])).toEqual([
      ['origin', 'Start: 12 Example St, Rouse Hill'],
      ['car-park', 'Car park: Tallawong P1'],
      ['destination', 'Destination: 1 Help St, Chatswood'],
    ]);
  });

  it('frames every line and marker', () => {
    expect(model.coordinates).toEqual(
      expect.arrayContaining([
        PLACES.rouseHillHome.coordinate,
        PLACES.tallawongCarPark.coordinate,
        PLACES.chatswoodOffice.coordinate,
      ]),
    );
  });

  it('summarises the route in words for VoiceOver', () => {
    expect(model.summary).toBe(
      'Map of the trip from 12 Example St, Rouse Hill to 1 Help St, Chatswood: drive to Tallawong P1, then walk to Tallawong Station, then Metro M1 to Chatswood Station, then walk to 1 Help St, Chatswood.',
    );
  });
});

describe('buildMapModel for transfers', () => {
  it('marks each change between services', () => {
    const base = transitItinerary({ departAt: DEPART_AT });
    const [walk, metro, lastWalk] = base.legs;
    if (!walk || !metro || !lastWalk || metro.kind !== 'transit')
      throw new Error('unexpected legs');
    const bus = {
      ...metro,
      id: 'transit-bus',
      mode: 'bus' as const,
      service: { ...metro.service, name: '280' },
      from: PLACES.chatswoodStation,
      to: PLACES.chatswoodOffice,
    };
    const withChange: Itinerary = { ...base, legs: [walk, metro, bus] };
    const transfers = buildMapModel({ itinerary: withChange }).markers.filter(
      (marker) => marker.kind === 'transfer',
    );
    expect(transfers).toEqual([
      expect.objectContaining({ accessibilityLabel: 'Change: Chatswood Station' }),
    ]);
  });
});

describe('buildMapModel for several options', () => {
  const transit = transitItinerary({ departAt: DEPART_AT });
  const parkAndRide = parkAndRideItinerary({ departAt: DEPART_AT });

  it('draws the selected option last, on top of the muted others', () => {
    const model = buildMapModel({
      itineraries: [transit, parkAndRide],
      selectedItineraryId: transit.id,
    });
    const emphases = model.lines.map((line) => line.emphasis);
    expect(emphases.slice(-3)).toEqual(['selected', 'selected', 'selected']);
    expect(emphases.slice(0, -3).every((emphasis) => emphasis === 'muted')).toBe(true);
    expect(model.summary).toMatch(/^Map of 2 trip options\. Highlighted: Map of the trip/);
  });

  it('keeps car parks from options that are not selected', () => {
    const model = buildMapModel({ itineraries: [transit, parkAndRide] });
    expect(model.markers.filter((marker) => marker.kind === 'car-park')).toHaveLength(1);
  });

  it('describes an empty list of options', () => {
    expect(buildMapModel({ itineraries: [] })).toEqual({
      lines: [],
      markers: [],
      coordinates: [],
      summary: 'Map with no trip options.',
    });
  });
});

describe('buildMapModel for points', () => {
  it('shows each place as a marker and lists them in the summary', () => {
    const model = buildMapModel({
      points: [
        {
          id: 'p1',
          kind: 'car-park',
          coordinate: PLACES.tallawongCarPark.coordinate,
          label: 'Tallawong P1',
        },
        {
          id: 'car',
          kind: 'parked-car',
          coordinate: PLACES.rouseHillHome.coordinate,
          label: 'Level 2',
        },
      ],
    });
    expect(model.lines).toEqual([]);
    expect(model.markers.map((marker) => marker.accessibilityLabel)).toEqual([
      'Car park: Tallawong P1',
      'Your car: Level 2',
    ]);
    expect(model.summary).toBe('Map showing 2 places: Tallawong P1, Level 2.');
  });
});

describe('describeItineraryRoute', () => {
  it('names the lift for a drop-off trip, never a drive', () => {
    const base = parkAndRideItinerary({ departAt: DEPART_AT });
    const [drive, , ...rest] = base.legs;
    if (!drive || drive.kind !== 'drive') throw new Error('unexpected legs');
    const dropOff: Itinerary = {
      ...base,
      strategy: 'drop-off',
      legs: [{ ...drive, kind: 'ride' }, ...rest],
    };
    expect(describeItineraryRoute(dropOff)).toMatch(/: get a lift to Tallawong P1, then/);
  });
});
