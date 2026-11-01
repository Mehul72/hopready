import { render, screen, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import type { VehicleRow } from '../itinerary/vehicle-text';
import { LivePositionsPanel } from './live-positions-panel';

const METRO: VehicleRow = {
  key: 'metro|demo-M1',
  legIndex: 2,
  mode: 'metro',
  title: 'Metro M1 towards Sydenham',
  status: { text: 'Not on its way yet', spoken: 'Not on its way yet' },
  place: null,
};

describe('LivePositionsPanel', () => {
  it('takes two fifths of the screen at most, its heading scrolling with the rows', async () => {
    await render(
      <LivePositionsPanel rows={[METRO]} checkedAt={null} demo onShow={() => undefined} />,
    );

    // At the largest text sizes the heading and caption alone are tall: capping only the rows
    // left the map a sliver above the panel.
    expect(screen.getByTestId('live-positions')).toHaveStyle({
      maxHeight: Dimensions.get('window').height * 0.4,
    });
    const list = screen.getByTestId('live-positions-list');
    expect(within(list).getByRole('header', { name: 'Live positions' })).toBeOnTheScreen();
    expect(within(list).getByText('Sample positions from the demo timetable')).toBeOnTheScreen();
    expect(within(list).getByTestId('live-position-2')).toBeOnTheScreen();
  });
});
