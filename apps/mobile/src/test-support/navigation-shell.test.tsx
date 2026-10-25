import { act, renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

// Lives outside src/app: every file there becomes a route and ships in the app bundle.
import TabsLayout from '@/app/(tabs)/_layout';
import RootLayout from '@/app/_layout';
import { DEMO_BANNER_MESSAGE, DEMO_BANNER_TITLE } from '@/components/demo-mode-banner';
import { appStorage } from '@/storage';

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
};

beforeEach(() => {
  appStorage.deleteAllData();
});

describe('navigation shell', () => {
  it('opens on the Plan tab and reaches every declared route', async () => {
    await renderRouter(ROUTES, { initialUrl: '/' });
    expect(screen.getByText('Plan screen')).toBeOnTheScreen();

    await testRouter.push('/results');
    expect(screen.getByText('Results screen')).toBeOnTheScreen();
    await testRouter.push('/itinerary/abc123');
    expect(screen.getByText('Itinerary screen')).toBeOnTheScreen();
    await testRouter.push('/place-search');
    await testRouter.push('/trip-options');
    await testRouter.push('/parked-car/confirm');
    await testRouter.push('/parked-car/correct');
    expect(screen.getByText('Correct parking screen')).toBeOnTheScreen();
  });

  it('shows the demo strip above every screen while demo mode is on', async () => {
    await renderRouter(ROUTES, { initialUrl: '/' });
    const spoken = `${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`;
    expect(screen.queryByLabelText(spoken)).not.toBeOnTheScreen();

    await act(async () => appStorage.settings.setDemoMode(true));
    expect(screen.getByLabelText(spoken)).toBeOnTheScreen();

    await testRouter.push('/results');
    expect(screen.getByLabelText(spoken)).toBeOnTheScreen();
  });
});
