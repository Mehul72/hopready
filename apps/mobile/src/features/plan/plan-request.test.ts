import { DEFAULT_PREFERENCES, planRequestSchema } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';

import { DEFAULT_APP_PREFERENCES } from '@/storage';

import { DEFAULT_PLAN_CHOICES } from './plan-choices';
import { buildPlanRequest, findPlanProblems, type PlanInputs } from './plan-request';

const NOW = new Date('2026-10-26T20:30:00.000Z');

function inputs(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    origin: DEMO_PLACES.rouseHillHome,
    destination: DEMO_PLACES.barangarooOffice,
    time: { type: 'now' },
    access: { ...DEFAULT_PLAN_CHOICES.access },
    choices: { preferredStation: null, preferredCarPark: null },
    preferences: { ...DEFAULT_APP_PREFERENCES, navigationApp: 'waze' },
    savedParkingSpots: [],
    ...overrides,
  };
}

describe('buildPlanRequest', () => {
  it('builds a request the planner accepts, leaving now', () => {
    const result = buildPlanRequest(inputs(), NOW);
    if (!result.ok) throw new Error(`Unexpected problems: ${result.problems.join(', ')}`);

    expect(planRequestSchema.parse(result.request)).toEqual(result.request);
    expect(result.request).toEqual({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
      time: { type: 'depart', at: NOW.toISOString() },
      access: { transit: true, drive: true, dropOff: false },
      preferences: DEFAULT_PREFERENCES,
      trip: { kind: 'outbound' },
    });
  });

  it('passes the preferred station and car park, and saved spots only when driving', () => {
    const spot = { id: 'spot-1', name: 'Side street', coordinate: { lat: -33.7, lon: 150.93 } };
    const choices = {
      preferredStation: DEMO_PLACES.castleTowers,
      preferredCarPark: { id: '29', name: 'Kellyville (north)', kind: 'car-park' as const },
    };

    const driving = buildPlanRequest(inputs({ choices, savedParkingSpots: [spot] }), NOW);
    const notDriving = buildPlanRequest(
      inputs({
        choices,
        savedParkingSpots: [spot],
        access: { transit: true, drive: false, dropOff: true },
      }),
      NOW,
    );

    expect(driving).toMatchObject({
      ok: true,
      request: {
        preferredCarParkId: '29',
        preferredStop: DEMO_PLACES.castleTowers,
        savedParkingSpots: [spot],
      },
    });
    expect(notDriving.ok && notDriving.request.savedParkingSpots).toBeUndefined();
  });

  it('uses a chosen arrive-by time as it is', () => {
    const at = '2026-10-26T22:00:00.000Z';
    const result = buildPlanRequest(inputs({ time: { type: 'arrive', at } }), NOW);
    expect(result.ok && result.request.time).toEqual({ type: 'arrive', at });
  });
});

describe('findPlanProblems', () => {
  it('names every missing piece at once', () => {
    expect(
      findPlanProblems(
        inputs({
          origin: null,
          destination: null,
          access: { transit: false, drive: false, dropOff: false },
        }),
        NOW,
      ),
    ).toEqual(['missing-origin', 'missing-destination', 'no-way-to-travel']);
  });

  it('refuses a trip to the same place', () => {
    expect(
      findPlanProblems(
        inputs({ destination: { ...DEMO_PLACES.rouseHillHome, name: 'Home' } }),
        NOW,
      ),
    ).toEqual(['same-place']);
  });

  it('needs public transport for a drop-off', () => {
    expect(
      findPlanProblems(inputs({ access: { transit: false, drive: true, dropOff: true } }), NOW),
    ).toEqual(['drop-off-needs-transit']);
    expect(
      findPlanProblems(inputs({ access: { transit: false, drive: true, dropOff: false } }), NOW),
    ).toEqual([]);
  });

  it("refuses a chosen time that has passed, allowing the planner's one minute of slack", () => {
    const justPassed = new Date(NOW.getTime() - 50_000).toISOString();
    const longPassed = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    expect(findPlanProblems(inputs({ time: { type: 'depart', at: justPassed } }), NOW)).toEqual([]);
    expect(findPlanProblems(inputs({ time: { type: 'arrive', at: longPassed } }), NOW)).toEqual([
      'time-passed',
    ]);
  });
});
