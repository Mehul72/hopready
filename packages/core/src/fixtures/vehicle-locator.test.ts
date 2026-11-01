import { describe, expect, it } from 'vitest';

import { haversineMetres } from '../geo';
import { transitLegsOf } from '../itinerary';
import type { TrackedService, VehicleLookup } from '../vehicles';
import { createDemoProviders } from './index';
import { DEMO_PLACES } from './places';
import type { DemoScenario } from './scenarios';
import { scenarioSettings } from './scenarios';
import { timetableWindowAround, type ScheduledTrip } from './timetable';
import { createDemoVehicleLocator } from './vehicle-locator';

const TUESDAY_0800_MS = Date.parse('2026-10-26T21:00:00Z');
const MINUTE_MS = 60_000;

const signal = () => new AbortController().signal;

function locateAt(
  nowMs: number,
  services: TrackedService[],
  scenario: DemoScenario = 'normal',
): Promise<VehicleLookup[]> {
  const locator = createDemoVehicleLocator({ clock: { now: () => new Date(nowMs) }, scenario });
  return locator.locate(services, signal());
}

// A running bus trip from the Tuesday morning timetable with at least three stops.
function busTrip(): ScheduledTrip {
  const window = timetableWindowAround(TUESDAY_0800_MS, scenarioSettings('normal').timetable);
  const trip = window.trips.find(
    (candidate) =>
      candidate.route.mode === 'bus' &&
      !candidate.cancelled &&
      candidate.timesMs.length >= 3 &&
      candidate.timesMs[0]! > TUESDAY_0800_MS,
  );
  if (!trip) throw new Error('The demo timetable has no Tuesday morning bus');
  return trip;
}

function serviceOf(trip: ScheduledTrip): TrackedService {
  return { mode: trip.route.mode, realtimeTripId: `demo-${trip.key}` };
}

function located(lookup: VehicleLookup | undefined) {
  if (lookup?.status !== 'located') throw new Error(`Expected located, got ${lookup?.status}`);
  return lookup;
}

describe('createDemoVehicleLocator', () => {
  it('puts a running vehicle between the stops its timetable says it is between', async () => {
    const trip = busTrip();
    const [firstMs, secondMs] = [trip.timesMs[0]!, trip.timesMs[1]!];
    const [first, second] = trip.direction.calls.map((call) => call.stop.coordinate);
    const halfwayMs = firstMs + (secondMs - firstMs) / 2;

    const [lookup] = await locateAt(halfwayMs, [serviceOf(trip)]);
    const vehicle = located(lookup);

    const fromFirst = haversineMetres(first!, vehicle.position);
    const toSecond = haversineMetres(vehicle.position, second!);
    expect(fromFirst + toSecond).toBeCloseTo(haversineMetres(first!, second!), -1);
    expect(fromFirst).toBeCloseTo(toSecond, -1);
    expect(vehicle.observedAt).toBe(new Date(halfwayMs).toISOString());
    expect(vehicle.servingTrip).toBe('this-trip');
    expect(vehicle.bearingDegrees).toBeGreaterThanOrEqual(0);
    expect(vehicle.bearingDegrees).toBeLessThan(360);
  });

  it('moves a vehicle on to the next pair of stops once it passes the second', async () => {
    const trip = busTrip();
    const [, second, third] = trip.direction.calls.map((call) => call.stop.coordinate);
    const [, secondMs, thirdMs] = trip.timesMs;
    const [lookup] = await locateAt(secondMs! + (thirdMs! - secondMs!) / 2, [serviceOf(trip)]);
    const vehicle = located(lookup);

    const fromSecond = haversineMetres(second!, vehicle.position);
    const toThird = haversineMetres(vehicle.position, third!);
    expect(fromSecond + toThird).toBeCloseTo(haversineMetres(second!, third!), -1);
  });

  it('shows a vehicle waiting at its first stop up to 10 minutes before it leaves', async () => {
    const trip = busTrip();
    const first = trip.direction.calls[0]!.stop.coordinate;

    const waiting = located(
      (await locateAt(trip.timesMs[0]! - 10 * MINUTE_MS, [serviceOf(trip)]))[0],
    );
    expect(waiting.position).toEqual(first);

    const [tooEarly] = await locateAt(trip.timesMs[0]! - 11 * MINUTE_MS, [serviceOf(trip)]);
    expect(tooEarly?.status).toBe('not-located');
  });

  it('has no vehicle once the trip has reached its last stop', async () => {
    const trip = busTrip();
    const [finished] = await locateAt(trip.timesMs.at(-1)!, [serviceOf(trip)]);
    expect(finished?.status).toBe('not-located');
  });

  it('finds nothing for an id that is not a demo trip, or a trip under the wrong mode', async () => {
    const trip = busTrip();
    const lookups = await locateAt(trip.timesMs[0]!, [
      { mode: 'bus', realtimeTripId: '2703224' },
      { mode: 'bus', realtimeTripId: 'demo-no-such-trip' },
      { mode: 'train', realtimeTripId: `demo-${trip.key}` },
    ]);
    expect(lookups.map((lookup) => lookup.status)).toEqual([
      'not-located',
      'not-located',
      'not-located',
    ]);
  });

  it('answers each service in the order given, saying which modes have no feed', async () => {
    const trip = busTrip();
    const services: TrackedService[] = [
      { mode: 'ferry', realtimeTripId: 'demo-ferry' },
      serviceOf(trip),
      { mode: 'light-rail', realtimeTripId: 'demo-l2' },
    ];
    const lookups = await locateAt(trip.timesMs[0]!, services);
    expect(lookups.map(({ mode, realtimeTripId }) => ({ mode, realtimeTripId }))).toEqual(services);
    expect(lookups.map((lookup) => lookup.status)).toEqual([
      'not-tracked',
      'located',
      'not-tracked',
    ]);
  });

  it('reads the feeds as down in the scenarios where the demo trip planner fails', async () => {
    const trip = busTrip();
    for (const scenario of ['provider-timeout', 'rate-limited'] as const) {
      const [lookup] = await locateAt(trip.timesMs[0]!, [serviceOf(trip)], scenario);
      expect(lookup?.status).toBe('unavailable');
    }
  });

  it('reports an aborted call as a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    const locator = createDemoVehicleLocator({
      clock: { now: () => new Date(TUESDAY_0800_MS) },
      scenario: 'normal',
    });
    await expect(locator.locate([serviceOf(busTrip())], controller.signal)).rejects.toMatchObject({
      failure: 'timeout',
    });
  });

  it('locates the services of a journey the demo trip planner planned', async () => {
    const now = new Date(TUESDAY_0800_MS);
    const demo = createDemoProviders({ clock: { now: () => now } });
    const [journey] = await demo.transit.planJourneys(
      {
        from: DEMO_PLACES.rouseHillHome,
        to: DEMO_PLACES.barangarooOffice,
        time: { type: 'depart', at: now.toISOString() },
        maxJourneys: 1,
        walkingSpeed: 'normal',
        excludedModes: [],
      },
      signal(),
    );
    const first = transitLegsOf(journey!.legs)[0]!;
    expect(first.realtimeTripId).not.toBeNull();

    const [lookup] = await createDemoVehicleLocator({
      clock: { now: () => new Date(Date.parse(first.start) + MINUTE_MS) },
      scenario: 'normal',
    }).locate([{ mode: first.mode, realtimeTripId: first.realtimeTripId! }], signal());
    expect(lookup?.status).toBe('located');
  });
});
