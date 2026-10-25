import type { ImperativeRouter } from 'expo-router';

// A sheet opened from a link has nothing beneath it to go back to, so it falls back to the Plan
// tab instead of leaving the person stuck.
export function closeSheet(router: Pick<ImperativeRouter, 'back' | 'canGoBack' | 'replace'>): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
