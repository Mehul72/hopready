import type { Clock } from '@hopready/core';

import { createApp, type App, type ClientAddressResolver } from './app';
import type { BudgetLedger } from './budget';
import {
  buildDemoProviders,
  buildLiveProviders,
  createProviderBudgets,
  flushProviderBudgets,
  type ProviderFactories,
} from './composition';
import type { ApiConfig } from './config';
import type { Logger } from './logger';
import type { ProviderSet } from './provider-set';
import type { FetchImplementation } from './providers/http';
import type { RateLimiter } from './rate-limit';

export interface RuntimeOptions {
  config: ApiConfig;
  factories: ProviderFactories;
  clock: Clock;
  logger: Logger;
  rateLimiter: RateLimiter;
  // Null runs the daily budgets on this process's count alone.
  budgetLedger: BudgetLedger | null;
  clientAddress?: ClientAddressResolver;
  // The fetch the provider adapters send through, beneath the budget counting. Tests replace it.
  fetchImpl?: FetchImplementation;
}

export interface Runtime {
  app: App;
  providers: ProviderSet;
  // Reports this isolate's provider requests to the shared budget ledger. Never throws.
  flushBudgets(): Promise<void>;
}

// Everything both entry points share: picks providers for the mode, wraps them in the daily
// budgets, and builds the app.
export function createRuntime(options: RuntimeOptions): Runtime {
  const { config, factories, clock, logger } = options;

  if (config.mode === 'demo') {
    logger.info('demo mode: serving labelled fixtures, no provider is called', { mode: 'demo' });
    const providers = buildDemoProviders(factories.createDemoProviders, clock);
    return {
      app: createApp({ ...appDeps(options), providers }),
      providers,
      flushBudgets: () => Promise.resolve(),
    };
  }

  const budgets = createProviderBudgets(config, {
    clock,
    ledger: options.budgetLedger,
    logger,
  });
  const providers = buildLiveProviders(config, factories, {
    clock,
    budgets,
    logger,
    fetchImpl: options.fetchImpl,
  });
  if (config.missingSettings.length > 0) {
    logger.warn('provider settings missing, those providers will answer 503', {
      mode: 'live',
      settings: config.missingSettings,
    });
  }
  return {
    app: createApp({ ...appDeps(options), providers }),
    providers,
    flushBudgets: () => flushProviderBudgets(budgets),
  };
}

function appDeps(options: RuntimeOptions) {
  return {
    config: options.config,
    rateLimiter: options.rateLimiter,
    logger: options.logger,
    clock: options.clock,
    clientAddress: options.clientAddress,
  };
}
