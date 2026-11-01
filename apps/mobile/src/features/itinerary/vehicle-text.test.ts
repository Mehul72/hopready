import { addMinutes, type VehicleLookup } from '@hopready/core';

import { metroThenBusItinerary, transitItinerary } from '@/test-support/trips';
import { trackedLegsOf, type VehiclePositions } from '@/trip/vehicle-positions';

import {
  hasLiveMap,
  liveMapLinkLabel,
  positionAge,
  VEHICLE_POSITION_FRESH_MS,
  vehicleMarkerLabel,
  vehicleRows,
} from './vehicle-text';

const DEPART = '2026-10-26T21:00:00.000Z';
// The bus leg of transitItinerary boards 10 minutes after leaving.
const BOARD_MS = Date.parse(addMinutes(DEPART, 10));
const CHECKED_AT = new Date(BOARD_MS + 60_000).toISOString();

const trip = transitItinerary({
  departAt: DEPART,
  mode: 'bus',
  service: '380',
  tripId: '2703224',
});

function positionsWith(
  lookups: VehicleLookup[],
  overrides: Partial<VehiclePositions> = {},
): VehiclePositions {
  return {
    lookups: new Map(lookups.map((lookup) => [`${lookup.mode}|${lookup.realtimeTripId}`, lookup])),
    checkedAt: CHECKED_AT,
    receivedAtMs: Date.parse(CHECKED_AT),
    mode: 'live',
    checking: false,
    failed: false,
    ...overrides,
  };
}

function locatedBus(ageMs: number, servingTrip: 'this-trip' | 'previous-trip' = 'this-trip') {
  return {
    mode: 'bus',
    realtimeTripId: '2703224',
    status: 'located',
    position: { lat: -33.892, lon: 151.25 },
    bearingDegrees: 78,
    observedAt: new Date(Date.parse(CHECKED_AT) - ageMs).toISOString(),
    servingTrip,
  } as const;
}

function onlyRow(positions: VehiclePositions, nowMs = Date.parse(CHECKED_AT)) {
  const [row] = vehicleRows(trackedLegsOf(trip, nowMs), positions, nowMs);
  if (!row) throw new Error('Expected a row');
  return row;
}

describe('positionAge', () => {
  it.each([
    [2_000, 'just now', 'just now'],
    [20_000, '20 s ago', '20 seconds ago'],
    [61_000, '1 min ago', '1 minute ago'],
    [180_000, '3 min ago', '3 minutes ago'],
  ])('reads %i ms as %s', (ageMs, text, spoken) => {
    expect(positionAge(ageMs)).toEqual({ text, spoken });
  });
});

describe('vehicleRows', () => {
  it('names the service by mode, number and where it is heading', () => {
    expect(onlyRow(positionsWith([])).title).toBe('Bus 380');
    const towards = metroThenBusItinerary({ departAt: DEPART, tripIds: ['m', 'b'] });
    expect(
      vehicleRows(trackedLegsOf(towards, BOARD_MS), positionsWith([]), BOARD_MS).map(
        (row) => row.title,
      ),
    ).toEqual(['Metro M1', 'Bus 545']);
  });

  it('places a vehicle reported recently and says how old the position is', () => {
    const row = onlyRow(positionsWith([locatedBus(20_000)]));
    expect(row.status).toEqual({ text: 'Updated 20 s ago', spoken: 'Updated 20 seconds ago' });
    expect(row.place).toEqual({
      coordinate: { lat: -33.892, lon: 151.25 },
      bearingDegrees: 78,
      mode: 'bus',
      onPreviousTrip: false,
    });
    expect(vehicleMarkerLabel(row)).toBe('Bus 380. Updated 20 seconds ago');
  });

  it('says a vehicle is still finishing its previous trip', () => {
    const row = onlyRow(positionsWith([locatedBus(10_000, 'previous-trip')]));
    expect(row.status.text).toBe('Finishing its previous trip · Updated 10 s ago');
    expect(row.place?.onPreviousTrip).toBe(true);
  });

  it('labels a demo position as a sample', () => {
    const row = onlyRow(positionsWith([locatedBus(0)], { mode: 'demo' }));
    expect(row.status.text).toBe('Sample position · Updated just now');
  });

  it('puts no marker for a position more than 5 minutes old, and says so', () => {
    const row = onlyRow(positionsWith([locatedBus(VEHICLE_POSITION_FRESH_MS + 60_000)]));
    expect(row.place).toBeNull();
    expect(row.status.text).toBe('Last seen 6 min ago · it may have moved since');
  });

  it('ages a position by the time since its answer arrived, so a failing map drops it', () => {
    const answered = positionsWith([locatedBus(20_000)], { failed: true });
    const sixMinutesLater = Date.parse(CHECKED_AT) + 6 * 60_000;
    const row = onlyRow(answered, sixMinutesLater);
    expect(row.place).toBeNull();
    expect(row.status.text).toMatch(/^Last seen 6 min ago/);
  });

  it('measures age on the phone’s own clock after the answer, whatever the server’s clock says', () => {
    // The phone received the answer at its own 09:00:00, while the server said 08:58:00.
    const receivedAtMs = Date.parse(CHECKED_AT) + 2 * 60_000;
    const positions = positionsWith([locatedBus(20_000)], { receivedAtMs });
    const row = onlyRow(positions, receivedAtMs + 30_000);
    expect(row.status.text).toBe('Updated 50 s ago');
  });

  it('keeps the last position when the latest check failed, and says it was not updated', () => {
    const row = onlyRow(positionsWith([locatedBus(20_000)], { failed: true }));
    expect(row.place).not.toBeNull();
    expect(row.status.text).toBe('Updated 20 s ago · not updated just now');
  });

  it('tells a service not yet on its way from one that is not reporting', () => {
    const notLocated = { mode: 'bus', realtimeTripId: '2703224', status: 'not-located' } as const;
    expect(onlyRow(positionsWith([notLocated]), BOARD_MS - 60_000).status.text).toBe(
      'Not on its way yet',
    );
    expect(onlyRow(positionsWith([notLocated]), BOARD_MS + 60_000).status.text).toBe(
      'Not reporting where it is',
    );
  });

  it('says a service may have finished once its planned end has passed', () => {
    const notLocated = { mode: 'bus', realtimeTripId: '2703224', status: 'not-located' } as const;
    // transitItinerary's bus rides 40 minutes from boarding.
    const afterEnd = BOARD_MS + 45 * 60_000;
    expect(onlyRow(positionsWith([notLocated]), afterEnd).status.text).toBe(
      'It may have finished its trip',
    );
  });

  it('says a ferry has no live positions without asking anyone', () => {
    const ferry = transitItinerary({ departAt: DEPART, mode: 'ferry', service: 'F1', tripId: 'f' });
    const [row] = vehicleRows(trackedLegsOf(ferry, BOARD_MS), positionsWith([]), BOARD_MS);
    expect(row?.status.text).toBe('Live positions are not available for this service');
    expect(row?.place).toBeNull();
  });

  it('explains a mode with no feed and a feed that could not be read', () => {
    const base = { mode: 'bus', realtimeTripId: '2703224' } as const;
    expect(onlyRow(positionsWith([{ ...base, status: 'not-tracked' }])).status.text).toBe(
      'Live positions are not available for this service',
    );
    expect(onlyRow(positionsWith([{ ...base, status: 'unavailable' }])).status.text).toBe(
      'Could not get its position just now',
    );
  });

  it('says it is checking before the first answer, and when that first check failed', () => {
    expect(onlyRow(positionsWith([], { checking: true })).status.text).toBe('Checking where it is');
    expect(onlyRow(positionsWith([], { failed: true })).status.text).toBe(
      'Could not check just now. Trying again',
    );
  });

  it('waits until about an hour before a service leaves', () => {
    const early = BOARD_MS - 2 * 60 * 60_000;
    const [row] = vehicleRows(trackedLegsOf(trip, early), positionsWith([locatedBus(0)]), early);
    expect(row?.status.text).toBe('Shows about an hour before it leaves');
    expect(row?.place).toBeNull();
  });
});

describe('the way to the live map', () => {
  it('names the one mode a trip rides, or says services for several', () => {
    expect(liveMapLinkLabel(trackedLegsOf(trip, BOARD_MS))).toBe('See where your bus is');
    const both = metroThenBusItinerary({ departAt: DEPART, tripIds: ['m', 'b'] });
    expect(liveMapLinkLabel(trackedLegsOf(both, BOARD_MS))).toBe('See where your services are');
  });

  it('is offered only when a service runs on a mode with a live feed', () => {
    expect(hasLiveMap(trackedLegsOf(trip, BOARD_MS))).toBe(true);
    const ferry = transitItinerary({ departAt: DEPART, mode: 'ferry', service: 'F1', tripId: 'f' });
    expect(hasLiveMap(trackedLegsOf(ferry, BOARD_MS))).toBe(false);
    expect(hasLiveMap(trackedLegsOf(transitItinerary({ departAt: DEPART }), BOARD_MS))).toBe(false);
  });
});
