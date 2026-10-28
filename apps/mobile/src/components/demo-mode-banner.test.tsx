import { act, render, screen } from '@testing-library/react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { appStorage } from '@/storage';
import { COMPACT_MAX_FONT_SCALE } from '@/theme';

import { AppText } from './app-text';
import { DEMO_BANNER_MESSAGE, DEMO_BANNER_TITLE, DemoModeBanner } from './demo-mode-banner';
import { Screen } from './screen';
import { ScreenPresentationProvider } from './screen-presentation';

const SPOKEN = `${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`;

beforeEach(() => {
  appStorage.deleteAllData();
});

describe('DemoModeBanner', () => {
  it('shows nothing in live mode', async () => {
    await render(<DemoModeBanner placement="window-top" />);
    expect(screen.queryByLabelText(SPOKEN)).not.toBeOnTheScreen();
  });

  it('appears as soon as demo mode is turned on, and goes when it is turned off', async () => {
    await render(<DemoModeBanner placement="window-top" />);

    await act(async () => appStorage.settings.setDemoMode(true));
    expect(screen.getByLabelText(SPOKEN)).toBeOnTheScreen();

    await act(async () => appStorage.settings.setDemoMode(false));
    expect(screen.queryByLabelText(SPOKEN)).not.toBeOnTheScreen();
  });
});

describe('Screen', () => {
  it('adds the demo banner inside modal sheets, which cover the window strip', async () => {
    appStorage.settings.setDemoMode(true);
    await render(
      <ScreenPresentationProvider presentation="modal">
        <Screen>
          <AppText>Choose a place</AppText>
        </Screen>
      </ScreenPresentationProvider>,
    );
    expect(
      screen.getByLabelText(`Demo. ${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`),
    ).toBeOnTheScreen();
    expect(screen.getByText('Choose a place')).toBeOnTheScreen();
  });

  it('uses the one-line label, capped in size, on a sheet with a fixed layout', async () => {
    appStorage.settings.setDemoMode(true);
    await render(
      <ScreenPresentationProvider presentation="modal">
        <Screen scroll={false}>
          <AppText>Choose a place</AppText>
        </Screen>
      </ScreenPresentationProvider>,
    );

    expect(screen.getByLabelText(SPOKEN)).toBeOnTheScreen();
    expect(screen.getByText('Sample data, not live')).toHaveProp(
      'maxFontSizeMultiplier',
      COMPACT_MAX_FONT_SCALE,
    );
    expect(
      screen.queryByLabelText(`Demo. ${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`),
    ).not.toBeOnTheScreen();
  });

  it('starts fixed content below a floating navigation header', async () => {
    await render(
      <HeaderHeightContext value={96}>
        <Screen scroll={false} testID="fixed">
          <AppText>Choose a place</AppText>
        </Screen>
      </HeaderHeightContext>,
    );

    expect(screen.getByTestId('fixed-content')).toHaveStyle({ paddingTop: 96 });
  });

  it('leaves the banner to the window strip on ordinary screens', async () => {
    appStorage.settings.setDemoMode(true);
    await render(
      <Screen>
        <AppText>Plan</AppText>
      </Screen>,
    );
    expect(
      screen.queryByLabelText(`Demo. ${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`),
    ).not.toBeOnTheScreen();
  });
});
