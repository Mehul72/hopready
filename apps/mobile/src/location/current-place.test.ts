import * as Location from 'expo-location';

import {
  CURRENT_LOCATION_LABEL,
  labelFromAddress,
  POSITION_TIMEOUT_MS,
  requestCurrentPlace,
} from './current-place';

const mocked = {
  request: jest.mocked(Location.requestForegroundPermissionsAsync),
  servicesEnabled: jest.mocked(Location.hasServicesEnabledAsync),
  position: jest.mocked(Location.getCurrentPositionAsync),
  reverseGeocode: jest.mocked(Location.reverseGeocodeAsync),
};

function permission(granted: boolean, canAskAgain: boolean): Location.LocationPermissionResponse {
  return {
    granted,
    canAskAgain,
    status: granted ? Location.PermissionStatus.GRANTED : Location.PermissionStatus.DENIED,
    expires: 'never',
  };
}

function positionAt(latitude: number, longitude: number): Location.LocationObject {
  return {
    coords: {
      latitude,
      longitude,
      altitude: null,
      accuracy: 20,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.parse('2026-10-26T20:55:00.000Z'),
  };
}

function address(
  parts: Partial<Location.LocationGeocodedAddress>,
): Location.LocationGeocodedAddress {
  return {
    city: null,
    district: null,
    streetNumber: null,
    street: null,
    region: null,
    subregion: null,
    country: null,
    postalCode: null,
    name: null,
    isoCountryCode: null,
    timezone: null,
    formattedAddress: null,
    ...parts,
  };
}

const ROUSE_HILL = positionAt(-33.6789, 150.9152);

describe('requestCurrentPlace', () => {
  it('asks for permission only when called', async () => {
    expect(mocked.request).not.toHaveBeenCalled();
    mocked.request.mockResolvedValueOnce(permission(false, true));
    await requestCurrentPlace();
    expect(mocked.request).toHaveBeenCalledTimes(1);
  });

  it('reports a denial and whether iOS will ask again, without reading the position', async () => {
    mocked.request.mockResolvedValueOnce(permission(false, false));
    await expect(requestCurrentPlace()).resolves.toEqual({ status: 'denied', canAskAgain: false });
    expect(mocked.position).not.toHaveBeenCalled();
  });

  it('names the street when asked to, once permission is granted', async () => {
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.position.mockResolvedValueOnce(ROUSE_HILL);
    mocked.reverseGeocode.mockResolvedValueOnce([
      address({
        name: '12 Example St',
        streetNumber: '12',
        street: 'Example St',
        city: 'Rouse Hill',
      }),
    ]);

    await expect(requestCurrentPlace({ lookUpStreetName: true })).resolves.toEqual({
      status: 'granted',
      place: {
        name: '12 Example St, Rouse Hill',
        coordinate: { lat: -33.6789, lon: 150.9152 },
        kind: 'current-location',
      },
    });
    expect(mocked.position).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('falls back to "Current location" when the geocoder fails', async () => {
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.position.mockResolvedValueOnce(ROUSE_HILL);
    mocked.reverseGeocode.mockRejectedValueOnce(new Error('Geocoder rate limited'));

    const result = await requestCurrentPlace({ lookUpStreetName: true });

    expect(result).toEqual({
      status: 'granted',
      place: expect.objectContaining({ name: CURRENT_LOCATION_LABEL, kind: 'current-location' }),
    });
  });

  it('sends the position nowhere unless asked to name the street', async () => {
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.position.mockResolvedValueOnce(ROUSE_HILL);

    const result = await requestCurrentPlace();

    expect(result).toEqual({
      status: 'granted',
      place: expect.objectContaining({ name: CURRENT_LOCATION_LABEL, kind: 'current-location' }),
    });
    expect(mocked.reverseGeocode).not.toHaveBeenCalled();
  });

  it('does not use a position outside Greater Sydney', async () => {
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.position.mockResolvedValueOnce(positionAt(-37.8183, 144.9671));

    await expect(requestCurrentPlace()).resolves.toEqual({ status: 'outside-coverage' });
    expect(mocked.reverseGeocode).not.toHaveBeenCalled();
  });

  it('gives up on a position fix after 10 seconds', async () => {
    jest.useFakeTimers();
    try {
      mocked.request.mockResolvedValueOnce(permission(true, true));
      mocked.position.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = requestCurrentPlace();
      await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('says location services are off instead of waiting for a fix', async () => {
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.servicesEnabled.mockResolvedValueOnce(false);
    await expect(requestCurrentPlace()).resolves.toEqual({
      status: 'unavailable',
      reason: 'services-disabled',
    });
    expect(mocked.position).not.toHaveBeenCalled();
  });

  it('reports a failed fix and logs only the error code', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocked.request.mockResolvedValueOnce(permission(true, true));
    mocked.position.mockRejectedValueOnce(
      Object.assign(new Error('Location unavailable near -33.6789, 150.9152'), {
        code: 'ERR_CURRENT_LOCATION_IS_UNAVAILABLE',
      }),
    );

    await expect(requestCurrentPlace()).resolves.toEqual({
      status: 'unavailable',
      reason: 'position-failed',
    });
    expect(warn).toHaveBeenCalledWith(
      'HopReady: no position fix (ERR_CURRENT_LOCATION_IS_UNAVAILABLE).',
    );
  });
});

describe('labelFromAddress', () => {
  it('builds the street and suburb from the parts when there is no name', () => {
    expect(
      labelFromAddress(address({ streetNumber: '1', street: 'Help St', city: 'Chatswood' })),
    ).toBe('1 Help St, Chatswood');
  });

  it('does not repeat a suburb that is also the name', () => {
    expect(labelFromAddress(address({ name: 'Chatswood', city: 'Chatswood' }))).toBe('Chatswood');
  });

  it('returns null when iOS gives nothing usable', () => {
    expect(labelFromAddress(undefined)).toBeNull();
    expect(labelFromAddress(address({}))).toBeNull();
  });
});
