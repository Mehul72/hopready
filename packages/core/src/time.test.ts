import { describe, expect, it } from 'vitest';

import {
  formatSydneyDayAndTime,
  formatSydneyTimeOnDay,
  addMinutes,
  formatDurationMinutes,
  formatSydneyTime,
  fromSydneyWallClock,
  secondsBetween,
  sydneyDateKey,
  sydneyOffsetMinutes,
  sydneyWallClock,
  toInstant,
  toTfnswDateTime,
} from './time';

describe('sydneyOffsetMinutes', () => {
  it('is +10:00 in winter (AEST)', () => {
    expect(sydneyOffsetMinutes('2026-07-01T00:00:00Z')).toBe(600);
  });

  it('is +11:00 in summer (AEDT)', () => {
    expect(sydneyOffsetMinutes('2026-12-01T00:00:00Z')).toBe(660);
  });

  it('switches at 02:00 AEST on the first Sunday of October 2026', () => {
    // 2026-10-04 01:59:59 AEST is 15:59:59 UTC on the 3rd; one second later clocks jump to 03:00 AEDT.
    expect(sydneyOffsetMinutes('2026-10-03T15:59:59Z')).toBe(600);
    expect(sydneyOffsetMinutes('2026-10-03T16:00:00Z')).toBe(660);
  });

  it('switches back at 03:00 AEDT on the first Sunday of April 2027', () => {
    expect(sydneyOffsetMinutes('2027-04-03T15:59:59Z')).toBe(660);
    expect(sydneyOffsetMinutes('2027-04-03T16:00:00Z')).toBe(600);
  });
});

describe('toTfnswDateTime', () => {
  it('uses the Sydney calendar date after UTC midnight has not yet passed', () => {
    // 13:30 UTC on the 25th is 00:30 on the 26th in Sydney (AEDT).
    expect(toTfnswDateTime('2026-10-25T13:30:00Z')).toEqual({
      itdDate: '20261026',
      itdTime: '0030',
    });
  });

  it('handles the minute before Sydney midnight', () => {
    expect(toTfnswDateTime('2026-10-25T12:59:00Z')).toEqual({
      itdDate: '20261025',
      itdTime: '2359',
    });
  });

  it('reports winter times with the AEST offset', () => {
    expect(toTfnswDateTime('2026-06-30T22:15:00Z')).toEqual({
      itdDate: '20260701',
      itdTime: '0815',
    });
  });
});

describe('fromSydneyWallClock', () => {
  it('round-trips an ordinary summer time', () => {
    const instant = fromSydneyWallClock({ year: 2026, month: 12, day: 24, hour: 8, minute: 30 });
    expect(instant.toISOString()).toBe('2026-12-23T21:30:00.000Z');
    expect(sydneyWallClock(instant)).toMatchObject({ day: 24, hour: 8, minute: 30 });
  });

  it('moves a time inside the October daylight-saving gap forward by an hour', () => {
    // 02:30 does not exist on 2026-10-04; it becomes 03:30 AEDT.
    const instant = fromSydneyWallClock({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 });
    expect(instant.toISOString()).toBe('2026-10-03T16:30:00.000Z');
    expect(sydneyWallClock(instant)).toMatchObject({ hour: 3, minute: 30 });
  });

  it('picks the first or second 02:30 when April clocks go back', () => {
    const wall = { year: 2027, month: 4, day: 4, hour: 2, minute: 30 };
    expect(fromSydneyWallClock(wall, 'earlier').toISOString()).toBe('2027-04-03T15:30:00.000Z');
    expect(fromSydneyWallClock(wall, 'later').toISOString()).toBe('2027-04-03T16:30:00.000Z');
  });
});

describe('durations across daylight saving', () => {
  it('counts real elapsed time, not wall-clock difference, on the October change night', () => {
    const start = fromSydneyWallClock({ year: 2026, month: 10, day: 4, hour: 1, minute: 30 });
    const end = fromSydneyWallClock({ year: 2026, month: 10, day: 4, hour: 3, minute: 30 });
    expect(secondsBetween(start, end)).toBe(3600);
  });

  it('counts the repeated hour on the April change night', () => {
    const start = fromSydneyWallClock({ year: 2027, month: 4, day: 4, hour: 1, minute: 30 });
    const end = fromSydneyWallClock({ year: 2027, month: 4, day: 4, hour: 3, minute: 30 });
    expect(secondsBetween(start, end)).toBe(3 * 3600);
  });

  it('adds minutes across Sydney midnight onto the next calendar day', () => {
    const lateEvening = '2026-10-25T12:50:00Z'; // 23:50 Sydney
    const afterMidnight = addMinutes(lateEvening, 25);
    expect(sydneyDateKey(lateEvening)).toBe('2026-10-25');
    expect(sydneyDateKey(afterMidnight)).toBe('2026-10-26');
    expect(toTfnswDateTime(afterMidnight).itdTime).toBe('0015');
  });
});

describe('formatting', () => {
  it('formats in Sydney time regardless of the machine time zone', () => {
    expect(formatSydneyTime('2026-10-25T21:05:00Z')).toBe('8:05\u00a0am');
  });

  it('formats durations in minutes and hours', () => {
    expect(formatDurationMinutes(0)).toBe('0 min');
    expect(formatDurationMinutes(59 * 60)).toBe('59 min');
    expect(formatDurationMinutes(60 * 60)).toBe('1 h');
    expect(formatDurationMinutes(95 * 60)).toBe('1 h 35 min');
  });
});

describe('times with their day', () => {
  // 10:30 pm on Monday 26 October 2026 in Sydney.
  const mondayNight = '2026-10-26T11:30:00.000Z';

  it('adds the weekday on another Sydney day and the date from six days away', () => {
    expect(formatSydneyTimeOnDay('2026-10-26T12:20:00.000Z', mondayNight)).toBe('11:20\u00a0pm');
    expect(formatSydneyTimeOnDay('2026-10-26T13:40:00.000Z', mondayNight)).toBe(
      'Tue 12:40\u00a0am',
    );
    expect(formatSydneyTimeOnDay('2026-10-30T22:00:00.000Z', mondayNight)).toBe('Sat 9:00\u00a0am');
    expect(formatSydneyTimeOnDay('2026-11-06T22:00:00.000Z', mondayNight)).toBe(
      'Sat 7 Nov 9:00\u00a0am',
    );
    expect(formatSydneyTimeOnDay('2026-11-06T22:00:00.000Z', mondayNight, 'long')).toBe(
      'Saturday 7 November 9:00\u00a0am',
    );
    expect(formatSydneyTimeOnDay('2026-10-26T13:40:00.000Z', null)).toBe('12:40\u00a0am');
  });

  it('words a time days away for messages', () => {
    expect(formatSydneyDayAndTime('2026-11-01T20:07:00.000Z')).toBe('Mon 2 Nov 7:07\u00a0am');
  });
});

describe('toInstant', () => {
  it('rejects values that are not date-times', () => {
    expect(() => toInstant('not a date')).toThrow(RangeError);
  });
});
