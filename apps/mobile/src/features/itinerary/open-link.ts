import { Alert, Linking } from 'react-native';

import { errorName } from '../saved/storage-writes';

// Opens a web page (parking rules, alerts, privacy policy) in Safari. An in-app browser would let
// people browse the web inside HopReady, which the App Store age rating says the app does not do.
// `pageName` is for the log and the alert, never the URL.
export async function openLink(url: string, pageName: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn(`HopReady: could not open ${pageName} (${errorName(error)}).`);
    Alert.alert(`Couldn't open ${pageName}`, "Safari didn't open. Try again.");
  }
}
