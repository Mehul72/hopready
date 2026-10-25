import type {
  DurableObjectNamespace,
  DurableObjectState,
  ExecutionContext,
  RateLimit,
} from '@cloudflare/workers-types';
import { systemClock } from '@hopready/core';
import { createDemoProviders } from '@hopready/core/fixtures';
import { DurableObject } from 'cloudflare:workers';

import { DurableObjectBudgetLedger, handleLedgerRequest, prepareLedger } from './budget-ledger';
import { ConfigError, loadConfig } from './config';
import type { LateOutcomeHandler } from './deadline';
import { standaloneErrorResponse } from './errors';
import { consoleSink, createLogger, errorLogFields, type Logger } from './logger';
import { createAppleMapsProviders } from './providers/apple-maps';
import { createTfnswProviders } from './providers/tfnsw';
import { RATE_LIMIT_BINDING_NAMES, WorkersRateLimiter } from './rate-limit';
import { createRuntime, type Runtime } from './runtime';

// Bindings from wrangler.jsonc. Settings arrive as vars or secrets; every one is optional here and
// checked by loadConfig.
export interface Env {
  HOPREADY_MODE?: string;
  TFNSW_API_KEY?: string;
  APPLE_MAPS_TEAM_ID?: string;
  APPLE_MAPS_KEY_ID?: string;
  APPLE_MAPS_PRIVATE_KEY?: string;
  LOG_LEVEL?: string;
  TFNSW_DAILY_CALL_BUDGET?: string;
  APPLE_MAPS_DAILY_CALL_BUDGET?: string;
  PLAN_DEADLINE_MS?: string;
  PLAN_RATE_LIMITER: RateLimit;
  PLACES_RATE_LIMITER: RateLimit;
  CARPARKS_RATE_LIMITER: RateLimit;
  IP_RATE_LIMITER: RateLimit;
  PROVIDER_BUDGET: DurableObjectNamespace;
}

const startupLogger = createLogger({ level: 'info', sink: consoleSink('object') });

function lateOutcomeLogger(logger: Logger, message: string): LateOutcomeHandler {
  return (outcome) =>
    logger.debug(message, outcome.status === 'rejected' ? errorLogFields(outcome.reason) : {});
}

// Built once per isolate, so provider token caches and the in-memory budget count survive
// between requests. Bindings do not change within an isolate.
let runtime: Runtime | undefined;

function createWorkerRuntime(env: Env): Runtime {
  const config = loadConfig(env);
  const logger: Logger = createLogger({ level: config.logLevel, sink: consoleSink('object') });
  return createRuntime({
    config,
    clock: systemClock,
    logger,
    factories: { createTfnswProviders, createAppleMapsProviders, createDemoProviders },
    rateLimiter: new WorkersRateLimiter({
      bindings: {
        plan: env[RATE_LIMIT_BINDING_NAMES.plan],
        places: env[RATE_LIMIT_BINDING_NAMES.places],
        carparks: env[RATE_LIMIT_BINDING_NAMES.carparks],
        ip: env[RATE_LIMIT_BINDING_NAMES.ip],
      },
      onLateOutcome: lateOutcomeLogger(logger, 'rate limiter answered after its timeout'),
    }),
    budgetLedger: new DurableObjectBudgetLedger(env.PROVIDER_BUDGET, {
      onLateOutcome: lateOutcomeLogger(logger, 'budget ledger answered after its timeout'),
    }),
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let current: Runtime;
    try {
      current = runtime ??= createWorkerRuntime(env);
    } catch (error) {
      // Nothing can be served without a runtime; answer in the API's error shape and retry the
      // set-up on the next request.
      const requestId = crypto.randomUUID();
      if (error instanceof ConfigError) {
        startupLogger.error('invalid settings, every request fails until they are fixed', {
          requestId,
          settings: error.settings,
        });
      } else {
        startupLogger.error('runtime set-up failed', { requestId, ...errorLogFields(error) });
      }
      return standaloneErrorResponse('internal-error', requestId);
    }
    const response = await current.app.fetch(request);
    ctx.waitUntil(current.flushBudgets());
    return response;
  },
};

// Keeps the day's provider call count shared by every isolate. See budget-ledger.ts.
export class ProviderBudget extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    prepareLedger(ctx.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    return handleLedgerRequest(this.ctx.storage.sql, request);
  }
}
