import {
  DEFAULT_PLANNER_LIMITS,
  isWithinGreaterSydney,
  planRequestSchema,
  planTrip as corePlanTrip,
  ProviderError,
  type Clock,
  type Coordinate,
  type PlanRequest,
} from '@hopready/core';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { methodNotAllowed } from 'hono/method-not-allowed';
import { routePath } from 'hono/route';
import type { z } from 'zod';

import { CarParkCatalogue, OCCUPANCY_UNAVAILABLE_NOTICE, withCurrentFreshness } from './car-parks';
import type { ApiConfig } from './config';
import { DeadlineExceededError, runWithDeadline, type LateOutcomeHandler } from './deadline';
import {
  API_ERRORS,
  apiErrorBody,
  apiErrorCodeFor,
  longestRetryAfterSeconds,
  placeSearchFailureCode,
  STANDARD_RESPONSE_HEADERS,
  type ApiErrorCode,
} from './errors';
import { elapsedMs, errorLogFields, type LogFields, type Logger } from './logger';
import { placeSearchRequestSchema, searchPlaces } from './places';
import {
  interceptCarParks,
  interceptPlaces,
  interceptProviderSet,
  loggingInterceptor,
  type ProviderSet,
} from './provider-set';
import {
  addressRateLimitKey,
  INSTALL_HEADER,
  parseInstallId,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitPolicy,
} from './rate-limit';
import { readJsonBody, type JsonBodyResult } from './request-body';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'hopready-api';

const PLAN_BODY_MAX_BYTES = 32 * 1024;
const PLACE_SEARCH_BODY_MAX_BYTES = 4 * 1024;
const PLACE_PROVIDER_TIMEOUT_MS = 5_000;
const CAR_PARK_CACHE_TTL_MS = 60_000;
// Provider calls are aborted this long before the plan deadline, so the planner can still return
// the options it already has. The deadline itself covers a provider that ignores the abort.
const PLAN_SETTLE_MAX_MS = 1_000;
// Hono records app.use('*') as '/*'. A request whose last match is one of these reached no route.
const GLOBAL_MIDDLEWARE_PATHS = new Set(['', '*', '/*']);

// Where the client's address comes from. CF-Connecting-IP is set by Cloudflare itself; a server
// that is not behind Cloudflare must use its socket address, because clients can send that header.
export type ClientAddressResolver = (context: Context) => string | null;

export interface AppDeps {
  config: ApiConfig;
  providers: ProviderSet;
  rateLimiter: RateLimiter;
  logger: Logger;
  clock: Clock;
  planTrip?: typeof corePlanTrip;
  clientAddress?: ClientAddressResolver;
}

interface RequestState {
  requestId: string;
  logger: Logger;
  // Extra fields for the one "request finished" line.
  logFields: LogFields;
}

type AppEnv = { Variables: { request: RequestState } };
type AppContext = Context<AppEnv>;

interface ErrorOptions {
  message?: string;
  retryAfterSeconds?: number;
  headers?: Record<string, string>;
}

const cloudflareClientAddress: ClientAddressResolver = (context) =>
  context.req.header('CF-Connecting-IP') ?? null;

export function createApp(deps: AppDeps) {
  const { config, providers, rateLimiter, clock, logger } = deps;
  const planTrip = deps.planTrip ?? corePlanTrip;
  const clientAddress = deps.clientAddress ?? cloudflareClientAddress;
  const carParkCatalogue = new CarParkCatalogue({
    clock,
    ttlMs: CAR_PARK_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PLANNER_LIMITS.providerTimeoutMs,
    onLateOutcome: lateOutcomeLogger(logger),
  });

  function stateOf(c: AppContext): RequestState {
    const existing: RequestState | undefined = c.get('request');
    if (existing) return existing;
    const requestId = crypto.randomUUID();
    const created = { requestId, logger: logger.child({ requestId }), logFields: {} };
    c.set('request', created);
    return created;
  }

  function sendError(c: AppContext, code: ApiErrorCode, options: ErrorOptions = {}): Response {
    const state = stateOf(c);
    state.logFields.errorCode = code;
    const headers: Record<string, string> = { ...options.headers };
    if (options.retryAfterSeconds !== undefined) {
      headers['Retry-After'] = String(Math.max(0, Math.ceil(options.retryAfterSeconds)));
    }
    return c.json(
      apiErrorBody(code, state.requestId, options.message),
      API_ERRORS[code].status,
      headers,
    );
  }

  function sendProviderError(c: AppContext, error: ProviderError): Response {
    const state = stateOf(c);
    state.logFields.provider = error.provider;
    state.logFields.failure = error.failure;
    if (error.status !== undefined) state.logFields.providerStatus = error.status;
    return sendError(c, apiErrorCodeFor(error), {
      retryAfterSeconds: error.failure === 'rate-limited' ? error.retryAfterSeconds : undefined,
    });
  }

  function sendBodyError(c: AppContext, body: Extract<JsonBodyResult, { ok: false }>): Response {
    return sendError(c, body.reason === 'too-large' ? 'payload-too-large' : 'invalid-json');
  }

  function sendValidationError(c: AppContext, error: z.ZodError): Response {
    const path = describeIssuePath(error.issues[0]?.path ?? []);
    return sendError(c, 'invalid-request', {
      message: path
        ? `The request has a missing or invalid value at ${path}.`
        : 'The request body must be a JSON object with the expected fields.',
    });
  }

  const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
    const startedAt = performance.now();
    const state = stateOf(c);
    await next();
    for (const [name, value] of Object.entries(STANDARD_RESPONSE_HEADERS)) c.header(name, value);
    c.header('X-Request-Id', state.requestId);
    const route = routePath(c, -1);
    const fields: LogFields = {
      ...state.logFields,
      method: c.req.method,
      // Only route templates are logged; a raw path is client text and could carry anything.
      route: GLOBAL_MIDDLEWARE_PATHS.has(route) ? 'unmatched' : route,
      status: c.res.status,
      durationMs: elapsedMs(startedAt),
      mode: config.mode,
    };
    // A failure on this side stands out even when nothing else was logged, such as a provider
    // that ignored its abort until the plan deadline.
    if (c.res.status >= 500) state.logger.warn('request finished', fields);
    else state.logger.info('request finished', fields);
  };

  async function checkRateLimit(
    policy: RateLimitPolicy,
    key: string,
    requestLogger: Logger,
  ): Promise<RateLimitDecision> {
    try {
      return await rateLimiter.check(policy, key);
    } catch (error) {
      // Rate limits protect provider quota, not data. While the limiter is down requests go
      // through, and the daily call budgets still cap what providers are asked for.
      requestLogger.error('rate limiter failed, request allowed', {
        ...errorLogFields(error),
        rateLimit: policy,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  function rateLimited(policy: RateLimitPolicy): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      const state = stateOf(c);
      let key = addressRateLimitKey(clientAddress(c));
      let limitedBy: 'install' | 'ip' = 'ip';
      if (policy !== 'ip') {
        const install = parseInstallId(c.req.header(INSTALL_HEADER));
        if (install.status === 'invalid') {
          return sendError(c, 'invalid-request', {
            message: `${INSTALL_HEADER} must be a version 4 UUID.`,
          });
        }
        if (install.status === 'valid') {
          key = `install:${install.id}`;
          limitedBy = 'install';
        }
      }
      const decision = await checkRateLimit(policy, key, state.logger);
      if (!decision.allowed) {
        state.logFields.rateLimit = policy;
        state.logFields.limitedBy = limitedBy;
        return sendError(c, 'too-many-requests', {
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }
      await next();
    };
  }

  const app = new Hono<AppEnv>();

  app.use('*', requestContext);
  app.use(
    '*',
    methodNotAllowed<AppEnv>({
      app,
      onMethodNotAllowed: (c, methods) =>
        sendError(c, 'method-not-allowed', { headers: { Allow: methods.join(', ') } }),
    }),
  );
  app.use('*', rateLimited('ip'));

  // Reports set-up only. It makes no provider calls, so uptime checks cost no quota.
  app.get('/v1/health', (c) =>
    c.json({
      status: 'ok',
      service: SERVICE_NAME,
      version: API_VERSION,
      mode: config.mode,
      providers: {
        transit: providers.transit ? 'configured' : 'missing',
        driving: providers.driving ? 'configured' : 'missing',
        carParks: providers.carParks ? 'configured' : 'missing',
        places: providers.places.length > 0 ? 'configured' : 'missing',
      },
    }),
  );

  app.post('/v1/plan', rateLimited('plan'), async (c) => {
    const state = stateOf(c);
    const body = await readJsonBody(c.req.raw, PLAN_BODY_MAX_BYTES);
    if (!body.ok) return sendBodyError(c, body);
    const parsed = planRequestSchema.safeParse(body.value);
    if (!parsed.success) return sendValidationError(c, parsed.error);
    const request = parsed.data;
    if (!isWithinCoverage(request)) return sendError(c, 'outside-coverage');

    const planProviders = interceptProviderSet(providers, loggingInterceptor(state.logger));
    const transit = planProviders.transit;
    if (!transit) return sendError(c, 'not-configured');

    try {
      const plan = await runWithDeadline(
        (signal) =>
          planTrip(
            request,
            {
              mode: config.mode,
              transit,
              driving: planProviders.driving,
              carParks: planProviders.carParks,
              clock,
            },
            signal,
          ),
        {
          deadlineMs: config.planDeadlineMs,
          settleMs: Math.min(PLAN_SETTLE_MAX_MS, Math.floor(config.planDeadlineMs / 4)),
          signal: c.req.raw.signal,
          onLateOutcome: lateOutcomeLogger(state.logger),
        },
      );
      state.logFields.itineraryCount = plan.itineraries.length;
      state.logFields.unavailableCount = plan.unavailable.length;
      return c.json(plan);
    } catch (error) {
      if (error instanceof DeadlineExceededError) return sendError(c, 'deadline-exceeded');
      if (error instanceof ProviderError) return sendProviderError(c, error);
      throw error;
    }
  });

  // A POST, so search text and coordinates never appear in URLs or edge request logs.
  app.post('/v1/places/search', rateLimited('places'), async (c) => {
    const state = stateOf(c);
    const body = await readJsonBody(c.req.raw, PLACE_SEARCH_BODY_MAX_BYTES);
    if (!body.ok) return sendBodyError(c, body);
    const parsed = placeSearchRequestSchema.safeParse(body.value);
    if (!parsed.success) return sendValidationError(c, parsed.error);
    if (providers.places.length === 0) return sendError(c, 'not-configured');

    const intercept = loggingInterceptor(state.logger);
    const placeProviders = providers.places.map((provider) => interceptPlaces(provider, intercept));
    const outcome = await searchPlaces(
      placeProviders,
      { query: parsed.data.query, near: parsed.data.near ?? null },
      {
        timeoutMs: PLACE_PROVIDER_TIMEOUT_MS,
        signal: c.req.raw.signal,
        onLateOutcome: lateOutcomeLogger(state.logger),
      },
    );
    if (outcome.droppedCount > 0) {
      state.logger.warn('place suggestions dropped for an unusable shape', {
        droppedCount: outcome.droppedCount,
      });
    }
    state.logFields.unavailableCount = outcome.failures.length;
    if (outcome.failures.length === placeProviders.length) {
      const code = placeSearchFailureCode(outcome.failures);
      return sendError(c, code, {
        retryAfterSeconds:
          code === 'provider-busy' ? longestRetryAfterSeconds(outcome.failures) : undefined,
      });
    }
    state.logFields.resultCount = outcome.results.length;
    return c.json({
      mode: config.mode,
      results: outcome.results,
      unavailable: outcome.failures.map((failure) => failure.provider),
    });
  });

  app.get('/v1/carparks', rateLimited('carparks'), async (c) => {
    const state = stateOf(c);
    if (!providers.carParks) return sendError(c, 'not-configured');
    const provider = interceptCarParks(providers.carParks, loggingInterceptor(state.logger));
    try {
      const { listing, cache } = await carParkCatalogue.read(provider);
      state.logFields.cache = cache;
      state.logFields.resultCount = listing.carParks.length;
      const now = clock.now();
      return c.json({
        mode: config.mode,
        fetchedAt: listing.fetchedAt,
        carParks: listing.carParks.map((carPark) => ({
          ...carPark,
          occupancy: withCurrentFreshness(carPark.occupancy, now),
        })),
        notices: listing.occupancyAvailable ? [] : [OCCUPANCY_UNAVAILABLE_NOTICE],
      });
    } catch (error) {
      if (error instanceof ProviderError) return sendProviderError(c, error);
      throw error;
    }
  });

  app.notFound((c) => sendError(c, 'not-found'));

  app.onError((error, c) => {
    if (error instanceof ProviderError) return sendProviderError(c, error);
    stateOf(c).logger.error('unexpected error', errorLogFields(error));
    return sendError(c, 'internal-error');
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

function isWithinCoverage(request: PlanRequest): boolean {
  const points: Coordinate[] = [request.origin.coordinate, request.destination.coordinate];
  if (request.trip.kind === 'return-via-car') {
    points.push(request.trip.parkedCar.location.coordinate);
  }
  return points.every(isWithinGreaterSydney);
}

// Paths name schema fields and list positions only, never values the client sent.
function describeIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, segment) => {
    if (typeof segment === 'number') return `${text}[${segment}]`;
    const name = String(segment);
    return text === '' ? name : `${text}.${name}`;
  }, '');
}

function lateOutcomeLogger(logger: Logger): LateOutcomeHandler {
  return (outcome) =>
    logger.debug(
      'work finished after its deadline',
      outcome.status === 'rejected' ? errorLogFields(outcome.reason) : {},
    );
}
