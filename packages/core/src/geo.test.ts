import { describe, expect, it } from 'vitest';

import { bearingDegrees, haversineMetres, isWithinGreaterSydney } from './geo';

const TOWN_HALL = { lat: -33.8732, lon: 151.2061 };
const CHATSWOOD = { lat: -33.7969, lon: 151.1803 };

describe('haversineMetres', () => {
  it('is zero for the same point', () => {
    expect(haversineMetres(TOWN_HALL, TOWN_HALL)).toBe(0);
  });

  it('matches the known Town Hall to Chatswood straight-line distance', () => {
    // About 8.8 km on any map; allow a few metres for the spherical model.
    expect(haversineMetres(TOWN_HALL, CHATSWOOD)).toBeGreaterThan(8_700);
    expect(haversineMetres(TOWN_HALL, CHATSWOOD)).toBeLessThan(8_900);
  });

  it('is symmetric', () => {
    expect(haversineMetres(TOWN_HALL, CHATSWOOD)).toBeCloseTo(
      haversineMetres(CHATSWOOD, TOWN_HALL),
      6,
    );
  });
});

describe('isWithinGreaterSydney', () => {
  it.each([
    ['Sydney CBD', TOWN_HALL],
    ['Tallawong', { lat: -33.6921, lon: 150.9058 }],
    ['Gosford', { lat: -33.4245, lon: 151.3418 }],
    ['Katoomba', { lat: -33.7125, lon: 150.3119 }],
  ])('accepts %s', (_name, point) => {
    expect(isWithinGreaterSydney(point)).toBe(true);
  });

  it.each([
    ['Newcastle', { lat: -32.9267, lon: 151.7789 }],
    ['Canberra', { lat: -35.2809, lon: 149.13 }],
    ['Melbourne', { lat: -37.8136, lon: 144.9631 }],
  ])('rejects %s', (_name, point) => {
    expect(isWithinGreaterSydney(point)).toBe(false);
  });
});

describe('bearingDegrees', () => {
  it('reads 0 due north, 90 due east, 180 due south and 270 due west', () => {
    const centre = { lat: -33.87, lon: 151.2 };
    expect(bearingDegrees(centre, { lat: -33.8, lon: 151.2 })).toBeCloseTo(0, 5);
    expect(bearingDegrees(centre, { lat: -33.87, lon: 151.3 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(centre, { lat: -33.95, lon: 151.2 })).toBeCloseTo(180, 5);
    expect(bearingDegrees(centre, { lat: -33.87, lon: 151.1 })).toBeCloseTo(270, 0);
  });

  it('stays below 360', () => {
    const bearing = bearingDegrees({ lat: -33.87, lon: 151.2 }, { lat: -33.8, lon: 151.19999 });
    expect(bearing).toBeGreaterThan(359);
    expect(bearing).toBeLessThan(360);
  });

  it('points from Town Hall north-northwest towards Chatswood', () => {
    expect(bearingDegrees(TOWN_HALL, CHATSWOOD)).toBeGreaterThan(330);
    expect(bearingDegrees(TOWN_HALL, CHATSWOOD)).toBeLessThan(350);
  });
});
