import type { z } from 'zod';

import { ApiError, type ApiErrorKind } from './errors';
import { errorCodeOf } from './schemas';

// The parts of fetch this client uses. React Native's fetch satisfies it, and tests pass fakes.
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export type FetchFunction = (url: string, init: FetchRequest) => Promise<FetchResponse>;

export interface HttpTransport {
  // Null when this build has no API address: every request then fails as not configured.
  baseUrl: string | null;
  fetch: FetchFunction;
  installId: () => string;
  // Asked only after a request fails to connect, to tell "offline" from "server unreachable".
  isOffline: () => Promise<boolean>;
  timeoutMs?: number;
  now?: () => Date;
}

export interface JsonRequest<T> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

// Short enough that someone waiting at a bus stop gets an answer instead of a spinner. The API's
// plan deadline must stay below this, so its partial answer arrives before the app gives up.
export const DEFAULT_TIMEOUT_MS = 15_000;

export const INSTALL_ID_HEADER = 'X-HopReady-Install';

// Retry-After is either whole seconds or an HTTP date.
export function parseRetryAfterSeconds(header: string | null, now: Date): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

// The API's stable error codes (apps/api/src/errors.ts). The code decides when two answers share
// a status: a 422 is either outside coverage or a provider refusing the request.
const KIND_FOR_ERROR_CODE: ReadonlyMap<string, ApiErrorKind> = new Map<string, ApiErrorKind>([
  ['not-configured', 'not-configured'],
  ['outside-coverage', 'outside-coverage'],
  ['too-many-requests', 'rate-limited'],
  ['provider-busy', 'rate-limited'],
  ['provider-timeout', 'timeout'],
  ['deadline-exceeded', 'timeout'],
  ['provider-rejected', 'rejected'],
  ['invalid-json', 'rejected'],
  ['invalid-request', 'rejected'],
  ['payload-too-large', 'rejected'],
  ['not-found', 'rejected'],
  ['method-not-allowed', 'rejected'],
  ['provider-unavailable', 'server'],
  ['provider-bad-response', 'server'],
  ['internal-error', 'server'],
]);

function kindForStatus(status: number): ApiErrorKind {
  if (status === 429) return 'rate-limited';
  if (status === 422) return 'outside-coverage';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'rejected';
}

function errorForStatus(response: FetchResponse, text: string, now: Date): ApiError {
  const status = response.status;
  const body = parseJson(text);
  const code = body.ok ? errorCodeOf(body.value) : null;
  const kind = (code !== null ? KIND_FOR_ERROR_CODE.get(code) : undefined) ?? kindForStatus(status);
  return new ApiError(kind, {
    status,
    retryAfterSeconds:
      kind === 'rate-limited'
        ? parseRetryAfterSeconds(response.headers.get('retry-after'), now)
        : null,
    suggestsDemoMode: kind === 'not-configured',
  });
}

async function classifyConnectionFailure(
  transport: HttpTransport,
  cause: unknown,
): Promise<ApiError> {
  let offline: boolean;
  try {
    offline = await transport.isOffline();
  } catch {
    // If the connectivity check itself fails, "unreachable" is the honest answer: nothing proves
    // the device is offline.
    offline = false;
  }
  return new ApiError(offline ? 'offline' : 'unreachable', { cause });
}

export async function requestJson<T>(
  transport: HttpTransport,
  request: JsonRequest<T>,
): Promise<T> {
  if (!transport.baseUrl) throw new ApiError('not-configured', { suggestsDemoMode: true });
  if (request.signal?.aborted) throw new ApiError('cancelled');

  const now = transport.now ?? (() => new Date());
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, transport.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const cancelWithCaller = () => controller.abort();
  request.signal?.addEventListener('abort', cancelWithCaller, { once: true });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    [INSTALL_ID_HEADER]: transport.installId(),
  };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: FetchResponse;
  let text: string;
  try {
    response = await transport.fetch(`${transport.baseUrl}${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    // The body read stays under the same timer: a server can stall after sending headers.
    text = await response.text();
  } catch (error) {
    if (timedOut) throw new ApiError('timeout', { cause: error });
    if (request.signal?.aborted) throw new ApiError('cancelled', { cause: error });
    throw await classifyConnectionFailure(transport, error);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', cancelWithCaller);
  }

  if (!response.ok) throw errorForStatus(response, text, now());

  const body = parseJson(text);
  if (!body.ok) {
    throw new ApiError('invalid-response', { status: response.status, cause: body.error });
  }
  const parsed = request.schema.safeParse(body.value);
  if (!parsed.success) {
    throw new ApiError('invalid-response', { status: response.status, cause: parsed.error });
  }
  return parsed.data;
}
