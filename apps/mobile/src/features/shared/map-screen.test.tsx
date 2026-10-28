import { screen } from 'expo-router/testing-library';

import { renderApp } from '../plan/test-harness';

describe('the full-screen map', () => {
  it('says there is nothing to show when it is opened before a trip is planned', async () => {
    await renderApp('/map');

    expect(await screen.findByTestId('map-empty')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'No map to show' })).toBeOnTheScreen();
  });
});
