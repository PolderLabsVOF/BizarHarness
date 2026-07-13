import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentHierarchy } from '../views/Agents/AgentHierarchy.js';

type Handler = (input: RequestInfo | URL) => Promise<Response>;
function installFetchMock(handlers: Array<[RegExp, Handler]>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [pat, fn] of handlers) if (pat.test(url)) return fn(input);
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const oneChildHierarchy = {
  roots: [{
    name: 'odin',
    agent: { name: 'odin', role: 'orchestrator', level: 0, parent: null, status: 'idle' },
    children: [{ name: 'frigg', agent: { name: 'frigg', role: 'researcher', level: 1, parent: 'odin', status: 'idle' }, children: [] }],
  }],
  all: [
    { name: 'odin', role: 'orchestrator', level: 0, parent: null, status: 'idle' },
    { name: 'frigg', role: 'researcher', level: 1, parent: 'odin', status: 'idle' },
  ],
};

describe('AgentHierarchy (v9.4.0)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders empty state when roots is empty', async () => {
    installFetchMock([[/^\/api\/agents\/hierarchy/, () => jsonResponse({ roots: [], all: [] })]]);
    render(<AgentHierarchy />);
    expect(await screen.findByTestId('agent-hierarchy-empty')).toBeTruthy();
  });

  it('renders one root with two children', async () => {
    installFetchMock([[/^\/api\/agents\/hierarchy/, () => jsonResponse({
      roots: [{
        name: 'odin',
        agent: { name: 'odin', role: 'orchestrator', level: 0, parent: null, status: 'idle' },
        children: [
          { name: 'frigg', agent: { name: 'frigg', role: 'researcher', level: 1, parent: 'odin', status: 'idle' }, children: [] },
          { name: 'thor', agent: { name: 'thor', role: 'implementer', level: 1, parent: 'odin', status: 'busy' }, children: [] },
        ],
      }],
      all: [
        { name: 'odin', role: 'orchestrator', level: 0, parent: null, status: 'idle' },
        { name: 'frigg', role: 'researcher', level: 1, parent: 'odin', status: 'idle' },
        { name: 'thor', role: 'implementer', level: 1, parent: 'odin', status: 'busy' },
      ],
    })]]);
    render(<AgentHierarchy />);
    expect(await screen.findByTestId('agent-hierarchy-node-odin')).toBeTruthy();
    expect(await screen.findByTestId('agent-hierarchy-node-frigg')).toBeTruthy();
    expect(await screen.findByTestId('agent-hierarchy-node-thor')).toBeTruthy();
  });

  it('clicking chevron on a root collapses its children', async () => {
    installFetchMock([[/^\/api\/agents\/hierarchy/, () => jsonResponse(oneChildHierarchy)]]);
    const user = userEvent.setup();
    render(<AgentHierarchy />);
    expect(await screen.findByTestId('agent-hierarchy-node-frigg')).toBeTruthy();
    await user.click(screen.getByTestId('agent-hierarchy-toggle-odin'));
    expect(screen.queryByTestId('agent-hierarchy-node-frigg')).toBeNull();
  });

  it('clicking chevron again expands the children', async () => {
    installFetchMock([[/^\/api\/agents\/hierarchy/, () => jsonResponse(oneChildHierarchy)]]);
    const user = userEvent.setup();
    render(<AgentHierarchy />);
    await screen.findByTestId('agent-hierarchy-node-frigg');
    await user.click(screen.getByTestId('agent-hierarchy-toggle-odin'));
    expect(screen.queryByTestId('agent-hierarchy-node-frigg')).toBeNull();
    await user.click(screen.getByTestId('agent-hierarchy-toggle-odin'));
    expect(await screen.findByTestId('agent-hierarchy-node-frigg')).toBeTruthy();
  });
});