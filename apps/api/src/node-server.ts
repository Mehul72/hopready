import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { systemClock } from '@hopready/core';
import { createDemoProviders } from '@hopready/core/fixtures';
import { z } from 'zod';

import { blankAsUnset, ConfigError, loadConfig, type ApiConfig } from './config';
import { consoleSink, createLogger, errorLogFields } from './logger';
import { createAppleMapsProviders } from './providers/apple-maps';
import { createTfnswProviders } from './providers/tfnsw';
import { SlidingWindowRateLimiter } from './rate-limit';
import { createRuntime } from './runtime';

// Local development entry. It reads the same .dev.vars file as `wrangler dev`, rate limits in
// memory, and keeps the daily budgets in this process.
const DEV_VARS_FILE = new URL('../.dev.vars', import.meta.url);

const serverSettingsSchema = z.object({
  PORT: z.preprocess(blankAsUnset, z.coerce.number().int().min(1).max(65_535).default(8787)),
  // Loopback by default so a server holding real provider keys is not open to the local network.
  HOST: z.preprocess(blankAsUnset, z.string().default('127.0.0.1')),
});
type ServerSettings = z.infer<typeof serverSettingsSchema>;

const startupLogger = createLogger({ level: 'info', sink: consoleSink('json-lines') });

function loadDevVars() {
  try {
    // Variables already set in the environment win over the file.
    process.loadEnvFile(DEV_VARS_FILE);
  } catch (error) {
    const missingFile = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missingFile) throw error;
  }
}

function readSettings(): { server: ServerSettings; config: ApiConfig } | null {
  const server = serverSettingsSchema.safeParse(process.env);
  if (!server.success) {
    const names = server.error.issues.map((issue) => String(issue.path[0] ?? 'env'));
    startupLogger.error('invalid settings', { settings: [...new Set(names)] });
    return null;
  }
  try {
    return { server: server.data, config: loadConfig(process.env) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    startupLogger.error('invalid settings', { settings: error.settings });
    return null;
  }
}

function main() {
  loadDevVars();
  const settings = readSettings();
  if (!settings) {
    process.exitCode = 1;
    return;
  }
  const { server, config } = settings;

  const logger = createLogger({ level: config.logLevel, sink: consoleSink('json-lines') });
  const { app } = createRuntime({
    config,
    clock: systemClock,
    logger,
    factories: { createTfnswProviders, createAppleMapsProviders, createDemoProviders },
    rateLimiter: new SlidingWindowRateLimiter({ clock: systemClock }),
    budgetLedger: null,
    clientAddress: (context) => getConnInfo(context).remote.address ?? null,
  });

  serve({ fetch: app.fetch, port: server.PORT, hostname: server.HOST }, (info) => {
    logger.info('hopready-api listening', { port: info.port, mode: config.mode });
  });
}

try {
  main();
} catch (error) {
  startupLogger.error('server failed to start', errorLogFields(error));
  process.exitCode = 1;
}
