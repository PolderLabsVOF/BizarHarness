import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AgentDetail } from '../ui/agents/AgentDetail';

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

const baseProps = {
  agentId: 'bizar:frigg',
  name: 'frigg',
  role: 'researcher',
  status: 'busy' as const,
  open: true,
  onOpenChange: () => {},
};

describe('AgentDetail agent↔task drilldown (v9.5.0 S49)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders tasks assigned to this agent when open', async () => {
    installFetchMock([
      [/^\/api\/tasks/, () => jsonResponse({
        tasks: [
          { id: 'T-1', title: 'Write integration spec', status: 'doing', workedBy: 'frigg', metadata: { agent: 'frigg' } },
          { id: 'T-2', title: 'Other team task', status: 'queued', workedBy: 'thor', metadata: { agent: 'thor' } },
          { id: 'T-3', title: 'Investigate flaky test', status: 'blocked', workedBy: null, metadata: { agent: 'thor' } },
        ],
      })],
    ]);
    render(<AgentDetail {...baseProps} />);
    expect(await screen.findByTestId('agent-tasks-T-1')).toBeTruthy();
    expect(screen.queryByTestId('agent-tasks-T-2')).toBeNull();
    expect(screen.queryByTestId('agent-tasks-T-3')).toBeNull();
  });

  it('shows an empty-state when the agent has no assigned tasks', async () => {
    installFetchMock([
      [/^\/api\/tasks/, () => jsonResponse({
        tasks: [
          { id: 'T-9', title: 'Someone else', status: 'queued', workedBy: 'thor', metadata: { agent: 'thor' } },
        ],
      })],
    ]);
    render(<AgentDetail {...baseProps} />);
    expect(await screen.findByTestId('agent-tasks-empty')).toBeTruthy();
  });

  it('does not fetch tasks when the Sheet is closed', async () => {
    const seen: string[] = [];
    installFetchMock([
      [/^\/api\/tasks/, () => { seen.push('tasks'); return jsonResponse({ tasks: [] }); }],
    ]);
    render(<AgentDetail {...baseProps} open={false} />);
    // Give React a tick to mount + run effects
    await waitFor(() => {
      expect(seen.length).toBe(0);
    });
  });
});