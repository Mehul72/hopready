// Every call answers "not decided yet" until a test scripts the case it is checking, so no test
// can pass by accident on a granted permission or a real position.

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
} as const;

export const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
} as const;

const undetermined = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  expires: 'never',
} as const;

export const getForegroundPermissionsAsync = jest.fn(async () => undetermined);
export const requestForegroundPermissionsAsync = jest.fn(async () => undetermined);
export const hasServicesEnabledAsync = jest.fn(async () => true);
export const getCurrentPositionAsync = jest.fn(async (): Promise<never> => {
  throw new Error('getCurrentPositionAsync was not scripted for this test');
});
export const reverseGeocodeAsync = jest.fn(async () => []);
