/**
 * S42 — mods-view.test.tsx
 *
 * Renders list, enable/disable PUT, uninstall confirm + DELETE, and
 * the registry install Sheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModsView } from '../views/Mods/ModsView.js';

interface MockState {
  posts: string[];
  puts: Array<{ url: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], puts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') out.posts.push(url);
    else if (method === 'PUT' && init?.body) {
      let parsed: unknown = init.body;
      try { parsed = JSON.parse(String(init.body)); } catch { /* keep raw */ }
      out.puts.push({ url, body: parsed });
    } else if (method === 'DELETE') {
      out.deletes.push(url);
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

const installed = [{ id: 'mod-a', name: 'Mod A', version: '1.0.0', enabled: true, description: 'First' }];
const registry = { registry: { version: 2, updatedAt: '2026-01-01', source: 'https://example.com' }, mods: [{ id: 'mod-a', name: 'Mod A', latest: '1.0.0', installed: true, installedVersion: '1.0.0', upgradeAvailable: null, description: 'First' }, { id: 'mod-b', name: 'Mod B', latest: '2.0.0', installed: false, installedVersion: null, upgradeAvailable: null, description: 'Second' }] };

describe('S42 ModsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders installed + registry lists', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/mods')) return jsonResponse(200, { mods: installed });
      if (url.endsWith('/api/mods/registry')) return jsonResponse(200, registry);
      return jsonResponse(200, {});
    });
    render(<ModsView />);
    expect(await screen.findByTestId('mods-view')).toBeTruthy();
    expect(await screen.findByTestId('mod-row-mod-a')).toBeTruthy();
    expect(await screen.findByTestId('mod-registry-row-mod-b')).toBeTruthy();
  });

  it('PUTs enable on toggle', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/mods')) return jsonResponse(200, { mods: installed });
      if (url.endsWith('/api/mods/registry')) return jsonResponse(200, registry);
      return jsonResponse(200, {});
    });
    render(<ModsView />);
    fireEvent.click(await screen.findByTestId('mod-toggle-mod-a'));
    await waitFor(() => {
      const hit = state.puts.find((p) => p.url.endsWith('/api/mods/mod-a'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { enabled: boolean }).enabled).toBe(false);
    });
  });

  it('DELETEs on uninstall confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/mods')) return jsonResponse(200, { mods: installed });
      if (url.endsWith('/api/mods/registry')) return jsonResponse(200, registry);
      return jsonResponse(200, {});
    });
    render(<ModsView />);
    fireEvent.click(await screen.findByTestId('mod-uninstall-mod-a'));
    fireEvent.click(await screen.findByTestId('mod-confirm-uninstall-mod-a'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/mods/mod-a'))).toBeTruthy();
    });
  });

  it('POSTs /api/mods (registry id) from registry Install button', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/mods')) return jsonResponse(200, { mods: installed });
      if (url.endsWith('/api/mods/registry')) return jsonResponse(200, registry);
      return jsonResponse(200, {});
    });
    render(<ModsView />);
    fireEvent.click(await screen.findByTestId('mod-registry-install-mod-b'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/mods'))).toBeTruthy();
    });
  });

  it('POSTs /api/mods (local path) from Install Sheet', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/mods')) return jsonResponse(200, { mods: installed });
      if (url.endsWith('/api/mods/registry')) return jsonResponse(200, registry);
      return jsonResponse(200, {});
    });
    render(<ModsView />);
    fireEvent.click(await screen.findByTestId('mods-install'));
    fireEvent.click(await screen.findByTestId('mod-install-mode-path'));
    fireEvent.input(await screen.findByTestId('mod-install-input'), { target: { value: '/abs/path/to/mod' } });
    fireEvent.click(await screen.findByTestId('mod-install-submit'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/mods'))).toBeTruthy();
    });
  });
});