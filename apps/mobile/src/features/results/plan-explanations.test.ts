import { DEFAULT_PREFERENCES, REJECTION_REASONS } from '@hopready/core';

import {
  carParkOutcomeText,
  type CheckedCarPark,
  describeCheckedCarPark,
  explainRejections,
  orderCheckedCarParks,
} from './plan-explanations';

const PREFERENCES = { ...DEFAULT_PREFERENCES, transferBufferMinutes: 3, maxWalkMinutes: 12 };

describe('explainRejections', () => {
  it("explains rejections with the person's own limits", () => {
    expect(
      explainRejections(
        [
          { reason: 'transfer-too-short', count: 4 },
          { reason: 'walk-too-long', count: 1 },
        ],
        PREFERENCES,
      ),
    ).toEqual([
      {
        reason: 'transfer-too-short',
        text: 'Some connections could not be made in time at your walking speed.',
        remedy: 'trip-options',
      },
      {
        reason: 'walk-too-long',
        text: 'Some walks were longer than your 12 min walking limit.',
        remedy: 'trip-options',
      },
    ]);
  });

  it('points time problems at the time, not the options', () => {
    const [explanation] = explainRejections(
      [{ reason: 'arrives-after-target', count: 2 }],
      PREFERENCES,
    );
    expect(explanation?.remedy).toBe('time');
  });

  it('says when options were more than 12 hours from the time asked for', () => {
    expect(
      explainRejections(
        [
          { reason: 'departs-long-after-requested', count: 2 },
          { reason: 'arrives-long-before-target', count: 1 },
        ],
        PREFERENCES,
      ),
    ).toEqual([
      {
        reason: 'departs-long-after-requested',
        text: 'Some options would have needed you to leave more than 12 hours after your chosen time.',
        remedy: 'time',
      },
      {
        reason: 'arrives-long-before-target',
        text: 'Some options would have got you there more than 12 hours before your arrive-by time.',
        remedy: 'time',
      },
    ]);
  });

  it('leaves out duplicates, which explain nothing about what is missing', () => {
    expect(explainRejections([{ reason: 'duplicate', count: 3 }], PREFERENCES)).toEqual([]);
  });

  it('has words for every reason the planner can give', () => {
    const explained = explainRejections(
      REJECTION_REASONS.map((reason) => ({ reason, count: 1 })),
      PREFERENCES,
    );
    expect(explained.map((explanation) => explanation.reason)).toEqual(
      REJECTION_REASONS.filter((reason) => reason !== 'duplicate'),
    );
    for (const explanation of explained) expect(explanation.text).toMatch(/^Some .+\.$/);
  });
});

describe('carParkOutcomeText', () => {
  it('describes each outcome in plain words', () => {
    expect(carParkOutcomeText('too-far-to-drive', 25)).toBe(
      'Further than your 25 min driving limit',
    );
    expect(carParkOutcomeText('not-towards-destination', 25)).toBe(
      'Not on the way to your destination',
    );
    expect(carParkOutcomeText('not-tried', 25)).toBe('Not among the five tried');
    expect(carParkOutcomeText('not-understood', 25)).toBe(
      'Checked. Update HopReady to see what happened here',
    );
    expect(carParkOutcomeText('no-workable-connection', 25)).toBe(
      'No public transport connection worked from here',
    );
    expect(carParkOutcomeText('provider-error', 25)).toBe("Couldn't be checked just now");
    expect(carParkOutcomeText('used', 25)).toBe('Exact times in the options');
    expect(carParkOutcomeText('matched-by-another', 25)).toBe(
      'Another car park at this station gets you there as early, with no more driving',
    );
    expect(carParkOutcomeText('left-out-for-space', 25)).toBe(
      'Works, but more options were found than fit on the list',
    );
  });
});

const SEVEN_HILLS: CheckedCarPark = {
  id: '488',
  name: 'Seven Hills',
  outcome: 'not-tried',
  stationName: 'Seven Hills Station',
  estimatedMinutes: 66,
};

describe('describeCheckedCarPark', () => {
  it('names the station and the rough door-to-door estimate, then the outcome', () => {
    expect(describeCheckedCarPark(SEVEN_HILLS, 30)).toEqual({
      title: 'Seven Hills',
      detail: 'Seven Hills Station · about 1 h 6 min door to door',
      outcome: 'Not among the five tried',
      spoken:
        'Seven Hills, Seven Hills Station, about 1 h 6 min door to door: Not among the five tried',
    });
  });

  it('leaves out what the planner did not give', () => {
    const described = describeCheckedCarPark(
      { id: '1', name: 'Hornsby', outcome: 'too-far-to-drive' },
      30,
    );
    expect(described.detail).toBeNull();
    expect(described.spoken).toBe('Hornsby: Further than your 30 min driving limit');
  });
});

describe('orderCheckedCarParks', () => {
  it('puts tried car parks first, then the rest by estimate', () => {
    const ordered = orderCheckedCarParks([
      { id: 'far', name: 'Hornsby', outcome: 'too-far-to-drive', estimatedMinutes: 50 },
      SEVEN_HILLS,
      { id: 'near', name: 'Bella Vista', outcome: 'not-tried', estimatedMinutes: 60 },
      { id: 'used', name: 'Hills Showground', outcome: 'used', estimatedMinutes: 70 },
      { id: 'unknown', name: 'Ashfield', outcome: 'not-tried' },
    ]);
    expect(ordered.map((carPark) => carPark.id)).toEqual(['used', 'near', '488', 'unknown', 'far']);
  });
});
