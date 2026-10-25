import { addMinutes, STANDARD_PARK_AND_RIDE_RULES, type TransitLeg } from '@hopready/core';

import { PLACES } from '@/test-support/trips';

import {
  describeDelay,
  describePlatform,
  describeRules,
  distance,
  duration,
  formatSydneyDay,
  PLATFORM_NOT_PROVIDED,
  serviceTitle,
  statedPlatform,
  stopCount,
  UNKNOWN_RULES_TEXT,
} from './trip-text';

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

  it('gives a stated platform, and nothing when none is stated', () => {
    expect(statedPlatform('3')).toBe('Platform 3');
    expect(statedPlatform('Stand C')).toBe('Stand C');
    expect(statedPlatform(null)).toBeNull();
    expect(statedPlatform('  ')).toBeNull();
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
