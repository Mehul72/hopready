// Small builders for tests. Real legs come from provider adapters or fixtures.
import type { Leg, Place, TransitLeg, TransitMode } from '../model';

export function place(
  name: string,
  lat: number,
  lon: number,
  kind: Place['kind'] = 'address',
): Place {
  return { name, coordinate: { lat, lon }, kind };
}

export const PLACES = {
  rouseHillHome: place('12 Example St, Rouse Hill', -33.6789, 150.9152),
  tallawongCarPark: place('Tallawong P1 car park', -33.6913, 150.9061, 'car-park'),
  tallawongStation: place('Tallawong Station', -33.6921, 150.9058, 'stop'),
  chatswoodStation: place('Chatswood Station', -33.7969, 151.1803, 'stop'),
  chatswoodOffice: place('1 Help St, Chatswood', -33.7975, 151.1832),
} as const;

export function walk(
  from: Place,
  to: Place,
  start: string,
  end: string,
  id = `walk-${from.name}`,
): Leg {
  return {
    id,
    kind: 'walk',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: 'estimated',
    distanceMetres: 400,
  };
}

export function transit(
  from: Place,
  to: Place,
  start: string,
  end: string,
  options: { mode?: TransitMode; name?: string; realtime?: boolean; cancelled?: boolean } = {},
): TransitLeg {
  return {
    id: `transit-${options.name ?? 'M1'}-${start}`,
    kind: 'transit',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: options.realtime ? 'realtime' : 'scheduled',
    mode: options.mode ?? 'metro',
    service: { name: options.name ?? 'M1', description: null, headsign: null, operator: null },
    scheduledStart: start,
    scheduledEnd: end,
    departurePlatform: null,
    arrivalPlatform: null,
    stopCount: null,
    cancelled: options.cancelled ?? false,
    alerts: [],
    realtimeTripId: null,
  };
}

export function drive(from: Place, to: Place, start: string, end: string): Leg {
  return {
    id: `drive-${from.name}`,
    kind: 'drive',
    from,
    to,
    start,
    end,
    source: 'demo-fixture',
    timing: 'estimated',
    distanceMetres: 2500,
    trafficAware: true,
  };
}
