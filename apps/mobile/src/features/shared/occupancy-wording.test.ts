import { addMinutes } from '@hopready/core';

import { describeAge, describeOccupancy } from './occupancy-wording';

const NOW = new Date('2026-10-26T20:30:00.000Z');

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe('describeOccupancy', () => {
  it('shows a fresh count as approximate, with its age', () => {
    expect(
      describeOccupancy(
        { status: 'known', spacesAvailable: 120, totalSpaces: 400, observedAt: minutesBefore(3) },
        NOW,
      ),
    ).toEqual({
      freshness: 'current',
      text: '~120 spaces free · updated 3 min ago',
      summary: '~120 spaces free · updated 3 min ago',
      detail: null,
      spoken: 'About 120 spaces free, updated 3 minutes ago',
    });
  });

  it('warns that an old count may be out of date, on one line or two', () => {
    expect(
      describeOccupancy(
        { status: 'stale', spacesAvailable: 40, totalSpaces: 400, observedAt: minutesBefore(130) },
        NOW,
      ),
    ).toEqual({
      freshness: 'stale',
      text: '~40 spaces free · May be out of date (updated 2 h ago)',
      summary: '~40 spaces free when last counted',
      detail: 'May be out of date (updated 2 h ago)',
      spoken:
        'About 40 spaces free when last counted, but this may be out of date. Updated 2 hours ago',
    });
  });

  it('treats a count that was fresh when planned, but has aged since, as out of date', () => {
    const wording = describeOccupancy(
      { status: 'known', spacesAvailable: 75, totalSpaces: 400, observedAt: minutesBefore(16) },
      NOW,
    );

    expect(wording.freshness).toBe('stale');
    expect(wording.detail).toBe('May be out of date (updated 16 min ago)');
  });

  it('never turns a missing count into a number, and says why', () => {
    expect(
      describeOccupancy({ status: 'unknown', reason: 'Occupancy figures are unavailable.' }, NOW),
    ).toEqual({
      freshness: 'unknown',
      text: 'Occupancy unknown',
      summary: 'Occupancy unknown',
      detail: 'Occupancy figures are unavailable.',
      spoken: 'Occupancy unknown. Occupancy figures are unavailable',
    });
  });

  it('says a full car park plainly, and uses the singular for one space', () => {
    expect(
      describeOccupancy(
        { status: 'known', spacesAvailable: 0, totalSpaces: 400, observedAt: minutesBefore(1) },
        NOW,
      ).text,
    ).toBe('No spaces free · updated 1 min ago');
    expect(
      describeOccupancy(
        { status: 'known', spacesAvailable: 1, totalSpaces: 400, observedAt: minutesBefore(1) },
        NOW,
      ).spoken,
    ).toBe('About 1 space free, updated 1 minute ago');
  });

  it('reads a count from slightly in the future as just now', () => {
    expect(
      describeOccupancy(
        { status: 'known', spacesAvailable: 5, totalSpaces: 400, observedAt: addMinutes(NOW, 2) },
        NOW,
      ).summary,
    ).toBe('~5 spaces free · updated just now');
  });
});

describe('describeAge', () => {
  it.each([
    [0.5, 'just now', 'just now'],
    [1, '1 min ago', '1 minute ago'],
    [59, '59 min ago', '59 minutes ago'],
    [60, '1 h ago', '1 hour ago'],
    [47 * 60, '47 h ago', '47 hours ago'],
    [3 * 24 * 60, '3 days ago', '3 days ago'],
  ])('describes %s minutes as "%s"', (minutes, text, spoken) => {
    expect(describeAge(minutesBefore(minutes), NOW)).toEqual({ text, spoken });
  });

  it('treats a time ahead of the phone clock as just now', () => {
    expect(describeAge(minutesBefore(-5), NOW).text).toBe('just now');
  });
});
