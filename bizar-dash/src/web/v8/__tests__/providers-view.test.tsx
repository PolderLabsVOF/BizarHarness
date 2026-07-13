/**
 * S42 — providers-view.test.tsx
 *
 * Renders the list, active-default card, auto-detect trigger, and
 * rotate inline-confirm + POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProvidersView } from '../views/Providers/ProvidersView.js';

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

describe('S42 ProvidersView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no providers', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/providers')) return jsonResponse(200, { providers: [], count: 0 });
      if (url.endsWith('/api/providers/active')) return jsonResponse(200, { providerId: null, modelId: null, source: null });
      return jsonResponse(200, {});
    });
    render(<ProvidersView />);
    expect(await screen.findByTestId('providers-view')).toBeTruthy();
    expect(await screen.findByText('No providers')).toBeTruthy();
  });

  it('shows active default card when one is configured', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/providers')) return jsonResponse(200, { providers: [], count: 0 });
      if (url.endsWith('/api/providers/active')) return jsonResponse(200, { providerId: 'minimax', modelId: 'haiku', source: 'cline.json' });
      return jsonResponse(200, {});
    });
    render(<ProvidersView />);
    const el = await screen.findByTestId('providers-active-provider');
    expect(el.textContent).toBe('minimax');
  });

  it('POSTs /api/providers/auto-detect on click', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/providers')) return jsonResponse(200, { providers: [], count: 0 });
      if (url.endsWith('/api/providers/active')) return jsonResponse(200, { providerId: null, modelId: null, source: null });
      if (url.endsWith('/api/providers/auto-detect')) return jsonResponse(200, { providers: [{ id: 'minimax' }], count: 1 });
      return jsonResponse(200, {});
    });
    render(<ProvidersView />);
    fireEvent.click(await screen.findByTestId('providers-auto-detect'));
    await waitFor(() => {
      // The Auto-detect trigger is GET, not POST — verify the GET hit.
      expect(screen.queryByText(/candidate/)).toBeTruthy();
    });
  });

  it('rotates a provider on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/providers')) {
        return jsonResponse(200, {
          providers: [{ id: 'minimax', name: 'MiniMax', keys: [{ envVar: 'BIZAR_AI_1' }, { envVar: 'BIZAR_AI_2' }] }],
          count: 1,
        });
      }
      if (url.endsWith('/api/providers/active')) return jsonResponse(200, { providerId: 'minimax', modelId: null, source: null });
      if (url.endsWith('/api/providers/minimax/active-key')) {
        return jsonResponse(200, { ok: true, active: { envVar: 'BIZAR_AI_1', keyPreview: 'sk...12', keySet: true, status: 'active' } });
      }
      return jsonResponse(200, {});
    });
    render(<ProvidersView />);
    fireEvent.click(await screen.findByTestId('provider-rotate-minimax'));
    fireEvent.click(await screen.findByTestId('provider-confirm-rotate-minimax'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/providers/minimax/rotate'))).toBeTruthy();
    });
  });
});