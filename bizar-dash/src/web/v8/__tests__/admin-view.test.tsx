/**
 * S40 — admin-view.test.tsx
 *
 * Verifies AdminView renders the action grid, posts to the right
 * /api/admin endpoint on Run, surfaces the inline-confirm flow for
 * destructive actions, and renders the GET download tile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminView } from '../views/Admin/AdminView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
}

function installFetchMock(handler: (url: string, init?: RequestInit) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && init?.body) {
      try { out.posts.push({ url, body: JSON.parse(String(init.body)) }); } catch { /* swallow */ }
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S40 AdminView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
    // jsdom's window.open is undefined; stub it.
    (window as unknown as { open: (url: string) => void }).open = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders one tile per action', async () => {
    installFetchMock(() => jsonResponse(200, { ok: true }));
    render(<AdminView />);
    expect(await screen.findByTestId('admin-view')).toBeTruthy();
    expect(screen.getByTestId('admin-run-gc')).toBeTruthy();
    expect(screen.getByTestId('admin-run-cache-clear')).toBeTruthy();
    expect(screen.getByTestId('admin-run-memory-reindex')).toBeTruthy();
    expect(screen.getByTestId('admin-run-logs-purge')).toBeTruthy();
    expect(screen.getByTestId('admin-run-restart')).toBeTruthy();
    expect(screen.getByTestId('admin-run-rebuild')).toBeTruthy();
    expect(screen.getByTestId('admin-run-export-activity')).toBeTruthy();
  });

  it('runs a non-destructive action immediately on click', async () => {
    const state = installFetchMock(() => jsonResponse(200, { ok: true, files: 3, bytes: 1024 }));
    render(<AdminView />);
    fireEvent.click(await screen.findByTestId('admin-run-gc'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/admin/gc'));
      expect(hit).toBeTruthy();
    });
    expect(await screen.findByTestId('admin-result-gc')).toBeTruthy();
  });

  it('shows inline confirm for destructive actions', async () => {
    installFetchMock(() => jsonResponse(200, { ok: true }));
    render(<AdminView />);
    fireEvent.click(await screen.findByTestId('admin-run-cache-clear'));
    expect(await screen.findByTestId('admin-confirm-cache-clear')).toBeTruthy();
  });

  it('runs destructive action only after Confirm', async () => {
    const state = installFetchMock(() => jsonResponse(200, { ok: true }));
    render(<AdminView />);
    fireEvent.click(await screen.findByTestId('admin-run-cache-clear'));
    fireEvent.click(await screen.findByTestId('admin-confirm-cache-clear'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/admin/cache/clear'));
      expect(hit).toBeTruthy();
    });
  });

  it('cancels destructive confirm without firing', async () => {
    const state = installFetchMock(() => jsonResponse(200, { ok: true }));
    render(<AdminView />);
    fireEvent.click(await screen.findByTestId('admin-run-cache-clear'));
    fireEvent.click(await screen.findByTestId('admin-cancel-cache-clear'));
    expect(state.posts.find((p) => p.url.endsWith('/api/admin/cache/clear'))).toBeUndefined();
  });

  it('opens export endpoint in a new tab on Run', async () => {
    installFetchMock(() => jsonResponse(200, { ok: true }));
    const opened = vi.fn();
    (window as unknown as { open: (url: string) => void }).open = opened;
    render(<AdminView />);
    fireEvent.click(await screen.findByTestId('admin-run-export-activity'));
    expect(opened).toHaveBeenCalledWith('/api/admin/activity/export', '_blank');
  });
});