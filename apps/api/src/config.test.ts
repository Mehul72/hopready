import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

const ALL_KEYS = {
  TFNSW_API_KEY: 'tfnsw-key-value',
  APPLE_MAPS_TEAM_ID: 'TEAM123456',
  APPLE_MAPS_KEY_ID: 'KEY1234567',
  APPLE_MAPS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

describe('loadConfig', () => {
  it('starts in live mode with documented defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      mode: 'live',
      logLevel: 'info',
      tfnsw: null,
      appleMaps: null,
      missingSettings: [
        'TFNSW_API_KEY',
        'APPLE_MAPS_TEAM_ID',
        'APPLE_MAPS_KEY_ID',
        'APPLE_MAPS_PRIVATE_KEY',
      ],
      dailyCallBudgets: { tfnsw: 50_000, appleMaps: 20_000 },
      planDeadlineMs: 12_000,
    });
  });

  it('reads every setting', () => {
    const config = loadConfig({
      ...ALL_KEYS,
      HOPREADY_MODE: 'demo',
      LOG_LEVEL: 'warn',
      TFNSW_DAILY_CALL_BUDGET: '40000',
      APPLE_MAPS_DAILY_CALL_BUDGET: '15000',
      PLAN_DEADLINE_MS: '12000',
    });

    expect(config).toEqual({
      mode: 'demo',
      logLevel: 'warn',
      tfnsw: { apiKey: 'tfnsw-key-value' },
      appleMaps: {
        teamId: 'TEAM123456',
        keyId: 'KEY1234567',
        privateKey: ALL_KEYS.APPLE_MAPS_PRIVATE_KEY,
      },
      missingSettings: [],
      dailyCallBudgets: { tfnsw: 40_000, appleMaps: 15_000 },
      planDeadlineMs: 12_000,
    });
  });

  it('accepts numbers as numbers, as Workers vars can be', () => {
    const config = loadConfig({ TFNSW_DAILY_CALL_BUDGET: 1_000, PLAN_DEADLINE_MS: 5_000 });
    expect(config.dailyCallBudgets.tfnsw).toBe(1_000);
    expect(config.planDeadlineMs).toBe(5_000);
  });

  it('treats blank values as not set', () => {
    const config = loadConfig({
      HOPREADY_MODE: '',
      TFNSW_API_KEY: '   ',
      PLAN_DEADLINE_MS: '',
      LOG_LEVEL: ' ',
    });
    expect(config.mode).toBe('live');
    expect(config.tfnsw).toBeNull();
    expect(config.planDeadlineMs).toBe(12_000);
    expect(config.logLevel).toBe('info');
  });

  it('leaves Apple Maps unset unless all three of its settings are present', () => {
    const config = loadConfig({
      TFNSW_API_KEY: 'tfnsw-key-value',
      APPLE_MAPS_TEAM_ID: 'TEAM123456',
    });
    expect(config.tfnsw).toEqual({ apiKey: 'tfnsw-key-value' });
    expect(config.appleMaps).toBeNull();
    expect(config.missingSettings).toEqual(['APPLE_MAPS_KEY_ID', 'APPLE_MAPS_PRIVATE_KEY']);
  });

  it('refuses malformed values and names the settings without quoting them', () => {
    let thrown: unknown;
    try {
      loadConfig({
        ...ALL_KEYS,
        HOPREADY_MODE: 'production',
        PLAN_DEADLINE_MS: 'soon',
        TFNSW_DAILY_CALL_BUDGET: '0',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    const error = thrown as ConfigError;
    expect(error.settings).toEqual([
      'HOPREADY_MODE',
      'PLAN_DEADLINE_MS',
      'TFNSW_DAILY_CALL_BUDGET',
    ]);
    expect(error.message).not.toContain('production');
    expect(error.message).not.toContain('soon');
    expect(error.message).not.toContain('tfnsw-key-value');
  });

  it('refuses a plan deadline outside 1 to 60 seconds', () => {
    expect(() => loadConfig({ PLAN_DEADLINE_MS: '999' })).toThrow(ConfigError);
    expect(() => loadConfig({ PLAN_DEADLINE_MS: '60001' })).toThrow(ConfigError);
  });
});
