/**
 * S39 — projects-view.test.tsx
 *
 * Verifies ProjectsView mounts, lists projects, renders the empty
 * state, opens the Add Project Sheet, POSTs to /api/projects on
 * submit, POSTs to /api/projects/:id/activate on Activate, and
 * DELETEs on Remove (with inline confirm).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProjectsView } from '../views/Projects/ProjectsView.js';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MockState {
  posts: Array<{ url: string; method: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handlers: Array<[RegExp, Handler]>, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && init?.body) {
      try { out.posts.push({ url, method, body: JSON.parse(String(init.body)) }); } catch { /* swallow */ }
    } else if (method === 'DELETE') {
      out.deletes.push(url);
    }
    for (const [pat, fn] of handlers) {
      if (pat.test(url)) return fn(input, init);
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S39 ProjectsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no projects exist', async () => {
    installFetchMock([
      [/^\/api\/projects/, () => jsonResponse(200, { projects: [] })],
    ]);
    render(<ProjectsView />);
    expect(await screen.findByTestId('projects-view')).toBeTruthy();
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });

  it('lists projects with active badge for the active one', async () => {
    installFetchMock([
      [/^\/api\/projects/, () => jsonResponse(200, {
        projects: [
          { id: 'p1', name: 'Alpha', path: '/tmp/alpha', active: true },
          { id: 'p2', name: 'Beta', path: '/tmp/beta', active: false },
        ],
      })],
    ]);
    render(<ProjectsView />);
    expect(await screen.findByTestId('project-row-p1')).toBeTruthy();
    expect(await screen.findByTestId('project-row-p2')).toBeTruthy();
    expect(await screen.findByText('Active')).toBeTruthy();
  });

  it('opens the Add Project Sheet on header button click', async () => {
    installFetchMock([
      [/^\/api\/projects/, () => jsonResponse(200, { projects: [] })],
    ]);
    render(<ProjectsView />);
    fireEvent.click(await screen.findByTestId('projects-add'));
    expect(await screen.findByTestId('projects-add-path')).toBeTruthy();
  });

  it('POSTs to /api/projects on Add submit', async () => {
    const state = installFetchMock([
      [/^\/api\/projects(\?|$)/, () => jsonResponse(200, { projects: [] })],
    ]);
    render(<ProjectsView />);
    fireEvent.click(await screen.findByTestId('projects-add'));
    fireEvent.input(await screen.findByTestId('projects-add-path'), {
      target: { value: '/tmp/new-project' },
    });
    fireEvent.click(await screen.findByTestId('projects-add-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/projects') && p.method === 'POST');
      expect(hit).toBeTruthy();
      expect((hit!.body as { path: string }).path).toBe('/tmp/new-project');
    });
  });

  it('POSTs to /api/projects/:id/activate on Activate click', async () => {
    const state = installFetchMock([
      [/^\/api\/projects(\?|$)/, () => jsonResponse(200, {
        projects: [
          { id: 'p1', name: 'Alpha', path: '/tmp/alpha', active: false },
        ],
      })],
    ]);
    render(<ProjectsView />);
    const row = await screen.findByTestId('project-row-p1');
    fireEvent.click(within(row).getByTestId('project-activate-p1'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/projects/p1/activate') && p.method === 'POST');
      expect(hit).toBeTruthy();
    });
  });

  it('DELETEs /api/projects/:id on Confirm remove', async () => {
    const state = installFetchMock([
      [/^\/api\/projects(\?|$)/, () => jsonResponse(200, {
        projects: [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha', active: false }],
      })],
    ]);
    render(<ProjectsView />);
    fireEvent.click(await screen.findByTestId('project-delete-p1'));
    fireEvent.click(await screen.findByTestId('project-confirm-delete-p1'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/projects/p1'))).toBeTruthy();
    });
  });
});