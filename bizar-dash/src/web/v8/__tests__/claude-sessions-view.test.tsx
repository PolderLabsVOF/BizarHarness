/**
 * S39 — claude-sessions-view.test.tsx
 *
 * Verifies ClaudeSessionsView mounts, lists sessions, opens the
 * New session Sheet, POSTs to /api/claude-sessions/new, DELETEs
 * /api/claude-sessions/:id (with inline confirm), and opens the
 * right Drawer with ClaudeSessionDetail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ClaudeSessionsView } from '../views/ClaudeSessions/ClaudeSessionsView.js';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MockState {
  posts: Array<{ url: string; method: string; body: unknown }>;
  patches: Array<{ url: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handlers: Array<[RegExp, Handler]>, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], patches: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (init?.body) {
      try {
        const parsed = JSON.parse(String(init.body));
        if (method === 'POST') out.posts.push({ url, method, body: parsed });
        else if (method === 'PATCH') out.patches.push({ url, body: parsed });
      } catch { /* swallow */ }
    } else if (method === 'DELETE') {
      out.deletes.push(url);
    }
    for (const [pat, fn] of handlers) {
      if (pat.test(url)) return fn(input, init);
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S39 ClaudeSessionsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no sessions exist', async () => {
    installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, { sessions: [] })],
    ]);
    render(<ClaudeSessionsView />);
    expect(await screen.findByTestId('claude-sessions-view')).toBeTruthy();
    expect(await screen.findByText('No Claude sessions')).toBeTruthy();
  });

  it('lists sessions with their id and agent', async () => {
    installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, {
        sessions: [
          { id: 'sess_abc', title: 'Hello', agent: 'general' },
          { id: 'sess_def', title: 'World', agent: 'reviewer' },
        ],
      })],
    ]);
    render(<ClaudeSessionsView />);
    expect(await screen.findByTestId('claude-session-row-sess_abc')).toBeTruthy();
    expect(await screen.findByTestId('claude-session-row-sess_def')).toBeTruthy();
  });

  it('opens the New session Sheet on header button click', async () => {
    installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, { sessions: [] })],
    ]);
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByTestId('claude-sessions-new'));
    expect(await screen.findByTestId('claude-sessions-new-prompt')).toBeTruthy();
    expect(await screen.findByTestId('claude-sessions-new-agent')).toBeTruthy();
  });

  it('POSTs to /api/claude-sessions/new on Create', async () => {
    const state = installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, { sessions: [] })],
    ]);
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByTestId('claude-sessions-new'));
    fireEvent.input(await screen.findByTestId('claude-sessions-new-prompt'), {
      target: { value: 'first turn' },
    });
    fireEvent.input(await screen.findByTestId('claude-sessions-new-agent'), {
      target: { value: 'general' },
    });
    fireEvent.click(await screen.findByTestId('claude-sessions-new-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/claude-sessions/new') && p.method === 'POST');
      expect(hit).toBeTruthy();
      expect((hit!.body as { prompt: string }).prompt).toBe('first turn');
      expect((hit!.body as { agent: string }).agent).toBe('general');
    });
  });

  it('PATCHes /api/claude-sessions/:id on Rename save', async () => {
    const state = installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, {
        sessions: [{ id: 'sess_abc', title: 'Old title', agent: 'general' }],
      })],
    ]);
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByTestId('claude-session-rename-sess_abc'));
    fireEvent.input(await screen.findByTestId('claude-session-rename-input-sess_abc'), {
      target: { value: 'New title' },
    });
    fireEvent.click(await screen.findByTestId('claude-session-rename-submit-sess_abc'));
    await waitFor(() => {
      const hit = state.patches.find((p) => p.url.endsWith('/api/claude-sessions/sess_abc'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { title: string }).title).toBe('New title');
    });
  });

  it('DELETEs /api/claude-sessions/:id on Confirm delete', async () => {
    const state = installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, {
        sessions: [{ id: 'sess_abc', title: 'Hello', agent: 'general' }],
      })],
    ]);
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByTestId('claude-session-delete-sess_abc'));
    fireEvent.click(await screen.findByTestId('claude-session-confirm-delete-sess_abc'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/claude-sessions/sess_abc'))).toBeTruthy();
    });
  });

  it('opens the Session detail Drawer on Open click', async () => {
    installFetchMock([
      [/^\/api\/claude-sessions(\?|$)/, () => jsonResponse(200, {
        sessions: [{ id: 'sess_abc', title: 'Hello', agent: 'general' }],
      })],
      [/^\/api\/claude-sessions\/sess_abc\/messages/, () => jsonResponse(200, {
        messages: [{ id: 'm1', ts: Date.now(), role: 'user', content: 'first' }],
      })],
    ]);
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByTestId('claude-session-open-sess_abc'));
    expect(await screen.findByTestId('claude-session-detail-sess_abc')).toBeTruthy();
  });
});