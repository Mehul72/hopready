import type { ProviderError, ProviderFailure } from '@hopready/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Stable codes the app switches on. Messages are for people and may change; codes may not.
export const API_ERROR_CODES = [
  'invalid-json',
  'invalid-request',
  'payload-too-large',
  'not-found',
  'method-not-allowed',
  'outside-coverage',
  'too-many-requests',
  'not-configured',
  'provider-busy',
  'provider-timeout',
  'deadline-exceeded',
  'provider-unavailable',
  'provider-bad-response',
  'provider-rejected',
  'internal-error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

interface ApiErrorDefinition {
  status: ContentfulStatusCode;
  retryable: boolean;
  message: string;
}

export const API_ERRORS: Readonly<Record<ApiErrorCode, ApiErrorDefinition>> = {
  'invalid-json': {
    status: 400,
    retryable: false,
    message: 'The request body must be valid JSON.',
  },
  'invalid-request': {
    status: 400,
    retryable: false,
    message: 'The request is missing a value or has a value that is not allowed.',
  },
  'payload-too-large': {
    status: 413,
    retryable: false,
    message: 'The request is too large.',
  },
  'not-found': {
    status: 404,
    retryable: false,
    message: 'Nothing is available at this address.',
  },
  'method-not-allowed': {
    status: 405,
    retryable: false,
    message: 'This address does not accept that kind of request.',
  },
  'outside-coverage': {
    status: 422,
    retryable: false,
    message:
      'HopReady plans trips within Greater Sydney only. Choose places inside Greater Sydney.',
  },
  'too-many-requests': {
    status: 429,
    retryable: true,
    message: 'Too many requests in a short time. Wait a moment, then try again.',
  },
  'not-configured': {
    status: 503,
    retryable: false,
    message: 'Live travel information is not set up on this server yet.',
  },
  'provider-busy': {
    status: 503,
    retryable: true,
    message: 'Travel information services are busy right now. Try again later.',
  },
  'provider-timeout': {
    status: 504,
    retryable: true,
    message: 'Travel information took too long to arrive. Try again.',
  },
  'deadline-exceeded': {
    status: 504,
    retryable: true,
    message: 'Planning this trip took too long. Try again.',
  },
  'provider-unavailable': {
    status: 502,
    retryable: true,
    message: 'Travel information services are unavailable right now. Try again shortly.',
  },
  'provider-bad-response': {
    status: 502,
    retryable: false,
    message: 'A travel information service sent a reply HopReady could not read. Try again later.',
  },
  'provider-rejected': {
    status: 422,
    retryable: false,
    message:
      'A travel information service could not handle this request. Check the places and time, then try again.',
  },
  'internal-error': {
    status: 500,
    retryable: true,
    message: "Something went wrong on HopReady's side. Try again.",
  },
};

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; retryable: boolean; requestId: string };
}

export function apiErrorBody(
  code: ApiErrorCode,
  requestId: string,
  message?: string,
): ApiErrorBody {
  const definition = API_ERRORS[code];
  return {
    error: {
      code,
      message: message ?? definition.message,
      retryable: definition.retryable,
      requestId,
    },
  };
}

const CODE_FOR_FAILURE: Readonly<Record<ProviderFailure, ApiErrorCode>> = {
  timeout: 'provider-timeout',
  'rate-limited': 'provider-busy',
  'not-configured': 'not-configured',
  unavailable: 'provider-unavailable',
  'malformed-response': 'provider-bad-response',
  'rejected-request': 'provider-rejected',
};

export function apiErrorCodeFor(error: ProviderError): ApiErrorCode {
  return CODE_FOR_FAILURE[error.failure];
}

// When every place provider failed, the answer is 503 if they are all busy or not set up,
// otherwise 502: a timed-out search box needs the same response from the app as a broken one.
export function placeSearchFailureCode(failures: readonly ProviderError[]): ApiErrorCode {
  if (failures.every((failure) => failure.failure === 'not-configured')) return 'not-configured';
  const temporarilyRefused = failures.every(
    (failure) => failure.failure === 'rate-limited' || failure.failure === 'not-configured',
  );
  return temporarilyRefused ? 'provider-busy' : 'provider-unavailable';
}

export function longestRetryAfterSeconds(failures: readonly ProviderError[]): number | undefined {
  const known = failures.flatMap((failure) =>
    failure.retryAfterSeconds === undefined ? [] : [failure.retryAfterSeconds],
  );
  return known.length === 0 ? undefined : Math.max(...known);
}

export const STANDARD_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// For failures outside the Hono app, such as invalid settings on Workers, so they still look
// like every other error response.
export function standaloneErrorResponse(code: ApiErrorCode, requestId: string): Response {
  return Response.json(apiErrorBody(code, requestId), {
    status: API_ERRORS[code].status,
    headers: { ...STANDARD_RESPONSE_HEADERS, 'X-Request-Id': requestId },
  });
}
