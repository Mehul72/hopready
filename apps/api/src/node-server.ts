import { serve } from '@hono/node-server';

import { createApp } from './app';

const DEFAULT_PORT = 8787;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

serve({ fetch: createApp().fetch, port }, (info) => {
  process.stdout.write(`hopready-api listening on http://localhost:${info.port}\n`);
});
