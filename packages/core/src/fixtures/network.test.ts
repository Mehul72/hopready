import { describe, expect, it } from 'vitest';

import { PARK_AND_RIDE_CATALOGUE } from '../data/park-and-ride';
import { haversineMetres, isWithinGreaterSydney } from '../geo';
import { minutesAt, NETWORK_ROUTES, type RunTimeProfile } from './routes';
import { minutesFromClockText } from './service-calendar';
import { NETWORK_STOPS, STOPS, WALKING_LINKS } from './stops';

const PROFILES: RunTimeProfile[] = ['quiet', 'day', 'peak'];

describe('demo network data', () => {
  it('has unique stop ids and stops inside Greater Sydney', () => {
    const ids = NETWORK_STOPS.map((stop) => stop.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const stop of NETWORK_STOPS) expect(isWithinGreaterSydney(stop.coordinate)).toBe(true);
  });

  it('serves every documented car park station except Schofields, which is on a line it leaves out', () => {
    const networkIds = new Set(NETWORK_STOPS.map((stop) => stop.id));
    const missing = PARK_AND_RIDE_CATALOGUE.filter(
      (carPark) => !networkIds.has(carPark.station.stopId),
    );

    expect(missing.map((carPark) => carPark.name)).toEqual(['Schofields']);
  });

  it('places each car park station within 100 m of the same stop in the network', () => {
    const byId = new Map(NETWORK_STOPS.map((stop) => [stop.id, stop]));
    for (const carPark of PARK_AND_RIDE_CATALOGUE) {
      const stop = byId.get(carPark.station.stopId);
      if (!stop) continue;
      expect(haversineMetres(stop.coordinate, carPark.station.coordinate)).toBeLessThan(100);
    }
  });

  it('runs every trip forward in time, for every time of day', () => {
    for (const route of NETWORK_ROUTES) {
      for (const direction of route.directions) {
        for (const profile of PROFILES) {
          const minutes = direction.calls.map((call) => minutesAt(call, profile));
          expect(minutes[0]).toBe(0);
          minutes
            .slice(1)
            .forEach((minute, index) => expect(minute).toBeGreaterThan(minutes[index]!));
        }
      }
    }
  });

  it('uses only real stops in each route and mirrors the stops in the other direction', () => {
    const known = new Set(NETWORK_STOPS);
    for (const route of NETWORK_ROUTES) {
      const [outbound, inbound] = route.directions;
      const outboundStops = outbound!.calls.map((call) => call.stop);
      const inboundStops = inbound!.calls.map((call) => call.stop);
      for (const stop of [...outboundStops, ...inboundStops]) expect(known.has(stop)).toBe(true);
      expect(outboundStops[0]).toBe(inboundStops.at(-1));
      expect(outboundStops.at(-1)).toBe(inboundStops[0]);
    }
  });

  it('gives platforms only as platform numbers', () => {
    for (const route of NETWORK_ROUTES) {
      for (const direction of route.directions) {
        for (const call of direction.calls) {
          if (call.platform !== null) expect(call.platform).toMatch(/^\d{1,2}$/);
        }
      }
    }
  });

  it('has headway bands in order, without overlaps, at least a minute apart', () => {
    for (const route of NETWORK_ROUTES) {
      for (const direction of route.directions) {
        const patterns = Object.values(direction.service);
        for (const bands of patterns) {
          let previousEnd = 0;
          for (const band of bands) {
            const from = minutesFromClockText(band.from);
            const until = minutesFromClockText(band.until);
            expect(from).toBeGreaterThanOrEqual(previousEnd);
            expect(until).toBeGreaterThan(from);
            expect(band.everyMinutes).toBeGreaterThanOrEqual(1);
            previousEnd = until;
          }
        }
      }
    }
  });

  it('links only stops a short walk apart', () => {
    for (const [first, second] of WALKING_LINKS) {
      expect(NETWORK_STOPS).toContain(first);
      expect(NETWORK_STOPS).toContain(second);
      expect(haversineMetres(first.coordinate, second.coordinate)).toBeLessThan(1_000);
    }
  });

  it('runs the M1 from Tallawong to Chatswood in 38 minutes, as the GTFS feed does', () => {
    const [towardsSydenham] = NETWORK_ROUTES.find((route) => route.id === 'M1')!.directions;
    const chatswood = towardsSydenham!.calls.find((call) => call.stop === STOPS.chatswood)!;

    expect(minutesAt(chatswood, 'day')).toBe(38);
  });
});
