import { addMinutes, buildItinerary, type Itinerary } from '@hopready/core';

import {
  parkAndRideItinerary,
  PLACES,
  TALLAWONG_PARKING,
  transitItinerary,
} from '@/test-support/trips';

import {
  alertSummary,
  describeItinerary,
  legDuration,
  legSteps,
  spokenDuration,
  timingSummary,
  tripFacts,
} from './route-summary';

const DEPART = '2026-10-26T20:42:00.000Z'; // 7:42 am in Sydney
const NOW = new Date('2026-10-26T20:30:00.000Z');

function withFreshCount(itinerary: Itinerary): Itinerary {
  const parking = {
    ...TALLAWONG_PARKING,
    occupancy: {
      status: 'known' as const,
      spacesAvailable: 120,
      totalSpaces: 400,
      observedAt: '2026-10-26T20:27:00.000Z',
    },
  };
  return { ...itinerary, parking };
}

function driveOnly(): Itinerary {
  return buildItinerary({
    strategy: 'drive-only',
    legs: [
      {
        id: 'drive',
        kind: 'drive',
        from: PLACES.rouseHillHome,
        to: PLACES.chatswoodOffice,
        start: DEPART,
        end: addMinutes(DEPART, 47),
        source: 'apple-maps',
        timing: 'estimated',
        distanceMetres: 35_000,
        trafficAware: true,
      },
    ],
  });
}

describe('describeItinerary', () => {
  it("reads the planner's caveats too, such as parking left out of a drive", () => {
    const itinerary = {
      ...driveOnly(),
      notes: ['Parking at your destination is not included in this time.'],
    };

    expect(describeItinerary(itinerary, NOW)).toMatch(
      /Parking at your destination is not included in this time\.$/,
    );
  });

  it('reads a whole option as one sentence, in the order it looks', () => {
    const itinerary = withFreshCount(parkAndRideItinerary({ departAt: DEPART, realtime: true }));

    expect(describeItinerary(itinerary, NOW)).toBe(
      'Drive and park. ' +
        'Leave 7:42\u00a0am, arrive 8:44\u00a0am, 1 hour 2 minutes in total. ' +
        'Drive for 6 minutes to Tallawong P1, then walk for 3 minutes, ' +
        'then Metro M1 for 40 minutes to Chatswood Station, then walk for 5 minutes. ' +
        'No changes. ' +
        'Parking at Tallawong P1: About 120 spaces free, updated 3 minutes ago. ' +
        'Spaces can fill before you arrive. ' +
        'Live times.',
    );
  });

  it('says when times come from the timetable and when there are alerts', () => {
    const itinerary: Itinerary = {
      ...transitItinerary({ departAt: DEPART }),
      alerts: [
        { id: 'a', severity: 'warning', title: 'Track work' },
        { id: 'b', severity: 'info', title: 'Lift out of order' },
      ],
    };
    const sentence = describeItinerary(itinerary, NOW);
    expect(sentence).toMatch(/^Public transport\. /);
    expect(sentence).toContain('Timetable times, not live. 2 service alerts.');
    expect(sentence).not.toContain('Parking');
  });
});

describe('card pieces', () => {
  it('lists moving steps with service names, and leaves out parking and waiting', () => {
    const steps = legSteps(parkAndRideItinerary({ departAt: DEPART }));
    expect(steps.map((step) => [step.kind, step.serviceName, step.duration.text])).toEqual([
      ['drive', null, '6 min'],
      ['walk', null, '3 min'],
      ['metro', 'M1', '40 min'],
      ['walk', null, '5 min'],
    ]);
  });

  it('leaves out a change between services that has no walking time', () => {
    const itinerary = parkAndRideItinerary({ departAt: DEPART });
    const metroIndex = itinerary.legs.findIndex((leg) => leg.kind === 'transit');
    const metro = itinerary.legs[metroIndex]!;
    const change = {
      ...metro,
      id: 'interchange-1',
      kind: 'walk' as const,
      start: metro.end,
      end: metro.end,
      timing: 'estimated' as const,
      distanceMetres: null,
    };
    const withChange = {
      ...itinerary,
      legs: [
        ...itinerary.legs.slice(0, metroIndex + 1),
        change,
        ...itinerary.legs.slice(metroIndex + 1),
      ],
    };

    expect(legSteps(withChange).map((step) => step.kind)).toEqual([
      'drive',
      'walk',
      'metro',
      'walk',
    ]);
  });

  it('gives driving, walking and changes for the summary line', () => {
    const facts = tripFacts(parkAndRideItinerary({ departAt: DEPART }));
    expect(facts.total.text).toBe('1 h 2 min');
    expect(facts.driving?.text).toBe('Drive 6 min');
    expect(facts.walking?.text).toBe('Walk 8 min');
    expect(facts.changes?.text).toBe('No changes');
  });

  it('has no changes line for a drive with no public transport', () => {
    const facts = tripFacts(driveOnly());
    expect(facts.changes).toBeNull();
    expect(facts.walking).toBeNull();
    expect(timingSummary(driveOnly())).toBe('estimate');
  });

  it('labels partly live trips as such', () => {
    const itinerary: Itinerary = { ...transitItinerary({ departAt: DEPART }), realtime: 'partial' };
    expect(timingSummary(itinerary)).toBe('partly-live');
  });

  it('reports the worst alert severity', () => {
    const itinerary: Itinerary = {
      ...transitItinerary({ departAt: DEPART }),
      alerts: [
        { id: 'a', severity: 'info', title: 'Lift out of order' },
        { id: 'b', severity: 'severe', title: 'Line closed' },
      ],
    };
    expect(alertSummary(itinerary)).toMatchObject({ count: 2, severity: 'severe' });
    expect(alertSummary(transitItinerary({ departAt: DEPART }))).toBeNull();
  });

  it('never shows a short step as zero minutes', () => {
    expect(legDuration(20)).toEqual({ text: '<1 min', spoken: 'less than a minute' });
    expect(legDuration(60).text).toBe('1 min');
    expect(spokenDuration(3_900)).toBe('1 hour 5 minutes');
    expect(spokenDuration(7_200)).toBe('2 hours');
  });
});
