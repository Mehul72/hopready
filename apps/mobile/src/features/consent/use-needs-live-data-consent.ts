import { isLivePlanningConfigured } from '@/api';
import { hasLiveDataConsent, useSettings } from '@/storage';

// True while the app must ask before anything is sent: this build can plan live trips, demo mode
// is off, and the person has not agreed to the current explanation.
export function useNeedsLiveDataConsent(): boolean {
  const settings = useSettings();
  return isLivePlanningConfigured && !settings.demoMode && !hasLiveDataConsent(settings);
}
