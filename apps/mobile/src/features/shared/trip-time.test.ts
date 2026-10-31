import { describeTripTime } from './trip-time';

// 10:30 pm on Monday 26 October 2026 in Sydney (AEDT).
const MONDAY_NIGHT = '2026-10-26T11:30:00.000Z';

describe('describeTripTime', () => {
  it('gives the time alone on the same Sydney day', () => {
    expect(describeTripTime('2026-10-26T12:20:00.000Z', MONDAY_NIGHT)).toEqual({
      text: '11:20 pm',
      spoken: '11:20 pm',
    });
  });

  it('adds the weekday once the time is on another Sydney day, even an hour later', () => {
    expect(describeTripTime('2026-10-26T13:40:00.000Z', MONDAY_NIGHT)).toEqual({
      text: 'Tue 12:40 am',
      spoken: 'Tuesday 12:40 am',
    });
  });

  it('compares Sydney days, not UTC days', () => {
    // Both on 26 October in UTC, but 12:30 am Tuesday against 10:30 pm Monday in Sydney.
    expect(describeTripTime('2026-10-26T13:30:00.000Z', MONDAY_NIGHT).text).toBe('Tue 12:30 am');
    // 26 and 27 October in UTC, but 1 am and 11 pm on the same Tuesday in Sydney.
    expect(describeTripTime('2026-10-27T12:00:00.000Z', '2026-10-26T14:00:00.000Z').text).toBe(
      '11:00 pm',
    );
  });

  it('accepts a date as the reference, and gives the time alone without one', () => {
    expect(describeTripTime('2026-10-26T19:40:00.000Z', new Date(MONDAY_NIGHT)).text).toBe(
      'Tue 6:40 am',
    );
    expect(describeTripTime('2026-10-26T19:40:00.000Z', null).text).toBe('6:40 am');
  });

  it('keeps the Sydney day across the start of daylight saving', () => {
    // 1:30 am AEST on Sunday 4 October 2026, then 4:30 am AEDT the same Sunday.
    expect(describeTripTime('2026-10-03T17:30:00.000Z', '2026-10-03T15:30:00.000Z').text).toBe(
      '4:30 am',
    );
  });
});
