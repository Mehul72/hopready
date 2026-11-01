import { forwardRef, type ReactNode, useEffect, useImperativeHandle } from 'react';
import { View, type ViewProps } from 'react-native';

// react-native-maps draws with MapKit, which Jest cannot run. These plain views pass every prop
// through, so a test can check colours, dash patterns and labels, and camera calls are recorded.

export const fitToCoordinates = jest.fn();
export const animateToRegion = jest.fn();
export const getCamera = jest.fn(async () => ({
  center: { latitude: 0, longitude: 0 },
  heading: 0,
  pitch: 0,
  zoom: 10,
}));

interface MockMapProps extends ViewProps {
  children?: ReactNode;
  onMapReady?: () => void;
}

const MapView = forwardRef<
  {
    fitToCoordinates: typeof fitToCoordinates;
    animateToRegion: typeof animateToRegion;
    getCamera: typeof getCamera;
  },
  MockMapProps
>(function MockMapView({ children, onMapReady, ...props }, ref) {
  useImperativeHandle(ref, () => ({ fitToCoordinates, animateToRegion, getCamera }));
  // The real map reports ready once MapKit has loaded; here that is straight after mounting.
  useEffect(() => {
    onMapReady?.();
  }, [onMapReady]);
  return (
    <View {...props} testID="map-view">
      {children}
    </View>
  );
});

export function Marker({ children, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} testID="map-marker">
      {children}
    </View>
  );
}

export function Polyline(props: ViewProps) {
  return <View {...props} testID="map-polyline" />;
}

export const PROVIDER_DEFAULT = undefined;
export default MapView;
