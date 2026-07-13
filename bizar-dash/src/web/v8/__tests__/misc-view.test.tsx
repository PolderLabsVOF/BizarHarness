/**
 * S43 — misc-view.test.tsx
 *
 * Renders the search box and tailscale panel. Tailscale Enable /
 * Disable POSTs the right endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MiscView } from '../views/Misc/MiscView.js';

interface MockState {
  posts: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') out.posts.push(url);
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

describe('S43 MiscView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders search + tailscale panels', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/search')) return jsonResponse(200, { query: '', results: [] });
      if (url.endsWith('/api/tailscale/status')) return jsonResponse(200, { enabled: false, running: false });
      return jsonResponse(200, {});
    });
    render(<MiscView />);
    expect(await screen.findByTestId('misc-view')).toBeTruthy();
    expect(await screen.findByTestId('misc-search-input')).toBeTruthy();
    expect(await screen.findByTestId('misc-tailscale-state')).toBeTruthy();
  });

  it('POSTs /api/tailscale/enable on Enable click', async () => {
    const state = installFetchMock((url) => {
      if (url.includes('/api/search')) return jsonResponse(200, { query: '', results: [] });
      if (url.endsWith('/api/tailscale/status')) return jsonResponse(200, { enabled: false, running: false });
      return jsonResponse(200, {});
    });
    render(<MiscView />);
    fireEvent.click(await screen.findByTestId('misc-tailscale-enable'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/tailscale/enable'))).toBeTruthy();
    });
  });

  it('POSTs /api/tailscale/disable on Disable click', async () => {
    const state = installFetchMock((url) => {
      if (url.includes('/api/search')) return jsonResponse(200, { query: '', results: [] });
      if (url.endsWith('/api/tailscale/status')) return jsonResponse(200, { enabled: true, running: true, hostname: 'box' });
      return jsonResponse(200, {});
    });
    render(<MiscView />);
    fireEvent.click(await screen.findByTestId('misc-tailscale-disable'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/tailscale/disable'))).toBeTruthy();
    });
  });
});