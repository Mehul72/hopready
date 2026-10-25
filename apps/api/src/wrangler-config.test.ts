import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RATE_LIMIT_BINDING_NAMES, RATE_LIMIT_POLICIES, RATE_LIMIT_RULES } from './rate-limit';

// Removes comments and trailing commas outside strings, which is all wrangler.jsonc adds to JSON.
function parseJsonc(text: string): unknown {
  let json = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (inString) {
      json += char;
      if (char === '\\') {
        json += next ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      json += char;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      json += '\n';
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
    } else if (char === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) {
      continue;
    } else {
      json += char;
    }
  }
  return JSON.parse(json);
}

const rateLimitSchema = z.object({
  name: z.string(),
  namespace_id: z.string().regex(/^[1-9]\d*$/),
  simple: z.object({ limit: z.number(), period: z.union([z.literal(10), z.literal(60)]) }),
});
const durableObjectsSchema = z.object({
  bindings: z.array(z.object({ name: z.string(), class_name: z.string() })),
});
const environmentSchema = z.object({
  vars: z.record(z.string(), z.string()),
  ratelimits: z.array(rateLimitSchema),
  durable_objects: durableObjectsSchema,
});
const wranglerSchema = environmentSchema.extend({
  name: z.string(),
  main: z.string(),
  compatibility_date: z.string(),
  observability: z.object({
    enabled: z.boolean(),
    logs: z.object({ enabled: z.boolean(), invocation_logs: z.boolean() }),
  }),
  migrations: z.array(z.object({ tag: z.string(), new_sqlite_classes: z.array(z.string()) })),
  env: z.object({ staging: environmentSchema }),
});

const config = wranglerSchema.parse(
  parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')),
);
const SECRET_NAMES = [
  'TFNSW_API_KEY',
  'APPLE_MAPS_TEAM_ID',
  'APPLE_MAPS_KEY_ID',
  'APPLE_MAPS_PRIVATE_KEY',
];

describe('wrangler.jsonc', () => {
  it('deploys src/worker.ts as hopready-api on the pinned compatibility date', () => {
    expect(config.name).toBe('hopready-api');
    expect(config.main).toBe('src/worker.ts');
    expect(config.compatibility_date).toBe('2026-10-01');
  });

  it('keeps Workers Logs on and invocation logs, which record request URLs, off', () => {
    expect(config.observability).toEqual({
      enabled: true,
      logs: { enabled: true, invocation_logs: false },
    });
  });

  it.each([
    ['production', config],
    ['staging', config.env.staging],
  ])('gives %s the same rate limits as the code', (_, environment) => {
    for (const policy of RATE_LIMIT_POLICIES) {
      const binding = environment.ratelimits.find(
        (candidate) => candidate.name === RATE_LIMIT_BINDING_NAMES[policy],
      );
      expect(binding?.simple).toEqual({
        limit: RATE_LIMIT_RULES[policy].limit,
        period: RATE_LIMIT_RULES[policy].periodSeconds,
      });
    }
    expect(environment.ratelimits).toHaveLength(RATE_LIMIT_POLICIES.length);
  });

  it('never shares a rate limit namespace between bindings or environments', () => {
    const ids = [...config.ratelimits, ...config.env.staging.ratelimits].map(
      (binding) => binding.namespace_id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds the SQLite-backed ProviderBudget object in every environment', () => {
    for (const environment of [config, config.env.staging]) {
      expect(environment.durable_objects.bindings).toEqual([
        { name: 'PROVIDER_BUDGET', class_name: 'ProviderBudget' },
      ]);
    }
    expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['ProviderBudget'] }]);
  });

  it('runs live and holds no secrets in vars', () => {
    for (const environment of [config, config.env.staging]) {
      expect(environment.vars.HOPREADY_MODE).toBe('live');
      for (const secret of SECRET_NAMES) expect(environment.vars).not.toHaveProperty(secret);
    }
  });
});
