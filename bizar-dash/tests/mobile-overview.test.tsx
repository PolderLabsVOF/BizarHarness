/**
 * tests/mobile-overview.test.tsx
 *
 * v5.4 — Component tests for the mobile-optimized overview (hero + stats +
 * recent activity + quick actions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MobileOverview } from '../src/web/mobile/MobileOverview';
import type { Snapshot } from '../src/web/lib/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/web/lib/api', () => ({
  api: {
    post: vi.fn().mockResolvedValue({ ok: true }),
    get: vi.fn().mockResolvedValue({}),
  },
}));

// Stub lucide icons — keep them tiny testids so we can assert presence cheaply.
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  const make = (name: string) => {
    const Cmp = (props: { size?: number }) => <svg data-testid={`icon-${name}`} data-size={props.size} />;
    Cmp.displayName = name;
    return Cmp;
  };
  return {
    ...actual,
    CheckSquare: make('CheckSquare'),
    Clock: make('Clock'),
    Bot: make('Bot'),
    Coins: make('Coins'),
    Plus: make('Plus'),
    MessageSquare: make('MessageSquare'),
    Stethoscope: make('Stethoscope'),
    Send: make('Send'),
  };
});

// ─── Test data ──────────────────────────────────────────────────────────────

const BASE_SNAPSHOT: Snapshot = {
  overview: {
    counts: { agents: 0, plans: 0, projects: 0, sessions: 0 },
    recentActivity: [],
    versions: { node: '', platform: '', projectRoot: '', bizarRoot: '' },
    generatedAt: '',
  },
  agents: [],
  artifacts: [],
  projects: [],
  activeProject: null,
  config: { path: '', data: null, raw: '', exists: false },
  settings: {
    path: '',
    data: {
      theme: { mode: 'dark', accent: '#8b5cf6', success: '#3fb950', warning: '#f0883e', error: '#f85149', info: '#58a6ff', fontFamily: 'sans-serif', fontSize: 14, compactMode: false, animations: true },
      ui: { layout: 'topnav', showHeader: true, showStatusBar: true, defaultTab: 'overview' },
      defaultAgent: 'odin',
      defaultModel: '',
      notifications: { onAgentComplete: false, onPlanApproval: false },
      dashboard: { autoLaunchWeb: false },
      service: { enabled: false, autostart: false },
      about: { version: '5.4.0', homepage: '', license: 'MIT' },
      agents: { maxParallel: 6, stuckThresholdMs: 600000, autoRestart: false },
      personalization: { displayName: '', role: '', team: '', aboutMe: '', preferences: '' },
      workflow: { artifactsEnabled: true, agentsDecideAutonomously: false, chatAutonomous: false },
      headroom: { enabled: false, autoInstall: true, port: 8787, host: '127.0.0.1', outputShaper: false, telemetry: false, budget: 0, backend: 'anthropic', autoStart: true, autoWrap: true, routeAllProviders: true },
    },
    exists: true,
  },
  tasks: [],
  mods: [],
  schedules: [],
  providers: [],
  mcps: [],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MobileOverview', () => {
  const refreshSnapshot = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders hero card with input', () => {
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByRole('heading', { name: /what do you want to do/i })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/implement user authentication/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('disables submit button when textarea is empty', () => {
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();
  });

  it('enables submit button when textarea has text', async () => {
    const user = userEvent.setup();
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    await user.type(screen.getByPlaceholderText(/implement user authentication/i), 'fix the bug');
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
  });

  it('renders 4 stat cards', () => {
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Schedules')).toBeInTheDocument();
    expect(screen.getByText('Active Agents')).toBeInTheDocument();
    expect(screen.getByText('API Tokens')).toBeInTheDocument();

    // Each stat label sits on a card with the matching modifier class.
    expect(document.querySelectorAll('.mobile-stat-card.is-blue')).toHaveLength(1);
    expect(document.querySelectorAll('.mobile-stat-card.is-purple')).toHaveLength(1);
    expect(document.querySelectorAll('.mobile-stat-card.is-green')).toHaveLength(1);
    expect(document.querySelectorAll('.mobile-stat-card.is-yellow')).toHaveLength(1);
  });

  it('reflects task count and active task subtext from snapshot', () => {
    const snap: Snapshot = {
      ...BASE_SNAPSHOT,
      tasks: [
        { ...BASE_SNAPSHOT.tasks[0], id: 't1', title: 'a', description: '', status: 'doing', tags: [], priority: 'normal', createdAt: '', updatedAt: '' },
        { ...BASE_SNAPSHOT.tasks[0], id: 't2', title: 'b', description: '', status: 'done', tags: [], priority: 'normal', createdAt: '', updatedAt: '' },
        { ...BASE_SNAPSHOT.tasks[0], id: 't3', title: 'c', description: '', status: 'queued', tags: [], priority: 'normal', createdAt: '', updatedAt: '' },
      ] as Snapshot['tasks'],
      schedules: [
        { id: 's1', name: 'nightly', cron: '0 0 * * *', enabled: true, lastRun: null, nextRun: null, target: 'agent', agentName: 'odin', createdAt: '', updatedAt: '' },
      ] as Snapshot['schedules'],
    };

    render(<MobileOverview snapshot={snap} refreshSnapshot={refreshSnapshot} />);

    // Tasks stat — first mobile-stat-value inside the blue card.
    const blueCard = document.querySelector('.mobile-stat-card.is-blue')!;
    expect(blueCard.querySelector('.mobile-stat-value')?.textContent).toBe('3');
    expect(blueCard.querySelector('.mobile-stat-subtext')?.textContent).toBe('1 active');

    // Schedules stat.
    const purpleCard = document.querySelector('.mobile-stat-card.is-purple')!;
    expect(purpleCard.querySelector('.mobile-stat-value')?.textContent).toBe('1');
  });

  it('shows recent activity when snapshot has items', () => {
    const snap: Snapshot = {
      ...BASE_SNAPSHOT,
      overview: {
        ...BASE_SNAPSHOT.overview,
        recentActivity: [
          { ts: '2026-07-05T12:34:00.000Z', kind: 'task', title: 'hello' },
          { ts: '2026-07-05T12:35:00.000Z', kind: 'agent', name: 'odin' },
        ],
      },
    };

    render(<MobileOverview snapshot={snap} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByRole('heading', { name: /recent activity/i })).toBeInTheDocument();
    const items = document.querySelectorAll('.mobile-activity-item');
    expect(items).toHaveLength(2);
    expect(screen.queryByText(/no recent activity/i)).not.toBeInTheDocument();
  });

  it('shows empty state when there is no recent activity', () => {
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
    expect(document.querySelector('.mobile-activity-list')).toBeNull();
  });

  it('renders quick action buttons', () => {
    render(<MobileOverview snapshot={BASE_SNAPSHOT} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run doctor/i })).toBeInTheDocument();
  });

  it('clamps recent activity to 8 items', () => {
    const many: { ts: string; kind: string; title: string }[] = [];
    for (let i = 0; i < 12; i++) {
      many.push({ ts: `2026-07-05T12:${String(i).padStart(2, '0')}:00.000Z`, kind: 'task', title: `t${i}` });
    }
    const snap: Snapshot = {
      ...BASE_SNAPSHOT,
      overview: { ...BASE_SNAPSHOT.overview, recentActivity: many },
    };

    render(<MobileOverview snapshot={snap} refreshSnapshot={refreshSnapshot} />);

    expect(document.querySelectorAll('.mobile-activity-item')).toHaveLength(8);
  });

  it('handles null snapshot without crashing', () => {
    render(<MobileOverview snapshot={null} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByRole('heading', { name: /what do you want to do/i })).toBeInTheDocument();
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});