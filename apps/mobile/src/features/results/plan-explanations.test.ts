import { DEFAULT_PREFERENCES, REJECTION_REASONS } from '@hopready/core';

import { carParkOutcomeText, explainRejections } from './plan-explanations';

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
        text: 'Some connections were shorter than your 3 min transfer buffer.',
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
    expect(carParkOutcomeText('not-tried', 25)).toBe(
      'Not tried: HopReady tries the four most promising car parks',
    );
    expect(carParkOutcomeText('no-workable-connection', 25)).toBe(
      'No public transport connection worked from here',
    );
    expect(carParkOutcomeText('provider-error', 25)).toBe("Couldn't be checked just now");
    expect(carParkOutcomeText('used', 25)).toBe('A connection was found from here');
    expect(carParkOutcomeText('matched-by-another', 25)).toBe(
      'A car park shown above gets you there as early, with no more driving',
    );
    expect(carParkOutcomeText('left-out-for-space', 25)).toBe(
      'Works, but more options were found than fit on the list',
    );
  });
});
