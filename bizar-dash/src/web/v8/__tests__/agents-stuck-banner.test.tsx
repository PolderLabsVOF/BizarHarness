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

  // v10-S1 — Pause/Resume + bulk action. The v9.5.0 banner only had
  // Restart; users with 3+ stuck agents who want to triage them one at
  // a time still need Pause (stop heartbeat drain) and Resume (re-enable)
  // without a full restart. Plus bulk Pause-all-stuck for the case where
  // the cluster is wedged and the user wants to drain it.
  it('clicking the per-agent Pause button POSTs /api/agents/:name/status with paused', async () => {
    let statusCalled: { url: string; body: unknown } | null = null;
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({
        agents: [{ name: 'frigg', role: 'researcher', status: 'stuck', lastSeen: Date.now() - 600_000 }],
      })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({
        stuck: [{ name: 'frigg', role: 'researcher', status: 'stuck' }],
      })],
      [/^\/api\/agents\/frigg\/status/, (input, init) => {
        statusCalled = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
        return jsonResponse({ ok: true });
      }],
    ]);
    const user = userEvent.setup();
    render(<AgentsView />);
    const btn = await screen.findByTestId('agents-stuck-pause-frigg');
    await user.click(btn);
    await waitFor(() => { expect(statusCalled).not.toBeNull(); });
    expect(statusCalled!.url).toMatch(/\/api\/agents\/frigg\/status$/);
    expect((statusCalled!.body as { status?: string })?.status).toBe('paused');
  });

  it('clicking the bulk Pause-all-stuck button POSTs /status for every stuck agent', async () => {
    const statusCalls: Array<{ url: string; body: unknown }> = [];
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({
        agents: [
          { name: 'frigg', role: 'r', status: 'stuck', lastSeen: Date.now() - 600_000 },
          { name: 'thor', role: 'i', status: 'stuck', lastSeen: Date.now() - 600_000 },
        ],
      })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({
        stuck: [
          { name: 'frigg', role: 'r', status: 'stuck' },
          { name: 'thor', role: 'i', status: 'stuck' },
        ],
      })],
      [/^\/api\/agents\/.*\/status/, (input, init) => {
        statusCalls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse({ ok: true });
      }],
    ]);
    const user = userEvent.setup();
    render(<AgentsView />);
    const btn = await screen.findByTestId('agents-stuck-bulk-pause');
    await user.click(btn);
    await waitFor(() => { expect(statusCalls.length).toBeGreaterThanOrEqual(2); });
    const names = statusCalls.map((c) => c.url.match(/\/api\/agents\/([^/]+)\/status$/)?.[1]).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['frigg', 'thor']));
    for (const c of statusCalls) expect((c.body as { status?: string })?.status).toBe('paused');
  });

  it('does not render Pause/Resume or bulk actions when there are no stuck agents', async () => {
    installFetchMock([
      [/^\/api\/agents(\?|$)/, () => jsonResponse({ agents: [] })],
      [/^\/api\/cc-agents/, () => jsonResponse({ agents: [] })],
      [/^\/api\/agents\/stuck/, () => jsonResponse({ stuck: [] })],
    ]);
    render(<AgentsView />);
    await waitFor(() => { expect(screen.queryByTestId('agents-stuck-banner')).toBeNull(); });
    expect(screen.queryByTestId('agents-stuck-pause-frigg')).toBeNull();
    expect(screen.queryByTestId('agents-stuck-bulk-pause')).toBeNull();
  });
});