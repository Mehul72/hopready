import {
  changeTimeType,
  defaultChosenAt,
  describeRequestTime,
  describeSydneyDay,
  isTimeInPast,
  phoneUsesSydneyTime,
  requestTimeFor,
} from './time-choice';

// Tuesday 27 October 2026, 7.32 am in Sydney (AEDT, UTC+11).
const NOW = new Date('2026-10-26T20:32:20.000Z');

describe('time choices', () => {
  it('suggests the next five minutes for a departure, and an hour later for an arrival', () => {
    expect(defaultChosenAt('depart', NOW)).toBe('2026-10-26T20:35:00.000Z');
    expect(defaultChosenAt('arrive', NOW)).toBe('2026-10-26T21:35:00.000Z');
  });

  it('does not jump ahead for seconds past a round time', () => {
    expect(defaultChosenAt('depart', new Date('2026-10-26T20:30:20.000Z'))).toBe(
      '2026-10-26T20:30:00.000Z',
    );
  });

  it('keeps the chosen time when switching between depart and arrive', () => {
    const departAt = { type: 'depart', at: '2026-10-26T23:00:00.000Z' } as const;
    expect(changeTimeType(departAt, 'arrive', NOW)).toEqual({
      type: 'arrive',
      at: '2026-10-26T23:00:00.000Z',
    });
    expect(changeTimeType(departAt, 'now', NOW)).toEqual({ type: 'now' });
    expect(changeTimeType({ type: 'now' }, 'depart', NOW)).toEqual({
      type: 'depart',
      at: '2026-10-26T20:35:00.000Z',
    });
  });

  it('turns "Leave now" into a departure at the moment of planning', () => {
    expect(requestTimeFor({ type: 'now' }, NOW)).toEqual({ type: 'depart', at: NOW.toISOString() });
  });

  it('knows when a chosen time has passed', () => {
    expect(isTimeInPast({ type: 'now' }, NOW)).toBe(false);
    expect(isTimeInPast({ type: 'depart', at: '2026-10-26T20:20:00.000Z' }, NOW)).toBe(true);
    expect(isTimeInPast({ type: 'arrive', at: '2026-10-26T20:40:00.000Z' }, NOW)).toBe(false);
  });
});

describe('describing times in Sydney', () => {
  it('names today, tomorrow and later days', () => {
    expect(describeSydneyDay('2026-10-27T02:00:00.000Z', NOW)).toBe('today');
    expect(describeSydneyDay('2026-10-27T20:00:00.000Z', NOW)).toBe('tomorrow');
    expect(describeSydneyDay('2026-10-29T20:00:00.000Z', NOW)).toBe('Fri 30 Oct');
  });

  it('finds tomorrow correctly across the short day when clocks go forward', () => {
    // Saturday 3 October 2026, 11.30 pm. Sunday has only 23 hours, so 24 hours on is Monday.
    const saturdayNight = new Date('2026-10-03T13:30:00.000Z');
    // Sunday 4 October, 9 am daylight time.
    expect(describeSydneyDay('2026-10-03T22:00:00.000Z', saturdayNight)).toBe('tomorrow');
    // Monday 5 October, 10 am.
    expect(describeSydneyDay('2026-10-04T23:00:00.000Z', saturdayNight)).toBe('Mon 5 Oct');
  });

  it('describes a request time in words', () => {
    expect(describeRequestTime({ type: 'depart', at: '2026-10-26T20:45:00.000Z' }, NOW)).toBe(
      'Leave after 7:45\u00a0am',
    );
    expect(describeRequestTime({ type: 'arrive', at: '2026-10-27T22:00:00.000Z' }, NOW)).toBe(
      'Arrive by 9:00\u00a0am tomorrow',
    );
    expect(describeRequestTime({ type: 'arrive', at: '2026-10-29T22:00:00.000Z' }, NOW)).toBe(
      'Arrive by 9:00\u00a0am, Fri 30 Oct',
    );
  });
});

describe('phoneUsesSydneyTime', () => {
  it('is true when the phone keeps Sydney time, so no extra note is needed', () => {
    // 7.32 am on 27 October is daylight time in Sydney: 11 hours ahead of UTC.
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-660);
    expect(phoneUsesSydneyTime(NOW)).toBe(true);
  });

  it('is false for a phone set to another zone, such as Perth', () => {
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480);
    expect(phoneUsesSydneyTime(NOW)).toBe(false);
  });
});
