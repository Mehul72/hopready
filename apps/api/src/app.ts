import { Hono } from 'hono';

export const API_VERSION = '0.1.0';

export function createApp() {
  const app = new Hono();

  app.get('/v1/health', (context) =>
    context.json({ status: 'ok', service: 'hopready-api', version: API_VERSION }),
  );

  return app;
}
