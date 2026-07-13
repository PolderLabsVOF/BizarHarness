/**
 * S43 — obsidian-view.test.tsx
 *
 * Renders vault stats, lists notes, and Delete confirms + fires
 * DELETE on the note path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObsidianView } from '../views/Obsidian/ObsidianView.js';

interface MockState {
  posts: string[];
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') out.posts.push(url);
    else if (method === 'DELETE') out.deletes.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S43 ObsidianView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when vault has no notes', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/obsidian')) return jsonResponse(200, { exists: true, noteCount: 0, totalSize: 0, vaultDir: '/tmp/v' });
      if (url.endsWith('/api/obsidian/notes')) return jsonResponse(200, { notes: [] });
      return jsonResponse(200, {});
    });
    render(<ObsidianView />);
    expect(await screen.findByTestId('obsidian-view')).toBeTruthy();
    expect(await screen.findByText('No notes')).toBeTruthy();
  });

  it('renders notes and deletes on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/obsidian')) return jsonResponse(200, { exists: true, noteCount: 2, totalSize: 1024, vaultDir: '/tmp/v' });
      if (url.endsWith('/api/obsidian/notes')) return jsonResponse(200, { notes: [{ path: 'foo.md', relPath: 'foo.md', size: 512 }, { path: 'bar.md', relPath: 'bar.md', size: 512 }] });
      return jsonResponse(200, {});
    });
    render(<ObsidianView />);
    expect(await screen.findByTestId('obsidian-row-foo.md')).toBeTruthy();
    fireEvent.click(screen.getByTestId('obsidian-delete-foo.md'));
    fireEvent.click(screen.getByTestId('obsidian-confirm-delete-foo.md'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.includes('/api/obsidian/notes/foo.md'))).toBeTruthy();
    });
  });

  it('POSTs /api/obsidian/index on reindex click', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/obsidian')) return jsonResponse(200, { exists: true, noteCount: 0, totalSize: 0, vaultDir: '/tmp/v' });
      if (url.endsWith('/api/obsidian/notes')) return jsonResponse(200, { notes: [] });
      return jsonResponse(200, {});
    });
    render(<ObsidianView />);
    fireEvent.click(await screen.findByTestId('obsidian-reindex'));
    await waitFor(() => {
      expect(state.posts.find((u) => u.endsWith('/api/obsidian/index'))).toBeTruthy();
    });
  });
});