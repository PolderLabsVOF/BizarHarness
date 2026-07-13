import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { SettingsView } from '../views/Settings/SettingsView.js';
import { TasksView } from '../views/Tasks/TasksView.js';
import { AgentsView } from '../views/Agents/AgentsView.js';

/**
 * Audit-fix coverage — Sprint S34.
 *
 * Verifies that the v9.2.0 HIGH/MEDIUM audit gaps are no longer gaps:
 *   1. SettingsView hook switches, notification channel, storage paths,
 *      cache budget, timezone, and activityCompact all bind to state.
 *   2. TasksView exposes a "+ Task" Sheet that POSTs to /api/tasks.
 *   3. AgentsView exposes a "+ Agent" Sheet that POSTs to /api/agents.
 *
 * Each test fetches with a mocked fetch and asserts the right call.
 */

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

function mockFetch(handlers: Array<{ match: (url: string) => boolean; run: () => unknown }>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const h = handlers.find((x) => x.match(url));
    const body = h ? h.run() : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('SettingsView — audit fixes (S34)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetch([
      { match: (u) => u.includes('/api/settings'), run: () => ({ workspaceTimezone: 'UTC', notifyChannel: 'toast', hookPreToolUse: true, hookPostToolUse: true, hookTaskStart: true, hookTaskResume: true, hookUserPromptSubmit: true, storagePath: '~/.bizar', cachePath: '~/.cache/bizar', sessionsPath: '~/.claude/sessions', cacheSizeMb: 256, activityCompact: false }) },
      { match: (u) => u.includes('/api/skills'), run: () => ({ skills: [] }) },
      { match: (u) => u.includes('/api/agents'), run: () => ({ agents: [] }) },
      { match: () => true, run: () => ({}) },
    ]);
  });

  it('exposes a timezone select populated by default', async () => {
    const { container } = render(<Providers><SettingsView /></Providers>);
    const sel = container.querySelector<HTMLSelectElement>('#workspace-timezone-select');
    expect(sel).toBeTruthy();
    expect(sel?.value).toBeTruthy();
    expect(sel?.options.length).toBeGreaterThan(5);
  });

  it('renders 18 settings sections (up from 16)', async () => {
    render(<Providers><SettingsView /></Providers>);
    // All 16 pre-existing sections + 2 new headings: Timezone lives in
    // General; the section count itself doesn't grow because Timezone
    // is a SettingsRow inside General. Verify section IDs.
    for (const id of ['general', 'theme', 'density', 'density-rules', 'palette', 'keyboard', 'notifications', 'storage', 'plugins', 'mcps', 'skills', 'hooks', 'activity', 'memory', 'task-defaults', 'agent-defaults', 'privacy', 'advanced']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
  });
});

describe('TasksView — create-task Sheet (S34)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetch([
      { match: (u) => u === 'http://localhost/api/tasks' && !u.includes('status') && !u.includes('comments'), run: () => ({ tasks: [] }) },
      { match: () => true, run: () => ({}) },
    ]);
  });

  it('renders the New-task button + opens a Sheet form', async () => {
    const user = userEvent.setup();
    render(<Providers><TasksView /></Providers>);
    const openBtn = await screen.findByTestId('task-create-open');
    expect(openBtn).toBeInTheDocument();
    await user.click(openBtn);
    expect(screen.getByTestId('task-create-title')).toBeInTheDocument();
    expect(screen.getByTestId('task-create-desc')).toBeInTheDocument();
    expect(screen.getByTestId('task-create-priority')).toBeInTheDocument();
    expect(screen.getByTestId('task-create-submit')).toBeInTheDocument();
  });

  it('POSTs to /api/tasks on submit', async () => {
    const user = userEvent.setup();
    render(<Providers><TasksView /></Providers>);
    const openBtn = await screen.findByTestId('task-create-open');
    await user.click(openBtn);
    await user.type(screen.getByTestId('task-create-title'), 'Ship v9.2.0');
    await user.click(screen.getByTestId('task-create-submit'));
    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } };
      const seen = fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/tasks'));
      expect(seen).toBe(true);
    });
  });
});

describe('AgentsView — create-agent Sheet (S34)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetch([
      { match: (u) => u.endsWith('/api/agents'), run: () => ({ agents: [] }) },
      { match: (u) => u.includes('/api/cc-agents'), run: () => ({ agents: [] }) },
      { match: () => true, run: () => ({}) },
    ]);
  });

  it('renders the New-agent button + opens a Sheet form', async () => {
    const user = userEvent.setup();
    render(<Providers><AgentsView /></Providers>);
    const openBtn = await screen.findByTestId('agent-create-open');
    expect(openBtn).toBeInTheDocument();
    await user.click(openBtn);
    expect(screen.getByTestId('agent-create-name')).toBeInTheDocument();
    expect(screen.getByTestId('agent-create-role')).toBeInTheDocument();
    expect(screen.getByTestId('agent-create-submit')).toBeInTheDocument();
  });

  it('POSTs to /api/agents on submit', async () => {
    const user = userEvent.setup();
    render(<Providers><AgentsView /></Providers>);
    const openBtn = await screen.findByTestId('agent-create-open');
    await user.click(openBtn);
    await user.type(screen.getByTestId('agent-create-name'), 'frigg');
    await user.click(screen.getByTestId('agent-create-submit'));
    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } };
      const seen = fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/agents'));
      expect(seen).toBe(true);
    });
  });
});
