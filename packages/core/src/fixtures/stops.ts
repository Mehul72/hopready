import type { Coordinate } from '../geo';

// Stops in the demo network. Ids, names and coordinates are copied from the TfNSW Timetables
// Complete GTFS feed (stops.txt, published 2026-10-25): parent stations for train, metro and
// B-Line stations, and the kerbside stand for other bus stops. Localities come from TfNSW's
// Public Transport Location Facilities dataset (2026-09-25) and, for kerbside stands, OpenStreetMap.
// Only the stops are real. The timetables built on them are demo data.

export interface NetworkStop {
  id: string;
  name: string;
  locality: string;
  coordinate: Coordinate;
}

function stop(id: string, name: string, locality: string, lat: number, lon: number): NetworkStop {
  return { id, name, locality, coordinate: { lat, lon } };
}

export const STOPS = {
  tallawong: stop('2155384', 'Tallawong Station', 'Rouse Hill', -33.691631, 150.906006),
  rouseHill: stop('2155383', 'Rouse Hill Station', 'Rouse Hill', -33.691812, 150.924168),
  kellyville: stop('2155382', 'Kellyville Station', 'Kellyville', -33.713374, 150.935231),
  bellaVista: stop('2153478', 'Bella Vista Station', 'Bella Vista', -33.730566, 150.94402),
  norwest: stop('2153477', 'Norwest Station', 'Norwest', -33.734617, 150.963522),
  hillsShowground: stop(
    '2154392',
    'Hills Showground Station',
    'Castle Hill',
    -33.727912,
    150.987025,
  ),
  castleHill: stop('2154391', 'Castle Hill Station', 'Castle Hill', -33.731626, 151.007288),
  cherrybrook: stop('2126158', 'Cherrybrook Station', 'Cherrybrook', -33.736659, 151.031994),
  epping: stop('212110', 'Epping Station', 'Epping', -33.772837, 151.082082),
  macquarieUniversity: stop(
    '211310',
    'Macquarie University Station',
    'Macquarie Park',
    -33.777282,
    151.118267,
  ),
  macquariePark: stop('211340', 'Macquarie Park Station', 'Macquarie Park', -33.78508, 151.128374),
  northRyde: stop('211320', 'North Ryde Station', 'North Ryde', -33.794218, 151.137987),
  chatswood: stop('206710', 'Chatswood Station', 'Chatswood', -33.797237, 151.180934),
  crowsNest: stop('206516', 'Crows Nest Station', 'Crows Nest', -33.82562, 151.199137),
  victoriaCross: stop('206044', 'Victoria Cross Station', 'North Sydney', -33.837727, 151.207385),
  barangaroo: stop('200046', 'Barangaroo Station', 'Barangaroo', -33.859577, 151.202615),
  martinPlace: stop('200030', 'Martin Place Station', 'Sydney', -33.867648, 151.210583),
  gadigal: stop('200066', 'Gadigal Station', 'Sydney', -33.873081, 151.208722),
  central: stop('200060', 'Central Station', 'Haymarket', -33.884024, 151.206203),
  waterloo: stop('201721', 'Waterloo Station', 'Waterloo', -33.897445, 151.20024),
  sydenham: stop('204420', 'Sydenham Station', 'Sydenham', -33.914459, 151.166526),

  hornsby: stop('207720', 'Hornsby Station', 'Hornsby', -33.703475, 151.09836),
  waitara: stop('207710', 'Waitara Station', 'Waitara', -33.710365, 151.104941),
  wahroonga: stop('207610', 'Wahroonga Station', 'Wahroonga', -33.718045, 151.117545),
  warrawee: stop('207420', 'Warrawee Station', 'Warrawee', -33.724399, 151.121828),
  turramurra: stop('207410', 'Turramurra Station', 'Turramurra', -33.732586, 151.128636),
  pymble: stop('207310', 'Pymble Station', 'Pymble', -33.74478, 151.142261),
  gordon: stop('207210', 'Gordon Station', 'Gordon', -33.755911, 151.154448),
  killara: stop('207110', 'Killara Station', 'Killara', -33.765699, 151.161847),
  lindfield: stop('207010', 'Lindfield Station', 'Lindfield', -33.775521, 151.169271),
  roseville: stop('206910', 'Roseville Station', 'Roseville', -33.784436, 151.177667),
  artarmon: stop('206410', 'Artarmon Station', 'Artarmon', -33.808542, 151.184701),
  stLeonards: stop('206520', 'St Leonards Station', 'St Leonards', -33.822232, 151.194134),
  wollstonecraft: stop(
    '206510',
    'Wollstonecraft Station',
    'Wollstonecraft',
    -33.831945,
    151.191749,
  ),
  waverton: stop('206020', 'Waverton Station', 'Waverton', -33.837618, 151.197381),
  northSydney: stop('206010', 'North Sydney Station', 'North Sydney', -33.84115, 151.207412),
  milsonsPoint: stop('206110', 'Milsons Point Station', 'Milsons Point', -33.845936, 151.211837),
  wynyard: stop('200080', 'Wynyard Station', 'Sydney', -33.865945, 151.206103),
  townHall: stop('200070', 'Town Hall Station', 'Sydney', -33.873539, 151.20693),

  monaVale: stop('2103108', 'Mona Vale B-Line', 'Mona Vale', -33.677396, 151.304789),
  warriewood: stop('2101131', 'Warriewood B-Line', 'Warriewood', -33.697012, 151.30109),
  narrabeen: stop('2101130', 'Narrabeen B-Line', 'Narrabeen', -33.713525, 151.297279),
  collaroy: stop('209742', 'Collaroy B-Line', 'Collaroy', -33.731745, 151.301068),
  deeWhy: stop('2099207', 'Dee Why B-Line', 'Dee Why', -33.752804, 151.286471),
  warringahMall: stop(
    '210020',
    'Warringah Mall, Pittwater Rd',
    'Brookvale',
    -33.767526,
    151.268564,
  ),
  manlyVale: stop('2093117', 'Manly Vale B-Line', 'Manly Vale', -33.786248, 151.266743),
  spitJunction: stop('2088233', 'Spit Junction B-Line', 'Mosman', -33.824067, 151.24155),
  neutralBay: stop(
    '208953',
    'Neutral Bay Junction, Military Rd',
    'Neutral Bay',
    -33.831537,
    151.222919,
  ),

  // Route 280 stops on the Chatswood-bound side of the road.
  allambieHeightsToChatswood: stop(
    '210091',
    'Allambie Heights Public School, Allambie Rd',
    'Allambie Heights',
    -33.765353,
    151.249589,
  ),
  hospitalToChatswood: stop(
    '208645',
    'Nth Beaches Hospital, Frenchs Forest Rd',
    'Frenchs Forest',
    -33.749702,
    151.232324,
  ),
  forestWayToChatswood: stop(
    '208649',
    'Rabbett St At Forest Way',
    'Frenchs Forest',
    -33.750651,
    151.226223,
  ),
  darleyStreetToChatswood: stop(
    '208752',
    'Warringah Rd At Darley St',
    'Forestville',
    -33.760385,
    151.214016,
  ),
  valleyRoadToChatswood: stop(
    '208756',
    'Warringah Rd Opp Valley Rd',
    'Forestville',
    -33.76404,
    151.205931,
  ),
  allanStreetToChatswood: stop(
    '206969',
    'Babbage Rd At Allan St',
    'Roseville Chase',
    -33.779109,
    151.19548,
  ),

  // Route 280 stops on the Brookvale-bound side of the road.
  parkAvenueToBrookvale: stop(
    '206966',
    'Babbage Rd At Park Av',
    'Roseville',
    -33.778624,
    151.194928,
  ),
  valleyRoadToBrookvale: stop(
    '208733',
    'Warringah Rd At Valley Rd',
    'Forestville',
    -33.763803,
    151.205758,
  ),
  darleyStreetToBrookvale: stop(
    '208737',
    'Warringah Rd Opp Darley St',
    'Forestville',
    -33.76001,
    151.213663,
  ),
  forestwayToBrookvale: stop(
    '208671',
    'Forestway Shopping Centre, Forest Way',
    'Frenchs Forest',
    -33.749943,
    151.225055,
  ),
  hospitalToBrookvale: stop(
    '208636',
    'Frenchs Forest Rd Opp Nth Beaches Hospital',
    'Frenchs Forest',
    -33.749528,
    151.232434,
  ),
  allambieHeightsToBrookvale: stop(
    '2100102',
    'Allambie Rd Opp Allambie Heights Public School',
    'Allambie Heights',
    -33.765187,
    151.249689,
  ),
} satisfies Record<string, NetworkStop>;

export const NETWORK_STOPS: readonly NetworkStop[] = Object.values(STOPS);

// Pairs of stops close enough to change between on foot. Walking time comes from the walking model.
export const WALKING_LINKS: readonly (readonly [NetworkStop, NetworkStop])[] = [
  [STOPS.wynyard, STOPS.barangaroo],
  [STOPS.wynyard, STOPS.martinPlace],
  [STOPS.townHall, STOPS.gadigal],
  [STOPS.northSydney, STOPS.victoriaCross],
  [STOPS.stLeonards, STOPS.crowsNest],
];
