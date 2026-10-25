import { describe, expect, it } from 'vitest';

import { buildItinerary, findContinuityIssues, stableId, withWaitLegs } from './itinerary';
import type { Place } from './model';
import { drive, PLACES, transit, walk } from './test-support/legs';

const { rouseHillHome, tallawongCarPark, tallawongStation, chatswoodStation, chatswoodOffice } =
  PLACES;

describe('findContinuityIssues', () => {
  it('accepts legs that meet in time and place', () => {
    const legs = [
      walk(tallawongCarPark, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:04:00Z'),
      transit(tallawongStation, chatswoodStation, '2026-10-26T21:06:00Z', '2026-10-26T21:43:00Z'),
    ];
    expect(findContinuityIssues(legs)).toEqual([]);
  });

  it('flags a leg that starts before the previous one ends', () => {
    const legs = [
      walk(tallawongCarPark, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:07:00Z'),
      transit(tallawongStation, chatswoodStation, '2026-10-26T21:06:00Z', '2026-10-26T21:43:00Z'),
    ];
    expect(findContinuityIssues(legs)).toEqual([
      { legIndex: 1, problem: 'overlaps-previous', detail: '60 s overlap' },
    ]);
  });

  it('flags a jump in location between legs', () => {
    const legs = [
      walk(rouseHillHome, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:04:00Z'),
      transit(chatswoodStation, chatswoodOffice, '2026-10-26T21:06:00Z', '2026-10-26T21:43:00Z'),
    ];
    expect(findContinuityIssues(legs).map((issue) => issue.problem)).toEqual(['location-gap']);
  });

  it('flags a leg that ends before it starts', () => {
    const legs = [
      walk(rouseHillHome, tallawongStation, '2026-10-26T21:05:00Z', '2026-10-26T21:00:00Z'),
    ];
    expect(findContinuityIssues(legs)[0]?.problem).toBe('ends-before-start');
  });
});

describe('withWaitLegs', () => {
  it('inserts a wait where the traveller stands for a minute or more', () => {
    const legs = withWaitLegs([
      walk(tallawongCarPark, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:04:00Z'),
      transit(tallawongStation, chatswoodStation, '2026-10-26T21:10:00Z', '2026-10-26T21:43:00Z'),
    ]);
    expect(legs.map((leg) => leg.kind)).toEqual(['walk', 'wait', 'transit']);
    expect(legs[1]).toMatchObject({
      start: '2026-10-26T21:04:00Z',
      end: '2026-10-26T21:10:00Z',
      from: tallawongStation,
      to: tallawongStation,
    });
  });

  it('leaves back-to-back legs alone', () => {
    const legs = withWaitLegs([
      walk(tallawongCarPark, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:04:00Z'),
      transit(tallawongStation, chatswoodStation, '2026-10-26T21:04:30Z', '2026-10-26T21:43:00Z'),
    ]);
    expect(legs.map((leg) => leg.kind)).toEqual(['walk', 'transit']);
  });
});

describe('buildItinerary', () => {
  const legs = [
    drive(rouseHillHome, tallawongCarPark, '2026-10-26T20:50:00Z', '2026-10-26T20:58:00Z'),
    walk(tallawongCarPark, tallawongStation, '2026-10-26T21:00:00Z', '2026-10-26T21:04:00Z'),
    transit(tallawongStation, chatswoodStation, '2026-10-26T21:06:00Z', '2026-10-26T21:43:00Z', {
      realtime: true,
    }),
    transit(chatswoodStation, chatswoodStation, '2026-10-26T21:47:00Z', '2026-10-26T21:50:00Z', {
      mode: 'bus',
      name: '545',
    }),
    walk(chatswoodStation, chatswoodOffice, '2026-10-26T21:50:00Z', '2026-10-26T21:55:00Z'),
  ];

  it('totals drive, walk and wait time and counts transfers', () => {
    const itinerary = buildItinerary({ strategy: 'park-and-ride', legs });
    expect(itinerary.departAt).toBe('2026-10-26T20:50:00Z');
    expect(itinerary.arriveAt).toBe('2026-10-26T21:55:00Z');
    expect(itinerary.durationSeconds).toBe(65 * 60);
    expect(itinerary.driveSeconds).toBe(8 * 60);
    expect(itinerary.walkSeconds).toBe(9 * 60);
    expect(itinerary.waitSeconds).toBe((2 + 2 + 4) * 60);
    expect(itinerary.transfers).toBe(1);
  });

  it('marks realtime coverage as partial when only some services are live', () => {
    expect(buildItinerary({ strategy: 'park-and-ride', legs }).realtime).toBe('partial');
  });

  it('keeps unknown fares and accessibility as unknown', () => {
    const itinerary = buildItinerary({ strategy: 'park-and-ride', legs });
    expect(itinerary.fare).toEqual({ status: 'unknown' });
    expect(itinerary.accessibility).toBe('unknown');
  });

  it('gives the same id to the same trip and a different id to a different service', () => {
    const again = buildItinerary({ strategy: 'park-and-ride', legs });
    const other = buildItinerary({ strategy: 'park-and-ride', legs: legs.slice(0, 3) });
    expect(buildItinerary({ strategy: 'park-and-ride', legs }).id).toBe(again.id);
    expect(other.id).not.toBe(again.id);
  });

  it('refuses an empty leg list', () => {
    expect(() => buildItinerary({ strategy: 'transit-only', legs: [] })).toThrow();
  });
});

describe('itinerary ids', () => {
  function driveOnlyFrom(origin: Place) {
    return buildItinerary({
      strategy: 'drive-only',
      legs: [drive(origin, chatswoodOffice, '2026-10-26T20:35:00Z', '2026-10-26T21:20:00Z')],
    });
  }

  it('tells drives to the same place from different starts apart', () => {
    expect(driveOnlyFrom(rouseHillHome).id).not.toBe(driveOnlyFrom(tallawongCarPark).id);
    expect(driveOnlyFrom(rouseHillHome).id).toBe(driveOnlyFrom(rouseHillHome).id);
  });
});

describe('stableId', () => {
  it('is deterministic and eight hex characters', () => {
    expect(stableId(['a', 'b'])).toBe(stableId(['a', 'b']));
    expect(stableId(['a', 'b'])).toMatch(/^[0-9a-f]{8}$/);
    expect(stableId(['a', 'b'])).not.toBe(stableId(['b', 'a']));
  });
});
