/**
 * S43 — lightrag-view.test.tsx
 *
 * Renders defaults form, Save PUTs /api/lightrag/defaults, and
 * Autostart POSTs /api/lightrag/autostart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LightRAGView } from '../views/LightRAG/LightRAGView.js';

interface MockState {
  puts: Array<{ url: string; body: unknown }>;
  posts: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { puts: [], posts: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT' && init?.body) {
      let parsed: unknown = init.body;
      try { parsed = JSON.parse(String(init.body)); } catch { /* keep raw */ }
      out.puts.push({ url, body: parsed });
    } else if (method === 'POST') {
      out.posts.push(url);
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

const defaults = { llm: 'gpt-4o-mini', embedding: 'text-embedding-3-small', source: 'env', builtin: { llm: 'gpt-4o-mini', embedding: 'text-embedding-3-small' } };
const status = { running: false, pid: null, host: '127.0.0.1', port: 9621, llmBinding: 'gpt-4o-mini', embeddingBinding: 'text-embedding-3-small', logTail: [] };

describe('S43 LightRAGView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders form pre-filled from defaults', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/lightrag/defaults')) return jsonResponse(200, defaults);
      if (url.endsWith('/api/lightrag/status')) return jsonResponse(200, status);
      return jsonResponse(200, {});
    });
    render(<LightRAGView />);
    expect(await screen.findByTestId('lightrag-view')).toBeTruthy();
    const llm = await screen.findByTestId('lightrag-llm');
    expect((llm as HTMLInputElement).value).toBe('gpt-4o-mini');
  });

  it('PUTs /api/lightrag/defaults on Save', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/lightrag/defaults')) return jsonResponse(200, defaults);
      if (url.endsWith('/api/lightrag/status')) return jsonResponse(200, status);
      return jsonResponse(200, {});
    });
    render(<LightRAGView />);
    fireEvent.click(await screen.findByTestId('lightrag-save'));
    await waitFor(() => {
      const hit = state.puts.find((p) => p.url.endsWith('/api/lightrag/defaults'));
      expect(hit).toBeTruthy();
    });
  });

  it('POSTs /api/lightrag/autostart', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/lightrag/defaults')) return jsonResponse(200, defaults);
      if (url.endsWith('/api/lightrag/status')) return jsonResponse(200, status);
      return jsonResponse(200, {});
    });
    render(<LightRAGView />);
    fireEvent.click(await screen.findByTestId('lightrag-autostart'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/lightrag/autostart'))).toBeTruthy();
    });
  });
});