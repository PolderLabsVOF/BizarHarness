/**
 * tests/mobile-tasks.test.tsx
 *
 * v5.4 — Mobile tasks component tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MobileTasks } from '../src/web/mobile/MobileTasks';
import { TaskCard } from '../src/web/components/TaskCard';
import type { Snapshot, Task } from '../src/web/lib/types';

const mockTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test task',
  description: 'A test task description',
  status: 'queued',
  tags: [],
  priority: 'normal',
  assignee: null,
  parent: null,
  dependencies: [],
  timeSpent: undefined,
  recurring: null,
  attachments: [],
  comments: [],
  activity: [],
  archived: false,
  workedBy: null,
  dueDate: null,
  subtasks: [],
  metadata: null,
  progress: undefined,
  currentStep: null,
  progressAgent: null,
  progressHistory: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  _timerStart: undefined,
  ...overrides,
});

const mockSnapshot = (tasks: Task[] = []): Snapshot => ({
  overview: {
    counts: { agents: 0, plans: 0, projects: 0, sessions: 0, activeProject: null },
    recentActivity: [],
    versions: { node: '', platform: '', projectRoot: '', bizarRoot: '' },
    generatedAt: new Date().toISOString(),
  },
  agents: [],
  artifacts: [],
  projects: [],
  activeProject: null,
  config: { path: '', data: {}, raw: '', exists: false },
  settings: { path: '', data: { theme: { mode: 'dark', accent: '#8b5cf6', success: '#3fb950', warning: '#d29922', error: '#f85149', info: '#58a6ff', fontFamily: '', fontSize: 14, compactMode: false, animations: true }, ui: { layout: 'topnav', showHeader: true, showStatusBar: true, defaultTab: '' }, defaultAgent: 'odin', defaultModel: '', notifications: { onAgentComplete: false, onPlanApproval: false }, dashboard: { autoLaunchWeb: false }, service: { enabled: false, autostart: false }, about: { version: '', homepage: '', license: '' }, agents: { maxParallel: 1, stuckThresholdMs: 0, autoRestart: false }, personalization: { displayName: '', role: '', team: '', aboutMe: '', preferences: '' }, workflow: { artifactsEnabled: false, agentsDecideAutonomously: false, chatAutonomous: false } }, exists: false },
  tasks,
  mods: [],
  schedules: [],
  providers: [],
  mcps: [],
});

describe('MobileTasks', () => {
  const refreshSnapshot = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders filter tabs with counts', () => {
    const tasks = [
      mockTask({ id: '1', status: 'queued' }),
      mockTask({ id: '2', status: 'doing' }),
      mockTask({ id: '3', status: 'done' }),
      mockTask({ id: '4', status: 'failed' }),
    ];
    render(<MobileTasks snapshot={mockSnapshot(tasks)} refreshSnapshot={refreshSnapshot} />);

    expect(screen.getByRole('button', { name: /All 4/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Todo 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Doing 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Done 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Failed 1/i })).toBeInTheDocument();
  });

  it('filters by search query', async () => {
    const tasks = [
      mockTask({ id: '1', title: 'Build the thing' }),
      mockTask({ id: '2', title: 'Fix the bug' }),
    ];
    render(<MobileTasks snapshot={mockSnapshot(tasks)} refreshSnapshot={refreshSnapshot} />);

    // Both visible initially
    expect(screen.getByText('Build the thing')).toBeInTheDocument();
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();

    // Type search query using fireEvent (more reliable in tests)
    const input = screen.getByPlaceholderText('Search tasks...');
    fireEvent.change(input, { target: { value: 'build' } });

    await waitFor(() => {
      expect(screen.getByText('Build the thing')).toBeInTheDocument();
      expect(screen.queryByText('Fix the bug')).not.toBeInTheDocument();
    });
  });

  it('opens create sheet on FAB click', async () => {
    render(<MobileTasks snapshot={mockSnapshot([])} refreshSnapshot={refreshSnapshot} />);

    const fab = screen.getByRole('button', { name: /Create new task/i });
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows empty state when no tasks', () => {
    render(<MobileTasks snapshot={mockSnapshot([])} refreshSnapshot={refreshSnapshot} />);
    expect(screen.getByText(/No tasks/i)).toBeInTheDocument();
  });
});

describe('TaskCard', () => {
  it('renders title and status', () => {
    const task = mockTask({ title: 'My task title', status: 'doing' });
    render(<TaskCard task={task} />);
    expect(screen.getByText('My task title')).toBeInTheDocument();
  });

  it('expands on click to show details', async () => {
    const task = mockTask({ title: 'Expandable task', description: 'Task description here', status: 'queued' });
    render(<TaskCard task={task} />);

    // Details not visible initially
    expect(screen.queryByText('Task description here')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('Expandable task'));

    await waitFor(() => {
      expect(screen.getByText('Task description here')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Start/i })).toBeInTheDocument();
  });

  it('color-coded by status', () => {
    const doingTask = mockTask({ id: 'doing-task', status: 'doing' });
    const { rerender } = render(<TaskCard task={doingTask} />);

    const card = screen.getByText('Test task').closest('.task-card-mobile');
    expect(card).toHaveClass('is-doing');

    const doneTask = mockTask({ id: 'done-task', status: 'done' });
    rerender(<TaskCard task={doneTask} />);

    const doneCard = screen.getByText('Test task').closest('.task-card-mobile');
    expect(doneCard).toHaveClass('is-done');
  });
});
