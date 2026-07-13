/**
 * tasks-detail.test.tsx — end-to-end coverage for the TasksView →
 * KanbanDetailDialog flow.
 *
 * Mocks fetch so jsdom doesn't try to hit a real server. Each test
 * mounts <TasksView> with a different mock fixture and asserts the
 * resulting UI calls the right endpoints.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { TasksView } from '../views/Tasks/TasksView.js';

interface MockRoute {
  match: (url: string, method: string) => boolean;
  body?: unknown;
  status?: number;
}

let routes: MockRoute[] = [];
let lastCall: { url: string; method: string; body: unknown } | null = null;

function mockFetch(routesIn: MockRoute[]): void {
  routes = routesIn;
  lastCall = null;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    lastCall = { url, method, body: init?.body ? JSON.parse(String(init.body)) : null };
    const match = routes.find((r) => r.match(url, method));
    if (!match) {
      return new Response(JSON.stringify({ error: 'not-mocked', url, method }), { status: 404 });
    }
    return new Response(
      match.body !== undefined ? JSON.stringify(match.body) : '',
      { status: match.status ?? 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

const SAMPLE_TASK = {
  id: 'tsk_a',
  title: 'Original title',
  description: '',
  status: 'queued',
  priority: 'medium',
  tags: [],
  assignee: null,
  branch: null,
};

beforeEach(() => {
  mockFetch([
    { match: (url) => url === '/api/tasks' && url === '/api/tasks', body: [SAMPLE_TASK] },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TasksView detail dialog', () => {
  it('renders columns + cards from /api/tasks', async () => {
    mockFetch([
      { match: (url, m) => url === '/api/tasks' && m === 'GET', body: [SAMPLE_TASK] },
    ]);
    render(<Providers><TasksView /></Providers>);
    await waitFor(() => {
      expect(screen.getByText('Original title')).toBeInTheDocument();
    });
  });

  it('opens the detail dialog when the card body is clicked', async () => {
    mockFetch([
      { match: (url, m) => url === '/api/tasks' && m === 'GET', body: [SAMPLE_TASK] },
    ]);
    render(<Providers><TasksView /></Providers>);
    const card = await screen.findByText('Original title');
    await userEvent.click(card);
    // Detail dialog title row.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Original title/ })).toBeInTheDocument();
    });
  });

  it('saves edits via PUT /api/tasks/:id', async () => {
    mockFetch([
      { match: (url, m) => url === '/api/tasks' && m === 'GET', body: [SAMPLE_TASK] },
      {
        match: (url, m) => m === 'PUT' && url === '/api/tasks/tsk_a',
        body: { ...SAMPLE_TASK, title: 'Edited title', priority: 'high' },
      },
    ]);
    render(<Providers><TasksView /></Providers>);
    const card = await screen.findByText('Original title');
    await userEvent.click(card);
    // Dialog renders into a Radix portal. Look up the title input by id.
    const titleInput = (await waitFor(() => document.getElementById('title'))) as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    fireEvent.change(titleInput, { target: { value: 'Edited title' } });
    const saveBtn = await screen.findByRole('button', { name: /save changes/i });
    await userEvent.click(saveBtn);
    await waitFor(() => {
      expect(lastCall?.method).toBe('PUT');
      expect(lastCall?.url).toBe('/api/tasks/tsk_a');
    });
    expect((lastCall?.body as { title: string })?.title).toBe('Edited title');
  });

  it('starts an agent via POST /api/tasks/:id/start for queued tasks', async () => {
    mockFetch([
      { match: (url, m) => url === '/api/tasks' && m === 'GET', body: [SAMPLE_TASK] },
      {
        match: (url, m) => m === 'POST' && url === '/api/tasks/tsk_a/start',
        body: { ok: true, task: { ...SAMPLE_TASK, status: 'doing' }, dispatched: {}, warnings: [] },
      },
    ]);
    render(<Providers><TasksView /></Providers>);
    await screen.findByText('Original title');
    await userEvent.click(screen.getByText('Original title'));
    const startBtn = await screen.findByRole('button', { name: /start agent/i });
    await userEvent.click(startBtn);
    await waitFor(() => {
      expect(lastCall?.method).toBe('POST');
      expect(lastCall?.url).toBe('/api/tasks/tsk_a/start');
    });
  });
});