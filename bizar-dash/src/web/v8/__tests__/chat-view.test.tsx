/**
 * S38 — chat-view.test.tsx
 *
 * Verifies ChatView mounts, lists sessions, renders composer, and
 * posts to /api/chat/sessions on the `+ New session` button (per
 * F-061 inline-no-window-confirm contract).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatView } from '../views/Chat/ChatView.js';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MockState {
  calls: string[];
  posts: Array<{ url: string; method: string; body: unknown }>;
}

function installFetchMock(handlers: Array<[RegExp, Handler]>, state?: MockState): MockState {
  const out: MockState = state ?? { calls: [], posts: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    out.calls.push(url);
    if (init?.method && init.method !== 'GET' && init.body) {
      try {
        out.posts.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      } catch { /* swallow */ }
    }
    for (const [pat, fn] of handlers) {
      if (pat.test(url)) return fn(input, init);
    }
    // Catch-all so unmatched POSTs (e.g. /api/chat/regenerate, /api/chat/audit)
    // still return a valid 200 and let the test observe the captured postLog entry.
    return jsonResponse(200, { ok: true });
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S38 ChatView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders session list + empty transcript when no sessions exist', async () => {
    installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, { messages: [], sessions: [] })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, { sessions: [] })],
    ]);
    render(<ChatView />);
    expect(await screen.findByTestId('chat-view')).toBeTruthy();
    expect(await screen.findByTestId('chat-transcript')).toBeTruthy();
  });

  it('lists one session and marks it active by default', async () => {
    installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, {
        messages: [],
        sessions: [{ id: 'sess_abc', file: 'sess_abc.jsonl', mtime: Date.now(), size: 0 }],
      })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, {
        sessions: [{ id: 'sess_abc', title: 'Test', messageCount: 2 }],
      })],
    ]);
    render(<ChatView />);
    expect(await screen.findByTestId('chat-session-sess_abc')).toBeTruthy();
  });

  it('renders existing messages for the active session', async () => {
    installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, {
        messages: [
          { id: 'm1', ts: new Date().toISOString(), role: 'user', content: 'hello' },
          { id: 'm2', ts: new Date().toISOString(), role: 'assistant', content: 'hi' },
        ],
        sessions: [{ id: 'sess_abc', file: 'sess_abc.jsonl', mtime: Date.now(), size: 200 }],
      })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, { sessions: [{ id: 'sess_abc' }] })],
    ]);
    render(<ChatView />);
    expect(await screen.findByTestId('chat-bubble-user')).toBeTruthy();
    expect(await screen.findByTestId('chat-bubble-assistant')).toBeTruthy();
  });

  it('POSTs to /api/chat/sessions on `+ New session`', async () => {
    const state = installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, { messages: [], sessions: [] })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, { sessions: [] })],
    ]);
    render(<ChatView />);
    const create = await screen.findByTestId('chat-create-session');
    fireEvent.click(create);
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/chat/sessions') && p.method === 'POST');
      expect(hit).toBeTruthy();
    });
  });

  it('POSTs to /api/chat/regenerate when an assistant bubble is regenerated', async () => {
    const state = installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, {
        messages: [{ id: 'm2', ts: new Date().toISOString(), role: 'assistant', content: 'hi' }],
        sessions: [{ id: 'sess_abc', file: 'sess_abc.jsonl', mtime: Date.now(), size: 200 }],
      })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, { sessions: [{ id: 'sess_abc' }] })],
    ]);
    render(<ChatView />);
    const regen = await screen.findByTestId('chat-regenerate-m2');
    fireEvent.click(regen);
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/chat/regenerate') && p.method === 'POST');
      expect(hit).toBeTruthy();
    });
  });

  it('POSTs to /api/chat/audit when the Audit button is clicked', async () => {
    const state = installFetchMock([
      [/^\/api\/chat(\?|$)/, () => jsonResponse(200, {
        messages: [],
        sessions: [{ id: 'sess_abc', file: 'sess_abc.jsonl', mtime: Date.now(), size: 0 }],
      })],
      [/^\/api\/chat\/sessions/, () => jsonResponse(200, { sessions: [{ id: 'sess_abc' }] })],
    ]);
    render(<ChatView />);
    const audit = await screen.findByTestId('chat-audit');
    fireEvent.click(audit);
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/chat/audit') && p.method === 'POST');
      expect(hit).toBeTruthy();
    });
  });
});