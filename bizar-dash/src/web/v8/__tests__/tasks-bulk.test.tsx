/**
 * tasks-bulk.test.tsx — multi-select + bulk actions on the kanban
 * board. Verifies:
 *   - the toolbar swaps to bulk mode when ≥1 card is selected.
 *   - the bulk archive button calls POST /api/tasks/bulk with
 *     `action: 'archive'`.
 *   - Esc clears the selection.
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
let fetchSpy: ReturnType<typeof vi.fn>;

function mockFetch(routesIn: MockRoute[]): void {
  routes = routesIn;
  lastCall = null;
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
  });
  globalThis.fetch = fetchSpy as typeof fetch;
}

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

const TASKS = [
  { id: 'tsk_a', title: 'Task A', status: 'queued', priority: 'medium', tags: [] },
  { id: 'tsk_b', title: 'Task B', status: 'queued', priority: 'medium', tags: [] },
  { id: 'tsk_c', title: 'Task C', status: 'doing', priority: 'medium', tags: [] },
];

beforeEach(() => {
  // Default: provide the list endpoint, return 404 for everything else.
  mockFetch([
    { match: (url, m) => url === '/api/tasks' && m === 'GET', body: TASKS },
  ]);
  // window.confirm: auto-accept so the bulk-delete path runs.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TasksView bulk selection', () => {
  it('toggling a card checkbox swaps the toolbar into bulk mode', async () => {
    render(<Providers><TasksView /></Providers>);
    await screen.findByText('Task A');
    const cards = document.querySelectorAll('[data-kanban-card-id]');
    expect(cards.length).toBeGreaterThan(0);
    // Hover/show selection is required for the checkbox to be clickable.
    // Easiest: trigger the first card's click to show selection, then
    // click the card's checkbox.
    const firstCard = cards[0] as HTMLElement;
    firstCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    // Force-showSelection via the store: just call the toolbar's selection
    // by clicking on the card directly (KanbanCard wires the click).
    await userEvent.click(firstCard);
    // First click opens detail. Click the dialog's X icon (the X has
    // aria-label="Close" but no text content — that's the unique one).
    const xBtn = document.querySelector('[aria-label="Close"][type="button"]') as HTMLButtonElement | null;
    expect(xBtn).not.toBeNull();
    await userEvent.click(xBtn!);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    // Now click the checkbox inside the first card.
    const checkbox = firstCard.querySelector('[role="checkbox"]') as HTMLButtonElement | null;
    expect(checkbox).not.toBeNull();
    await userEvent.click(checkbox!);
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
    // Toolbar swap reveals the bulk-mode "Archive" action.
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
  });

  it('bulk archive hits /api/tasks/bulk with action archive', async () => {
    render(<Providers><TasksView /></Providers>);
    await screen.findByText('Task A');
    // Force selection by clicking the checkbox on the first two cards.
    const cards = document.querySelectorAll('[data-kanban-card-id]');
    for (let i = 0; i < 2; i++) {
      const card = cards[i] as HTMLElement;
      const cb = card.querySelector('[role="checkbox"]') as HTMLButtonElement;
      await userEvent.click(cb);
    }
    const archiveBtn = screen.getByRole('button', { name: /^archive$/i });
    await userEvent.click(archiveBtn);
    await waitFor(() => {
      expect(lastCall?.method).toBe('POST');
      expect(lastCall?.url).toBe('/api/tasks/bulk');
    });
    expect((lastCall?.body as { action: string })?.action).toBe('archive');
    expect((lastCall?.body as { ids: string[] })?.ids).toEqual(['tsk_a', 'tsk_b']);
  });

  it('Esc clears selection', async () => {
    render(<Providers><TasksView /></Providers>);
    await screen.findByText('Task A');
    const card = document.querySelector('[data-kanban-card-id="tsk_a"]') as HTMLElement;
    const cb = card.querySelector('[role="checkbox"]') as HTMLButtonElement;
    await userEvent.click(cb);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    });
  });
});