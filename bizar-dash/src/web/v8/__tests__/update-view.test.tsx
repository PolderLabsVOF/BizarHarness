/**
 * S42 — update-view.test.tsx
 *
 * Renders status table, Check hits /api/updates/check, Apply (single)
 * hits /api/updates/apply with the package id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdateView } from '../views/Update/UpdateView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && init?.body) {
      let parsed: unknown = init.body;
      try { parsed = JSON.parse(String(init.body)); } catch { /* keep raw */ }
      out.posts.push({ url, body: parsed });
    }
    return handler(url);
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const status = { packages: [{ id: 'bizar', installed: '9.2.0', label: 'Bizar CLI' }, { id: 'bizar-dash', installed: '9.2.0', label: 'Dashboard' }] };
const checked = { packages: [{ id: 'bizar', installed: '9.2.0', latest: '9.3.0', hasUpdate: true, label: 'Bizar CLI' }, { id: 'bizar-dash', installed: '9.2.0', latest: '9.2.0', hasUpdate: false, label: 'Dashboard' }], hasUpdates: true };

describe('S42 UpdateView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders status list', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/updates/status')) return jsonResponse(200, status);
      return jsonResponse(200, {});
    });
    render(<UpdateView />);
    expect(await screen.findByTestId('update-view')).toBeTruthy();
    expect(await screen.findByTestId('update-row-bizar')).toBeTruthy();
    expect(await screen.findByTestId('update-row-bizar-dash')).toBeTruthy();
  });

  it('renders UPDATE AVAILABLE flag when check reports one', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/updates/status')) return jsonResponse(200, status);
      if (url.endsWith('/api/updates/check')) return jsonResponse(200, checked);
      return jsonResponse(200, {});
    });
    render(<UpdateView />);
    fireEvent.click(await screen.findByTestId('update-check'));
    await waitFor(() => {
      expect(screen.queryByTestId('update-available-bizar')).toBeTruthy();
    });
  });

  it('POSTs /api/updates/apply with selected package id on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/updates/status')) return jsonResponse(200, status);
      if (url.endsWith('/api/updates/check')) return jsonResponse(200, checked);
      return jsonResponse(200, {});
    });
    render(<UpdateView />);
    fireEvent.click(await screen.findByTestId('update-check'));
    fireEvent.click(await screen.findByTestId('update-apply-bizar'));
    fireEvent.click(await screen.findByTestId('update-confirm-apply-bizar'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/updates/apply'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { packages: string[] }).packages).toEqual(['bizar']);
    });
  });
});