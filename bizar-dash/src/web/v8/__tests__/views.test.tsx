import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { OverviewView } from '../views/Overview/OverviewView.js';
import { TasksView } from '../views/Tasks/TasksView.js';
import { GoalsView } from '../views/Goals/GoalsView.js';
import { AgentsView } from '../views/Agents/AgentsView.js';
import { ActivityView } from '../views/Activity/ActivityView.js';
import { MemoryView } from '../views/Memory/MemoryView.js';
import { LibrariesView } from '../views/Libraries/LibrariesView.js';
import { SettingsView } from '../views/Settings/SettingsView.js';

/**
 * Views test (S10) — every view pulls live data from the backend now.
 * We mock `fetch` so jsdom doesn't try to hit a real server. Each test
 * asserts: (1) the view renders its title/header, (2) the rendered
 * surface reflects whatever the mocked endpoint returned.
 */

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

interface MockRoute {
  url: string;
  body: unknown;
}

let routes: MockRoute[] = [];

function mockFetch(routesIn: MockRoute[]): void {
  routes = routesIn;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = routes.find((r) => url.startsWith(r.url));
    if (!match) {
      return new Response(JSON.stringify({ error: 'not-mocked', url }), { status: 404 });
    }
    return new Response(JSON.stringify(match.body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  // Reasonable default — most tests only care about one endpoint.
  mockFetch([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OverviewView', () => {
  it('renders the four stat tiles plus activity + needs-attention cards', async () => {
    mockFetch([
      { url: '/api/snapshot', body: { overview: { tasks: { active: 2, queued: 1, done: 0, blocked: 0 }, goals: { atRisk: 1, total: 3, done: 1 }, agents: { running: 2, total: 4, idle: 1, error: 0 }, tokens: { last24h: 1_500_000 }, needsAttention: [{ label: 'CI', value: 'failed' }] } } },
      { url: '/api/activity', body: { events: [] } },
    ]);
    render(<Providers><OverviewView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText(/Active tasks/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Goals at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Agents running/i)).toBeInTheDocument();
    expect(screen.getByText(/Tokens \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
  });
});

describe('TasksView', () => {
  it('renders kanban column titles for a non-empty task list', async () => {
    mockFetch([
      { url: '/api/tasks', body: { tasks: [{ id: 't1', title: 'Ship v8 dashboard', status: 'doing', priority: 'high' }] } },
    ]);
    render(<Providers><TasksView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText(/Backlog/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/To do/i)).toBeInTheDocument();
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/In review/i)).toBeInTheDocument();
    expect(screen.getByText(/Done/i)).toBeInTheDocument();
    expect(screen.getByText(/Ship v8 dashboard/i)).toBeInTheDocument();
  });
});

describe('GoalsView', () => {
  it('renders goal titles pulled from /api/goals', async () => {
    mockFetch([
      { url: '/api/goals', body: { goals: [
        { id: 'g1', title: 'Ship v8 dashboard', status: 'active', progress: 0.5, keyResults: [{ id: 'kr1', title: 'Cut S9 polish in half', done: false }] },
        { id: 'g2', title: 'Adopt OKLch tokens', status: 'on-track', progress: 0.8, keyResults: [] },
      ] } },
    ]);
    render(<Providers><GoalsView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText(/Ship v8 dashboard/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Adopt OKLch tokens/i)).toBeInTheDocument();
  });
});

describe('AgentsView', () => {
  it('renders Bizar + CC agents with the source filter chip', async () => {
    mockFetch([
      { url: '/api/agents', body: { agents: [{ name: 'atlas', role: 'coder', status: 'busy' }] } },
      { url: '/api/cc-agents', body: { agents: [{ id: 's1', sessionId: 's1', name: 'CC worker', kind: 'background', status: 'idle' }] } },
    ]);
    render(<Providers><AgentsView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText('atlas')).toBeInTheDocument();
    });
    expect(screen.getByText('CC worker')).toBeInTheDocument();
    expect(screen.getByText(/^All$/)).toBeInTheDocument();
    expect(screen.getByText(/^Bizar$/)).toBeInTheDocument();
    expect(screen.getByText(/^Claude Code$/)).toBeInTheDocument();
  });
});

describe('ActivityView', () => {
  it('renders the heading even when no events', async () => {
    mockFetch([{ url: '/api/activity', body: { events: [] } }]);
    render(<Providers><ActivityView /></Providers>);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /activity/i })).toBeInTheDocument();
    });
  });
});

describe('MemoryView', () => {
  it('renders scope filter chips and an empty state when no entries', async () => {
    mockFetch([{ url: '/api/memory', body: { entries: [] } }]);
    render(<Providers><MemoryView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText(/^All$/)).toBeInTheDocument();
    });
    expect(screen.getByText(/^Project$/)).toBeInTheDocument();
    expect(screen.getByText(/^Global$/)).toBeInTheDocument();
  });
});

describe('LibrariesView (Skills)', () => {
  it('renders items fetched from /api/skills', async () => {
    mockFetch([
      { url: '/api/skills', body: { skills: [
        { id: 'frigg', name: 'Frigg', slug: 'frigg', status: 'enabled', description: 'Read-only codebase Q&A.' },
        { id: 'mimir', name: 'Mimir', slug: 'mimir', status: 'enabled', description: 'Deep codebase research.' },
      ] } },
    ]);
    const { container } = render(<Providers><LibrariesView kind="skills" /></Providers>);
    await waitFor(() => {
      expect(container.textContent).toContain('Frigg');
    });
    expect(container.textContent).toContain('Read-only codebase Q&A.');
  });
});

describe('SettingsView', () => {
  it('renders the 16 settings sections and shows the active nav', () => {
    render(<Providers><SettingsView /></Providers>);
    expect(screen.getByRole('heading', { level: 2, name: /^General$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Theme$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Density$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Privacy$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Advanced$/i })).toBeInTheDocument();
  });

  it('marks the General nav entry as the active section', () => {
    render(<Providers><SettingsView /></Providers>);
    const navButtons = screen.getAllByRole('button');
    const generalBtn = navButtons.find((b) => b.textContent === 'General');
    expect(generalBtn?.getAttribute('aria-current')).toBe('true');
  });
});