import { describe, expect, it } from 'vitest';

import { HUBS } from './data/park-and-ride-hub-times';
import {
  estimateTransit,
  estimateTransitMinutes,
  hubPeriodFor,
  roughRideMinutes,
  walkCost,
} from './estimate';

const CENTRAL = HUBS.find((hub) => hub.id === 'central')!.coordinate;
const SEVEN_HILLS = { coordinate: { lat: -33.774430434, lon: 150.936513359 }, stopId: '214710' };
const HILLS_SHOWGROUND = { coordinate: { lat: -33.72782, lon: 150.987345 }, stopId: '2154392' };

describe('hubPeriodFor', () => {
  it.each([
    ['Monday 8 am', '2026-11-01T21:00:00Z', 'weekday-peak'],
    ['Monday 9.59 am', '2026-11-01T22:59:00Z', 'weekday-peak'],
    ['Monday 10 am', '2026-11-01T23:00:00Z', 'weekday-evening'],
    ['Monday 5 pm', '2026-11-02T06:00:00Z', 'weekday-peak'],
    ['Monday 9 pm', '2026-11-02T10:00:00Z', 'weekday-evening'],
    ['Saturday 10 am', '2026-11-06T23:00:00Z', 'weekend'],
    ['Sunday 8 am', '2026-11-07T21:00:00Z', 'weekend'],
    ['Wednesday 8 am in winter (AEST)', '2026-07-07T22:00:00Z', 'weekday-peak'],
  ])('reads %s as %s', (_, instant, period) => {
    expect(hubPeriodFor(instant)).toBe(period);
  });
});

describe('estimateTransitMinutes', () => {
  it('uses the recorded ride and half the headway for a station in the table', () => {
    // Seven Hills to Central at peak: 33 minutes on board, every 8 minutes, no walk at Central.
    const minutes = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-peak', 'normal');

    expect(minutes).toBeCloseTo(33 + 4, 0);
  });

  it('ranks a slower line with a longer drive-side ride behind a quicker one', () => {
    const sevenHills = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-peak', 'normal');
    const hillsShowground = estimateTransitMinutes(
      HILLS_SHOWGROUND,
      CENTRAL,
      'weekday-peak',
      'normal',
    );

    // Hills Showground: 39 minutes every 4; Seven Hills: 33 every 8.
    expect(sevenHills).toBeLessThan(hillsShowground);
    expect(hillsShowground).toBeCloseTo(41, 0);
  });

  it('adds the walk from the hub for a destination near it', () => {
    // About 500 m north of Central Station.
    const nearCentral = { lat: CENTRAL.lat + 0.0045, lon: CENTRAL.lon };
    const atCentral = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-peak', 'normal');
    const walkAway = estimateTransitMinutes(SEVEN_HILLS, nearCentral, 'weekday-peak', 'normal');

    expect(walkAway - atCentral).toBeGreaterThanOrEqual(7);
    expect(walkAway - atCentral).toBeLessThanOrEqual(10);
  });

  it('adds a change and another ride for a destination well past every hub', () => {
    // Bondi Beach: about 7 km east of the city hubs.
    const bondi = { lat: -33.8915, lon: 151.2767 };
    const minutes = estimateTransitMinutes(SEVEN_HILLS, bondi, 'weekday-peak', 'normal');
    const toCentral = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-peak', 'normal');

    expect(minutes).toBeGreaterThan(toCentral + 15);
    expect(minutes).toBeLessThan(roughRideMinutes(SEVEN_HILLS.coordinate, bondi));
  });

  it('never beats the straight-line ride for a destination back near the station', () => {
    // Blacktown is a few kilometres from Seven Hills; no city hub helps.
    const blacktown = { lat: -33.7686, lon: 150.9065 };
    const minutes = estimateTransitMinutes(SEVEN_HILLS, blacktown, 'weekday-peak', 'normal');

    expect(minutes).toBe(roughRideMinutes(SEVEN_HILLS.coordinate, blacktown));
  });

  it('falls back to the straight-line ride for a place with no row in the table', () => {
    const savedSpot = { coordinate: { lat: -33.7101, lon: 150.9562 } };

    expect(estimateTransitMinutes(savedSpot, CENTRAL, 'weekday-peak', 'normal')).toBe(
      roughRideMinutes(savedSpot.coordinate, CENTRAL),
    );
  });

  it('reads the period asked for', () => {
    // Seven Hills to Central: 33 minutes every 8 at peak, 40 minutes every 8 in the evening.
    const peak = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-peak', 'normal');
    const evening = estimateTransitMinutes(SEVEN_HILLS, CENTRAL, 'weekday-evening', 'normal');

    expect(evening - peak).toBeCloseTo(7, 0);
  });
});

describe('estimateTransit', () => {
  it('weights the wait at 1.4 and the walk at 1.5 in the cost, not in the minutes', () => {
    // About 500 m north of Central Station: 33 on board, 4 waiting, then a walk.
    const nearCentral = { lat: CENTRAL.lat + 0.0045, lon: CENTRAL.lon };
    const estimate = estimateTransit(SEVEN_HILLS, nearCentral, 'weekday-peak', 'normal');
    const walkMinutes = estimate.minutes - 33 - 4;

    expect(walkMinutes).toBeGreaterThan(6);
    expect(estimate.cost).toBeCloseTo(33 + 4 * 1.4 + walkMinutes * 1.5, 5);
    expect(walkCost(10)).toBe(15);
  });

  it('costs a straight-line ride at its plain minutes, so a hub route must beat it outright', () => {
    const savedSpot = { coordinate: { lat: -33.7101, lon: 150.9562 } };
    const estimate = estimateTransit(savedSpot, CENTRAL, 'weekday-peak', 'normal');

    expect(estimate.cost).toBe(estimate.minutes);
  });

  it('chooses the hub by cost and reports that route in plain minutes', () => {
    // Hills Showground to Central: the recorded ride and 2 minutes of waiting, a frequent service.
    const estimate = estimateTransit(HILLS_SHOWGROUND, CENTRAL, 'weekday-peak', 'normal');

    expect(estimate.minutes).toBeCloseTo(41, 0);
    expect(estimate.cost).toBeCloseTo(39 + 2 * 1.4, 0);
  });
});
