import { ProviderError } from '@hopready/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { consoleSink, createLogger, errorLogFields, type LogEntry, type LogFields } from './logger';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const entries: LogEntry[] = [];
  const logger = createLogger({
    level,
    sink: (entry) => entries.push(entry),
    now: () => new Date('2026-10-26T20:30:00.000Z'),
  });
  return { logger, entries };
}

describe('createLogger', () => {
  it('writes the level, message, time and allowed fields', () => {
    const { logger, entries } = capture();
    logger
      .child({ requestId: 'req-1' })
      .info('request finished', { route: '/v1/plan', status: 200 });

    expect(entries).toEqual([
      {
        time: '2026-10-26T20:30:00.000Z',
        level: 'info',
        message: 'request finished',
        requestId: 'req-1',
        route: '/v1/plan',
        status: 200,
      },
    ]);
  });

  it('drops fields that are not on the allowlist, whatever the caller passes', () => {
    const { logger, entries } = capture();
    const smuggled = {
      status: 200,
      query: 'Wynyard Secret Lane',
      coordinate: { lat: -33.8688, lon: 151.2093 },
      apiKey: 'tfnsw-key-value',
    } as unknown as LogFields;

    logger.info('request finished', smuggled);

    expect(entries[0]).toEqual({
      time: '2026-10-26T20:30:00.000Z',
      level: 'info',
      message: 'request finished',
      status: 200,
    });
  });

  it('drops values of the wrong type and shortens long text', () => {
    const { logger, entries } = capture();
    logger.info('x', {
      status: Number.NaN,
      durationMs: '12' as unknown as number,
      route: 'r'.repeat(500),
    });

    expect(entries[0]?.status).toBeUndefined();
    expect(entries[0]?.durationMs).toBeUndefined();
    expect(String(entries[0]?.route)).toHaveLength(160);
  });

  it('writes non-standard HTTP methods as OTHER', () => {
    const { logger, entries } = capture();
    logger.info('request finished', { method: 'GET-33.8688' });
    expect(entries[0]?.method).toBe('OTHER');
  });

  it('skips entries below the configured level', () => {
    const { logger, entries } = capture('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(entries.map((entry) => entry.message)).toEqual(['c', 'd']);
  });
});

describe('errorLogFields', () => {
  it('describes a provider failure by provider, kind and status', () => {
    const error = new ProviderError('apple-maps', 'rate-limited', 'Apple said 429', {
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(errorLogFields(error)).toEqual({
      provider: 'apple-maps',
      failure: 'rate-limited',
      providerStatus: 429,
      retryAfterSeconds: 60,
    });
  });

  it('keeps the name and stack frames of other errors but never their message', () => {
    const error = new TypeError('Invalid URL https://api.example/?q=Wynyard&key=secret-key');
    const fields = errorLogFields(error);

    expect(fields.errorName).toBe('TypeError');
    expect(fields.errorFrames?.length).toBeGreaterThan(0);
    expect(JSON.stringify(fields)).not.toContain('secret-key');
    expect(JSON.stringify(fields)).not.toContain('Wynyard');
  });

  it('names the type of a thrown non-error', () => {
    expect(errorLogFields('just a string')).toEqual({ errorName: 'string' });
  });
});

describe('consoleSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const entry: LogEntry = { time: '2026-10-26T20:30:00.000Z', level: 'warn', message: 'm' };

  it('writes one JSON document per line for terminals', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleSink('json-lines')(entry);
    expect(warn).toHaveBeenCalledWith(JSON.stringify(entry));
  });

  it('writes the object itself for Workers Logs, using the console method for its level', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleSink('object')({ ...entry, level: 'error' });
    expect(error).toHaveBeenCalledWith({ ...entry, level: 'error' });
  });
});
