/**
 * v8/data/fetcher.ts — tiny fetch wrapper for the v8 dashboard.
 *
 * Thin layer over `fetch` with AbortController support. The dashboard
 * sits behind the same origin as the API (vite dev proxies /api → :PORT,
 * prod serves from the same host), so the URL is always relative.
 *
 * `useFetch` is React-side; `fetchJson` is the vanilla helper that the
 * hook uses. Both go through here so we have one place to add
 * auth headers, retry, etc.
 */

export class FetchError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

export interface FetchJsonOptions {
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the base URL. Default = '' (same-origin). */
  base?: string;
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    signal: opts.signal,
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const fullUrl = (opts.base || '') + url;
  const res = await fetch(fullUrl, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as { message: unknown }).message === 'string')
        ? (parsed as { message: string }).message
        : `HTTP ${res.status}`;
    throw new FetchError(res.status, message, parsed);
  }
  return parsed as T;
}