// Types for the module the Workers runtime provides to worker.ts. @cloudflare/workers-types only
// declares it in its global build, which clashes with the DOM and Node types this package uses.
declare module 'cloudflare:workers' {
  import type { DurableObjectState } from '@cloudflare/workers-types';

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
  }
}
