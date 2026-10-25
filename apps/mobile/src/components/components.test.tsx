import { render, screen, userEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AccessibilityInfo } from 'react-native';

import { animateToRegion, fitToCoordinates } from '@/test-support/mocks/react-native-maps';
import { parkAndRideItinerary } from '@/test-support/trips';
import { MIN_TOUCH_TARGET } from '@/theme';

import { Banner } from './banner';
import { Button } from './button';
import { Chip } from './chip';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { LoadingState } from './loading-state';
import { ModeIcon } from './mode-icon';
import { SegmentedControl } from './segmented-control';
import { Stepper } from './stepper';
import { TimingBadge } from './timing-badge';
import { TripMap } from './trip-map';

describe('Button', () => {
  it('is a button named by its label', async () => {
    const onPress = jest.fn();
    await render(<Button label="Plan trip" onPress={onPress} />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Plan trip' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reports busy and ignores presses while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Plan trip" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Plan trip' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    await userEvent.setup().press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps a hint for what the button does when the label is not enough', async () => {
    await render(
      <Button
        label="Remove"
        accessibilityLabel="Remove Office"
        accessibilityHint="Deletes this favourite"
        variant="destructive"
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove Office' })).toHaveProp(
      'accessibilityHint',
      'Deletes this favourite',
    );
  });
});

describe('IconButton', () => {
  it('is named by its label and is at least 44 points square', async () => {
    await render(<IconButton symbol="xmark" accessibilityLabel="Close" onPress={jest.fn()} />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveStyle({ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET });
  });
});

describe('Chip', () => {
  it('is a toggle that reports and flips its checked state', async () => {
    const onToggle = jest.fn();
    await render(<Chip label="Bus" selected={false} onToggle={onToggle} />);
    const chip = screen.getByRole('togglebutton', { name: 'Bus' });
    expect(chip).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
    await userEvent.setup().press(chip);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows a tick when selected, so selection is not colour alone', async () => {
    await render(<Chip label="Bus" selected onToggle={jest.fn()} />);
    expect(screen.getByTestId('symbol:checkmark')).toBeOnTheScreen();
  });
});

describe('SegmentedControl', () => {
  it('is a set of radio buttons that name their group, with the selected one checked', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        accessibilityLabel="Time"
        options={[
          { value: 'depart', label: 'Leave at' },
          { value: 'arrive', label: 'Arrive by' },
        ]}
        value="depart"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Leave at' })).toBeChecked();
    expect(screen.getByHintText('Time, 2 of 2')).toBe(
      screen.getByRole('radio', { name: 'Arrive by' }),
    );
    expect(screen.getByRole('radio', { name: 'Arrive by' })).not.toBeChecked();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Arrive by' }));
    expect(onChange).toHaveBeenCalledWith('arrive');
  });
});

describe('Stepper', () => {
  it('is adjustable with the value spoken in minutes', async () => {
    await render(
      <Stepper label="Parking buffer" value={8} min={0} max={30} onChange={jest.fn()} />,
    );
    expect(screen.getByRole('adjustable', { name: 'Parking buffer' })).toHaveAccessibilityValue({
      min: 0,
      max: 30,
      now: 8,
      text: '8 minutes',
    });
  });

  it('labels its buttons and stops at the limits', async () => {
    const onChange = jest.fn();
    await render(
      <Stepper label="Transfer buffer" value={20} min={0} max={20} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Increase Transfer buffer' })).toBeDisabled();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Decrease Transfer buffer' }));
    expect(onChange).toHaveBeenCalledWith(19);
  });
});

describe('Banner', () => {
  it('speaks what kind of notice it is, not just its colour', async () => {
    await render(
      <Banner tone="warning" title="Timetable only" message="Live times are not available." />,
    );
    expect(
      screen.getByLabelText('Warning. Timetable only. Live times are not available.'),
    ).toBeOnTheScreen();
  });

  it('keeps its action as a separate button', async () => {
    const onPress = jest.fn();
    await render(
      <Banner tone="error" message="Couldn't refresh." action={{ label: 'Try again', onPress }} />,
    );
    await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ModeIcon', () => {
  it('names the mode for VoiceOver', async () => {
    await render(<ModeIcon mode="train" />);
    expect(screen.getByRole('image', { name: 'Train' })).toBeOnTheScreen();
  });

  it('can be named more precisely and show its label', async () => {
    await render(<ModeIcon mode="metro" showLabel accessibilityLabel="Metro M1" />);
    expect(screen.getByRole('image', { name: 'Metro M1' })).toBeOnTheScreen();
    expect(screen.getByText('Metro')).toBeOnTheScreen();
  });
});

describe('TimingBadge', () => {
  it.each([
    ['realtime', 'Live', 'Live time from the operator'],
    ['scheduled', 'Timetable', 'Timetable time, not live'],
    ['estimated', 'Estimate', 'Estimated time'],
  ] as const)('labels %s times as "%s"', async (timing, label, spoken) => {
    await render(<TimingBadge timing={timing} />);
    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByLabelText(spoken)).toBeOnTheScreen();
  });
});

describe('ListRow', () => {
  it('reads as one button with its title, subtitle and value', async () => {
    await render(
      <ListRow title="Max walk" subtitle="Each walking leg" value="15 min" onPress={jest.fn()} />,
    );
    expect(
      screen.getByRole('button', { name: 'Max walk, Each walking leg, 15 min' }),
    ).toBeOnTheScreen();
  });
});

describe('states', () => {
  it('LoadingState is one busy progress element', async () => {
    await render(<LoadingState accessibilityLabel="Loading trip options" />);
    expect(screen.getByRole('progressbar', { name: 'Loading trip options' })).toBeBusy();
  });

  it('EmptyState gives its title as a heading', async () => {
    await render(<EmptyState title="No favourites yet" message="Star a place to keep it here." />);
    expect(screen.getByRole('header', { name: 'No favourites yet' })).toBeOnTheScreen();
  });

  it('ErrorState announces the problem and offers a retry', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onRetry = jest.fn();
    await render(<ErrorState message="You're offline." onRetry={onRetry} />);
    expect(announce).toHaveBeenCalledWith("Couldn't load this. You're offline.");
    await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('TripMap', () => {
  const itinerary = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' });

  it('gives VoiceOver a summary of the route', async () => {
    await render(<TripMap itinerary={itinerary} />);
    expect(
      screen.getByRole('image', { name: /^Map of the trip from 12 Example St, Rouse Hill/ }),
    ).toBeOnTheScreen();
  });

  it('draws walking dashed, uses mode colours and labels each marker', async () => {
    await render(<TripMap itinerary={itinerary} />);
    const lines = screen.getAllByTestId('map-polyline');
    expect(lines.map((line) => line.props.lineDashPattern)).toEqual([
      undefined,
      [6, 6],
      [1, 7],
      [6, 6],
    ]);
    expect(lines[0]?.props.strokeColor).toBe('#334155');
    expect(lines[2]?.props.strokeColor).toBe('#00718A');
    expect(
      screen.getAllByTestId('map-marker').map((marker) => marker.props.accessibilityLabel),
    ).toEqual([
      'Start: 12 Example St, Rouse Hill',
      'Car park: Tallawong P1',
      'Destination: 1 Help St, Chatswood',
    ]);
  });

  it('frames the route above a covering sheet and keeps the legal link clear of it', async () => {
    await render(<TripMap itinerary={itinerary} bottomInset={200} />);
    expect(screen.getByTestId('map-view')).toHaveProp('mapPadding', {
      top: 0,
      right: 0,
      bottom: 200,
      left: 0,
    });
    expect(fitToCoordinates).toHaveBeenCalledWith(
      expect.arrayContaining([{ latitude: -33.6789, longitude: 150.9152 }]),
      expect.objectContaining({ edgePadding: { top: 48, right: 48, bottom: 248, left: 48 } }),
    );
  });

  it('centres on a single place instead of zooming in as far as the map goes', async () => {
    await render(
      <TripMap
        points={[
          {
            id: 'car',
            kind: 'parked-car',
            coordinate: { lat: -33.69305, lon: 150.90526 },
            label: 'Your car',
          },
        ]}
      />,
    );
    expect(animateToRegion).toHaveBeenCalledWith({
      latitude: -33.69305,
      longitude: 150.90526,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
    expect(fitToCoordinates).not.toHaveBeenCalled();
  });

  it('shows the blue dot only when location access was already granted', async () => {
    const getPermission = jest.mocked(Location.getForegroundPermissionsAsync);
    getPermission.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      status: Location.PermissionStatus.GRANTED,
      expires: 'never',
    });
    await render(<TripMap itinerary={itinerary} />);
    expect(await screen.findByTestId('map-view')).toHaveProp('showsUserLocation', true);
    expect(jest.mocked(Location.requestForegroundPermissionsAsync)).not.toHaveBeenCalled();
  });

  it('leaves the blue dot off when access has not been granted', async () => {
    await render(<TripMap itinerary={itinerary} />);
    expect(screen.getByTestId('map-view')).toHaveProp('showsUserLocation', false);
  });
});
