/**
 * tests/views/Tasks.test.tsx
 *
 * Wave 3 redesign — exercises the new design-system kanban board:
 *   1. All 5 columns (Todo / In progress / Done / Failed / Backlog) appear.
 *   2. Each column's task count matches the snapshot.
 *   3. Priority filter narrows the visible task set across columns.
 *   4. Clicking a task row fires `onTaskClick` (i.e. opens the edit modal).
 *   5. Search input filters tasks by title (case-insensitive).
 *
 * Stubs `api.get` via vi.mock so the view boots from a synthetic snapshot.
 * The legacy `Modal` and `BacklogPanel` are still imported — Modal because
 * the redesigned view still uses it for the create/edit dialogs, and
 * BacklogPanel because the prop contract is preserved across this wave.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';
import { Tasks } from '../../src/web/views/Tasks';
import { api } from '../../src/web/lib/api';
import type { Settings, Snapshot, Task } from '../../src/web/lib/types';

vi.mock('../../src/web/lib/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  const put = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  return {
    api: { get, post, put, patch, del, setToken: vi.fn(), probeAuthStatus: vi.fn() },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    enhancePrompt: vi.fn(async (t: string) => t),
  };
});

const SETTINGS = {} as Settings;

function makeSnapshot(tasks: Task[]): Snapshot {
  return {
    tasks,
    agents: [],
    overview: {} as Snapshot['overview'],
    artifacts: [],
    projects: [],
    activeProject: null,
    config: {} as Snapshot['config'],
    settings: {} as Snapshot['settings'],
    mods: [],
    schedules: [],
    providers: [],
    mcps: [],
  };
}

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? `t-${Math.random().toString(36).slice(2, 8)}`,
    title: over.title ?? 'Untitled task',
    description: over.description ?? '',
    status: over.status ?? 'queued',
    priority: over.priority ?? 'normal',
    tags: over.tags ?? [],
    createdAt: over.createdAt ?? '2026-07-12T10:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-12T10:00:00.000Z',
    workedBy: over.workedBy ?? null,
    assignee: over.assignee ?? null,
  };
}

const Harness = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <ModalProvider>{children}</ModalProvider>
  </ToastProvider>
);

function renderTasks(snapshot: Snapshot, props: Partial<React.ComponentProps<typeof Tasks>> = {}) {
  const refresh = vi.fn(async () => undefined);
  const setActiveTab = vi.fn();
  return render(
    <Harness>
      <Tasks
        snapshot={snapshot}
        settings={SETTINGS}
        activeTab="tasks"
        setActiveTab={setActiveTab}
        refreshSnapshot={refresh}
        {...props}
      />
    </Harness>,
  );
}

describe('Tasks view — Wave 3 redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: api.get returns nothing (the view uses snapshot.tasks)
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders all 5 columns (Todo, In progress, Done, Failed, Backlog)', () => {
    const tasks: Task[] = [
      mkTask({ id: 'a', title: 'Alpha', status: 'queued' }),
      mkTask({ id: 'b', title: 'Beta', status: 'doing' }),
      mkTask({ id: 'c', title: 'Gamma', status: 'done' }),
      mkTask({ id: 'd', title: 'Delta', status: 'blocked' }),
      mkTask({ id: 'e', title: 'Epsilon', status: 'backlog' }),
    ];
    renderTasks(makeSnapshot(tasks));
    // The column label appears in both the column header AND the per-row
    // status badge. Use getAllByText so the assertion is "at least one".
    expect(screen.getAllByText('Todo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Backlog').length).toBeGreaterThan(0);
  });

  it('reports the correct task count per column', () => {
    const tasks: Task[] = [
      mkTask({ id: 'a', status: 'queued' }),
      mkTask({ id: 'b', status: 'queued' }),
      mkTask({ id: 'c', status: 'queued' }),
      mkTask({ id: 'd', status: 'doing' }),
      mkTask({ id: 'e', status: 'doing' }),
      mkTask({ id: 'f', status: 'done' }),
      mkTask({ id: 'g', status: 'blocked' }),
    ];
    renderTasks(makeSnapshot(tasks));

    // Each of the 4 rendered columns (Todo / In progress / Done / Failed)
    // exposes its count as a tabular-nums span with an aria-label like
    // "3 tasks". The Backlog column is rendered separately by BacklogPanel
    // (legacy) and is not part of this assertion.
    const countByLabel = (label: string): number =>
      screen.getAllByLabelText(label).length;
    expect(countByLabel('3 tasks')).toBe(1); // Todo
    expect(countByLabel('2 tasks')).toBe(1); // In progress
    expect(countByLabel('1 tasks')).toBe(2); // Done + Failed (both have 1)
  });

  it('priority filter narrows results across all columns', async () => {
    const tasks: Task[] = [
      mkTask({ id: 'h1', title: 'Hot', status: 'queued', priority: 'high' }),
      mkTask({ id: 'h2', title: 'Hot 2', status: 'doing', priority: 'high' }),
      mkTask({ id: 'n1', title: 'Normal', status: 'queued', priority: 'normal' }),
      mkTask({ id: 'l1', title: 'Low', status: 'done', priority: 'low' }),
    ];
    const user = userEvent.setup();
    renderTasks(makeSnapshot(tasks));

    // Initially all 4 visible.
    expect(screen.getByText('Hot')).toBeInTheDocument();
    expect(screen.getByText('Hot 2')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();

    // The Select component wraps the native <select> in a <span>; the
    // priority label is wired via aria-labelledby on the wrapper. Reach the
    // inner <select> through the labelled container.
    const priorityWrapper = screen.getByLabelText(/priority/i);
    const prioritySelect = priorityWrapper.querySelector('select') as HTMLSelectElement;
    expect(prioritySelect).toBeInTheDocument();
    await user.selectOptions(prioritySelect, 'high');

    await waitFor(() => {
      expect(screen.getByText('Hot')).toBeInTheDocument();
      expect(screen.getByText('Hot 2')).toBeInTheDocument();
    });
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    expect(screen.queryByText('Low')).not.toBeInTheDocument();

    // Reset to All — Low / Normal return.
    await user.selectOptions(prioritySelect, '');
    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });
  });

  it('clicking a task row opens the edit modal (fires onTaskClick)', async () => {
    const task = mkTask({ id: 'edit-me', title: 'Click to edit me', status: 'queued' });
    const user = userEvent.setup();
    renderTasks(makeSnapshot([task]));

    const row = screen.getByText('Click to edit me');
    // The title lives inside the row; click the row container.
    const rowEl = row.closest('[data-task-id="edit-me"]');
    expect(rowEl).not.toBeNull();
    await user.click(rowEl as HTMLElement);

    // The edit modal opens with the existing title prefilled — proves the
    // click handler routed to openEditTaskModal.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByDisplayValue('Click to edit me')).toBeInTheDocument();
  });

  it('search input filters tasks by title (case-insensitive)', async () => {
    const tasks: Task[] = [
      mkTask({ id: '1', title: 'Deploy v6.5 release', status: 'queued' }),
      mkTask({ id: '2', title: 'Write release notes', status: 'doing' }),
      mkTask({ id: '3', title: 'Unrelated task', status: 'queued' }),
    ];
    const user = userEvent.setup();
    renderTasks(makeSnapshot(tasks));

    const search = screen.getByLabelText('Search tasks');
    await user.type(search, 'RELEASE');

    await waitFor(() => {
      expect(screen.getByText('Deploy v6.5 release')).toBeInTheDocument();
      expect(screen.getByText('Write release notes')).toBeInTheDocument();
    });
    expect(screen.queryByText('Unrelated task')).not.toBeInTheDocument();

    // Clear and the unrelated task returns.
    await user.clear(search);
    await waitFor(() => {
      expect(screen.getByText('Unrelated task')).toBeInTheDocument();
    });
  });

  it('renders a loading state when snapshot.tasks is undefined on first mount', () => {
    const emptySnapshot = makeSnapshot([]);
    // Pretend the initial snapshot has no tasks — view starts in loading mode.
    (emptySnapshot as { tasks?: Task[] }).tasks = undefined as unknown as Task[];
    renderTasks(emptySnapshot);
    // The redesigned view uses LoadingState — it renders a role="status"
    // container with aria-live="polite". The view also has a hidden live
    // region for screen-reader status announcements, so we filter to the
    // one that actually contains loading text.
    const statuses = screen.getAllByRole('status');
    const loadingStatus = statuses.find(
      (el) => el.textContent && /loading/i.test(el.textContent),
    );
    expect(loadingStatus).toBeDefined();
    expect(loadingStatus!.textContent).toMatch(/loading/i);
  });
});
