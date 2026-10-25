import type { ConfigContext, ExpoConfig } from 'expo/config';

// Build-time settings come from the environment (EAS environment variables or a local shell),
// never from this file. Nothing here is secret: the app holds no provider keys.

const LOCATION_PURPOSE =
  'HopReady uses your location only when you ask, to start a trip from where you are.';

// Calm deep teal from the HopReady icon (src/theme/colours.ts), and its dark counterpart.
const SPLASH_BACKGROUND = '#0E6F6E';
const SPLASH_BACKGROUND_DARK = '#0B3B3A';

const DEFAULT_PRIVACY_POLICY_URL = 'https://mehul72.github.io/hopready/privacy/';
const DEFAULT_SUPPORT_URL = 'https://mehul72.github.io/hopready/support/';

function easExtra(): { eas: { projectId: string } } | Record<string, never> {
  const projectId = process.env.EAS_PROJECT_ID;
  return projectId ? { eas: { projectId } } : {};
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HopReady',
  slug: 'hopready',
  scheme: 'hopready',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: process.env.HOPREADY_IOS_BUNDLE_ID ?? 'au.hopready.HopReady',
    supportsTablet: false,
    icon: './assets/expo.icon',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_PURPOSE,
      // HopReady only uses the encryption built into iOS (HTTPS), which is exempt.
      ITSAppUsesNonExemptEncryption: false,
      // The navigation apps the drive leg can be handed to, checked with canOpenURL.
      LSApplicationQueriesSchemes: ['comgooglemaps', 'waze'],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: SPLASH_BACKGROUND,
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: SPLASH_BACKGROUND_DARK },
      },
    ],
    'expo-sqlite',
    // Listed explicitly because prebuild applies expo-location even when unlisted, and its
    // defaults would add "Always", motion and precise-location prompts HopReady never uses.
    [
      'expo-location',
      {
        locationWhenInUsePermission: LOCATION_PURPOSE,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        locationFullAccuracyPermission: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // Null leaves live mode "not configured"; the app then offers demo mode and never switches
    // to it by itself.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? null,
    privacyPolicyUrl: process.env.HOPREADY_PRIVACY_POLICY_URL ?? DEFAULT_PRIVACY_POLICY_URL,
    supportUrl: process.env.HOPREADY_SUPPORT_URL ?? DEFAULT_SUPPORT_URL,
    ...easExtra(),
  },
});
