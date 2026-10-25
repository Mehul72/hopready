import {
  addMinutes,
  type Leg,
  type Place,
  STANDARD_PARK_AND_RIDE_RULES,
  type TransitLeg,
  type TransitMode,
} from '@hopready/core';

import { place, PLACES, transitItinerary } from '@/test-support/trips';

import {
  describeDelay,
  describePlatform,
  describeRealtimeCoverage,
  describeRules,
  describeStepNotes,
  distance,
  duration,
  formatSydneyDay,
  PLATFORM_NOT_PROVIDED,
  platformToAdd,
  serviceTitle,
  staleCheckOf,
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

const STOPS = {
  collaroy: place('Collaroy B-Line', -33.731745, 151.301068, 'stop'),
  warringahMall: place('Warringah Mall, Pittwater Rd', -33.767526, 151.268564, 'stop'),
  wynyard: place('Wynyard Station', -33.865945, 151.206103, 'stop'),
  martinPlace: place('Martin Place Station', -33.867648, 151.210583, 'stop'),
  barangaroo: place('Barangaroo Station', -33.859577, 151.202615, 'stop'),
  central: place('Central Station', -33.884024, 151.206203, 'stop'),
  kellyville: place('Kellyville Station', -33.713514, 150.935304, 'stop'),
  hornsby: place('Hornsby Station', -33.703, 151.0985, 'stop'),
  gordon: place('Gordon Station', -33.7559, 151.1541, 'stop'),
  frenchsForest: place('Frenchs Forest Rd Opp Nth Beaches Hospital', -33.7515, 151.2337, 'stop'),
};

// Legs are timed in minutes after the first service leaves, so each trip reads as a timeline.
const FIRST_DEPARTURE = '2026-10-26T20:43:00.000Z';

function at(minute: number): string {
  return addMinutes(FIRST_DEPARTURE, minute);
}

function ride(name: string, mode: TransitMode, from: Place, to: Place, minutes: [number, number]) {
  const start = at(minutes[0]);
  const end = at(minutes[1]);
  return transitLeg({
    id: `${name}-${minutes[0]}`,
    from,
    to,
    mode,
    service: { name, description: null, headsign: null, operator: null },
    start,
    end,
    scheduledStart: start,
    scheduledEnd: end,
  });
}

function walk(from: Place, to: Place, minutes: [number, number]): Leg {
  return {
    id: `walk-${minutes[0]}`,
    kind: 'walk',
    from,
    to,
    start: at(minutes[0]),
    end: at(minutes[1]),
    source: 'tfnsw-trip-planner',
    timing: 'estimated',
    distanceMetres: 400,
  };
}

function wait(stop: Place, minutes: [number, number]): Leg {
  return {
    id: `wait-${minutes[0]}`,
    kind: 'wait',
    from: stop,
    to: stop,
    start: at(minutes[0]),
    end: at(minutes[1]),
    source: 'hopready',
    timing: 'scheduled',
  };
}

function bufferStep(
  kind: 'drop-off' | 'car-retrieval',
  where: Place,
  minutes: [number, number],
): Leg {
  return {
    id: `${kind}-${minutes[0]}`,
    kind,
    from: where,
    to: where,
    start: at(minutes[0]),
    end: at(minutes[1]),
    source: 'hopready',
    timing: 'buffer',
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

  it('adds a platform to a stop name only when the name does not already end with it', () => {
    expect(platformToAdd('Chatswood Station', 'Platform 1')).toBe('Platform 1');
    expect(platformToAdd('Chatswood Station, Platform 1', 'Platform 1')).toBeNull();
    expect(platformToAdd('Circular Quay,Wharf 2, Side A', 'Wharf 2, Side A')).toBeNull();
    expect(platformToAdd('Central Station, Platform 24', 'Platform 4')).toBe('Platform 4');
    expect(platformToAdd('Chatswood Station', PLATFORM_NOT_PROVIDED)).toBe(PLATFORM_NOT_PROVIDED);
    expect(platformToAdd('Chatswood Station', null)).toBeNull();
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

describe('changes between services', () => {
  const walkingChange = [
    ride('B1', 'bus', STOPS.collaroy, STOPS.wynyard, [0, 54]),
    walk(STOPS.wynyard, STOPS.martinPlace, [54, 59]),
    wait(STOPS.martinPlace, [59, 62]),
    ride('M1', 'metro', STOPS.martinPlace, PLACES.chatswoodStation, [62, 73]),
  ];

  it('sets a change against the transfer buffer once, on the walk that starts it', () => {
    const notes = describeStepNotes(walkingChange, 3);

    expect(notes[1]).toContainEqual({
      text: 'Change at Wynyard Station: 8 min including the walk; your transfer buffer is 3 min.',
      spoken:
        'Change at Wynyard Station: 8 minutes including the walk; your transfer buffer is 3 minutes.',
    });
    expect([notes[0], notes[2], notes[3]]).toEqual([[], [], []]);
  });

  it('sets a change at one stop against the transfer buffer on the wait', () => {
    const legs = [
      ride('B1', 'bus', STOPS.collaroy, STOPS.warringahMall, [0, 14]),
      wait(STOPS.warringahMall, [14, 18]),
      ride('280', 'bus', STOPS.warringahMall, PLACES.chatswoodStation, [18, 71]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([
      [],
      [
        {
          text: 'Change at Warringah Mall, Pittwater Rd: 4 min between services; your transfer buffer is 3 min.',
          spoken:
            'Change at Warringah Mall, Pittwater Rd: 4 minutes between services; your transfer buffer is 3 minutes.',
        },
      ],
      [],
    ]);
  });

  it('puts a change with no walk or wait on the service being left', () => {
    const legs = [
      ride('T1', 'train', STOPS.wynyard, STOPS.central, [0, 6]),
      ride('T8', 'train', STOPS.central, PLACES.chatswoodStation, [6, 40]),
    ];

    expect(describeStepNotes(legs, 0)).toEqual([
      [
        {
          text: 'Change at Central Station: under 1 min between services; your transfer buffer is 0 min.',
          spoken:
            'Change at Central Station: less than a minute between services; your transfer buffer is 0 minutes.',
        },
      ],
      [],
    ]);
  });

  it('leaves the buffer out when the trip no longer says what it was planned with', () => {
    expect(describeStepNotes(walkingChange, null)[1]).toContainEqual({
      text: 'Change at Wynyard Station: 8 min including the walk.',
      spoken: 'Change at Wynyard Station: 8 minutes including the walk.',
    });
  });

  it('adds nothing to a trip with one service', () => {
    const office = place('60 Example Street, Sydney', -33.8677, 151.2088);
    const legs = [
      ride('B1', 'bus', STOPS.collaroy, STOPS.wynyard, [0, 54]),
      walk(STOPS.wynyard, office, [54, 60]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([[], []]);
  });
});

describe('station entrances and exits', () => {
  const sentence = (text: string) => ({ text, spoken: text });

  it('says on walks into and out of a station that the entrance and exit are not provided', () => {
    const legs = [
      walk(PLACES.rouseHillHome, PLACES.tallawongStation, [-12, -3]),
      wait(PLACES.tallawongStation, [-3, 0]),
      ride('M1', 'metro', PLACES.tallawongStation, PLACES.chatswoodStation, [0, 40]),
      walk(PLACES.chatswoodStation, PLACES.chatswoodOffice, [40, 47]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([
      [sentence('Entrance details not provided. Follow the station signs.')],
      [],
      [],
      [sentence('Exit details not provided. Follow the station signs.')],
    ]);
  });

  it('names both on a walk between stations, after the change', () => {
    const legs = [
      ride('T1', 'train', STOPS.central, STOPS.wynyard, [0, 4]),
      walk(STOPS.wynyard, STOPS.barangaroo, [4, 12]),
      ride('M1', 'metro', STOPS.barangaroo, PLACES.chatswoodStation, [14, 24]),
    ];

    expect(describeStepNotes(legs, 3)[1]).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^Change at Wynyard Station:/) }),
      sentence('Exit and entrance details not provided. Follow the station signs.'),
    ]);
  });

  it('says nothing on a change of platform inside one station, or at a bus stop', () => {
    const insideCentral = [
      ride('T1', 'train', STOPS.wynyard, STOPS.central, [0, 6]),
      walk(STOPS.central, STOPS.central, [6, 9]),
      ride('T8', 'train', STOPS.central, PLACES.chatswoodStation, [12, 40]),
    ];
    const byBus = [
      walk(place('3 Example Street, Collaroy', -33.733, 151.2985), STOPS.collaroy, [-5, 0]),
      ride('B1', 'bus', STOPS.collaroy, STOPS.wynyard, [0, 54]),
    ];

    expect(describeStepNotes(insideCentral, 3)[1]).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^Change at Central Station:/) }),
    ]);
    expect(describeStepNotes(byBus, 3)).toEqual([[], []]);
  });

  it('notes the entrance on the metro itself when a drop-off leads straight onto it', () => {
    const legs = [
      bufferStep('drop-off', STOPS.kellyville, [-4, -2]),
      wait(STOPS.kellyville, [-2, 0]),
      ride('M1', 'metro', STOPS.kellyville, PLACES.chatswoodStation, [0, 30]),
      walk(PLACES.chatswoodStation, PLACES.chatswoodOffice, [30, 37]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([
      [],
      [],
      [sentence('Entrance details not provided. Follow the station signs.')],
      [sentence('Exit details not provided. Follow the station signs.')],
    ]);
  });

  it('notes the exit on the train itself when the trip home goes straight to the car', () => {
    const carPark = place('Gordon Henry St (north)', -33.756009, 151.154528, 'car-park');
    const legs = [
      walk(PLACES.chatswoodOffice, PLACES.chatswoodStation, [-7, 0]),
      ride('T1', 'train', PLACES.chatswoodStation, STOPS.gordon, [0, 8]),
      bufferStep('car-retrieval', carPark, [8, 13]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([
      [sentence('Entrance details not provided. Follow the station signs.')],
      [sentence('Exit details not provided. Follow the station signs.')],
      [],
    ]);
  });

  it('notes both on a metro between a drop-off and a bus from the stop of the same name', () => {
    const legs = [
      bufferStep('drop-off', STOPS.kellyville, [-2, 0]),
      ride('M1', 'metro', STOPS.kellyville, PLACES.chatswoodStation, [0, 30]),
      wait(PLACES.chatswoodStation, [30, 36]),
      ride('280', 'bus', PLACES.chatswoodStation, STOPS.frenchsForest, [36, 52]),
    ];
    const notes = describeStepNotes(legs, 3);

    expect(notes[1]).toEqual([
      sentence('Entrance and exit details not provided. Follow the station signs.'),
    ]);
    expect(notes[2]).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^Change at Chatswood Station:/) }),
    ]);
  });

  it('says nothing at a station the trip starts or ends at, or between trains with a wait', () => {
    const legs = [
      ride('T1', 'train', STOPS.hornsby, PLACES.chatswoodStation, [0, 20]),
      wait(PLACES.chatswoodStation, [20, 24]),
      ride('M1', 'metro', PLACES.chatswoodStation, STOPS.barangaroo, [24, 40]),
    ];

    expect(describeStepNotes(legs, 3)).toEqual([
      [],
      [expect.objectContaining({ text: expect.stringMatching(/^Change at Chatswood Station:/) })],
      [],
    ]);
  });
});

describe('how live the times are', () => {
  const checkedAt = '2026-10-26T20:30:00.000Z';
  const minutesLater = (minutes: number) => Date.parse(addMinutes(checkedAt, minutes));
  const live = transitItinerary({ departAt: '2026-10-26T20:40:00.000Z', realtime: true });

  it('calls times live for as long as car park counts count as current', () => {
    expect(staleCheckOf(checkedAt, minutesLater(15))).toBeNull();
    expect(staleCheckOf(checkedAt, minutesLater(16))).toBe(checkedAt);
    expect(staleCheckOf(null, minutesLater(60))).toBeNull();
  });

  it('says when live times were checked once they may have changed', () => {
    expect(describeRealtimeCoverage(live)).toEqual({
      text: 'Live times',
      spoken: 'Public transport times are live.',
    });
    expect(describeRealtimeCoverage(live, checkedAt)).toEqual({
      text: 'Checked 7:30 am',
      spoken: 'Public transport times were checked at 7:30 am and may have changed.',
    });
  });

  it('keeps sample and timetable times labelled as they are', () => {
    const sample = {
      ...live,
      legs: live.legs.map((leg) => ({ ...leg, source: 'demo-fixture' as const })),
    };
    const timetable = transitItinerary({ departAt: '2026-10-26T20:40:00.000Z' });
    expect(describeRealtimeCoverage(sample, checkedAt)?.text).toBe('Sample live times');
    expect(describeRealtimeCoverage(timetable, checkedAt)?.text).toBe('Timetable times');
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
