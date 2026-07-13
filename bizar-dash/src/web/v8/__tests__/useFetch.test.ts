/**
 * v8/__tests__/useFetch.test.ts
 *
 * Sprint S10 — Verifies the useFetch + fetcher wiring in jsdom.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchJson, FetchError } from '../data/fetcher.js';
import { useFetch } from '../data/useFetch.js';

describe('fetchJson', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses JSON on 200', async () => {
    const data = await fetchJson<{ ok: boolean }>('/api/test');
    expect(data.ok).toBe(true);
  });

  it('throws FetchError on 4xx', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'bad_request', message: 'nope' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(fetchJson('/api/test')).rejects.toBeInstanceOf(FetchError);
  });

  it('aborts via AbortSignal', async () => {
    let aborted = false;
    global.fetch = vi.fn(async (_url, init) =>
      new Promise((_, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      }),
    ) as unknown as typeof fetch;
    const ctrl = new AbortController();
    const p = fetchJson('/api/test', { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});

describe('useFetch', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns loading → data', async () => {
    const { result } = renderHook(() => useFetch<{ tasks: unknown[] }>('/api/tasks'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.tasks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces error on failure', async () => {
    global.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useFetch('/api/test'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });
});