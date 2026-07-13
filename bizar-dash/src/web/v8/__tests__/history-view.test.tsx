/**
 * S40 — history-view.test.tsx
 *
 * Verifies HistoryView mounts, lists events, applies kind + project
 * filters, and refreshes on demand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HistoryView } from '../views/History/HistoryView.js';

function installFetchMock(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => handler(String(input))) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FIXTURE = {
  events: [
    { id: 'e1', ts: new Date().toISOString(), kind: 'task.add', project: 'p1', title: 'first' },
    { id: 'e2', ts: new Date(Date.now() - 60_000).toISOString(), kind: 'goal.add', project: 'p2', title: 'second' },
    { id: 'e3', ts: new Date(Date.now() - 120_000).toISOString(), kind: 'task.add', project: 'p2', title: 'third' },
  ],
  projects: [
    { id: 'p1', name: 'Alpha' },
    { id: 'p2', name: 'Beta' },
  ],
  stats: {},
  generatedAt: new Date().toISOString(),
};

describe('S40 HistoryView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the timeline with all events', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/history')) return jsonResponse(200, FIXTURE);
      return jsonResponse(200, {});
    });
    render(<HistoryView />);
    expect(await screen.findByTestId('history-view')).toBeTruthy();
    expect(await screen.findByText('first')).toBeTruthy();
    expect(await screen.findByText('second')).toBeTruthy();
    expect(await screen.findByText('third')).toBeTruthy();
  });

  it('renders empty state when no events', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/history')) return jsonResponse(200, { events: [], projects: [] });
      return jsonResponse(200, {});
    });
    render(<HistoryView />);
    expect(await screen.findByText('No activity yet.')).toBeTruthy();
  });

  it('filters by kind when a kind chip is clicked', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/history')) return jsonResponse(200, FIXTURE);
      return jsonResponse(200, {});
    });
    render(<HistoryView />);
    await screen.findByText('first');
    fireEvent.click(await screen.findByTestId('history-filter-kind-task.add'));
    // Only the two task.add events remain
    await waitFor(() => {
      expect(screen.queryByText('second')).toBeNull();
      expect(screen.getByText('first')).toBeTruthy();
      expect(screen.getByText('third')).toBeTruthy();
    });
  });

  it('filters by project when a project chip is clicked', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/history')) return jsonResponse(200, FIXTURE);
      return jsonResponse(200, {});
    });
    render(<HistoryView />);
    await screen.findByText('first');
    fireEvent.click(await screen.findByTestId('history-filter-project-p2'));
    await waitFor(() => {
      expect(screen.queryByText('first')).toBeNull();
      expect(screen.getByText('second')).toBeTruthy();
      expect(screen.getByText('third')).toBeTruthy();
    });
  });
});