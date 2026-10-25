import { shownDurationSeconds } from './shown-duration';

describe('shownDurationSeconds', () => {
  it('matches the minutes shown for Leave and Arrive, whatever the seconds', () => {
    expect(
      shownDurationSeconds({
        departAt: '2026-10-26T20:35:59.000Z',
        arriveAt: '2026-10-26T21:33:10.000Z',
      }),
    ).toBe(58 * 60);
    expect(
      shownDurationSeconds({
        departAt: '2026-10-26T20:36:00.000Z',
        arriveAt: '2026-10-26T21:33:59.000Z',
      }),
    ).toBe(57 * 60);
  });
});
