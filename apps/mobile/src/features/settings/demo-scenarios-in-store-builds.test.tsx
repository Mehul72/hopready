import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { appStorage } from '@/storage';

import { freezeClockAt, renderApp, WEEKDAY_MORNING } from '../itinerary/testing';

// A store build: demo mode is offered, the sample situations that stage failures are not.
jest.mock('@/api', () => ({
  ...jest.requireActual('@/api'),
  readDemoScenariosAllowed: () => false,
}));

beforeEach(() => {
  freezeClockAt(WEEKDAY_MORNING);
  appStorage.deleteAllData();
});

afterEach(() => {
  jest.useRealTimers();
});

it('turns demo mode on without offering staged failures', async () => {
  await renderApp('/settings');

  await fireEvent(screen.getByRole('switch', { name: 'Demo mode' }), 'valueChange', true);

  expect(appStorage.settings.get().demoMode).toBe(true);
  expect(screen.getByText('Demo mode is on')).toBeOnTheScreen();
  expect(screen.queryByText('Sample situation')).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('radio', { name: /^Public transport times out/ }),
  ).not.toBeOnTheScreen();
});
