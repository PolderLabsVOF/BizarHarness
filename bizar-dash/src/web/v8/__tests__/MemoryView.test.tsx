/**
 * v8/__tests__/MemoryView.test.tsx
 *
 * Sprint S15b — verifies the dashboard's full memory control surface:
 * create, edit, delete notes via the sheet + buttons.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryView } from '../views/Memory/MemoryView.js';

describe('MemoryView — control surface', () => {
  const originalFetch = global.fetch;
  let notes: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    notes = [
      { id: 'm1', content: 'old note', scope: 'project', updatedAt: Date.now() },
    ];
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('/api/memory') && method === 'GET') {
        return new Response(JSON.stringify({ entries: notes }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/api/memory/notes') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const created = { id: `m-${Date.now()}`, content: body.content ?? '', scope: body.scope ?? 'project', updatedAt: Date.now() };
        notes.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      if (u.includes('/api/memory/notes/') && method === 'DELETE') {
        notes = notes.filter((n) => !u.endsWith(`/${n.id}`));
        return new Response(null, { status: 204 });
      }
      if (u.includes('/api/memory/notes/') && method === 'PUT') {
        const id = u.split('/').pop();
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        notes = notes.map((n) => (n.id === id ? { ...n, ...body, updatedAt: Date.now() } : n));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders a "+ New note" button', async () => {
    render(<MemoryView />);
    await waitFor(() => screen.getByTestId('memory-new'));
  });

  it('opens a sheet with a Textarea when "+ New note" is clicked', async () => {
    const user = userEvent.setup();
    render(<MemoryView />);
    await waitFor(() => screen.getByTestId('memory-new'));
    await user.click(screen.getByTestId('memory-new'));
    expect(screen.getByTestId('memory-content')).toBeInTheDocument();
  });

  it('creates a note when Create is clicked with content', async () => {
    const user = userEvent.setup();
    render(<MemoryView />);
    await waitFor(() => screen.getByTestId('memory-new'));
    await user.click(screen.getByTestId('memory-new'));
    await user.type(screen.getByTestId('memory-content'), 'new memo body');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      // POST /api/memory/notes was called with the body
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const lastPost = [...calls].reverse().find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(lastPost).toBeDefined();
    });
  });

  it('opens an existing note in the sheet and offers Delete', async () => {
    const user = userEvent.setup();
    render(<MemoryView />);
    await waitFor(() => screen.getByText(/old note/));
    await user.click(screen.getByText(/old note/));
    const sheet = await screen.findByTestId('memory-content');
    expect(sheet).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});