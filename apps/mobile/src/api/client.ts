import {
  type Coordinate,
  type PlanRequest,
  type PlanResponse,
  planResponseSchema,
} from '@hopready/core';

import { type HttpTransport, requestJson } from './http';
import {
  type CarParkListing,
  carParksResponseSchema,
  type PlaceSearchResults,
  placeSearchResponseSchema,
} from './schemas';

// The server accepts 2 to 80 characters. Shorter text returns no results without a request, and
// search fields should set maxLength so longer text never reaches the server.
export const PLACE_QUERY_MIN_LENGTH = 2;
export const PLACE_QUERY_MAX_LENGTH = 80;

// One place for the paths, so they can follow the server if its routes move.
export const API_ROUTES = {
  plan: '/v1/plan',
  placeSearch: '/v1/places/search',
  carParks: '/v1/carparks',
} as const;

export interface ApiClient {
  plan: (request: PlanRequest, signal?: AbortSignal) => Promise<PlanResponse>;
  // Search text and the location hint go in a POST body, not the URL, so proxies and server
  // access logs never record them.
  searchPlaces: (
    query: string,
    near?: Coordinate | null,
    signal?: AbortSignal,
  ) => Promise<PlaceSearchResults>;
  carParks: (signal?: AbortSignal) => Promise<CarParkListing>;
}

export function createApiClient(transport: HttpTransport): ApiClient {
  return {
    plan: (request, signal) =>
      requestJson(transport, {
        method: 'POST',
        path: API_ROUTES.plan,
        body: request,
        schema: planResponseSchema,
        signal,
      }),
    searchPlaces: async (query, near, signal) => {
      const trimmed = query.trim();
      // Nothing is sent, so nothing in this answer can be the server's sample data.
      if (trimmed.length < PLACE_QUERY_MIN_LENGTH) {
        return { mode: 'live', results: [], unavailable: [] };
      }
      return requestJson(transport, {
        method: 'POST',
        path: API_ROUTES.placeSearch,
        body: { query: trimmed, near: near ?? null },
        schema: placeSearchResponseSchema,
        signal,
      });
    },
    carParks: (signal) =>
      requestJson(transport, {
        method: 'GET',
        path: API_ROUTES.carParks,
        schema: carParksResponseSchema,
        signal,
      }),
  };
}
