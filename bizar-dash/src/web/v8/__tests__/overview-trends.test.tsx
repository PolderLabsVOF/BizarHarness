import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { OverviewView } from '../views/Overview/OverviewView';

type Handler = (input: RequestInfo | URL) => Promise<Response>;
function installFetchMock(handlers: Array<[RegExp, Handler]>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [pat, fn] of handlers) if (pat.test(url)) return fn(input);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('OverviewView real-time trends (v10-S2)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders a Tokens sparkline when /api/usage returns >=2 daily points', async () => {
    installFetchMock([
      [/^\/api\/snapshot/, () => jsonResponse({
        overview: {
          tasks: { queued: 1, active: 2, done: 5, blocked: 0 },
          goals: { total: 4, done: 1, atRisk: 1 },
          agents: { running: 2, idle: 3, error: 0, total: 5 },
          tokens: { last24h: 240_000 },
          needsAttention: [],
        },
      })],
      [/^\/api\/activity/, () => jsonResponse({ events: [] })],
      [/^\/api\/usage/, () => jsonResponse({
        totals: { tokens: 240_000 },
        daily: [
          { date: '2026-07-12', tokens: 10_000 },
          { date: '2026-07-13', tokens: 40_000 },
          { date: '2026-07-14', tokens: 190_000 },
        ],
      })],
    ]);
    render(<OverviewView />);
    // v10.0.3-S2 — overview now asks /api/usage?range=7d so the daily
    // time-series has ≥2 points; the testid still anchors to the same
    // node regardless of the URL change.
    expect(await screen.findByTestId('overview-tokens-sparkline')).toBeTruthy();
  });

  it('does not render a Tokens sparkline when /api/usage returns <2 daily points', async () => {
    installFetchMock([
      [/^\/api\/snapshot/, () => jsonResponse({
        overview: {
          tasks: { queued: 0, active: 0, done: 0, blocked: 0 },
          goals: { total: 0, done: 0, atRisk: 0 },
          agents: { running: 0, idle: 0, error: 0, total: 0 },
          tokens: { last24h: 0 },
          needsAttention: [],
        },
      })],
      [/^\/api\/activity/, () => jsonResponse({ events: [] })],
      [/^\/api\/usage/, () => jsonResponse({
        totals: { tokens: 0 },
        daily: [{ date: '2026-07-14', tokens: 0 }],
      })],
    ]);
    render(<OverviewView />);
    await waitFor(() => { expect(screen.queryByTestId('overview-tokens-sparkline')).toBeNull(); });
  });

  it('does not crash when /api/usage 500s — Tokens tile still renders', async () => {
    installFetchMock([
      [/^\/api\/snapshot/, () => jsonResponse({
        overview: {
          tasks: { queued: 1, active: 0, done: 0, blocked: 0 },
          goals: { total: 0, done: 0, atRisk: 0 },
          agents: { running: 0, idle: 1, error: 0, total: 1 },
          tokens: { last24h: 0 },
          needsAttention: [],
        },
      })],
      [/^\/api\/activity/, () => jsonResponse({ events: [] })],
      [/^\/api\/usage/, () => new Response(JSON.stringify({ error: 'oops' }), { status: 500 })],
    ]);
    render(<OverviewView />);
    // Wait for snapshot to load — Tokens tile still has its label
    expect(await screen.findByText(/tokens \(24h\)/i)).toBeTruthy();
  });
});