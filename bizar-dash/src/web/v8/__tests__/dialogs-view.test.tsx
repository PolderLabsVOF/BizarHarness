/**
 * S42 — dialogs-view.test.tsx
 *
 * Renders list with a dismissable row, confirms DELETE on confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DialogsView } from '../views/Dialogs/DialogsView.js';

interface MockState {
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'DELETE') out.deletes.push(url);
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

describe('S42 DialogsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no dialogs', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/dialogs')) return jsonResponse(200, { dialogs: [], dir: '/tmp/dialogs' });
      return jsonResponse(200, {});
    });
    render(<DialogsView />);
    expect(await screen.findByTestId('dialogs-view')).toBeTruthy();
    expect(await screen.findByText('No active dialogs')).toBeTruthy();
  });

  it('renders active dialogs with kind + title', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/dialogs')) {
        return jsonResponse(200, {
          dialogs: [{ id: 'd1', kind: 'prompt', title: 'Need approval', body: 'Continue?', source: 'plugin' }],
          dir: '/tmp/dialogs',
        });
      }
      return jsonResponse(200, {});
    });
    render(<DialogsView />);
    const row = await screen.findByTestId('dialog-row-d1');
    expect(row.textContent).toContain('Need approval');
    expect(row.textContent).toContain('prompt');
  });

  it('DELETEs /api/dialogs/:id on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/dialogs')) {
        return jsonResponse(200, { dialogs: [{ id: 'd2', title: 'X' }], dir: '/tmp/dialogs' });
      }
      return jsonResponse(200, {});
    });
    render(<DialogsView />);
    fireEvent.click(await screen.findByTestId('dialog-dismiss-d2'));
    fireEvent.click(await screen.findByTestId('dialog-confirm-dismiss-d2'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/dialogs/d2'))).toBeTruthy();
    });
  });
});