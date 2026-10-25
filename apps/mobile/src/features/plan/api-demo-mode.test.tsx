import { systemClock, toIso } from '@hopready/core';
import { createDemoProviders } from '@hopready/core/fixtures';
import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen, testRouter, within } from 'expo-router/testing-library';
import { z } from 'zod';

import {
  type ApiClient,
  apiClient,
  type ApiMode,
  API_ROUTES,
  createApiClient,
  type FetchRequest,
  type FetchResponse,
} from '@/api';
import SavedTab from '@/app/(tabs)/saved';
import ConfirmParkingRoute from '@/app/parked-car/confirm';
import { DEMO_BANNER_MESSAGE, DEMO_BANNER_TITLE } from '@/components/demo-mode-banner';
import { appStorage } from '@/storage';
import { jsonResponse } from '@/test-support/fetch';
import { OCCUPANCY_NOT_CHECKED } from '@/trip/trip-service';

import { DEMO_SEARCH_ATTRIBUTION } from '../saved/place-picker-sheet';
import { DEMO_ATTRIBUTION, LIVE_ATTRIBUTION } from './place-search-screen';
import { APP_ROUTES } from './test-harness';

// The one-line label on a sheet with a fixed layout, and the full banner in a scrolling sheet.
const DEMO_LINE = `${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`;
const DEMO_BANNER = `Demo. ${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`;

// The plan screens, with the real Saved tab and parking sheet: they also search places and list
// car parks.
const ROUTES = {
  ...APP_ROUTES,
  '(tabs)/saved': SavedTab,
  'parked-car/confirm': ConfirmParkingRoute,
};

async function openApp(path: string) {
  await renderRouter(ROUTES, { initialUrl: '/' });
  await testRouter.push(path);
}

const searchBodySchema = z.object({ query: z.string() });

// A local HopReady API (`pnpm api:dev`) answering from the same fixtures as the app's demo mode.
// Started with HOPREADY_MODE=demo it says 'demo' in every answer; `mode` is what it says.
function localApi(mode: ApiMode): ApiClient {
  const providers = createDemoProviders({ clock: systemClock });
  const answer = async (url: string, init: FetchRequest): Promise<FetchResponse> => {
    if (url.endsWith(API_ROUTES.placeSearch)) {
      const { query } = searchBodySchema.parse(JSON.parse(init.body ?? 'null'));
      const results = await providers.places.search(query, null, init.signal);
      return jsonResponse(200, { mode, results, unavailable: [] });
    }
    if (url.endsWith(API_ROUTES.carParks)) {
      const facilities = await providers.carParks.listFacilities(init.signal);
      return jsonResponse(200, {
        mode,
        fetchedAt: toIso(systemClock.now()),
        carParks: facilities.map((facility) => ({ ...facility, occupancy: OCCUPANCY_NOT_CHECKED })),
        notices: [],
      });
    }
    return jsonResponse(404, { error: { code: 'not-found' } });
  };
  return createApiClient({
    baseUrl: 'http://localhost:8787',
    fetch: answer,
    installId: () => appStorage.settings.get().installId,
    isOffline: async () => false,
  });
}

// The app's own client asks `api` instead of this build's API address, which tests do not have.
function answerFrom(api: ApiClient) {
  jest.spyOn(apiClient, 'searchPlaces').mockImplementation(api.searchPlaces);
  jest.spyOn(apiClient, 'carParks').mockImplementation(api.carParks);
}

beforeEach(() => {
  // Deleting everything leaves demo mode off, so the app is in live mode.
  appStorage.deleteAllData();
});

afterEach(() => {
  appStorage.deleteAllData();
});

describe('live mode against an API serving demo data', () => {
  it('labels the place search sheet and its credit line as demo', async () => {
    answerFrom(localApi('demo'));
    const user = userEvent.setup();
    await openApp('/place-search?field=destination');
    const sheet = screen.getByTestId('place-search-screen');
    expect(within(sheet).queryByLabelText(DEMO_LINE)).not.toBeOnTheScreen();

    await user.type(screen.getByLabelText('Search for a place or stop'), 'Chatswood');

    expect(await screen.findByTestId('search-attribution')).toHaveTextContent(DEMO_ATTRIBUTION);
    expect(within(sheet).getByLabelText(DEMO_LINE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^1 Example Street, Chatswood/ })).toBeOnTheScreen();
    expect(appStorage.settings.get().demoMode).toBe(false);
  });

  it('labels the place picker on the Saved tab and its credit line as demo', async () => {
    answerFrom(localApi('demo'));
    const user = userEvent.setup();
    await openApp('/saved');
    await user.press(screen.getByRole('button', { name: 'Home, Not set' }));
    const picker = screen.getByTestId('place-picker');
    expect(within(picker).queryByLabelText(DEMO_BANNER)).not.toBeOnTheScreen();

    await user.type(within(picker).getByLabelText('Search for a place'), 'Rouse Hill');

    expect(await within(picker).findByText(DEMO_SEARCH_ATTRIBUTION)).toBeOnTheScreen();
    expect(within(picker).getByLabelText(DEMO_BANNER)).toBeOnTheScreen();
  });

  it('labels the car park list in trip options as demo', async () => {
    answerFrom(localApi('demo'));
    const user = userEvent.setup();
    await openApp('/trip-options');
    const sheet = screen.getByTestId('trip-options-screen');
    expect(within(sheet).queryByLabelText(DEMO_BANNER)).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: /^Preferred car park, None/ }));

    expect(await screen.findByTestId('car-park-picker')).toBeOnTheScreen();
    expect(within(sheet).getByLabelText(DEMO_BANNER)).toBeOnTheScreen();
  });

  it('labels the Park&Ride list on the parking sheet as demo', async () => {
    answerFrom(localApi('demo'));
    const user = userEvent.setup();
    await openApp('/parked-car/confirm');
    const sheet = screen.getByTestId('confirm-parking');
    expect(within(sheet).queryByLabelText(DEMO_BANNER)).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Choose another car park' }));

    expect(
      await screen.findByRole('radio', { name: 'Kellyville (north), Kellyville Station' }),
    ).toBeOnTheScreen();
    expect(within(sheet).getByLabelText(DEMO_BANNER)).toBeOnTheScreen();
  });

  it('drops the label once the API answers with live data again', async () => {
    answerFrom(localApi('demo'));
    const user = userEvent.setup();
    await openApp('/place-search?field=destination');
    const input = screen.getByLabelText('Search for a place or stop');
    await user.type(input, 'Chatswood');
    expect(await screen.findByText(DEMO_ATTRIBUTION)).toBeOnTheScreen();

    // The same server, restarted without HOPREADY_MODE=demo.
    answerFrom(localApi('live'));
    await user.clear(input);
    await user.type(input, 'Rouse Hill');

    expect(await screen.findByText(LIVE_ATTRIBUTION)).toBeOnTheScreen();
    expect(screen.queryByLabelText(DEMO_LINE)).not.toBeOnTheScreen();
  });
});
