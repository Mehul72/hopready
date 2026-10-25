import { describe, expect, it } from 'vitest';

import { API_VERSION, createApp } from './app';

describe('GET /v1/health', () => {
  it('reports the service is up with its version', async () => {
    const response = await createApp().request('/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'hopready-api',
      version: API_VERSION,
    });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await createApp().request('/v1/nope');
    expect(response.status).toBe(404);
  });
});
