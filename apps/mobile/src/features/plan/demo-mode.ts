import { appStorage } from '@/storage';

// Only ever called from a person's tap: live mode never switches to sample data by itself.
// Returns false when the setting could not be saved, so the screen can stay as it is.
export function turnOnDemoMode(): boolean {
  try {
    appStorage.settings.setDemoMode(true);
    return true;
  } catch (error) {
    console.warn(
      `HopReady: could not turn on demo mode (${error instanceof Error ? error.name : 'unknown'}).`,
    );
    return false;
  }
}
