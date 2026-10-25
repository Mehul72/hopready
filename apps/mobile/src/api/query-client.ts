import { focusManager, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { isApiError } from './errors';

const MAX_AUTOMATIC_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;

// One retry for network trouble and 5xx answers. A 4xx, a "not configured" server or a response
// the app cannot read gives the same answer again, so those are shown straight away.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_AUTOMATIC_RETRIES && isApiError(error) && error.isRetryable;
}

// Full jitter, so phones recovering from the same outage do not all retry at the same moment.
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  return random() * Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay: (attempt) => retryDelayMs(attempt),
        // Requests always go out and fail with a typed "offline" error, instead of pausing
        // silently until the network comes back.
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

// React Native has no window focus, so "focused" means the app is in the foreground. Stale
// queries then refetch when the person comes back to the app.
export function useQueryFocusFollowsAppState(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => subscription.remove();
  }, []);
}
