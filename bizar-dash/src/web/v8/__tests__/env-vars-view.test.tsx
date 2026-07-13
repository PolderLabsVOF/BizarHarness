/**
 * S41 — env-vars-view.test.tsx
 *
 * Verifies EnvVarsView mounts, lists vars, opens the Add Sheet,
 * POSTs to /api/env-vars on submit, DELETEs (with inline confirm),
 * and bulk-imports via POST /api/env-vars/bulk-import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EnvVarsView } from '../views/EnvVars/EnvVarsView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
  puts: Array<{ url: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handler: (url: string, init?: RequestInit) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], puts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (init?.body) {
      try {
        const parsed = JSON.parse(String(init.body));
        if (method === 'POST') out.posts.push({ url, body: parsed });
        else if (method === 'PUT') out.puts.push({ url, body: parsed });
      } catch { /* swallow */ }
    } else if (method === 'DELETE') {
      out.deletes.push(url);
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

describe('S41 EnvVarsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no env vars exist', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/env-vars')) return jsonResponse(200, []);
      return jsonResponse(200, {});
    });
    render(<EnvVarsView />);
    expect(await screen.findByTestId('env-vars-view')).toBeTruthy();
    expect(await screen.findByText('No env vars')).toBeTruthy();
  });

  it('lists env vars with masked values', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/env-vars')) return jsonResponse(200, [
        { name: 'BIZAR_FOO', value: '****bar', createdAt: '2026-01-01', source: 'dashboard' },
      ]);
      return jsonResponse(200, {});
    });
    render(<EnvVarsView />);
    expect(await screen.findByTestId('env-var-row-BIZAR_FOO')).toBeTruthy();
    expect(screen.getByText('****bar')).toBeTruthy();
  });

  it('opens the Add Sheet and POSTs on submit', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/env-vars') && !url.includes('/api/env-vars/')) return jsonResponse(200, []);
      return jsonResponse(200, {});
    });
    render(<EnvVarsView />);
    fireEvent.click(await screen.findByTestId('env-vars-add'));
    fireEvent.input(await screen.findByTestId('env-var-form-name'), { target: { value: 'BIZAR_FOO' } });
    fireEvent.input(await screen.findByTestId('env-var-form-value'), { target: { value: 'bar' } });
    fireEvent.click(await screen.findByTestId('env-var-form-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/env-vars'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { name: string }).name).toBe('BIZAR_FOO');
      expect((hit!.body as { value: string }).value).toBe('bar');
    });
  });

  it('DELETEs an env var on Confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/env-vars')) return jsonResponse(200, [{ name: 'BIZAR_FOO', value: '****bar' }]);
      return jsonResponse(200, {});
    });
    render(<EnvVarsView />);
    fireEvent.click(await screen.findByTestId('env-var-delete-BIZAR_FOO'));
    fireEvent.click(await screen.findByTestId('env-var-confirm-delete-BIZAR_FOO'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/env-vars/BIZAR_FOO'))).toBeTruthy();
    });
  });

  it('bulk-imports via POST /api/env-vars/bulk-import', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/env-vars')) return jsonResponse(200, []);
      return jsonResponse(200, {});
    });
    render(<EnvVarsView />);
    fireEvent.click(await screen.findByTestId('env-vars-bulk-import'));
    fireEvent.input(await screen.findByTestId('env-vars-bulk-input'), {
      target: { value: 'BIZAR_A=1\nBIZAR_B=2\n# comment' },
    });
    fireEvent.click(await screen.findByTestId('env-vars-bulk-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/env-vars/bulk-import'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { envContent: string }).envContent).toContain('BIZAR_A=1');
    });
  });
});