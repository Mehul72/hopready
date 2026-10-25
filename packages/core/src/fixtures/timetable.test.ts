import { describe, expect, it } from 'vitest';

import { sydneyWallClock } from '../time';
import { scenarioSettings } from './scenarios';
import { serviceDayClock, type CalendarDate } from './service-calendar';
import { STOPS } from './stops';
import { tripsForServiceDay, type ScheduledTrip } from './timetable';

const NORMAL = scenarioSettings('normal').timetable;
const TUESDAY: CalendarDate = { year: 2026, month: 10, day: 27 };
const FRIDAY: CalendarDate = { year: 2026, month: 10, day: 30 };
const SATURDAY: CalendarDate = { year: 2026, month: 10, day: 31 };
const SUNDAY: CalendarDate = { year: 2026, month: 11, day: 1 };
const DST_START_EVE: CalendarDate = { year: 2026, month: 10, day: 3 };
const DST_START: CalendarDate = { year: 2026, month: 10, day: 4 };
const DST_END_EVE: CalendarDate = { year: 2027, month: 4, day: 3 };
const DST_END: CalendarDate = { year: 2027, month: 4, day: 4 };
const MS_PER_MINUTE = 60_000;

function tripsOf(
  date: CalendarDate,
  routeId: string,
  headsign: string,
  settings = NORMAL,
): ScheduledTrip[] {
  return tripsForServiceDay(date, settings).filter(
    (trip) => trip.route.id === routeId && trip.direction.headsign === headsign,
  );
}

const localTime = (ms: number) => {
  const clock = sydneyWallClock(new Date(ms));
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
};

// Minutes between consecutive departures from the first stop that fall in [from, until).
function headwaysBetween(trips: ScheduledTrip[], from: string, until: string): number[] {
  const starts = trips.map((trip) => trip.timesMs[0]!);
  return starts
    .slice(1)
    .map((start, index) => ({ start, gap: (start - starts[index]!) / MS_PER_MINUTE }))
    .filter(({ start }) => localTime(start) >= from && localTime(start) < until)
    .map(({ gap }) => gap);
}

function timeAt(trip: ScheduledTrip, stop: (typeof STOPS)[keyof typeof STOPS]): number {
  const index = trip.direction.calls.findIndex((call) => call.stop === stop);
  return trip.timesMs[index]!;
}

describe('weekday M1 timetable', () => {
  const towardsSydenham = tripsOf(TUESDAY, 'M1', 'Sydenham');

  it('runs every 4 minutes in the peaks, 5 in the middle of the day and 10 in the evening', () => {
    expect(new Set(headwaysBetween(towardsSydenham, '06:05', '09:30'))).toEqual(new Set([4]));
    expect(new Set(headwaysBetween(towardsSydenham, '09:35', '14:00'))).toEqual(new Set([5]));
    expect(new Set(headwaysBetween(towardsSydenham, '14:05', '18:28'))).toEqual(new Set([4]));
    expect(new Set(headwaysBetween(towardsSydenham, '18:45', '23:50'))).toEqual(new Set([10]));
  });

  it('starts at 4.05 am and stops before midnight from Monday to Thursday', () => {
    expect(localTime(towardsSydenham[0]!.timesMs[0]!)).toBe('04:05');
    expect(localTime(towardsSydenham.at(-1)!.timesMs[0]!)).toBe('23:45');
  });

  it('takes 38 minutes from Tallawong to Chatswood and 58 to Sydenham', () => {
    const trip = towardsSydenham[0]!;

    expect((timeAt(trip, STOPS.chatswood) - trip.timesMs[0]!) / MS_PER_MINUTE).toBe(38);
    expect((trip.timesMs.at(-1)! - trip.timesMs[0]!) / MS_PER_MINUTE).toBe(58);
  });
});

describe('late night and weekends', () => {
  it('runs later on Friday and Saturday nights and stops earlier on Sunday', () => {
    const lastStart = (date: CalendarDate) =>
      localTime(tripsOf(date, 'M1', 'Sydenham').at(-1)!.timesMs[0]!);

    expect(lastStart(FRIDAY)).toBe('00:45');
    expect(lastStart(SATURDAY)).toBe('00:45');
    expect(lastStart(SUNDAY)).toBe('22:55');
  });

  it('runs every 10 minutes all day at the weekend', () => {
    for (const date of [SATURDAY, SUNDAY]) {
      expect(new Set(headwaysBetween(tripsOf(date, 'M1', 'Sydenham'), '04:00', '23:59'))).toEqual(
        new Set([10]),
      );
    }
  });

  it('starts no trip between 1.30 am and 4 am on any day', () => {
    for (const date of [TUESDAY, FRIDAY, SATURDAY, SUNDAY]) {
      for (const trip of tripsForServiceDay(date, NORMAL)) {
        const start = localTime(trip.timesMs[0]!);
        expect(start >= '01:30' && start < '04:00').toBe(false);
      }
    }
  });
});

describe('daylight saving', () => {
  it('turns times inside the October gap into "no such time"', () => {
    const clock = serviceDayClock(DST_START);

    expect(clock.instantMs(2 * 60 + 30)).toBeNull();
    expect(new Date(clock.instantMs(3 * 60)!).toISOString()).toBe('2026-10-03T16:00:00.000Z');
    expect(new Date(clock.instantMs(1 * 60 + 59)!).toISOString()).toBe('2026-10-03T15:59:00.000Z');
  });

  it('uses the first of the two 2.30 ams in April', () => {
    const clock = serviceDayClock(DST_END);

    expect(new Date(clock.instantMs(2 * 60 + 30)!).toISOString()).toBe('2027-04-03T15:30:00.000Z');
  });

  it('starts the Sunday metro at 4.05 am local time on both changeover days', () => {
    expect(new Date(tripsOf(DST_START, 'M1', 'Sydenham')[0]!.timesMs[0]!).toISOString()).toBe(
      '2026-10-03T17:05:00.000Z',
    );
    expect(new Date(tripsOf(DST_END, 'M1', 'Sydenham')[0]!.timesMs[0]!).toISOString()).toBe(
      '2027-04-03T18:05:00.000Z',
    );
  });

  it('runs the Saturday night services before the change at their local times', () => {
    expect(
      new Date(tripsOf(DST_START_EVE, 'M1', 'Sydenham').at(-1)!.timesMs[0]!).toISOString(),
    ).toBe('2026-10-03T14:45:00.000Z');
    expect(new Date(tripsOf(DST_END_EVE, 'M1', 'Sydenham').at(-1)!.timesMs[0]!).toISOString()).toBe(
      '2027-04-03T13:45:00.000Z',
    );
  });

  it('keeps every trip the same length in real time on changeover days', () => {
    for (const date of [DST_START_EVE, DST_START, DST_END_EVE, DST_END]) {
      for (const trip of tripsOf(date, 'M1', 'Sydenham')) {
        expect((trip.timesMs.at(-1)! - trip.timesMs[0]!) / MS_PER_MINUTE).toBe(58);
      }
    }
  });
});

describe('route 280 meeting the metro at Chatswood', () => {
  // Every bus is timed to one metro: it arrives this many minutes before a Tallawong-bound train
  // leaves, or leaves this many minutes after a Sydenham-bound train arrives.
  function expectTimedConnections(minutes: number, settings = NORMAL) {
    const metroDepartures = tripsOf(TUESDAY, 'M1', 'Tallawong', settings).map((trip) =>
      timeAt(trip, STOPS.chatswood),
    );
    const metroArrivals = tripsOf(TUESDAY, 'M1', 'Sydenham', settings).map((trip) =>
      timeAt(trip, STOPS.chatswood),
    );
    const inbound = tripsOf(TUESDAY, '280', 'Chatswood', settings);
    const outbound = tripsOf(TUESDAY, '280', 'Warringah Mall', settings);

    expect(inbound.length).toBeGreaterThan(20);
    expect(outbound.length).toBeGreaterThan(20);
    for (const bus of inbound) {
      expect(metroDepartures).toContain(timeAt(bus, STOPS.chatswood) + minutes * MS_PER_MINUTE);
    }
    for (const bus of outbound) {
      expect(metroArrivals).toContain(timeAt(bus, STOPS.chatswood) - minutes * MS_PER_MINUTE);
    }
  }

  it('leaves 5 minutes to change in the normal timetable', () => {
    expectTimedConnections(5);
  });

  it('leaves only 2 minutes in the tight-transfer scenario', () => {
    expectTimedConnections(2, scenarioSettings('tight-transfer').timetable);
  });
});

describe('cancelled-service scenario', () => {
  const cancelling = scenarioSettings('cancelled-service').timetable;

  it('cancels every second M1 trip starting between 6.30 am and 9.30 am, and nothing else', () => {
    const trips = tripsForServiceDay(TUESDAY, cancelling);
    const cancelled = trips.filter((trip) => trip.cancelled);
    const morningMetro = trips.filter((trip) => {
      const start = localTime(trip.timesMs[0]!);
      return trip.route.id === 'M1' && start >= '06:30' && start < '09:30';
    });

    expect(cancelled.length).toBeGreaterThan(0);
    for (const trip of cancelled) expect(morningMetro).toContain(trip);
    for (const headsign of ['Sydenham', 'Tallawong']) {
      const direction = morningMetro.filter((trip) => trip.direction.headsign === headsign);
      expect(direction.map((trip) => trip.cancelled)).toEqual(
        direction.map((_, index) => index % 2 === 1),
      );
    }
  });

  it('cancels nothing in the normal timetable', () => {
    expect(tripsForServiceDay(TUESDAY, NORMAL).some((trip) => trip.cancelled)).toBe(false);
  });
});

describe('live times', () => {
  it('reports live times for a repeatable share of trips on each route', () => {
    const trips = tripsForServiceDay(TUESDAY, NORMAL);
    const share = (routeId: string) => {
      const routeTrips = trips.filter((trip) => trip.route.id === routeId);
      return routeTrips.filter((trip) => trip.realtimeEligible).length / routeTrips.length;
    };

    expect(share('M1')).toBeGreaterThan(0.65);
    expect(share('M1')).toBeLessThan(0.85);
    expect(share('T1')).toBeGreaterThan(0.35);
    expect(share('T1')).toBeLessThan(0.65);
    expect(share('280')).toBe(0);
  });
});
