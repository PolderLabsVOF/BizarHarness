/**
 * S43 — clipboard-view.test.tsx
 *
 * Renders list, Save Sheet POSTs /api/clipboard/save, Delete
 * confirms + DELETEs /api/clipboard/:id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClipboardView } from '../views/Clipboard/ClipboardView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && init?.body) {
      let parsed: unknown = init.body;
      try { parsed = JSON.parse(String(init.body)); } catch { /* keep raw */ }
      out.posts.push({ url, body: parsed });
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

describe('S43 ClipboardView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no clips', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/clipboard/list')) return jsonResponse(200, { clips: [] });
      return jsonResponse(200, {});
    });
    render(<ClipboardView />);
    expect(await screen.findByTestId('clipboard-view')).toBeTruthy();
    expect(await screen.findByText('No saved clips')).toBeTruthy();
  });

  it('POSTs /api/clipboard/save from Save Sheet', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/clipboard/list')) return jsonResponse(200, { clips: [] });
      return jsonResponse(200, {});
    });
    render(<ClipboardView />);
    fireEvent.click(await screen.findByTestId('clipboard-add'));
    fireEvent.input(await screen.findByTestId('clipboard-form-url'), { target: { value: 'https://example.com' } });
    fireEvent.input(await screen.findByTestId('clipboard-form-title'), { target: { value: 'Example' } });
    fireEvent.click(await screen.findByTestId('clipboard-form-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/clipboard/save'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { url: string }).url).toBe('https://example.com');
    });
  });

  it('DELETEs /api/clipboard/:id on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/clipboard/list')) {
        return jsonResponse(200, { clips: [{ id: 'c1', title: 'X' }] });
      }
      return jsonResponse(200, {});
    });
    render(<ClipboardView />);
    fireEvent.click(await screen.findByTestId('clipboard-delete-c1'));
    fireEvent.click(await screen.findByTestId('clipboard-confirm-delete-c1'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/clipboard/c1'))).toBeTruthy();
    });
  });
});