import type { ConfigContext, ExpoConfig } from 'expo/config';

// Build-time settings come from the environment (EAS environment variables or a local shell),
// never from this file. Nothing here is secret: the app holds no provider keys.

const LOCATION_PURPOSE =
  'HopReady uses your location to start trips from where you are, to show where you are on its maps, and to list nearby places first when you search.';

// Calm deep teal from the HopReady icon (src/theme/colours.ts), and its dark counterpart.
const SPLASH_BACKGROUND = '#0E6F6E';
const SPLASH_BACKGROUND_DARK = '#0B3B3A';

const DEFAULT_PRIVACY_POLICY_URL = 'https://mehul72.github.io/hopready/privacy/';
const DEFAULT_SUPPORT_URL = 'https://mehul72.github.io/hopready/support/';
// The owner's Apple Developer team (individual membership), read from their provisioning profiles.
const DEFAULT_APPLE_TEAM_ID = 'MACDPWQG37';

function easExtra(): { eas: { projectId: string } } | Record<string, never> {
  const projectId = process.env.EAS_PROJECT_ID;
  return projectId ? { eas: { projectId } } : {};
}

// The XCUITest target is only for local end-to-end runs; store builds never carry it.
function uiTestPlugins(): string[] {
  return process.env.HOPREADY_IOS_UI_TESTS === '1' ? ['./plugins/with-ios-ui-tests'] : [];
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HopReady',
  slug: 'hopready',
  scheme: 'hopready',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/icon-1024.png',
  ios: {
    bundleIdentifier: process.env.HOPREADY_IOS_BUNDLE_ID ?? 'au.hopready.HopReady',
    appleTeamId: process.env.HOPREADY_APPLE_TEAM_ID ?? DEFAULT_APPLE_TEAM_ID,
    supportsTablet: false,
    // iOS 26 and later use the layered Icon Composer icon; earlier versions use the PNG above.
    icon: './assets/brand/hopready.icon',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_PURPOSE,
      // HopReady only uses the encryption built into iOS (HTTPS), which is exempt.
      ITSAppUsesNonExemptEncryption: false,
      // The navigation apps the drive leg can be handed to, checked with canOpenURL.
      LSApplicationQueriesSchemes: ['comgooglemaps', 'waze'],
      // HTTPS only. Local networking stays open so a development build can reach a laptop's API.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
    },
    // Apple rejects uploads without reasons for these APIs, which React Native and Expo modules use.
    // Static CocoaPods dependencies do not always contribute their own manifests (Expo's guide).
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      // Matches the App Privacy answers in docs/release.md (option A): places and searches leave
      // the phone for providers that may log requests. Never linked to the person, never tracking.
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeSearchHistory',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
      ],
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: SPLASH_BACKGROUND,
        image: './assets/brand/splash-mark.png',
        imageWidth: 160,
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
    ...uiTestPlugins(),
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
    // Lets internal builds stage failures in demo mode; store builds leave it off.
    demoScenarios: process.env.HOPREADY_DEMO_SCENARIOS === '1',
    ...easExtra(),
  },
});
