import { act, renderRouter, screen, testRouter, userEvent } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import RootLayout from '@/app/_layout';
import DataUseRoute from '@/app/data-use';
import WelcomeRoute from '@/app/welcome';
import { appStorage, LIVE_DATA_CONSENT_VERSION } from '@/storage';

// This build has an API address, so live planning is possible and must be agreed to first.
jest.mock('@/api', () => ({ ...jest.requireActual('@/api'), isLivePlanningConfigured: true }));

function placeholder(name: string) {
  return function PlaceholderScreen() {
    return <Text>{name} screen</Text>;
  };
}

const ROUTES = {
  _layout: RootLayout,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': placeholder('Plan'),
  '(tabs)/car': placeholder('Car'),
  '(tabs)/saved': placeholder('Saved'),
  '(tabs)/settings': placeholder('Settings'),
  results: placeholder('Results'),
  'itinerary/[id]': placeholder('Itinerary'),
  'place-search': placeholder('Place search'),
  'trip-options': placeholder('Trip options'),
  'parked-car/confirm': placeholder('Confirm parking'),
  'parked-car/correct': placeholder('Correct parking'),
  welcome: WelcomeRoute,
  'data-use': DataUseRoute,
};

const FIRST_RUN_TITLE = 'Before your first live trip';

beforeEach(() => {
  appStorage.deleteAllData();
});

describe('live data consent', () => {
  it('shows only the explanation on first launch, and nothing is agreed yet', async () => {
    await renderRouter(ROUTES, { initialUrl: '/' });

    expect(screen.getByText(FIRST_RUN_TITLE)).toBeOnTheScreen();
    expect(screen.getByText('What is sent')).toBeOnTheScreen();
    expect(screen.queryByText('Plan screen')).not.toBeOnTheScreen();
    expect(appStorage.settings.get().liveDataConsent).toBeNull();
  });

  it('keeps every other screen closed until the person answers', async () => {
    await renderRouter(ROUTES, { initialUrl: '/results' });

    expect(screen.getByText(FIRST_RUN_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText('Results screen')).not.toBeOnTheScreen();
  });

  it('opens the app after agreeing, and records which explanation was agreed to', async () => {
    const user = userEvent.setup();
    await renderRouter(ROUTES, { initialUrl: '/' });

    await user.press(screen.getByRole('button', { name: 'Agree and continue' }));

    expect(await screen.findByText('Plan screen')).toBeOnTheScreen();
    expect(appStorage.settings.get().liveDataConsent?.version).toBe(LIVE_DATA_CONSENT_VERSION);
    expect(appStorage.settings.get().demoMode).toBe(false);
  });

  it('opens the app in demo mode without agreeing when the person prefers demo mode', async () => {
    const user = userEvent.setup();
    await renderRouter(ROUTES, { initialUrl: '/' });

    await user.press(screen.getByRole('button', { name: 'Use demo mode instead' }));

    expect(await screen.findByText('Plan screen')).toBeOnTheScreen();
    expect(appStorage.settings.get()).toMatchObject({ demoMode: true, liveDataConsent: null });
  });

  it('does not ask again on the next launch', async () => {
    appStorage.settings.acceptLiveDataConsent(new Date('2026-10-26T12:00:00.000Z'));

    await renderRouter(ROUTES, { initialUrl: '/' });

    expect(screen.getByText('Plan screen')).toBeOnTheScreen();
    expect(screen.queryByText(FIRST_RUN_TITLE)).not.toBeOnTheScreen();
  });

  it('lets the person review the agreement and withdraw it, which asks again', async () => {
    const user = userEvent.setup();
    appStorage.settings.acceptLiveDataConsent(new Date('2026-10-26T12:00:00.000Z'));
    await renderRouter(ROUTES, { initialUrl: '/' });

    await testRouter.push('/data-use');
    expect(screen.getByText('Live data use')).toBeOnTheScreen();
    expect(screen.getByText(/You agreed on 26 October 2026/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Withdraw agreement' }));

    expect(appStorage.settings.get().liveDataConsent).toBeNull();
    expect(await screen.findByText(FIRST_RUN_TITLE)).toBeOnTheScreen();
  });

  it('asks again after all data is deleted', async () => {
    appStorage.settings.acceptLiveDataConsent(new Date('2026-10-26T12:00:00.000Z'));
    await renderRouter(ROUTES, { initialUrl: '/' });
    expect(screen.getByText('Plan screen')).toBeOnTheScreen();

    await act(async () => appStorage.deleteAllData());

    expect(await screen.findByText(FIRST_RUN_TITLE)).toBeOnTheScreen();
  });

  it('asks before live trips when demo mode is turned off', async () => {
    appStorage.settings.setDemoMode(true);
    await renderRouter(ROUTES, { initialUrl: '/' });
    expect(screen.getByText('Plan screen')).toBeOnTheScreen();

    await act(async () => appStorage.settings.setDemoMode(false));

    expect(await screen.findByText(FIRST_RUN_TITLE)).toBeOnTheScreen();
  });
});
