/**
 * v8/data/useFetch.ts — React-side `useFetch<T>(url)` hook.
 *
 * Returns `{ data, error, loading, refetch }`. Calls `fetchJson` with
 * an AbortController that's tied to the component lifecycle so an
 * unmount mid-request doesn't trigger a state update.
 *
 * Re-fetches when `url` changes (deep-equal via JSON.stringify — fine
 * for the small REST surfaces the dashboard uses).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson, FetchError } from './fetcher.js';

export interface UseFetchState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => void;
}

export function useFetch<T>(url: string | null): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const urlRef = useRef<string | null>(url);
  urlRef.current = url;

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJson<T>(url, { signal: ctrl.signal })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new FetchError(0, String(err), null));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url, tick]);

  const refetch = useCallback(() => { setTick((n) => n + 1); }, []);

  return { data, error, loading, refetch };
}