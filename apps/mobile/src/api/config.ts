import Constants from 'expo-constants';
import { z } from 'zod';

// http is allowed for a local API on the simulator (http://localhost:8787); release builds set https.
const BASE_URL_PATTERN = /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;

const extraSchema = z.object({
  apiBaseUrl: z.string().nullable().optional(),
});

// Reads `extra.apiBaseUrl` from the app config (EXPO_PUBLIC_API_BASE_URL at build time).
// Returns null when it is missing or malformed: live mode then reports "not configured".
export function readApiBaseUrl(extra: unknown = Constants.expoConfig?.extra): string | null {
  const parsed = extraSchema.safeParse(extra ?? {});
  const value = parsed.success ? parsed.data.apiBaseUrl?.trim() : undefined;
  if (!value) return null;
  if (!BASE_URL_PATTERN.test(value)) {
    console.warn('HopReady: EXPO_PUBLIC_API_BASE_URL is not an http(s) URL, so live mode is off.');
    return null;
  }
  return value.replace(/\/+$/, '');
}

const HTTPS_URL_PATTERN = /^https:\/\/[^\s/?#]+(\/[^\s]*)?$/;

const linksSchema = z.object({
  privacyPolicyUrl: z.string().regex(HTTPS_URL_PATTERN).optional().catch(undefined),
  supportUrl: z.string().regex(HTTPS_URL_PATTERN).optional().catch(undefined),
});

export interface SupportLinks {
  // Null when the build has no valid https address: the screen then leaves the link out rather
  // than open something broken.
  privacyPolicyUrl: string | null;
  supportUrl: string | null;
}

// The privacy policy and support pages from the app config (HOPREADY_PRIVACY_POLICY_URL and
// HOPREADY_SUPPORT_URL at build time), for Settings and App Store links.
export function readSupportLinks(extra: unknown = Constants.expoConfig?.extra): SupportLinks {
  const parsed = linksSchema.safeParse(extra ?? {});
  return {
    privacyPolicyUrl: (parsed.success && parsed.data.privacyPolicyUrl) || null,
    supportUrl: (parsed.success && parsed.data.supportUrl) || null,
  };
}

const buildOptionsSchema = z.object({
  demoScenarios: z.boolean().optional().catch(undefined),
});

// The sample situations that fake failures (a timeout, a cancelled service) are for development
// and internal test builds (HOPREADY_DEMO_SCENARIOS=1). Store builds keep demo mode without them,
// so nobody mistakes a staged outage for a real one.
export function readDemoScenariosAllowed(
  extra: unknown = Constants.expoConfig?.extra,
  developmentBuild: boolean = __DEV__,
): boolean {
  if (developmentBuild) return true;
  const parsed = buildOptionsSchema.safeParse(extra ?? {});
  return parsed.success && parsed.data.demoScenarios === true;
}
