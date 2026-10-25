import { getNetworkStateAsync } from 'expo-network';

import { appStorage } from '@/storage';

import { createApiClient } from './client';
import { readApiBaseUrl } from './config';

export async function isDeviceOffline(): Promise<boolean> {
  const state = await getNetworkStateAsync();
  return state.isConnected === false || state.isInternetReachable === false;
}

// The client the app uses: the build's API address, React Native's fetch, and this install's ID.
export const apiClient = createApiClient({
  baseUrl: readApiBaseUrl(),
  fetch: (url, init) => fetch(url, init),
  installId: () => appStorage.settings.get().installId,
  isOffline: isDeviceOffline,
});
