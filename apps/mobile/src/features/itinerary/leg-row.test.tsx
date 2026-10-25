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

import { PLACES, TALLAWONG_PARKING } from '@/test-support/trips';

import { LegRow } from './leg-row';
import { PLATFORM_NOT_PROVIDED, SPACES_CAN_FILL_NOTE } from './trip-text';

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

async function renderLeg(leg: Leg, onStartDriving = jest.fn()) {
  await render(<LegRow leg={leg} nowMs={NOW.getTime()} onStartDriving={onStartDriving} />);
  return onStartDriving;
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

  it('shows the platform, live delay and alerts of a live service', async () => {
    await renderLeg(
      transitLeg({
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
});
