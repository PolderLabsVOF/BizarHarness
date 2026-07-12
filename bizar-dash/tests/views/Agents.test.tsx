// tests/views/Agents.test.tsx — Wave 3 Agents view (split-pane roster + detail panel).
//
// Covers the redesign contract: DataTable renders rows from snapshot, clicking
// a row selects an agent and updates the detail panel, category + search
// filters narrow the table, and the Edit button fires the handler. The
// create/delete/invoke modals use the legacy Modal and are exercised here
// only at the click-button level — their form contents are unchanged from
// the previous view and live in the legacy test suite.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';
import { Agents } from '../../src/web/views/Agents';
import type { Agent, Settings, Snapshot } from '../../src/web/lib/types';

// ─── API mock ────────────────────────────────────────────────────────────

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDel = vi.fn();

vi.mock('../../src/web/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    del: (...args: unknown[]) => apiDel(...args),
  },
}));

// The Agents view does not own a WS subscription (parent App.tsx does), but
// stubbing Ws makes the file load-safe if a future change introduces one.
vi.mock('../../src/web/lib/ws', () => ({
  Ws: class {
    on() { return () => undefined; }
    onStatus() { return () => undefined; }
    close() {}
  },
}));

// ─── Test fixtures ───────────────────────────────────────────────────────

const odin: Agent = {
  name: 'odin',
  description: 'Top-tier orchestrator',
  model: 'anthropic/claude-3-5-sonnet',
  mode: 'primary',
  file: 'odin.md',
  path: '/agents/odin.md',
  mtime: Date.now() - 3600_000,
  tools: ['bash', 'read', 'edit'],
  tags: ['orchestrator', 'reasoning'],
  category: 'reasoning',
  color: '#8b5cf6',
  status: 'working',
  isStuck: false,
};

const frigg: Agent = {
  name: 'frigg',
  description: 'Quality + memory curator',
  model: 'anthropic/claude-3-5-haiku',
  mode: 'subagent',
  file: 'frigg.md',
  path: '/agents/frigg.md',
  mtime: Date.now() - 7200_000,
  tools: ['read', 'grep'],
  tags: ['curator', 'analysis'],
  category: 'analysis',
  status: 'idle',
};

const tyr: Agent = {
  name: 'tyr',
  description: 'Implementation engine',
  model: 'openai/gpt-4o',
  mode: 'subagent',
  file: 'tyr.md',
  path: '/agents/tyr.md',
  mtime: Date.now() - 1800_000,
  tools: ['bash', 'edit', 'write'],
  tags: ['implementation', 'code'],
  category: 'code',
  color: '#2563eb',
  status: 'working',
  isStuck: true,
};

function makeSnapshot(agents: Agent[] = [odin, frigg, tyr]): Snapshot {
  return {
    agents,
  } as unknown as Snapshot;
}

const dummySettings = {} as Settings;

const Harness: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ToastProvider>
    <ModalProvider>{children}</ModalProvider>
  </ToastProvider>
);

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Agents view (Wave 3 redesign)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiDel.mockReset();
    // Default mock for any GET that may sneak through (modal loads).
    apiGet.mockImplementation(async () => ({}));
    apiPost.mockResolvedValue({});
    apiPut.mockResolvedValue({});
    apiDel.mockResolvedValue({});
    // confirm() always true for delete tests
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the DataTable rows from the snapshot', async () => {
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    expect(await screen.findByTestId('agents-table')).toBeInTheDocument();
    expect(screen.getByTestId('agents-count').textContent).toContain('(3)');

    const table = screen.getByTestId('agents-table');
    expect(within(table).getByText('odin')).toBeInTheDocument();
    expect(within(table).getByText('frigg')).toBeInTheDocument();
    expect(within(table).getByText('tyr')).toBeInTheDocument();
  });

  it('shows the empty state when no agents match', async () => {
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot([])}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    expect(await screen.findByText(/No agents found/i)).toBeInTheDocument();
    expect(screen.getByTestId('agents-count').textContent).toContain('(0)');
  });

  it('clicking a row populates the detail panel', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    const table = await screen.findByTestId('agents-table');
    await user.click(within(table).getByText('frigg'));

    // Detail panel shows the agent's metadata — use unique marker
    await waitFor(() => {
      expect(screen.getByText('Quality + memory curator')).toBeInTheDocument();
    });
    // Frigg-specific tag (curator) appears in the detail panel
    expect(screen.getAllByText('curator').length).toBeGreaterThan(0);
    // Edit button is rendered with frigg-specific testid
    expect(screen.getByTestId('agents-detail-edit-frigg')).toBeInTheDocument();
    // Frigg's path shows in the panel description
    expect(screen.getByText('/agents/frigg.md')).toBeInTheDocument();
  });

  it('category filter narrows the visible agents', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    const table = await screen.findByTestId('agents-table');
    expect(within(table).getByText('tyr')).toBeInTheDocument();

    const filter = screen.getByTestId('agents-category-filter') as HTMLSelectElement;
    await user.selectOptions(filter, 'code');

    expect(within(table).queryByText('odin')).not.toBeInTheDocument();
    expect(within(table).queryByText('frigg')).not.toBeInTheDocument();
    expect(within(table).getByText('tyr')).toBeInTheDocument();
    expect(screen.getByTestId('agents-count').textContent).toContain('(1)');
  });

  it('search filters by name / description / tag', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    const table = await screen.findByTestId('agents-table');
    const search = screen.getByTestId('agents-search');

    // Tag match
    await user.type(search, 'curator');
    expect(within(table).queryByText('odin')).not.toBeInTheDocument();
    expect(within(table).queryByText('frigg')).toBeInTheDocument();
    expect(within(table).queryByText('tyr')).not.toBeInTheDocument();

    // Description match
    await user.clear(search);
    await user.type(search, 'Implementation');
    expect(within(table).getByText('tyr')).toBeInTheDocument();
    expect(within(table).queryByText('frigg')).not.toBeInTheDocument();

    // Name match (case-insensitive)
    await user.clear(search);
    await user.type(search, 'ODIN');
    expect(within(table).getByText('odin')).toBeInTheDocument();
    expect(within(table).queryByText('tyr')).not.toBeInTheDocument();
  });

  it('Edit button on the detail panel loads the agent and opens the edit modal', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/agents/odin') {
        return { ...odin, prompt: 'You are Odin.' };
      }
      return {};
    });

    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    const table = await screen.findByTestId('agents-table');
    await user.click(within(table).getByText('odin'));

    const editBtn = await screen.findByTestId('agents-detail-edit-odin');
    await user.click(editBtn);

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/agents/odin');
    });

    // Edit modal renders with the existing prompt pre-filled.
    await waitFor(() => {
      const promptArea = screen.getByLabelText(/system prompt/i) as HTMLTextAreaElement;
      expect(promptArea.value).toBe('You are Odin.');
    });
    expect(screen.getByText('Edit odin')).toBeInTheDocument();
  });

  it('pulse fires on StatusDot when agent is stuck', async () => {
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    const table = await screen.findByTestId('agents-table');
    // Tyr is stuck — find the row and confirm the pulsing status dot is present.
    const tyrRow = within(table).getByText('tyr').closest('tr');
    expect(tyrRow).not.toBeNull();
    const pulseDot = tyrRow!.querySelector('.bizar-status-dot--pulse');
    expect(pulseDot).not.toBeNull();
  });

  it('renders the "No agent selected" placeholder when nothing is picked', async () => {
    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    expect(await screen.findByText(/No agent selected/i)).toBeInTheDocument();
  });

  it('refresh button reloads /agents and updates count', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') return { agents: [odin] };
      return {};
    });

    render(
      <Harness>
        <Agents
          snapshot={makeSnapshot()}
          settings={dummySettings}
          activeTab="agents"
          setActiveTab={() => undefined}
          refreshSnapshot={async () => undefined}
        />
      </Harness>,
    );

    expect(screen.getByTestId('agents-count').textContent).toContain('(3)');
    await user.click(screen.getByTestId('agents-refresh'));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/agents');
    });
    await waitFor(() => {
      expect(screen.getByTestId('agents-count').textContent).toContain('(1)');
    });
  });
});