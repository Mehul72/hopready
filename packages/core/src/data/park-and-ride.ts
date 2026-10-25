import type { Coordinate } from '../geo';
import type { ParkingRules, TransitMode } from '../model';

// Documented Transport Park&Ride facilities. Sources, both read on 2026-10-25:
// - Car Park API documentation v2.4 (facility IDs, documented space counts, station stop numbers)
// - transportnsw.info Park&Ride page (rules and opening hours)
// Live mode takes names, entrances, capacity and occupancy from the Car Park API feed and uses this
// list only for the station each car park serves and its rules. Demo mode uses it as is.

export const PARK_AND_RIDE_RULES_URL =
  'https://transportnsw.info/travel-info/ways-to-get-around/drive/parking/transport-parkride-car-parks';
const RULES_CHECKED_ON = '2026-10-25';

export const STANDARD_PARK_AND_RIDE_RULES: ParkingRules = {
  status: 'documented',
  summary:
    'Free for up to 18 hours when you tap on and off a public transport trip with the same Opal or linked card, and exit within 18 hours. Opal users tap out at the exit. Longer stays cost $30 on weekdays and $10 on weekends and public holidays. Open 24 hours, 7 days.',
  sourceUrl: PARK_AND_RIDE_RULES_URL,
  checkedOn: RULES_CHECKED_ON,
};

const DEE_WHY_RULES: ParkingRules = {
  ...STANDARD_PARK_AND_RIDE_RULES,
  summary:
    'Free for up to 18 hours when you tap on and off a public transport trip with the same Opal or linked card. Opal users tap out at the exit. Open 5.30 am to midnight Monday to Saturday, and 6.30 am to midnight on Sundays and public holidays.',
};

export interface CataloguedCarPark {
  facilityId: string;
  name: string;
  station: { name: string; stopId: string; coordinate: Coordinate };
  servedBy: readonly TransitMode[];
  // The documented car park entrance where one is published; otherwise the station is the best point.
  entrance: Coordinate | null;
  documentedSpaces: number;
  rules: ParkingRules;
}

const TALLAWONG = {
  name: 'Tallawong Station',
  stopId: '2155384',
  coordinate: { lat: -33.69163, lon: 150.906022 },
};
const KELLYVILLE = {
  name: 'Kellyville Station',
  stopId: '2155382',
  coordinate: { lat: -33.713514, lon: 150.935304 },
};

export const PARK_AND_RIDE_CATALOGUE: readonly CataloguedCarPark[] = [
  {
    facilityId: '26',
    name: 'Tallawong P1',
    station: TALLAWONG,
    servedBy: ['metro'],
    entrance: { lat: -33.69304704, lon: 150.9052577 },
    documentedSpaces: 121,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '27',
    name: 'Tallawong P2',
    station: TALLAWONG,
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 455,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '28',
    name: 'Tallawong P3',
    station: TALLAWONG,
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 397,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '29',
    name: 'Kellyville (north)',
    station: KELLYVILLE,
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 351,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '30',
    name: 'Kellyville (south)',
    station: KELLYVILLE,
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 964,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '31',
    name: 'Bella Vista',
    station: {
      name: 'Bella Vista Station',
      stopId: '2153478',
      coordinate: { lat: -33.730592, lon: 150.944024 },
    },
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 777,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '32',
    name: 'Hills Showground',
    station: {
      name: 'Hills Showground Station',
      stopId: '2154392',
      coordinate: { lat: -33.72782, lon: 150.987345 },
    },
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 584,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '33',
    name: 'Cherrybrook',
    station: {
      name: 'Cherrybrook Station',
      stopId: '2126158',
      coordinate: { lat: -33.736703, lon: 151.031977 },
    },
    servedBy: ['metro'],
    entrance: null,
    documentedSpaces: 384,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '24',
    name: 'Schofields',
    station: {
      name: 'Schofields Station',
      stopId: '276220',
      coordinate: { lat: -33.704477, lon: 150.873817 },
    },
    servedBy: ['train'],
    entrance: null,
    documentedSpaces: 700,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '10',
    name: 'Warriewood',
    station: {
      name: 'Warriewood B-Line stop',
      stopId: '2101131',
      coordinate: { lat: -33.697777, lon: 151.300667 },
    },
    servedBy: ['bus'],
    entrance: null,
    documentedSpaces: 244,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '12',
    name: 'Mona Vale',
    station: {
      name: 'Mona Vale B-Line stop',
      stopId: '2103108',
      coordinate: { lat: -33.677276, lon: 151.305146 },
    },
    servedBy: ['bus'],
    entrance: null,
    documentedSpaces: 68,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '13',
    name: 'Dee Why',
    station: {
      name: 'Dee Why B-Line stop',
      stopId: '2099207',
      coordinate: { lat: -33.752797, lon: 151.286485 },
    },
    servedBy: ['bus'],
    entrance: null,
    documentedSpaces: 117,
    rules: DEE_WHY_RULES,
  },
  {
    facilityId: '489',
    name: 'Manly Vale',
    station: {
      name: 'Manly Vale B-Line stop',
      stopId: '2093117',
      coordinate: { lat: -33.786247, lon: 151.26671 },
    },
    servedBy: ['bus'],
    entrance: null,
    documentedSpaces: 142,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
  {
    facilityId: '490',
    name: 'Brookvale',
    station: {
      name: 'Brookvale B-Line stop',
      stopId: '210020',
      coordinate: { lat: -33.767508, lon: 151.268541 },
    },
    servedBy: ['bus'],
    entrance: null,
    documentedSpaces: 246,
    rules: STANDARD_PARK_AND_RIDE_RULES,
  },
];

export function findCataloguedCarPark(facilityId: string): CataloguedCarPark | undefined {
  return PARK_AND_RIDE_CATALOGUE.find((carPark) => carPark.facilityId === facilityId);
}
