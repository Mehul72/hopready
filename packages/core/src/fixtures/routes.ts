import type { TransitMode } from '../model';
import { isWeekend, type ServiceDay } from './service-calendar';
import { STOPS, type NetworkStop } from './stops';

// Routes in the demo network. Stop order, run times and platform numbers follow the TfNSW
// Timetables Complete GTFS feed published 2026-10-25 (median times for each time of day, rounded to
// the minute). Headways approximate that feed's weekday and weekend patterns. Departure times are
// generated from these patterns, so the timetable is plausible demo data, not the real timetable.
// The same feed runs the M1 on to Bankstown from 30 October 2026; this network stops at Sydenham.

export type RunTimeProfile = 'quiet' | 'day' | 'peak';

export interface StopCall {
  stop: NetworkStop;
  // Minutes after the trip leaves its first stop. Buses are slower in traffic, so they carry one
  // value per time of day; trains and the metro keep the same times all day.
  minutes: number | Readonly<Record<RunTimeProfile, number>>;
  // Only platforms the GTFS feed gives for nearly every trip; null where it varies or is absent.
  platform: string | null;
}

export interface HeadwayBand {
  // "HH:MM" after the start of the service day; hours past 23 are the next morning.
  from: string;
  // No departures at or after this time.
  until: string;
  everyMinutes: number;
}

export interface ServicePattern {
  weekday: readonly HeadwayBand[];
  friday?: readonly HeadwayBand[];
  saturday: readonly HeadwayBand[];
  sunday?: readonly HeadwayBand[];
}

export interface TimedConnection {
  routeId: string;
  directionIndex: number;
  stop: NetworkStop;
  // 'departure': the bus arrives a set number of minutes before that metro leaves.
  // 'arrival': the bus leaves a set number of minutes after that metro arrives.
  meets: 'departure' | 'arrival';
}

export interface RouteDirection {
  headsign: string;
  calls: readonly StopCall[];
  service: ServicePattern;
  timedTo?: TimedConnection;
}

export interface NetworkRoute {
  id: string;
  mode: TransitMode;
  description: string;
  operator: string;
  // Share of trips that report live times, picked by a hash of the trip so it is repeatable.
  realtimePercent: number;
  directions: readonly RouteDirection[];
}

const band = (from: string, until: string, everyMinutes: number): HeadwayBand => ({
  from,
  until,
  everyMinutes,
});

const rail = (stop: NetworkStop, minutes: number, platform: string | null = null): StopCall => ({
  stop,
  minutes,
  platform,
});

const bus = (stop: NetworkStop, quiet: number, day: number, peak: number): StopCall => ({
  stop,
  minutes: { quiet, day, peak },
  platform: null,
});

export const M1: NetworkRoute = {
  id: 'M1',
  mode: 'metro',
  description: 'Metro North West & Bankstown Line',
  operator: 'Sydney Metro',
  realtimePercent: 75,
  directions: [
    {
      headsign: 'Sydenham',
      calls: [
        rail(STOPS.tallawong, 0),
        rail(STOPS.rouseHill, 2, '1'),
        rail(STOPS.kellyville, 5, '1'),
        rail(STOPS.bellaVista, 8, '1'),
        rail(STOPS.norwest, 10, '1'),
        rail(STOPS.hillsShowground, 13, '1'),
        rail(STOPS.castleHill, 15, '1'),
        rail(STOPS.cherrybrook, 18, '1'),
        rail(STOPS.epping, 24, '5'),
        rail(STOPS.macquarieUniversity, 28, '1'),
        rail(STOPS.macquariePark, 30, '1'),
        rail(STOPS.northRyde, 32, '1'),
        rail(STOPS.chatswood, 38, '2'),
        rail(STOPS.crowsNest, 41),
        rail(STOPS.victoriaCross, 43),
        rail(STOPS.barangaroo, 46),
        rail(STOPS.martinPlace, 49),
        rail(STOPS.gadigal, 51),
        rail(STOPS.central, 53),
        rail(STOPS.waterloo, 55),
        rail(STOPS.sydenham, 58, '1'),
      ],
      service: {
        weekday: [
          band('04:05', '06:00', 10),
          band('06:00', '09:30', 4),
          band('09:30', '14:00', 5),
          band('14:00', '18:30', 4),
          band('18:35', '23:50', 10),
        ],
        friday: [
          band('04:05', '06:00', 10),
          band('06:00', '09:30', 4),
          band('09:30', '14:00', 5),
          band('14:00', '18:30', 4),
          band('18:35', '24:50', 10),
        ],
        saturday: [band('04:05', '24:50', 10)],
        sunday: [band('04:05', '22:56', 10)],
      },
    },
    {
      headsign: 'Tallawong',
      calls: [
        rail(STOPS.sydenham, 0, '1'),
        rail(STOPS.waterloo, 3),
        rail(STOPS.central, 6),
        rail(STOPS.gadigal, 8),
        rail(STOPS.martinPlace, 10),
        rail(STOPS.barangaroo, 12),
        rail(STOPS.victoriaCross, 15),
        rail(STOPS.crowsNest, 17),
        rail(STOPS.chatswood, 21, '3'),
        rail(STOPS.northRyde, 26, '2'),
        rail(STOPS.macquariePark, 28, '2'),
        rail(STOPS.macquarieUniversity, 30, '2'),
        rail(STOPS.epping, 34, '6'),
        rail(STOPS.cherrybrook, 40, '2'),
        rail(STOPS.castleHill, 43, '2'),
        rail(STOPS.hillsShowground, 45, '2'),
        rail(STOPS.norwest, 48, '2'),
        rail(STOPS.bellaVista, 51, '2'),
        rail(STOPS.kellyville, 53, '2'),
        rail(STOPS.rouseHill, 56, '2'),
        rail(STOPS.tallawong, 58),
      ],
      service: {
        weekday: [
          band('04:53', '06:30', 10),
          band('06:30', '09:45', 4),
          band('09:45', '14:45', 5),
          band('14:45', '19:15', 4),
          band('19:25', '24:26', 10),
        ],
        friday: [
          band('04:53', '06:30', 10),
          band('06:30', '09:45', 4),
          band('09:45', '14:45', 5),
          band('14:45', '19:15', 4),
          band('19:25', '25:26', 10),
        ],
        saturday: [band('04:55', '25:26', 10)],
        sunday: [band('04:55', '23:26', 10)],
      },
    },
  ],
};

const T1_WEEKEND = [band('05:00', '24:31', 8)];

// Only the North Shore section, Hornsby to Central, with all-stations trains. Southbound trains
// really continue west of Central; in the demo they end there.
export const T1: NetworkRoute = {
  id: 'T1',
  mode: 'train',
  description: 'North Shore & Western Line',
  operator: 'Sydney Trains',
  realtimePercent: 50,
  directions: [
    {
      headsign: 'Emu Plains',
      calls: [
        rail(STOPS.hornsby, 0),
        rail(STOPS.waitara, 2, '1'),
        rail(STOPS.wahroonga, 4, '1'),
        rail(STOPS.warrawee, 6, '1'),
        rail(STOPS.turramurra, 8, '1'),
        rail(STOPS.pymble, 11, '1'),
        rail(STOPS.gordon, 14, '1'),
        rail(STOPS.killara, 16, '1'),
        rail(STOPS.lindfield, 18, '1'),
        rail(STOPS.roseville, 20, '1'),
        rail(STOPS.chatswood, 24, '1'),
        rail(STOPS.artarmon, 26, '1'),
        rail(STOPS.stLeonards, 29, '2'),
        rail(STOPS.wollstonecraft, 31, '1'),
        rail(STOPS.waverton, 33, '1'),
        rail(STOPS.northSydney, 37, '1'),
        rail(STOPS.milsonsPoint, 39, '1'),
        rail(STOPS.wynyard, 43, '3'),
        rail(STOPS.townHall, 47, '2'),
        rail(STOPS.central, 50, '18'),
      ],
      service: {
        weekday: [
          band('04:30', '06:30', 15),
          band('06:30', '09:30', 8),
          band('09:30', '15:30', 15),
          band('15:30', '19:00', 8),
          band('19:00', '23:46', 15),
        ],
        saturday: T1_WEEKEND,
      },
    },
    {
      headsign: 'Hornsby',
      calls: [
        rail(STOPS.central, 0, '16'),
        rail(STOPS.townHall, 3, '3'),
        rail(STOPS.wynyard, 6, '4'),
        rail(STOPS.milsonsPoint, 10, '2'),
        rail(STOPS.northSydney, 12, '4'),
        rail(STOPS.waverton, 14, '2'),
        rail(STOPS.wollstonecraft, 17, '2'),
        rail(STOPS.stLeonards, 19, '3'),
        rail(STOPS.artarmon, 21, '2'),
        rail(STOPS.chatswood, 24, '4'),
        rail(STOPS.roseville, 27, '2'),
        rail(STOPS.lindfield, 30, '3'),
        rail(STOPS.killara, 32, '2'),
        rail(STOPS.gordon, 35, '3'),
        rail(STOPS.pymble, 37, '2'),
        rail(STOPS.turramurra, 40, '2'),
        rail(STOPS.warrawee, 42, '2'),
        rail(STOPS.wahroonga, 44, '2'),
        rail(STOPS.waitara, 46, '2'),
        rail(STOPS.hornsby, 49),
      ],
      service: {
        weekday: [
          band('04:25', '06:30', 15),
          band('06:30', '09:30', 8),
          band('09:30', '15:30', 15),
          band('15:30', '19:00', 8),
          band('19:00', '24:31', 15),
        ],
        saturday: T1_WEEKEND,
      },
    },
  ],
};

export const B1: NetworkRoute = {
  id: 'B1',
  mode: 'bus',
  description: 'B-Line City Wynyard to Mona Vale',
  operator: 'Keolis Downer Northern Beaches',
  realtimePercent: 67,
  directions: [
    {
      headsign: 'City Wynyard',
      calls: [
        bus(STOPS.monaVale, 0, 0, 0),
        bus(STOPS.warriewood, 2, 3, 3),
        bus(STOPS.narrabeen, 5, 6, 6),
        bus(STOPS.collaroy, 7, 9, 10),
        bus(STOPS.deeWhy, 12, 16, 17),
        bus(STOPS.warringahMall, 18, 23, 24),
        bus(STOPS.manlyVale, 22, 28, 29),
        bus(STOPS.spitJunction, 30, 38, 41),
        bus(STOPS.neutralBay, 34, 44, 49),
        bus(STOPS.wynyard, 42, 54, 64),
      ],
      service: {
        weekday: [
          band('04:33', '06:00', 8),
          band('06:00', '07:00', 5),
          band('07:00', '08:30', 3),
          band('08:30', '14:00', 8),
          band('14:00', '17:00', 5),
          band('17:00', '19:00', 7),
          band('19:00', '22:00', 8),
          band('22:00', '23:54', 10),
        ],
        saturday: [
          band('04:33', '07:00', 10),
          band('07:00', '20:00', 8),
          band('20:00', '23:54', 10),
        ],
      },
    },
    {
      headsign: 'Mona Vale',
      calls: [
        bus(STOPS.wynyard, 0, 0, 0),
        bus(STOPS.neutralBay, 7, 8, 8),
        bus(STOPS.spitJunction, 10, 12, 14),
        bus(STOPS.manlyVale, 18, 22, 24),
        bus(STOPS.warringahMall, 22, 28, 30),
        bus(STOPS.deeWhy, 27, 35, 37),
        bus(STOPS.collaroy, 32, 41, 43),
        bus(STOPS.narrabeen, 35, 45, 47),
        bus(STOPS.warriewood, 38, 50, 52),
        bus(STOPS.monaVale, 45, 58, 59),
      ],
      service: {
        weekday: [
          band('05:25', '06:00', 15),
          band('06:00', '14:00', 7),
          band('14:00', '16:00', 5),
          band('16:00', '18:30', 4),
          band('18:30', '22:00', 6),
          band('22:00', '24:46', 10),
        ],
        saturday: [
          band('05:25', '07:00', 10),
          band('07:00', '20:00', 8),
          band('20:00', '24:46', 10),
        ],
      },
    },
  ],
};

// Route 280 links the Brookvale (Warringah Mall) Park&Ride to the metro at Chatswood. The demo
// shows only its main stops, and times each bus to meet the metro (see TimedConnection).
export const ROUTE_280: NetworkRoute = {
  id: '280',
  mode: 'bus',
  description: 'Chatswood to Warringah Mall',
  operator: 'Keolis Downer Northern Beaches',
  realtimePercent: 0,
  directions: [
    {
      headsign: 'Chatswood',
      calls: [
        bus(STOPS.warringahMall, 0, 0, 0),
        bus(STOPS.allambieHeightsToChatswood, 7, 8, 9),
        bus(STOPS.hospitalToChatswood, 15, 17, 22),
        bus(STOPS.forestWayToChatswood, 17, 19, 25),
        bus(STOPS.darleyStreetToChatswood, 21, 24, 31),
        bus(STOPS.valleyRoadToChatswood, 22, 26, 33),
        bus(STOPS.allanStreetToChatswood, 25, 29, 38),
        bus(STOPS.chatswood, 34, 43, 53),
      ],
      service: {
        weekday: [
          band('05:02', '06:30', 20),
          band('06:30', '09:30', 15),
          band('09:30', '14:30', 30),
          band('14:30', '18:30', 20),
          band('18:30', '23:03', 30),
        ],
        saturday: [band('05:02', '23:03', 30)],
      },
      timedTo: { routeId: 'M1', directionIndex: 1, stop: STOPS.chatswood, meets: 'departure' },
    },
    {
      headsign: 'Warringah Mall',
      calls: [
        bus(STOPS.chatswood, 0, 0, 0),
        bus(STOPS.parkAvenueToBrookvale, 6, 8, 12),
        bus(STOPS.valleyRoadToBrookvale, 9, 12, 16),
        bus(STOPS.darleyStreetToBrookvale, 11, 13, 17),
        bus(STOPS.forestwayToBrookvale, 16, 19, 24),
        bus(STOPS.hospitalToBrookvale, 18, 21, 26),
        bus(STOPS.allambieHeightsToBrookvale, 26, 30, 36),
        bus(STOPS.warringahMall, 36, 40, 47),
      ],
      service: {
        weekday: [
          band('05:45', '10:00', 20),
          band('10:00', '15:00', 30),
          band('15:00', '19:00', 20),
          band('19:00', '23:46', 30),
        ],
        saturday: [band('05:45', '23:46', 30)],
      },
      timedTo: { routeId: 'M1', directionIndex: 0, stop: STOPS.chatswood, meets: 'arrival' },
    },
  ],
};

// Timed routes come after the routes they meet, so their partners exist when they are generated.
export const NETWORK_ROUTES: readonly NetworkRoute[] = [M1, T1, B1, ROUTE_280];

export function bandsFor(pattern: ServicePattern, day: ServiceDay): readonly HeadwayBand[] {
  switch (day) {
    case 'weekday':
      return pattern.weekday;
    case 'friday':
      return pattern.friday ?? pattern.weekday;
    case 'saturday':
      return pattern.saturday;
    case 'sunday':
      return pattern.sunday ?? pattern.saturday;
  }
}

const MORNING_PEAK = { start: 7 * 60, end: 9 * 60 + 30 };
const AFTERNOON_PEAK = { start: 15 * 60, end: 19 * 60 };
const WEEKDAY_DAYTIME = { start: 6 * 60, end: 19 * 60 };
const WEEKEND_DAYTIME = { start: 8 * 60, end: 19 * 60 };

const within = (minute: number, range: { start: number; end: number }) =>
  minute >= range.start && minute < range.end;

// Which bus run times apply to a trip that leaves its first stop at this local time.
export function runTimeProfile(day: ServiceDay, minuteOfDay: number): RunTimeProfile {
  if (isWeekend(day)) return within(minuteOfDay, WEEKEND_DAYTIME) ? 'day' : 'quiet';
  if (within(minuteOfDay, MORNING_PEAK) || within(minuteOfDay, AFTERNOON_PEAK)) return 'peak';
  return within(minuteOfDay, WEEKDAY_DAYTIME) ? 'day' : 'quiet';
}

export function minutesAt(call: StopCall, profile: RunTimeProfile): number {
  return typeof call.minutes === 'number' ? call.minutes : call.minutes[profile];
}
