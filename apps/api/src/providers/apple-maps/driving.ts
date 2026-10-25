import {
  haversineMetres,
  mapSettled,
  ProviderError,
  type Coordinate,
  type DriveEstimate,
  type DriveRoute,
  type DriveTime,
  type DrivingProvider,
} from '@hopready/core';

import { appleCoordinate, encodeQuery, toCoordinate, type AppleMapsClient } from './client';
import {
  directionsResponseSchema,
  etaResponseSchema,
  type AppleDirections,
  type AppleEta,
} from './schemas';

// Apple's /v1/etas accepts "no more than 10 destinations" per call.
const MAX_ETA_DESTINATIONS = 10;
const ETA_CALL_CONCURRENCY = 2;
// Apple echoes each destination it answers for. The echo may come back rounded (its other
// endpoints return 32-bit floats), so it only has to land this close to what was sent.
const ETA_ECHO_TOLERANCE_METRES = 100;

interface EtaDestination {
  query: string;
  coordinate: Coordinate;
}

export function createAppleDrivingProvider(client: AppleMapsClient): DrivingProvider {
  return {
    name: 'apple-maps',

    async estimateDrives(origin, destinations, time, signal) {
      const timeParams = appleTimeParams(time);
      const originQuery = appleCoordinate(origin);
      // Repeated destinations are asked about once and share the answer.
      const unique = new Map<string, EtaDestination>();
      for (const coordinate of destinations) {
        const query = appleCoordinate(coordinate);
        if (!unique.has(query)) unique.set(query, { query, coordinate });
      }

      const batches = inBatches([...unique.values()], MAX_ETA_DESTINATIONS);
      const outcomes = await mapSettled(batches, ETA_CALL_CONCURRENCY, async (batch) => {
        const response = await client.get(
          '/v1/etas',
          encodeQuery({
            origin: originQuery,
            destinations: batch.map((destination) => destination.query).join('|'),
            transportType: 'Automobile',
            ...timeParams,
          }),
          (body) => etaResponseSchema.parse(body),
          signal,
        );
        return matchEtas(batch, response.etas ?? []);
      });

      const estimateByQuery = new Map<string, DriveEstimate | null>();
      for (const outcome of outcomes) {
        // A failed batch has no answer at all, which is not the same as "no drivable route".
        if (outcome.status === 'rejected') throw outcome.reason;
        for (const [query, estimate] of outcome.value) estimateByQuery.set(query, estimate);
      }
      return destinations.map(
        (coordinate) => estimateByQuery.get(appleCoordinate(coordinate)) ?? null,
      );
    },

    async routeDrive(from, to, time, signal) {
      const response = await client.get(
        '/v1/directions',
        encodeQuery({
          origin: appleCoordinate(from),
          destination: appleCoordinate(to),
          transportType: 'Automobile',
          ...appleTimeParams(time),
        }),
        (body) => directionsResponseSchema.parse(body),
        signal,
      );
      return toDriveRoute(response);
    },
  };
}

function appleTimeParams(time: DriveTime): { departureDate: string } | { arrivalDate: string } {
  const at = new Date(time.at);
  if (Number.isNaN(at.getTime())) {
    throw new ProviderError('apple-maps', 'rejected-request', 'The drive time is not a valid date');
  }
  // Apple documents whole-second UTC times such as 2023-04-15T16:42:00Z.
  const appleDate = at.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return time.type === 'depart' ? { departureDate: appleDate } : { arrivalDate: appleDate };
}

function inBatches<Item>(items: readonly Item[], size: number): Item[][] {
  const batches: Item[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

// Results can be partial or in any order, so each one is matched to the destination it echoes.
// A destination with no usable result maps to null.
function matchEtas(
  batch: readonly EtaDestination[],
  etas: readonly AppleEta[],
): Map<string, DriveEstimate | null> {
  const closestMatch = new Map<string, { estimate: DriveEstimate; offsetMetres: number }>();
  for (const eta of etas) {
    const estimate = toDriveEstimate(eta);
    if (!eta.destination || !estimate) continue;
    const echoed = toCoordinate(eta.destination);
    const nearest = nearestDestination(batch, echoed);
    if (!nearest || nearest.offsetMetres > ETA_ECHO_TOLERANCE_METRES) continue;
    const existing = closestMatch.get(nearest.destination.query);
    if (!existing || nearest.offsetMetres < existing.offsetMetres) {
      closestMatch.set(nearest.destination.query, {
        estimate,
        offsetMetres: nearest.offsetMetres,
      });
    }
  }
  return new Map(
    batch.map((destination) => [
      destination.query,
      closestMatch.get(destination.query)?.estimate ?? null,
    ]),
  );
}

function nearestDestination(
  batch: readonly EtaDestination[],
  echoed: Coordinate,
): { destination: EtaDestination; offsetMetres: number } | undefined {
  let nearest: { destination: EtaDestination; offsetMetres: number } | undefined;
  for (const destination of batch) {
    const offsetMetres = haversineMetres(destination.coordinate, echoed);
    if (!nearest || offsetMetres < nearest.offsetMetres) nearest = { destination, offsetMetres };
  }
  return nearest;
}

// expectedTravelTimeSeconds includes traffic; staticTravelTimeSeconds does not and is used only
// when the traffic estimate is missing. Without a time or a distance there is no usable estimate.
function toDriveEstimate(eta: AppleEta): DriveEstimate | null {
  const trafficSeconds = eta.expectedTravelTimeSeconds;
  const durationSeconds = trafficSeconds ?? eta.staticTravelTimeSeconds;
  if (durationSeconds === undefined || eta.distanceMeters === undefined) return null;
  return {
    durationSeconds: Math.round(durationSeconds),
    distanceMetres: Math.round(eta.distanceMeters),
    trafficAware: trafficSeconds !== undefined,
  };
}

function toDriveRoute(response: AppleDirections): DriveRoute {
  const route = response.routes?.[0];
  if (!route) {
    throw new ProviderError('apple-maps', 'rejected-request', 'Apple Maps found no driving route');
  }
  if (route.durationSeconds === undefined || route.distanceMeters === undefined) {
    throw new ProviderError(
      'apple-maps',
      'malformed-response',
      'Apple Maps sent a route without its duration or distance',
    );
  }
  return {
    durationSeconds: Math.round(route.durationSeconds),
    distanceMetres: Math.round(route.distanceMeters),
    // Every request carries a departure or arrival time, and Apple then predicts traffic for it.
    trafficAware: true,
    path: routePath(route.stepIndexes ?? [], response),
  };
}

// Step paths are self-contained: each one starts on the last point of the step before it, and
// Apple leaves removing that shared point to the client.
function routePath(stepIndexes: readonly number[], response: AppleDirections): Coordinate[] {
  const path: Coordinate[] = [];
  for (const stepIndex of stepIndexes) {
    const pathIndex = response.steps?.[stepIndex]?.stepPathIndex;
    const stepPath = pathIndex === undefined ? undefined : response.stepPaths?.[pathIndex];
    if (!stepPath) {
      throw new ProviderError(
        'apple-maps',
        'malformed-response',
        'Apple Maps sent a route step that points at no path',
      );
    }
    for (const point of stepPath) {
      const previous = path.at(-1);
      if (previous?.lat === point.latitude && previous.lon === point.longitude) continue;
      path.push(toCoordinate(point));
    }
  }
  return path;
}
