import { addMinutes, STANDARD_PARK_AND_RIDE_RULES, type TransitLeg } from '@hopready/core';

import { PLACES } from '@/test-support/trips';

import {
  describeDelay,
  describeOccupancy,
  describePlatform,
  describeRules,
  distance,
  duration,
  formatSydneyDay,
  PLATFORM_NOT_PROVIDED,
  serviceTitle,
  stopCount,
  UNKNOWN_RULES_TEXT,
} from './trip-text';

const NOW = new Date('2026-10-26T20:30:00.000Z');

function observedMinutesAgo(minutes: number): string {
  return addMinutes(NOW, -minutes);
}

function transitLeg(overrides: Partial<TransitLeg> = {}): TransitLeg {
  const start = '2026-10-26T20:53:00.000Z';
  return {
    id: 'metro',
    kind: 'transit',
    from: PLACES.tallawongStation,
    to: PLACES.chatswoodStation,
    start,
    end: addMinutes(start, 33),
    source: 'tfnsw-trip-planner',
    timing: 'realtime',
    mode: 'metro',
    service: { name: 'M1', description: null, headsign: 'Sydenham', operator: null },
    scheduledStart: start,
    scheduledEnd: addMinutes(start, 33),
    departurePlatform: '1',
    arrivalPlatform: null,
    stopCount: 10,
    cancelled: false,
    alerts: [],
    realtimeTripId: null,
    ...overrides,
  };
}

describe('describeOccupancy', () => {
  it('gives a recent count as approximate, with its age', () => {
    const wording = describeOccupancy(
      {
        status: 'known',
        spacesAvailable: 120,
        totalSpaces: 400,
        observedAt: observedMinutesAgo(3),
      },
      NOW.getTime(),
    );
    expect(wording).toEqual({
      freshness: 'current',
      summary: '~120 spaces free · updated 3 min ago',
      detail: null,
      spoken: 'About 120 spaces free, updated 3 minutes ago.',
    });
  });

  it('says a full car park is full rather than "~0 spaces"', () => {
    const wording = describeOccupancy(
      { status: 'known', spacesAvailable: 0, totalSpaces: 400, observedAt: observedMinutesAgo(0) },
      NOW.getTime(),
    );
    expect(wording.summary).toBe('Full · updated just now');
  });

  it('flags a stale count as possibly out of date, with its age in hours', () => {
    const wording = describeOccupancy(
      {
        status: 'stale',
        spacesAvailable: 40,
        totalSpaces: 400,
        observedAt: observedMinutesAgo(130),
      },
      NOW.getTime(),
    );
    expect(wording.freshness).toBe('stale');
    expect(wording.summary).toBe('~40 spaces free when last counted');
    expect(wording.detail).toBe('May be out of date (updated 2 h ago)');
  });

  it('treats a count that was fresh when planned, but has aged since, as stale', () => {
    const wording = describeOccupancy(
      {
        status: 'known',
        spacesAvailable: 75,
        totalSpaces: 400,
        observedAt: observedMinutesAgo(16),
      },
      NOW.getTime(),
    );
    expect(wording.freshness).toBe('stale');
    expect(wording.detail).toBe('May be out of date (updated 16 min ago)');
  });

  it('keeps an unknown count unknown, never zero, and says why', () => {
    const wording = describeOccupancy(
      { status: 'unknown', reason: 'Occupancy figures are unavailable right now.' },
      NOW.getTime(),
    );
    expect(wording).toEqual({
      freshness: 'unknown',
      summary: 'Occupancy unknown',
      detail: 'Occupancy figures are unavailable right now.',
      spoken: 'Occupancy unknown. Occupancy figures are unavailable right now.',
    });
  });

  it('reads a count from slightly in the future as just now', () => {
    const wording = describeOccupancy(
      { status: 'known', spacesAvailable: 5, totalSpaces: 400, observedAt: addMinutes(NOW, 2) },
      NOW.getTime(),
    );
    expect(wording.summary).toBe('~5 spaces free · updated just now');
  });
});

describe('describeRules', () => {
  it('shows documented rules with where they come from and when they were checked', () => {
    const rules = STANDARD_PARK_AND_RIDE_RULES;
    if (rules.status !== 'documented') throw new Error('The standard rules should be documented');
    expect(describeRules(rules)).toEqual({
      summary: rules.summary,
      source: {
        url: 'https://transportnsw.info/travel-info/ways-to-get-around/drive/parking/transport-parkride-car-parks',
        label: 'Source: transportnsw.info, checked 25 Oct 2026',
      },
      spoken: expect.stringMatching(/^Parking rules: Free for up to 18 hours/),
    });
  });

  it('tells people to check the signs when the rules are unknown', () => {
    expect(describeRules({ status: 'unknown' })).toEqual({
      summary: UNKNOWN_RULES_TEXT,
      source: null,
      spoken: 'Check signs for parking rules.',
    });
    expect(UNKNOWN_RULES_TEXT).toBe('Check signs for parking rules');
  });
});

describe('public transport wording', () => {
  it('shows a platform only when one is provided', () => {
    expect(describePlatform('1')).toBe('Platform 1');
    expect(describePlatform('Platform 2')).toBe('Platform 2');
    expect(describePlatform('Stand A')).toBe('Stand A');
    expect(describePlatform(null)).toBe(PLATFORM_NOT_PROVIDED);
    expect(describePlatform('  ')).toBe('Platform not provided');
  });

  it('names the service with its headsign when there is one', () => {
    expect(serviceTitle(transitLeg())).toBe('M1 towards Sydenham');
    expect(
      serviceTitle(
        transitLeg({ service: { name: '280', description: null, headsign: null, operator: null } }),
      ),
    ).toBe('280');
  });

  it('counts stops only when the provider states them', () => {
    expect(stopCount(10)).toBe('10 stops');
    expect(stopCount(1)).toBe('1 stop');
    expect(stopCount(null)).toBeNull();
  });

  it('reports a delay against the timetable for live legs only', () => {
    const scheduledStart = '2026-10-26T20:53:00.000Z';
    expect(describeDelay(transitLeg({ start: addMinutes(scheduledStart, 3) }))?.text).toBe(
      '3 min late',
    );
    expect(describeDelay(transitLeg({ start: addMinutes(scheduledStart, -1) }))?.spoken).toBe(
      '1 minute early',
    );
    expect(describeDelay(transitLeg())?.text).toBe('On time');
    expect(
      describeDelay(transitLeg({ timing: 'scheduled', start: addMinutes(scheduledStart, 3) })),
    ).toBeNull();
  });
});

describe('units', () => {
  it('words durations for the screen and for VoiceOver', () => {
    expect(duration(14 * 60)).toEqual({ text: '14 min', spoken: '14 minutes' });
    expect(duration(65 * 60)).toEqual({ text: '1 h 5 min', spoken: '1 hour 5 minutes' });
    expect(duration(20)).toEqual({ text: 'under 1 min', spoken: 'less than a minute' });
  });

  it('uses metres under a kilometre and kilometres above', () => {
    expect(distance(488)).toEqual({ text: '490 m', spoken: '490 metres' });
    expect(distance(996)).toEqual({ text: '1.0 km', spoken: '1.0 kilometres' });
    expect(distance(2_784)).toEqual({ text: '2.8 km', spoken: '2.8 kilometres' });
    expect(distance(12_400)).toEqual({ text: '12 km', spoken: '12 kilometres' });
  });

  it('formats a Sydney day the same way in every engine', () => {
    expect(formatSydneyDay('2026-10-24T20:58:00.000Z')).toBe('Sun 25 Oct');
  });
});
