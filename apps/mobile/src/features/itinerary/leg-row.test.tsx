import {
  addMinutes,
  type DriveLeg,
  formatSydneyTime,
  type Leg,
  type ParkLeg,
  type RideLeg,
  STANDARD_PARK_AND_RIDE_RULES,
  type TransitLeg,
  type WalkLeg,
} from '@hopready/core';
import { render, screen, userEvent, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { place, PLACES, TALLAWONG_PARKING } from '@/test-support/trips';

import { LegRow } from './leg-row';
import { SPACES_CAN_FILL_NOTE } from '../shared/occupancy-wording';
import { describeStepNotes, PLATFORM_NOT_PROVIDED } from './trip-text';

beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

const NOW = new Date('2026-10-26T20:30:00.000Z');
const START = '2026-10-26T20:35:00.000Z';

const base = {
  from: PLACES.rouseHillHome,
  to: PLACES.tallawongCarPark,
  start: START,
  source: 'demo-fixture' as const,
};

function driveLeg(): DriveLeg {
  return {
    ...base,
    id: 'drive',
    kind: 'drive',
    end: addMinutes(START, 14),
    timing: 'estimated',
    distanceMetres: 2_784,
    trafficAware: true,
  };
}

function rideLeg(): RideLeg {
  return {
    ...base,
    id: 'ride',
    kind: 'ride',
    to: PLACES.tallawongStation,
    end: addMinutes(START, 9),
    timing: 'estimated',
    distanceMetres: 2_762,
    trafficAware: true,
  };
}

function walkLeg(distanceMetres: number | null): WalkLeg {
  return {
    ...base,
    id: 'walk',
    kind: 'walk',
    from: PLACES.chatswoodStation,
    to: PLACES.chatswoodOffice,
    end: addMinutes(START, 7),
    timing: 'estimated',
    distanceMetres,
  };
}

function transitLeg(overrides: Partial<TransitLeg> = {}): TransitLeg {
  return {
    ...base,
    id: 'metro',
    kind: 'transit',
    from: PLACES.tallawongStation,
    to: PLACES.chatswoodStation,
    end: addMinutes(START, 40),
    timing: 'scheduled',
    mode: 'metro',
    service: { name: 'M1', description: null, headsign: 'Sydenham', operator: null },
    scheduledStart: START,
    scheduledEnd: addMinutes(START, 40),
    departurePlatform: null,
    arrivalPlatform: null,
    stopCount: 13,
    cancelled: false,
    alerts: [],
    realtimeTripId: null,
    ...overrides,
  };
}

function parkLeg(parking: ParkLeg['parking']): ParkLeg {
  return {
    ...base,
    id: 'park',
    kind: 'park',
    from: PLACES.tallawongCarPark,
    end: addMinutes(START, 8),
    timing: 'buffer',
    parking,
  };
}

function bufferLeg(kind: 'drop-off' | 'wait' | 'car-retrieval', minutes: number): Leg {
  return {
    ...base,
    id: kind,
    kind,
    from: PLACES.tallawongStation,
    to: kind === 'car-retrieval' ? PLACES.tallawongCarPark : PLACES.tallawongStation,
    end: addMinutes(START, minutes),
    timing: kind === 'wait' ? 'scheduled' : 'buffer',
  };
}

function service(name: string, mode: TransitLeg['mode'], overrides: Partial<TransitLeg>) {
  return transitLeg({
    id: name,
    mode,
    service: { name, description: null, headsign: null, operator: null },
    ...overrides,
  });
}

async function renderLeg(leg: Leg, onStartDriving = jest.fn()) {
  await render(<LegRow leg={leg} nowMs={NOW.getTime()} onStartDriving={onStartDriving} />);
  return onStartDriving;
}

// One step of a trip, with what it says about the steps around it.
async function renderStepOf(legs: Leg[], index: number, transferBufferMinutes = 3) {
  const leg = legs[index];
  if (!leg) throw new Error(`The trip has no step ${index}`);
  await render(
    <LegRow
      leg={leg}
      notes={describeStepNotes(legs, transferBufferMinutes)[index]}
      nowMs={NOW.getTime()}
      onStartDriving={jest.fn()}
    />,
  );
}

const leaveTime = formatSydneyTime(START);

describe('LegRow', () => {
  it('describes a drive with its distance and hands it to a navigation app', async () => {
    const onStartDriving = await renderLeg(driveLeg());

    expect(screen.getByText('Drive 14 min to Tallawong P1')).toBeOnTheScreen();
    expect(screen.getByText('2.8 km · Estimate with traffic')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        `${leaveTime}. Drive 14 minutes to Tallawong P1, 2.8 kilometres, estimate with traffic.`,
      ),
    ).toBeOnTheScreen();

    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Start driving to Tallawong P1' }));
    expect(onStartDriving).toHaveBeenCalledWith({
      name: 'Tallawong P1',
      coordinate: PLACES.tallawongCarPark.coordinate,
    });
  });

  it('describes a drop-off ride without offering to drive it', async () => {
    await renderLeg(rideLeg());
    expect(screen.getByText('Get dropped off at Tallawong Station')).toBeOnTheScreen();
    expect(screen.getByText('9 min ride · 2.8 km · Estimate with traffic')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Start driving/ })).not.toBeOnTheScreen();
  });

  it('gives a walk in minutes and metres, and minutes only when the distance is unknown', async () => {
    await renderLeg(walkLeg(488));
    expect(screen.getByText('Walk 7 min to 1 Help St, Chatswood')).toBeOnTheScreen();
    expect(screen.getByText('490 m')).toBeOnTheScreen();

    await renderLeg(walkLeg(null));
    expect(screen.queryByText(/ m$/)).not.toBeOnTheScreen();
  });

  it('shows a change between services with no walking time as a change, not a 0 min walk', async () => {
    await renderLeg({ ...walkLeg(null), to: PLACES.chatswoodStation, end: START });

    expect(screen.getByText(`Change to ${PLACES.chatswoodStation.name}`)).toBeOnTheScreen();
    expect(screen.getByText('Walking time not given')).toBeOnTheScreen();
    expect(screen.queryByText(/Walk 0 min/)).not.toBeOnTheScreen();
  });

  it('never calls a demo service live, even when it carries a delay', async () => {
    await renderLeg(
      transitLeg({ timing: 'realtime', start: addMinutes(START, 3), end: addMinutes(START, 43) }),
    );

    expect(screen.getByText('Sample live')).toBeOnTheScreen();
    expect(screen.getByText('3 min late (sample)')).toBeOnTheScreen();
    expect(screen.queryByText('Live')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(/Live time from the operator/)).not.toBeOnTheScreen();
  });

  it('says when no platform is provided, and labels timetable times', async () => {
    await renderLeg(transitLeg());

    expect(screen.getByText('M1 towards Sydenham')).toBeOnTheScreen();
    expect(screen.getByRole('image', { name: 'Metro' })).toBeOnTheScreen();
    expect(screen.getByText(`From Tallawong Station · ${PLATFORM_NOT_PROVIDED}`)).toBeOnTheScreen();
    expect(
      screen.getByText(
        `To Chatswood Station, arrive ${formatSydneyTime(addMinutes(START, 40))} · 13 stops`,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Timetable')).toBeOnTheScreen();
    expect(screen.queryByText(/late|early|On time/)).not.toBeOnTheScreen();
  });

  it('names the platform to get off at when one is stated, on screen and for VoiceOver', async () => {
    await renderLeg(transitLeg({ arrivalPlatform: '3' }));
    const arrive = formatSydneyTime(addMinutes(START, 40));

    expect(
      screen.getByText(`To Chatswood Station, Platform 3, arrive ${arrive} · 13 stops`),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        `${leaveTime}. Metro M1 towards Sydenham. From Tallawong Station, ${PLATFORM_NOT_PROVIDED}. To Chatswood Station, Platform 3, arriving ${arrive}. 13 stops. Timetable time, not live.`,
      ),
    ).toBeOnTheScreen();
  });

  it('shows the platform, live delay and alerts of a live service', async () => {
    await renderLeg(
      transitLeg({
        source: 'tfnsw-trip-planner',
        timing: 'realtime',
        start: addMinutes(START, 3),
        end: addMinutes(START, 43),
        departurePlatform: '2',
        alerts: [
          {
            id: 'lift',
            severity: 'warning',
            title: 'Lift out of service',
            detail: 'The lift to platform 2 at Tallawong is out of service.',
            url: 'https://transportnsw.info/alerts/lift',
          },
        ],
      }),
    );

    expect(screen.getByText('From Tallawong Station · Platform 2')).toBeOnTheScreen();
    expect(screen.getByText('Live')).toBeOnTheScreen();
    expect(screen.getByText('3 min late')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Warning. Lift out of service. The lift to platform 2 at Tallawong is out of service.',
      ),
    ).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'More about this alert' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://transportnsw.info/alerts/lift');
  });

  it('explains the parking buffer and keeps occupancy and rules apart', async () => {
    await renderLeg(
      parkLeg({
        ...TALLAWONG_PARKING,
        occupancy: {
          status: 'known',
          spacesAvailable: 82,
          totalSpaces: 121,
          observedAt: addMinutes(NOW, -2),
        },
        rules: STANDARD_PARK_AND_RIDE_RULES,
      }),
    );

    expect(screen.getByText('Park at Tallawong P1')).toBeOnTheScreen();
    expect(
      screen.getByText('8 min to find a space, park and reach the exit (your parking buffer).'),
    ).toBeOnTheScreen();

    const occupancy = screen.getByTestId('parking-occupancy');
    expect(within(occupancy).getByText('~82 spaces free · updated 2 min ago')).toBeOnTheScreen();
    expect(within(occupancy).getByText(SPACES_CAN_FILL_NOTE)).toBeOnTheScreen();
    expect(within(occupancy).queryByText(/Free for up to 18 hours/)).not.toBeOnTheScreen();

    const rules = screen.getByTestId('parking-rules');
    expect(within(rules).getByText(/^Free for up to 18 hours/)).toBeOnTheScreen();
    expect(within(rules).queryByText(/spaces free/)).not.toBeOnTheScreen();

    await userEvent
      .setup()
      .press(
        screen.getByRole('button', { name: 'Source: transportnsw.info, checked 25 Oct 2026' }),
      );
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://transportnsw.info/travel-info/ways-to-get-around/drive/parking/transport-parkride-car-parks',
    );
  });

  it('flags a stale count and still says spaces can fill', async () => {
    await renderLeg(
      parkLeg({
        ...TALLAWONG_PARKING,
        occupancy: {
          status: 'stale',
          spacesAvailable: 40,
          totalSpaces: 121,
          observedAt: addMinutes(NOW, -125),
        },
      }),
    );
    const occupancy = screen.getByTestId('parking-occupancy');
    expect(within(occupancy).getByText('~40 spaces free when last counted')).toBeOnTheScreen();
    expect(within(occupancy).getByText('May be out of date (updated 2 h ago)')).toBeOnTheScreen();
    expect(within(occupancy).getByText(SPACES_CAN_FILL_NOTE)).toBeOnTheScreen();
  });

  it('says occupancy is unknown, and to check signs when rules are unknown', async () => {
    await renderLeg(
      parkLeg({
        carPark: { ...TALLAWONG_PARKING.carPark, kind: 'user-saved', name: 'Kerb near the shops' },
        occupancy: {
          status: 'unknown',
          reason: 'No live occupancy for parking spots you added yourself.',
        },
        rules: { status: 'unknown' },
      }),
    );
    const occupancy = screen.getByTestId('parking-occupancy');
    expect(within(occupancy).getByText('Occupancy unknown')).toBeOnTheScreen();
    expect(
      within(occupancy).getByText('No live occupancy for parking spots you added yourself.'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('parking-rules')).getByText('Check signs for parking rules'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Source:/ })).not.toBeOnTheScreen();
  });

  it('explains the drop-off, wait and car retrieval steps', async () => {
    await renderLeg(bufferLeg('drop-off', 2));
    expect(screen.getByText('Drop-off at Tallawong Station')).toBeOnTheScreen();
    expect(
      screen.getByText('2 min to get out and head to the platform (your drop-off buffer).'),
    ).toBeOnTheScreen();

    await renderLeg(bufferLeg('wait', 6));
    expect(screen.getByText('Wait 6 min at Tallawong Station')).toBeOnTheScreen();

    await renderLeg(bufferLeg('car-retrieval', 5));
    expect(screen.getByText('Back to your car at Tallawong P1')).toBeOnTheScreen();
    expect(
      screen.getByText('5 min to reach your car and drive off (your car retrieval buffer).'),
    ).toBeOnTheScreen();
  });

  describe('at a change between services', () => {
    const wynyard = place('Wynyard Station', -33.865945, 151.206103, 'stop');
    const carringtonStreet = place('Wynyard Station, Carrington St', -33.8653, 151.2056, 'stop');
    const warringahMall = place('Warringah Mall, Pittwater Rd', -33.767526, 151.268564, 'stop');
    const central = place('Central Station', -33.884024, 151.206203, 'stop');
    const martinPlace = place('Martin Place Station', -33.867648, 151.210583, 'stop');

    it('sets the change against the transfer buffer on the walk, on screen and for VoiceOver', async () => {
      await renderStepOf(
        [
          service('B1', 'bus', { to: wynyard, start: addMinutes(START, -54), end: START }),
          { ...walkLeg(300), from: wynyard, to: carringtonStreet, end: addMinutes(START, 5) },
          service('324', 'bus', { from: carringtonStreet, start: addMinutes(START, 8) }),
        ],
        1,
      );

      expect(screen.getByText('Walk 5 min to Wynyard Station, Carrington St')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Change at Wynyard Station: 8 min including the walk; your transfer buffer is 3 min.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText(
          `${leaveTime}. Walk 5 minutes to Wynyard Station, Carrington St, 300 metres. Change at Wynyard Station: 8 minutes including the walk; your transfer buffer is 3 minutes.`,
        ),
      ).toBeOnTheScreen();
    });

    it('sets a change at one stop against the transfer buffer on the wait', async () => {
      await renderStepOf(
        [
          service('B1', 'bus', { to: warringahMall, start: addMinutes(START, -14), end: START }),
          { ...bufferLeg('wait', 4), from: warringahMall, to: warringahMall },
          service('280', 'bus', { from: warringahMall, start: addMinutes(START, 4) }),
        ],
        1,
      );

      expect(screen.getByText('Wait 4 min at Warringah Mall, Pittwater Rd')).toBeOnTheScreen();
      expect(
        screen.getByLabelText(
          `${leaveTime}. Wait 4 minutes at Warringah Mall, Pittwater Rd. Change at Warringah Mall, Pittwater Rd: 4 minutes between services; your transfer buffer is 3 minutes.`,
        ),
      ).toBeOnTheScreen();
    });

    it('ends the service being left with the change when the next one leaves straight away', async () => {
      await renderStepOf(
        [
          service('T1', 'train', { to: central, end: addMinutes(START, 6) }),
          service('T8', 'train', { from: central, start: addMinutes(START, 6) }),
        ],
        0,
        0,
      );

      expect(
        screen.getByText(
          'Change at Central Station: under 1 min between services; your transfer buffer is 0 min.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText(
          /Timetable time, not live\. Change at Central Station: less than a minute between services; your transfer buffer is 0 minutes\.$/,
        ),
      ).toBeOnTheScreen();
    });

    it('follows the change with the station entrance on a walk to the metro', async () => {
      await renderStepOf(
        [
          service('B1', 'bus', { to: wynyard, start: addMinutes(START, -54), end: START }),
          { ...walkLeg(640), from: wynyard, to: martinPlace, end: addMinutes(START, 8) },
          service('M1', 'metro', { from: martinPlace, start: addMinutes(START, 8) }),
        ],
        1,
      );

      expect(
        screen.getByText('Entrance details not provided. Follow the station signs.'),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText(
          `${leaveTime}. Walk 8 minutes to Martin Place Station, 640 metres. Change at Wynyard Station: 8 minutes including the walk; your transfer buffer is 3 minutes. Entrance details not provided. Follow the station signs.`,
        ),
      ).toBeOnTheScreen();
    });

    it('keeps both notes on a change of stop with no walking time', async () => {
      await renderStepOf(
        [
          service('B1', 'bus', { to: wynyard, start: addMinutes(START, -54), end: START }),
          { ...walkLeg(null), from: wynyard, to: martinPlace, end: START },
          service('M1', 'metro', { from: martinPlace, start: addMinutes(START, 8) }),
        ],
        1,
      );

      expect(
        screen.getByLabelText(
          `${leaveTime}. Change to Martin Place Station. Walking time not given. Change at Wynyard Station: 8 minutes including the walk; your transfer buffer is 3 minutes. Entrance details not provided. Follow the station signs.`,
        ),
      ).toBeOnTheScreen();
    });
  });

  it('says the station exit is not provided on the walk out, on screen and for VoiceOver', async () => {
    await renderStepOf(
      [transitLeg({ start: addMinutes(START, -40), end: START }), walkLeg(488)],
      1,
    );

    expect(
      screen.getByText('Exit details not provided. Follow the station signs.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        `${leaveTime}. Walk 7 minutes to 1 Help St, Chatswood, 490 metres. Exit details not provided. Follow the station signs.`,
      ),
    ).toBeOnTheScreen();
  });

  it('says on the service when no walk leads into the station, on screen and for VoiceOver', async () => {
    const arrive = formatSydneyTime(addMinutes(START, 40));
    await renderStepOf(
      [
        { ...bufferLeg('drop-off', 2), start: addMinutes(START, -2), end: START },
        transitLeg(),
        { ...walkLeg(488), start: addMinutes(START, 40), end: addMinutes(START, 47) },
      ],
      1,
    );

    expect(
      screen.getByText('Entrance details not provided. Follow the station signs.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        `${leaveTime}. Metro M1 towards Sydenham. From Tallawong Station, ${PLATFORM_NOT_PROVIDED}. To Chatswood Station, arriving ${arrive}. 13 stops. Timetable time, not live. Entrance details not provided. Follow the station signs.`,
      ),
    ).toBeOnTheScreen();
  });
});
