// Online by default; a test that needs "offline" overrides the next answer.
export const getNetworkStateAsync = jest.fn(async () => ({
  type: 'WIFI',
  isConnected: true,
  isInternetReachable: true,
}));
