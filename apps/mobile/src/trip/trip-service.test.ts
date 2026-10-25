import {
  type Clock,
  type Coordinate,
  type PlanRequest,
  savedParkingSpotSchema,
} from '@hopready/core';
import { createDemoProviders, DEMO_PLACES } from '@hopready/core/fixtures';

import {
  type ApiClient,
  ApiError,
  type ApiErrorKind,
  type ApiMode,
  type CarParkListing,
  type PlaceSearchResults,
} from '@/api';
import type { AppSettings } from '@/storage';
import { PLACES, planRequest, planResponse } from '@/test-support/trips';

import { createTripService, OCCUPANCY_NOT_CHECKED, withAllowedDemoScenario } from './trip-service';

jest.mock('@hopready/core/fixtures', () => {
  const actual = jest.requireActual('@hopready/core/fixtures');
  return { ...actual, createDemoProviders: jest.fn(actual.createDemoProviders) };
});

const createDemoProvidersSpy = jest.mocked(createDemoProviders);

// Tuesday 27 October 2026, 7.30 am in Sydney: a weekday morning in the demo timetable.
const NOW = new Date('2026-10-26T20:30:00.000Z');
const clock: Clock = { now: () => NOW };

// An API that fails with `failure`, or answers in `mode` (an API started with HOPREADY_MODE=demo
// answers in demo mode).
function fakeApi(failure?: ApiError, mode: ApiMode = 'live'): jest.Mocked<ApiClient> {
  const answer = <T>(value: T) => (failure ? Promise.reject(failure) : Promise.resolve(value));
  return {
    plan: jest.fn((request: PlanRequest, signal?: AbortSignal) =>
      answer(planResponse([], { mode })),
    ),
    searchPlaces: jest.fn(
      (
        query: string,
        near?: Coordinate | null,
        signal?: AbortSignal,
      ): Promise<PlaceSearchResults> => answer({ mode, results: [], unavailable: [] }),
    ),
    carParks: jest.fn((signal?: AbortSignal): Promise<CarParkListing> =>
      answer({ mode, carParks: [], notices: [] }),
    ),
  };
}

function serviceWith(
  api: ApiClient,
  settings: Pick<AppSettings, 'demoMode' | 'demoScenario'>,
  onApiAnswer: (mode: ApiMode) => void = () => {},
) {
  return createTripService({ api, settings: () => settings, clock, onApiAnswer });
}

const LIVE = { demoMode: false, demoScenario: null } as const;
const DEMO = { demoMode: true, demoScenario: null } as const;

function demoRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return planRequest({
    origin: DEMO_PLACES.rouseHillHome,
    destination: DEMO_PLACES.chatswoodOffice,
    time: { type: 'depart', at: '2026-10-26T20:35:00.000Z' },
    ...overrides,
  });
}

describe('live mode never falls back to demo data', () => {
  it.each<ApiErrorKind>([
    'not-configured',
    'offline',
    'unreachable',
    'timeout',
    'server',
    'rate-limited',
  ])('passes a %s failure through when planning', async (kind) => {
    const failure = new ApiError(kind, { suggestsDemoMode: kind === 'not-configured' });
    const service = serviceWith(fakeApi(failure), LIVE);

    await expect(service.planTrip(planRequest())).rejects.toBe(failure);
    expect(createDemoProvidersSpy).not.toHaveBeenCalled();
  });

  it('passes failures through for place search and car parks too', async () => {
    const failure = new ApiError('not-configured', { suggestsDemoMode: true });
    const service = serviceWith(fakeApi(failure), LIVE);

    await expect(service.searchPlaces('Chatswood', null)).rejects.toBe(failure);
    await expect(service.listCarParks()).rejects.toBe(failure);
    expect(createDemoProvidersSpy).not.toHaveBeenCalled();
  });

  it('suggests turning on demo mode when live planning is not set up, without doing it', async () => {
    const service = serviceWith(
      fakeApi(new ApiError('not-configured', { suggestsDemoMode: true })),
      LIVE,
    );
    const error = await service.planTrip(planRequest()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'not-configured', suggestsDemoMode: true });
    expect(service.currentMode()).toBe('live');
  });

  it('sends live requests to the API with the caller signal', async () => {
    const api = fakeApi();
    const controller = new AbortController();
    await serviceWith(api, LIVE).planTrip(planRequest(), { signal: controller.signal });
    expect(api.plan).toHaveBeenCalledWith(planRequest(), controller.signal);
  });
});

describe('demo mode', () => {
  it('plans on the device with the fixtures and labels the answer as demo', async () => {
    const api = fakeApi();
    const response = await serviceWith(api, DEMO).planTrip(demoRequest());

    expect(response.mode).toBe('demo');
    expect(response.itineraries.length).toBeGreaterThan(0);
    expect(api.plan).not.toHaveBeenCalled();
    expect(createDemoProvidersSpy).toHaveBeenCalledWith({ clock, scenario: undefined });
  });

  it('uses the scenario chosen in settings and describes its failure as demo', async () => {
    const service = serviceWith(fakeApi(), { demoMode: true, demoScenario: 'rate-limited' });
    // Public transport only, so the simulated outage leaves the planner nothing to offer.
    const transitOnly = demoRequest({ access: { transit: true, drive: false, dropOff: false } });

    const error = await service.planTrip(transitOnly).catch((caught: unknown) => caught);

    expect(createDemoProvidersSpy).toHaveBeenCalledWith({ clock, scenario: 'rate-limited' });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 30,
      suggestsDemoMode: false,
      message: 'Demo mode: the sample travel service is busy. Try again in 30 seconds.',
    });
  });

  it('searches the demo places, never the API', async () => {
    const api = fakeApi();
    const { mode, results, unavailable } = await serviceWith(api, DEMO).searchPlaces(
      'Chatswood',
      null,
    );
    expect(mode).toBe('demo');
    expect(results.length).toBeGreaterThan(0);
    expect(unavailable).toEqual([]);
    expect(api.searchPlaces).not.toHaveBeenCalled();
  });

  it('lists demo car parks the way the live API does, with counts left to planning', async () => {
    const api = fakeApi();
    const listing = await serviceWith(api, DEMO).listCarParks();
    expect(listing.mode).toBe('demo');
    expect(listing.carParks.length).toBeGreaterThan(0);
    expect(listing.carParks.every((carPark) => carPark.occupancy === OCCUPANCY_NOT_CHECKED)).toBe(
      true,
    );
    expect(listing.notices).toEqual([]);
    expect(api.carParks).not.toHaveBeenCalled();
  });
});

describe('request checks, the same in both modes', () => {
  it.each([
    ['live', LIVE],
    ['demo', DEMO],
  ] as const)(
    'rejects a trip outside Greater Sydney before any call in %s mode',
    async (_, settings) => {
      const api = fakeApi();
      const error = await serviceWith(api, settings)
        .planTrip(planRequest({ destination: PLACES.melbourne }))
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ kind: 'outside-coverage' });
      expect(api.plan).not.toHaveBeenCalled();
      expect(createDemoProvidersSpy).not.toHaveBeenCalled();
    },
  );

  it('rejects a parked car outside Greater Sydney for "Take me home"', async () => {
    const error = await serviceWith(fakeApi(), LIVE)
      .planTrip(
        planRequest({
          trip: {
            kind: 'return-via-car',
            parkedCar: {
              location: PLACES.melbourne,
              carParkId: null,
              confirmedAt: NOW.toISOString(),
            },
          },
        }),
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'outside-coverage' });
  });

  it('rejects a request the server would refuse, such as too many saved spots', async () => {
    const spot = savedParkingSpotSchema.parse({
      id: 's',
      name: 'Spot',
      coordinate: { lat: -33.7, lon: 151 },
    });
    const error = await serviceWith(fakeApi(), LIVE)
      .planTrip(planRequest({ savedParkingSpots: Array.from({ length: 11 }, () => spot) }))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'rejected' });
  });

  it('returns no place results for text too short to search, in either mode', async () => {
    const api = fakeApi();
    expect(await serviceWith(api, DEMO).searchPlaces(' C ', null)).toEqual({
      mode: 'demo',
      results: [],
      unavailable: [],
    });
    expect(await serviceWith(api, LIVE).searchPlaces('C', null)).toEqual({
      mode: 'live',
      results: [],
      unavailable: [],
    });
    expect(api.searchPlaces).not.toHaveBeenCalled();
    expect(createDemoProvidersSpy).not.toHaveBeenCalled();
  });
});

describe('the mode the API answers in', () => {
  it('passes on the mode of every answer the API gives', async () => {
    const onApiAnswer = jest.fn();
    const service = serviceWith(fakeApi(undefined, 'demo'), LIVE, onApiAnswer);

    await service.planTrip(planRequest());
    await service.searchPlaces('Chatswood', null);
    await service.listCarParks();
    // The same server, restarted without HOPREADY_MODE=demo.
    await serviceWith(fakeApi(), LIVE, onApiAnswer).searchPlaces('Chatswood', null);

    expect(onApiAnswer.mock.calls).toEqual([['demo'], ['demo'], ['demo'], ['live']]);
  });

  it('passes on nothing the API did not answer', async () => {
    const onApiAnswer = jest.fn();
    const api = fakeApi(undefined, 'demo');

    await serviceWith(api, DEMO, onApiAnswer).planTrip(demoRequest());
    await serviceWith(api, DEMO, onApiAnswer).searchPlaces('Chatswood', null);
    await serviceWith(api, DEMO, onApiAnswer).listCarParks();
    await serviceWith(api, LIVE, onApiAnswer).searchPlaces('C', null);
    await expect(
      serviceWith(fakeApi(new ApiError('offline')), LIVE, onApiAnswer).listCarParks(),
    ).rejects.toMatchObject({ kind: 'offline' });

    expect(onApiAnswer).not.toHaveBeenCalled();
  });
});

describe('demo scenarios in store builds', () => {
  it('ignores a scenario chosen in a development build', () => {
    const chosen = { demoMode: true, demoScenario: 'no-route' } as const;

    expect(withAllowedDemoScenario(chosen, false)).toEqual({ demoMode: true, demoScenario: null });
    expect(withAllowedDemoScenario(chosen, true)).toBe(chosen);
  });
});
