import { readFileSync } from 'node:fs';

import type { FetchImplementation } from '../http';

// Builders for the TfNSW adapter tests. Samples live in __fixtures__ (see the README there).

const FIXTURES_DIRECTORY = new URL('./__fixtures__/', import.meta.url);

export function loadFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(new URL(fileName, FIXTURES_DIRECTORY), 'utf8'));
}

// A fresh copy that a test can change without touching other tests' fixtures.
export function loadFixtureCopy<T>(fileName: string): T {
  return structuredClone(loadFixture(fileName)) as T;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export interface RecordedRequest {
  url: URL;
  headers: Headers;
}

export type FakeFetch = FetchImplementation & { requests: RecordedRequest[] };

export function fakeFetch(respond: (url: URL) => Response | Promise<Response>): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  };
  return Object.assign(fetchImpl, { requests });
}

export function neverAborted(): AbortSignal {
  return new AbortController().signal;
}
