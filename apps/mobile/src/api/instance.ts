import { getNetworkStateAsync } from 'expo-network';

import { appStorage, hasLiveDataConsent } from '@/storage';

import { createApiClient } from './client';
import { readApiBaseUrl } from './config';

export async function isDeviceOffline(): Promise<boolean> {
  const state = await getNetworkStateAsync();
  return state.isConnected === false || state.isInternetReachable === false;
}

const baseUrl = readApiBaseUrl();

// False when this build has no API address, so live mode can only report "not configured".
export const isLivePlanningConfigured = baseUrl !== null;

// The client the app uses: the build's API address, React Native's fetch, and this install's ID.
export const apiClient = createApiClient({
  baseUrl,
  fetch: (url, init) => fetch(url, init),
  installId: () => appStorage.settings.get().installId,
  isOffline: isDeviceOffline,
  hasLiveDataConsent: () => hasLiveDataConsent(appStorage.settings.get()),
});
