import { openBrowserAsync } from 'expo-web-browser';
import { Alert } from 'react-native';

import { errorName } from '../saved/storage-writes';

// Opens a web page (parking rules, alerts, privacy policy) in an in-app Safari view, so the person
// comes straight back to HopReady. `pageName` is for the log and the alert, never the URL.
export async function openLink(url: string, pageName: string): Promise<void> {
  try {
    await openBrowserAsync(url);
  } catch (error) {
    console.warn(`HopReady: could not open ${pageName} (${errorName(error)}).`);
    Alert.alert(`Couldn't open ${pageName}`, 'Check your connection, then try again.');
  }
}
