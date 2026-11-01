export interface Coordinate {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_METRES = 6_371_008.8;

export function haversineMetres(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The compass direction from one point towards another, in degrees clockwise from north, 0 to 359.99.
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

// Greater Sydney (ABS GCCSA, including the Central Coast and Blue Mountains) with a small margin.
// Requests outside it are rejected up front instead of returning partial or misleading plans.
export const GREATER_SYDNEY_BOUNDS = {
  south: -34.45,
  north: -32.95,
  west: 149.95,
  east: 151.7,
} as const;

export function isWithinGreaterSydney(point: Coordinate): boolean {
  const { south, north, west, east } = GREATER_SYDNEY_BOUNDS;
  return point.lat >= south && point.lat <= north && point.lon >= west && point.lon <= east;
}
