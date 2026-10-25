import { useSyncExternalStore } from 'react';

import type { ApiMode } from '@/api';
import { appStorage } from '@/storage';

// The mode the HopReady API gave with its latest answer, or null before it has answered. An API
// started with HOPREADY_MODE=demo serves sample data while the app is in live mode, and screens
// must label that data as demo just as they do in the app's own demo mode.
export interface ApiAnswerModeStore {
  get: () => ApiMode | null;
  subscribe: (listener: () => void) => () => void;
  record: (mode: ApiMode) => void;
  reset: () => void;
}

export function createApiAnswerModeStore(): ApiAnswerModeStore {
  let mode: ApiMode | null = null;
  const listeners = new Set<() => void>();

  function update(next: ApiMode | null) {
    if (next === mode) return;
    mode = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    get: () => mode,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record: update,
    reset: () => update(null),
  };
}

export const apiAnswerMode = createApiAnswerModeStore();

// "Delete all data" also clears the cached searches and car parks, so no answer is left to label.
appStorage.onDataDeleted(() => apiAnswerMode.reset());

export function useApiAnswerMode(): ApiMode | null {
  return useSyncExternalStore(apiAnswerMode.subscribe, apiAnswerMode.get, apiAnswerMode.get);
}
