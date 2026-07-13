/**
 * tests/views/Overview.test.tsx
 *
 * Wave 3 — Overview redesign smoke tests. Covers:
 *   - The new Overview mounts without crashing given a populated snapshot.
 *   - The five stat tiles render the correct labelled values.
 *   - The activity stream renders rows from the snapshot seed.
 *   - Per-row hide toggle POSTs to /activity/hide with the correct key.
 *   - "Hide all" calls POST /activity/hide with the full list of keys.
 *   - The SSE subscription is established (mock EventSource) but never actually fires.
 *   - Clicking the submit button calls /tasks/submit.
 *
 * Notes:
 *   - EventSource is mocked globally (no listener fires in jsdom).
 *   - api is mocked so no network is attempted.
 *   - ThemeProvider + ToastProvider + ModalProvider wrap the view so the
 *     helpers the Overview calls (useToast / useModal) get a real context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { Overview } from '../../src/web/views/Overview';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';

import type {
  ActivityItem,
  Agent,
  Artifact,
  Mod,
  Overview as OverviewData,
  ProjectRecord,
  Settings,
  Snapshot,
  Task,
} from '../../src/web/lib/types';
import { api } from '../../src/web/lib/api';

// ─── Mocks ──────────────────────────────────────────────────────────────────

class MockEventSource {
  url: string;
  readyState = 0;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (e: MessageEvent) => void) {
    (this.listeners[name] ||= []).push(cb);
  }
  removeEventListener() { /* noop for tests */ }
  close() {
    this.readyState = 2;
  }
  // Test helpers — manually dispatch like a real server would.
  __dispatch(name: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners[name]?.forEach((cb) => cb(ev));
  }
}
(MockEventSource as unknown as { instances: MockEventSource[] }).instances = [];

vi.stubGlobal('EventSource', MockEventSource);

vi.mock('../../src/web/lib/api', () => {
  return {
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      getToken: vi.fn(() => ''),
      setToken: vi.fn(),
      probeAuthStatus: vi.fn(),
    },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

const Harness: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ToastProvider>
    <ModalProvider>{children}</ModalProvider>
  </ToastProvider>
);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeOverview(overrides: Partial<OverviewData> = {}): OverviewData {
  return {
    counts: {
      agents: 7,
      plans: 4,
      projects: 3,
      sessions: 2,
      activeProject: 'p-1',
      ...(overrides.counts ?? {}),
    },
    recentActivity: overrides.recentActivity ?? [
      {
        ts: new Date().toISOString(),
        kind: 'task.created',
        title: 'Build settings page',
      } as unknown as ActivityItem,
      {
        ts: new Date(Date.now() - 5 * 60_000).toISOString(),
        kind: 'agent.delegated',
        agent: 'thor',
      } as unknown as ActivityItem,
    ],
    versions: {
      node: 'v20.10.0',
      platform: 'linux',
      projectRoot: '/srv/bizar',
      bizarRoot: '/home/user/.bizar',
      ...(overrides.versions ?? {}),
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  } as OverviewData;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    overview: makeOverview(),
    agents: [] as Agent[],
    artifacts: [] as Artifact[],
    projects: [
      { id: 'p-1', name: 'Bizar', path: '/srv/bizar', status: 'active' },
      { id: 'p-2', name: 'Spar', path: '/srv/spar', status: 'inactive' },
    ] as ProjectRecord[],
    activeProject: {
      id: 'p-1',
      name: 'Bizar',
      path: '/srv/bizar',
      status: 'active',
    } as ProjectRecord,
    config: { path: '', data: {}, raw: '', exists: true },
    settings: { path: '', data: {} as Settings, exists: true },
    tasks: [
      {
        id: 't-1',
        title: 'Refactor parser',
        description: '',
        status: 'doing',
        tags: [],
        priority: 'normal',
        assignee: 'thor',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Task,
      {
        id: 't-2',
        title: 'Add schema check',
        description: '',
        status: 'queued',
        tags: [],
        priority: 'normal',
        assignee: 'heimdall',
        createdAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
        updatedAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
      } as Task,
    ],
    mods: [
      {
        id: 'm-1',
        name: 'graphify',
        version: '1.0.0',
        author: 'bizar',
        description: '',
        bizar: '',
        type: 'tool',
        enabled: true,
        permissions: [],
        entry: {},
        files: [],
        path: '/mods/graphify',
        installedAt: null,
      } as Mod,
      {
        id: 'm-2',
        name: 'headroom',
        version: '0.4.0',
        author: 'bizar',
        description: '',
        bizar: '',
        type: 'service',
        enabled: false,
        permissions: [],
        entry: {},
        files: [],
        path: '/mods/headroom',
        installedAt: null,
      } as Mod,
    ],
    schedules: [],
    providers: [],
    mcps: [],
    ...overrides,
  };
}

const baseSettings = {
  theme: { mode: 'system' as const, accent: '', success: '', warning: '', error: '', info: '', fontFamily: '', fontSize: 13, compactMode: false, animations: true },
  ui: { layout: 'both' as const, showHeader: true, showStatusBar: true, defaultTab: 'overview' },
  defaultAgent: 'odin',
  defaultModel: 'claude-opus-4',
  notifications: { onAgentComplete: false, onPlanApproval: false },
  dashboard: { autoLaunchWeb: false, projectsDirectory: '/srv' },
  service: { enabled: false, autostart: false },
  about: { version: 'v6.5.0', homepage: '', license: '' },
  agents: { maxParallel: 3, stuckThresholdMs: 60_000, autoRestart: false },
  personalization: { displayName: '', role: '', team: '', aboutMe: '', preferences: '' },
  workflow: { artifactsEnabled: true, agentsDecideAutonomously: false, chatAutonomous: false },
} as unknown as Settings;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Overview (Wave 3 redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances.length = 0;
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/activity/hidden') return Promise.resolve({ hidden: [] });
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts without crashing and establishes the SSE subscription', async () => {
    const snapshot = makeSnapshot();
    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={vi.fn(async () => undefined)}
        />
      </Harness>,
    );

    expect(await screen.findByTestId('overview-stat-row')).toBeInTheDocument();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/activity/stream');
  });

  it('renders all five stat tiles with the correct values', async () => {
    const snapshot = makeSnapshot({
      overview: makeOverview({
        counts: { agents: 7, plans: 4, projects: 3, sessions: 2, activeProject: 'p-1' },
      }),
    });
    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={vi.fn(async () => undefined)}
        />
      </Harness>,
    );

    // StatTile doesn't forward data-testid; find tiles by their label
    // text. Labels are sentence-cased in DOM, uppercase via CSS.
    expect(await screen.findByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Mods')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();

    // 7 agents, 2 tasks, 2 projects, 2 mods, 2 background
    const row = await screen.findByTestId('overview-stat-row');
    expect(within(row).getByText('7')).toBeInTheDocument();
    // The number "2" appears multiple times (tasks, projects, mods, background)
    const twos = within(row).getAllByText('2');
    expect(twos.length).toBeGreaterThanOrEqual(4);
  });

  it('renders activity rows from the snapshot seed', async () => {
    const snapshot = makeSnapshot({
      overview: makeOverview({
        recentActivity: [
          { ts: new Date().toISOString(), kind: 'task.created', title: 'Build settings page' } as ActivityItem,
          { ts: new Date().toISOString(), kind: 'agent.delegated', agent: 'thor' } as ActivityItem,
        ],
      }),
    });
    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={vi.fn(async () => undefined)}
        />
      </Harness>,
    );

    const list = await screen.findByTestId('overview-activity-list');
    expect(within(list).getByText(/Task created/i)).toBeInTheDocument();
    expect(within(list).getByText(/Agent delegated/i)).toBeInTheDocument();
  });

  it('hides a single activity row when its icon button is clicked', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const snapshot = makeSnapshot();
    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={vi.fn(async () => undefined)}
        />
      </Harness>,
    );

    const list = await screen.findByTestId('overview-activity-list');
    const hideButtons = within(list).getAllByRole('button', { name: /hide from overview/i });
    expect(hideButtons.length).toBeGreaterThan(0);

    await user.click(hideButtons[0]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/activity/hide',
        expect.objectContaining({ keys: expect.any(Array) }),
      );
    });
  });

  it('posts the full list of keys when "Hide all" is clicked', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const snapshot = makeSnapshot();
    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={vi.fn(async () => undefined)}
        />
      </Harness>,
    );

    await user.click(await screen.findByTestId('overview-hide-all'));

    await waitFor(() => {
      const calls = (api.post as ReturnType<typeof vi.fn>).mock.calls;
      const hideCall = calls.find(([url]: unknown[]) => url === '/activity/hide');
      expect(hideCall).toBeDefined();
      const body = hideCall?.[1] as { keys: string[] };
      expect(Array.isArray(body.keys)).toBe(true);
      expect(body.keys.length).toBeGreaterThan(0);
    });

    confirmSpy.mockRestore();
  });

  it('calls /tasks/submit when the "Submit to Odin" button is clicked', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ subtasks: [{}, {}] });
    const user = userEvent.setup();
    const refresh = vi.fn(async () => undefined);
    const snapshot = makeSnapshot();

    render(
      <Harness>
        <Overview
          snapshot={snapshot}
          settings={baseSettings}
          activeTab="overview"
          setActiveTab={vi.fn()}
          refreshSnapshot={refresh}
        />
      </Harness>,
    );

    const textarea = await screen.findByTestId('overview-prompt-input');
    await user.type(textarea, 'Build a thing');
    await user.click(screen.getByTestId('overview-submit'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/tasks/submit',
        expect.objectContaining({ title: expect.stringContaining('Build a thing') }),
      );
    });
  });
});
