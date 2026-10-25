import type { Coordinate } from '../geo';
import type { ParkingRules, TransitMode } from '../model';

// Every live Transport Park&Ride facility in the Car Park API. Sources, both read on 2026-10-25:
// - Car Park API documentation v2.4, section 4 (facility IDs, station stop numbers, station
//   coordinates, documented space counts)
// - transportnsw.info Park&Ride page (rules and opening hours)
// IDs 1 to 5 are history-only and left out. Live mode takes names, entrances, capacity and occupancy
// from the feed and uses this list for the station each car park serves and its rules, so a plan
// does not need one feed call per facility. Demo mode uses it as is.

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

interface Row {
  id: string;
  name: string;
  station: string;
  stopId: string;
  lat: number;
  lon: number;
  spaces: number;
  mode: TransitMode;
}

// One row per facility, transcribed from the documentation table. Stop numbers that wrap over two
// lines in the PDF are joined (for example 215538 and 4 make 2155384). Kept one row per line so the
// table reads like its source.
// prettier-ignore
const ROWS: readonly Row[] = [
  { id: '6', name: 'Gordon Henry St (north)', station: 'Gordon Station', stopId: '207210', lat: -33.756009, lon: 151.154528, spaces: 213, mode: 'train' },
  { id: '7', name: 'Kiama', station: 'Kiama Station', stopId: '253330', lat: -34.672518, lon: 150.854695, spaces: 42, mode: 'train' },
  { id: '8', name: 'Gosford', station: 'Gosford Station', stopId: '225040', lat: -33.423883, lon: 151.341711, spaces: 1057, mode: 'train' },
  { id: '9', name: 'Revesby', station: 'Revesby Station', stopId: '221210', lat: -33.95246, lon: 151.014838, spaces: 934, mode: 'train' },
  // The documentation prints this latitude without its minus sign.
  { id: '10', name: 'Warriewood', station: 'Warriewood B-Line stop', stopId: '2101131', lat: -33.697777, lon: 151.300667, spaces: 244, mode: 'bus' },
  { id: '11', name: 'Narrabeen', station: 'Narrabeen B-Line stop', stopId: '2101130', lat: -33.713514, lon: 151.297315, spaces: 46, mode: 'bus' },
  { id: '12', name: 'Mona Vale', station: 'Mona Vale B-Line stop', stopId: '2103108', lat: -33.677276, lon: 151.305146, spaces: 68, mode: 'bus' },
  { id: '13', name: 'Dee Why', station: 'Dee Why B-Line stop', stopId: '2099207', lat: -33.752797, lon: 151.286485, spaces: 117, mode: 'bus' },
  { id: '14', name: 'West Ryde', station: 'West Ryde Station', stopId: '211420', lat: -33.807172, lon: 151.090229, spaces: 151, mode: 'train' },
  { id: '15', name: 'Sutherland East Parade', station: 'Sutherland Station', stopId: '223210', lat: -34.031787, lon: 151.05719, spaces: 373, mode: 'train' },
  { id: '16', name: 'Leppington', station: 'Leppington Station', stopId: '217933', lat: -33.9544, lon: 150.8081, spaces: 1884, mode: 'train' },
  { id: '17', name: 'Edmondson Park (south)', station: 'Edmondson Park Station', stopId: '217426', lat: -33.9693, lon: 150.8587, spaces: 1431, mode: 'train' },
  { id: '18', name: 'St Marys', station: 'St Marys Station', stopId: '276010', lat: -33.762256, lon: 150.776029, spaces: 682, mode: 'train' },
  { id: '19', name: 'Campbelltown Farrow Rd (north)', station: 'Campbelltown Station', stopId: '256020', lat: -34.063835, lon: 150.813929, spaces: 68, mode: 'train' },
  { id: '20', name: 'Campbelltown Hurley St', station: 'Campbelltown Station', stopId: '256020', lat: -34.063835, lon: 150.813929, spaces: 118, mode: 'train' },
  { id: '21', name: 'Penrith (at-grade)', station: 'Penrith Station', stopId: '275010', lat: -33.750055, lon: 150.696135, spaces: 230, mode: 'train' },
  { id: '22', name: 'Penrith (multi-level)', station: 'Penrith Station', stopId: '275010', lat: -33.750055, lon: 150.696135, spaces: 1144, mode: 'train' },
  { id: '23', name: 'Warwick Farm', station: 'Warwick Farm Station', stopId: '217010', lat: -33.91345, lon: 150.935036, spaces: 910, mode: 'train' },
  { id: '24', name: 'Schofields', station: 'Schofields Station', stopId: '276220', lat: -33.704477, lon: 150.873817, spaces: 700, mode: 'train' },
  { id: '25', name: 'Hornsby', station: 'Hornsby Station', stopId: '207720', lat: -33.702801, lon: 151.098494, spaces: 145, mode: 'train' },
  { id: '26', name: 'Tallawong P1', station: 'Tallawong Station', stopId: '2155384', lat: -33.69163, lon: 150.906022, spaces: 121, mode: 'metro' },
  { id: '27', name: 'Tallawong P2', station: 'Tallawong Station', stopId: '2155384', lat: -33.69163, lon: 150.906022, spaces: 455, mode: 'metro' },
  { id: '28', name: 'Tallawong P3', station: 'Tallawong Station', stopId: '2155384', lat: -33.69163, lon: 150.906022, spaces: 397, mode: 'metro' },
  { id: '29', name: 'Kellyville (north)', station: 'Kellyville Station', stopId: '2155382', lat: -33.713514, lon: 150.935304, spaces: 351, mode: 'metro' },
  { id: '30', name: 'Kellyville (south)', station: 'Kellyville Station', stopId: '2155382', lat: -33.713514, lon: 150.935304, spaces: 964, mode: 'metro' },
  { id: '31', name: 'Bella Vista', station: 'Bella Vista Station', stopId: '2153478', lat: -33.730592, lon: 150.944024, spaces: 777, mode: 'metro' },
  { id: '32', name: 'Hills Showground', station: 'Hills Showground Station', stopId: '2154392', lat: -33.72782, lon: 150.987345, spaces: 584, mode: 'metro' },
  { id: '33', name: 'Cherrybrook', station: 'Cherrybrook Station', stopId: '2126158', lat: -33.736703, lon: 151.031977, spaces: 384, mode: 'metro' },
  { id: '34', name: 'Lindfield Village Green', station: 'Lindfield Station', stopId: '207010', lat: -33.775185, lon: 151.169111, spaces: 94, mode: 'train' },
  { id: '35', name: 'Beverly Hills', station: 'Beverly Hills Station', stopId: '220910', lat: -33.948849, lon: 151.081692, spaces: 200, mode: 'train' },
  { id: '36', name: 'Emu Plains', station: 'Emu Plains Station', stopId: '275020', lat: -33.745527, lon: 150.66987, spaces: 751, mode: 'train' },
  { id: '37', name: 'Riverwood', station: 'Riverwood Station', stopId: '221010', lat: -33.952727, lon: 151.050035, spaces: 142, mode: 'train' },
  { id: '38', name: 'North Rocks', station: 'North Rocks Park&Ride stop', stopId: '2151161', lat: -33.765539, lon: 151.014131, spaces: 139, mode: 'bus' },
  { id: '39', name: 'Edmondson Park (north)', station: 'Edmondson Park Station', stopId: '217426', lat: -33.969123, lon: 150.861594, spaces: 917, mode: 'train' },
  { id: '40', name: 'Gordon Henry St (south)', station: 'Gordon Station', stopId: '207210', lat: -33.757889, lon: 151.155306, spaces: 331, mode: 'train' },
  { id: '41', name: 'Mount Druitt', station: 'Mount Druitt Station', stopId: '277010', lat: -33.769635, lon: 150.822987, spaces: 208, mode: 'train' },
  { id: '486', name: 'Ashfield', station: 'Ashfield Station', stopId: '213110', lat: -33.8875506079, lon: 151.125504163, spaces: 225, mode: 'train' },
  { id: '487', name: 'Kogarah', station: 'Kogarah Station', stopId: '221710', lat: -33.9621493059, lon: 151.132641462, spaces: 259, mode: 'train' },
  { id: '488', name: 'Seven Hills', station: 'Seven Hills Station', stopId: '214710', lat: -33.774430434, lon: 150.936513359, spaces: 1613, mode: 'train' },
  { id: '489', name: 'Manly Vale', station: 'Manly Vale B-Line stop', stopId: '2093117', lat: -33.786247, lon: 151.26671, spaces: 142, mode: 'bus' },
  { id: '490', name: 'Brookvale', station: 'Brookvale B-Line stop', stopId: '210020', lat: -33.767508, lon: 151.268541, spaces: 246, mode: 'bus' },
];

// The only entrance the documentation publishes (its sample response for Tallawong P1).
const DOCUMENTED_ENTRANCES: Readonly<Record<string, Coordinate>> = {
  '26': { lat: -33.69304704, lon: 150.9052577 },
};

export const PARK_AND_RIDE_CATALOGUE: readonly CataloguedCarPark[] = ROWS.map((row) => ({
  facilityId: row.id,
  name: row.name,
  station: { name: row.station, stopId: row.stopId, coordinate: { lat: row.lat, lon: row.lon } },
  servedBy: [row.mode],
  entrance: DOCUMENTED_ENTRANCES[row.id] ?? null,
  documentedSpaces: row.spaces,
  rules: row.id === '13' ? DEE_WHY_RULES : STANDARD_PARK_AND_RIDE_RULES,
}));

export function findCataloguedCarPark(facilityId: string): CataloguedCarPark | undefined {
  return PARK_AND_RIDE_CATALOGUE.find((carPark) => carPark.facilityId === facilityId);
}
