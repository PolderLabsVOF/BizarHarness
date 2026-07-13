import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentsView } from '../views/Agents/AgentsView.js';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function installFetchMock(handlers: Array<[RegExp, Handler]>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    for (const [pat, fn] of handlers) if (pat.test(url)) return fn(input, init);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('AgentsView stuck banner (v9.5.0 S48)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders no banner when /api/agents/stuck returns []', async () => {
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({ agents: [] })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({ stuck: [] })],
    ]);
    render(<AgentsView />);
    // Wait for both fetches to settle, then assert no banner
    await waitFor(() => { expect(screen.queryByTestId('agents-stuck-banner')).toBeNull(); });
  });

  it('renders the warning banner when stuck agents exist', async () => {
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({
        agents: [{ name: 'frigg', role: 'researcher', status: 'stuck', lastSeen: Date.now() - 600_000 }],
      })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({
        stuck: [{ name: 'frigg', role: 'researcher', status: 'stuck' }],
      })],
    ]);
    render(<AgentsView />);
    expect(await screen.findByTestId('agents-stuck-banner')).toBeTruthy();
    expect(screen.getByTestId('agents-stuck-banner').textContent).toMatch(/frigg|stuck/i);
  });

  it('clicking the per-agent Restart button POSTs /api/agents/:name/restart', async () => {
    let restartCalled: { url: string; body: unknown } | null = null;
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({
        agents: [{ name: 'frigg', role: 'researcher', status: 'stuck', lastSeen: Date.now() - 600_000 }],
      })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({
        stuck: [{ name: 'frigg', role: 'researcher', status: 'stuck' }],
      })],
      [/^\/api\/agents\/frigg\/restart/, (input, init) => {
        restartCalled = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
        return jsonResponse({ ok: true });
      }],
    ]);
    const user = userEvent.setup();
    render(<AgentsView />);
    const btn = await screen.findByTestId('agents-stuck-restart-frigg');
    await user.click(btn);
    await waitFor(() => { expect(restartCalled).not.toBeNull(); });
    expect(restartCalled!.url).toMatch(/\/api\/agents\/frigg\/restart$/);
  });
});