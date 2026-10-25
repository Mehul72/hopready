import { ProviderError, type ProviderFailure, type ProviderName } from '@hopready/core';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// The only fields a log line can carry. Anything else is dropped before writing, so request bodies,
// search text, coordinates, addresses, keys, tokens and install IDs cannot reach the logs by accident.
export interface LogFields {
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  mode?: 'live' | 'demo';
  port?: number;
  errorCode?: string;
  errorName?: string;
  errorFrames?: readonly string[];
  provider?: ProviderName;
  providerAccount?: 'tfnsw' | 'apple-maps';
  operation?: string;
  failure?: ProviderFailure;
  providerStatus?: number;
  retryAfterSeconds?: number;
  rateLimit?: string;
  limitedBy?: 'install' | 'ip';
  budget?: string;
  budgetLimit?: number;
  itineraryCount?: number;
  resultCount?: number;
  unavailableCount?: number;
  droppedCount?: number;
  cache?: 'hit' | 'miss';
  settings?: readonly string[];
  // Provider adapter diagnostics: what was left out of a response and why.
  diagnostic?: string;
  reason?: string;
  count?: number;
  codes?: readonly number[];
  facilityIds?: readonly string[];
  ageHours?: number;
}

export interface LogEntry {
  time: string;
  level: LogLevel;
  message: string;
  [field: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const MAX_TEXT_LENGTH = 160;
const MAX_LIST_ITEMS = 12;
const MAX_STACK_FRAMES = 6;
const KNOWN_HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

type FieldSanitizer = (value: unknown) => unknown;

function cleanText(value: string): string {
  return value.replace(/\p{Cc}/gu, ' ').slice(0, MAX_TEXT_LENGTH);
}

const text: FieldSanitizer = (value) => (typeof value === 'string' ? cleanText(value) : undefined);

const finiteNumber: FieldSanitizer = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const textList: FieldSanitizer = (value) =>
  Array.isArray(value)
    ? value
        .slice(0, MAX_LIST_ITEMS)
        .map(text)
        .filter((item) => item !== undefined)
    : undefined;

const numberList: FieldSanitizer = (value) =>
  Array.isArray(value)
    ? value
        .slice(0, MAX_LIST_ITEMS)
        .map(finiteNumber)
        .filter((item) => item !== undefined)
    : undefined;

// A client can send any method token, so only standard ones are written as they are.
const httpMethod: FieldSanitizer = (value) =>
  typeof value === 'string' ? (KNOWN_HTTP_METHODS.has(value) ? value : 'OTHER') : undefined;

const FIELD_SANITIZERS = {
  requestId: text,
  route: text,
  method: httpMethod,
  status: finiteNumber,
  durationMs: finiteNumber,
  mode: text,
  port: finiteNumber,
  errorCode: text,
  errorName: text,
  errorFrames: textList,
  provider: text,
  providerAccount: text,
  operation: text,
  failure: text,
  providerStatus: finiteNumber,
  retryAfterSeconds: finiteNumber,
  rateLimit: text,
  limitedBy: text,
  budget: text,
  budgetLimit: finiteNumber,
  itineraryCount: finiteNumber,
  resultCount: finiteNumber,
  unavailableCount: finiteNumber,
  droppedCount: finiteNumber,
  cache: text,
  settings: textList,
  diagnostic: text,
  reason: text,
  count: finiteNumber,
  codes: numberList,
  facilityIds: textList,
  ageHours: finiteNumber,
} satisfies Record<keyof LogFields, FieldSanitizer>;

function isLogField(name: string): name is keyof LogFields {
  return Object.hasOwn(FIELD_SANITIZERS, name);
}

function sanitizeFields(fields: LogFields): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!isLogField(name)) continue;
    const clean = FIELD_SANITIZERS[name](value);
    if (clean !== undefined) sanitized[name] = clean;
  }
  return sanitized;
}

export interface LoggerOptions {
  level: LogLevel;
  sink: LogSink;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions, boundFields: LogFields = {}): Logger {
  const now = options.now ?? (() => new Date());
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[options.level]) return;
    options.sink({
      time: now().toISOString(),
      level,
      message: cleanText(message),
      ...sanitizeFields({ ...boundFields, ...fields }),
    });
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger(options, { ...boundFields, ...fields }),
  };
}

// Workers Logs indexes the fields of a logged object, while a terminal reads one JSON document per line.
export function consoleSink(format: 'object' | 'json-lines'): LogSink {
  return (entry) => {
    const payload = format === 'object' ? entry : JSON.stringify(entry);
    /* eslint-disable no-console -- this module is the single place that writes logs, and both Workers Logs and the Node terminal read the console */
    switch (entry.level) {
      case 'debug':
        console.debug(payload);
        break;
      case 'info':
        console.info(payload);
        break;
      case 'warn':
        console.warn(payload);
        break;
      case 'error':
        console.error(payload);
        break;
    }
    /* eslint-enable no-console */
  };
}

// Describes a failure without its message: messages from fetch, parsers and adapters can quote
// URLs, query strings or response bodies. Stack frames name code locations only.
export function errorLogFields(error: unknown): LogFields {
  if (error instanceof ProviderError) {
    return {
      provider: error.provider,
      failure: error.failure,
      ...(error.status === undefined ? {} : { providerStatus: error.status }),
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  if (error instanceof Error) {
    const frames = (error.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, MAX_STACK_FRAMES);
    return { errorName: error.name, errorFrames: frames };
  }
  return { errorName: typeof error };
}

export function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
