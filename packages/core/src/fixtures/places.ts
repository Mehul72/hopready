import type { Place } from '../model';

// Named places for quick picks and tests. Suburbs, stations and landmarks are real. Homes and
// offices sit on "Example" streets that do not exist, at points checked against OpenStreetMap to be
// in the named suburb. Landmark coordinates are from OpenStreetMap (Nominatim), read 2026-10-25.

export type DemoPlaceRole = 'home' | 'office' | 'landmark';

export interface DemoPlaceEntry {
  place: Place;
  role: DemoPlaceRole;
  locality: string;
}

// Frozen because these objects are shared by every screen and test that picks them.
function entry(role: DemoPlaceRole, place: Place, locality: string): DemoPlaceEntry {
  Object.freeze(place.coordinate);
  return Object.freeze({ place: Object.freeze(place), role, locality });
}

const home = (name: string, locality: string, lat: number, lon: number) =>
  entry('home', { name, coordinate: { lat, lon }, kind: 'address' }, locality);

const office = (name: string, locality: string, lat: number, lon: number) =>
  entry('office', { name, coordinate: { lat, lon }, kind: 'address' }, locality);

const landmark = (name: string, locality: string, lat: number, lon: number) =>
  entry('landmark', { name, coordinate: { lat, lon }, kind: 'poi' }, locality);

export const DEMO_PLACE_ENTRIES = {
  rouseHillHome: home('12 Example Street, Rouse Hill', 'Rouse Hill', -33.6955, 150.93),
  boxHillHome: home('8 Example Road, Box Hill', 'Box Hill', -33.6431, 150.8975),
  kellyvilleHome: home('27 Example Avenue, Kellyville', 'Kellyville', -33.704, 150.958),
  bellaVistaHome: home('5 Example Close, Bella Vista', 'Bella Vista', -33.742, 150.956),
  glenhavenHome: home('41 Example Road, Glenhaven', 'Glenhaven', -33.699, 151.0),
  collaroyHome: home('3 Example Street, Collaroy', 'Collaroy', -33.733, 151.2985),
  collaroyPlateauHome: home(
    '16 Example Parade, Collaroy Plateau',
    'Collaroy Plateau',
    -33.729,
    151.286,
  ),

  chatswoodOffice: office('1 Example Street, Chatswood', 'Chatswood', -33.7962, 151.1848),
  barangarooOffice: office('200 Example Avenue, Barangaroo', 'Barangaroo', -33.864, 151.2016),
  martinPlaceOffice: office('60 Example Street, Sydney', 'Sydney', -33.8677, 151.2088),
  centralOffice: office('88 Example Street, Surry Hills', 'Surry Hills', -33.8845, 151.2097),
  macquarieParkOffice: office(
    '10 Example Road, Macquarie Park',
    'Macquarie Park',
    -33.7832,
    151.1312,
  ),
  waterlooOffice: office('30 Example Street, Waterloo', 'Waterloo', -33.8988, 151.2045),
  deeWhyOffice: office('2 Example Lane, Dee Why', 'Dee Why', -33.753, 151.2882),

  macquarieUniversity: landmark('Macquarie University', 'Macquarie Park', -33.774197, 151.112714),
  northernBeachesHospital: landmark(
    'Northern Beaches Hospital',
    'Frenchs Forest',
    -33.750822,
    151.232759,
  ),
  warringahMall: landmark('Warringah Mall', 'Brookvale', -33.767355, 151.265154),
  rouseHillTownCentre: landmark('Rouse Hill Town Centre', 'Rouse Hill', -33.690782, 150.925659),
  castleTowers: landmark('Castle Towers', 'Castle Hill', -33.730565, 151.006251),
  barangarooReserve: landmark('Barangaroo Reserve', 'Barangaroo', -33.858489, 151.201165),
  queenVictoriaBuilding: landmark('Queen Victoria Building', 'Sydney', -33.871436, 151.206669),
} satisfies Record<string, DemoPlaceEntry>;

export type DemoPlaceId = keyof typeof DEMO_PLACE_ENTRIES;

function placesOf(entries: Record<DemoPlaceId, DemoPlaceEntry>): Record<DemoPlaceId, Place> {
  const places = {} as Record<DemoPlaceId, Place>;
  for (const id of Object.keys(entries) as DemoPlaceId[]) places[id] = entries[id].place;
  return places;
}

export const DEMO_PLACES: Readonly<Record<DemoPlaceId, Place>> = placesOf(DEMO_PLACE_ENTRIES);
