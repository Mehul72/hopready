import { z } from 'zod';

import { LOG_LEVELS, type LogLevel } from './logger';

export type ApiMode = 'live' | 'demo';

export interface TfnswSettings {
  apiKey: string;
}

export interface AppleMapsSettings {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface ApiConfig {
  mode: ApiMode;
  logLevel: LogLevel;
  // Null when the key is missing: that provider is then reported as missing, never replaced.
  tfnsw: TfnswSettings | null;
  appleMaps: AppleMapsSettings | null;
  // Names of the provider settings that are not set. Values never leave this module.
  missingSettings: string[];
  dailyCallBudgets: { tfnsw: number; appleMaps: number };
  planDeadlineMs: number;
}

export class ConfigError extends Error {
  readonly settings: readonly string[];

  constructor(settings: readonly string[]) {
    super(`These settings have invalid values: ${settings.join(', ')}`);
    this.name = 'ConfigError';
    this.settings = settings;
  }
}

// `KEY=` in .dev.vars or an empty dashboard variable means "not set", not "set to nothing".
export function blankAsUnset(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const optionalText = z.preprocess(blankAsUnset, z.string().optional());

function wholeNumber(min: number, max: number, fallback: number) {
  return z.preprocess(blankAsUnset, z.coerce.number().int().min(min).max(max).default(fallback));
}

const envSchema = z.object({
  HOPREADY_MODE: z.preprocess(blankAsUnset, z.enum(['live', 'demo']).default('live')),
  TFNSW_API_KEY: optionalText,
  APPLE_MAPS_TEAM_ID: optionalText,
  APPLE_MAPS_KEY_ID: optionalText,
  APPLE_MAPS_PRIVATE_KEY: optionalText,
  LOG_LEVEL: z.preprocess(blankAsUnset, z.enum(LOG_LEVELS).default('info')),
  TFNSW_DAILY_CALL_BUDGET: wholeNumber(1, 10_000_000, 50_000),
  APPLE_MAPS_DAILY_CALL_BUDGET: wholeNumber(1, 10_000_000, 20_000),
  PLAN_DEADLINE_MS: wholeNumber(1_000, 60_000, 20_000),
});

const APPLE_MAPS_SETTING_NAMES = [
  'APPLE_MAPS_TEAM_ID',
  'APPLE_MAPS_KEY_ID',
  'APPLE_MAPS_PRIVATE_KEY',
] as const;

// Reads settings from process.env or the Workers env. Missing provider keys are allowed; a value
// that is present but malformed is not, because the server would otherwise run on a guess.
export function loadConfig(env: unknown): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'env')));
    throw new ConfigError([...names].sort());
  }
  const settings = parsed.data;

  const missingSettings: string[] = [];
  if (!settings.TFNSW_API_KEY) missingSettings.push('TFNSW_API_KEY');
  const missingApple = APPLE_MAPS_SETTING_NAMES.filter((name) => !settings[name]);
  missingSettings.push(...missingApple);

  const {
    APPLE_MAPS_TEAM_ID: teamId,
    APPLE_MAPS_KEY_ID: keyId,
    APPLE_MAPS_PRIVATE_KEY: privateKey,
  } = settings;

  return {
    mode: settings.HOPREADY_MODE,
    logLevel: settings.LOG_LEVEL,
    tfnsw: settings.TFNSW_API_KEY ? { apiKey: settings.TFNSW_API_KEY } : null,
    appleMaps: teamId && keyId && privateKey ? { teamId, keyId, privateKey } : null,
    missingSettings,
    dailyCallBudgets: {
      tfnsw: settings.TFNSW_DAILY_CALL_BUDGET,
      appleMaps: settings.APPLE_MAPS_DAILY_CALL_BUDGET,
    },
    planDeadlineMs: settings.PLAN_DEADLINE_MS,
  };
}
