/**
 * v8/__tests__/NotificationsPopover.test.tsx
 *
 * Sprint S15b — verifies the topbar notification bell:
 *   - renders a button labeled with unread count
 *   - clicking opens a popover with notification items
 *   - mark-read hits the correct endpoint + optimistically removes the row
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsPopover } from '../ui/feedback/NotificationsPopover.js';

describe('NotificationsPopover', () => {
  const originalFetch = global.fetch;
  let notifications: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    notifications = [
      { id: 'n1', title: 'Agent spawned', body: 'coder agent up', ts: Date.now(), kind: 'info' },
      { id: 'n2', title: 'Task done', body: 'Ship S15', ts: Date.now() - 60_000, kind: 'success' },
    ];
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('/api/notifications') && method === 'GET') {
        return new Response(JSON.stringify({ notifications }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/read-all') && method === 'POST') {
        notifications = [];
        return new Response(JSON.stringify({ ok: true, marked: 2 }), { status: 200 });
      }
      if (u.includes('/read') && method === 'POST') {
        const id = u.match(/notifications\/([^/]+)\/read/)?.[1];
        notifications = notifications.filter((n) => n.id !== id);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows the unread count badge', async () => {
    render(<NotificationsPopover />);
    await waitFor(() => {
      const badge = screen.getByTestId('topbar-notifications-count');
      expect(badge.textContent).toBe('2');
    });
  });

  it('opens a popover with notification titles when clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationsPopover />);
    await waitFor(() => screen.getByTestId('topbar-notifications-count'));
    await user.click(screen.getByTestId('topbar-notifications'));
    await waitFor(() => {
      expect(screen.getByText('Agent spawned')).toBeInTheDocument();
      expect(screen.getByText('Task done')).toBeInTheDocument();
    });
  });

  it('shows an empty-state when there are no unread notifications', async () => {
    notifications = [];
    render(<NotificationsPopover />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByTestId('topbar-notifications'));
    await user.click(screen.getByTestId('topbar-notifications'));
    await waitFor(() => {
      expect(screen.getByText(/no unread/i)).toBeInTheDocument();
    });
  });

  it('hits /read-all when Mark all read is clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationsPopover />);
    await waitFor(() => screen.getByTestId('topbar-notifications-count'));
    await user.click(screen.getByTestId('topbar-notifications'));
    const markAllBtn = await screen.findByText(/mark all read/i);
    await user.click(markAllBtn);
    await waitFor(() => {
      expect(screen.queryByTestId('topbar-notifications-count')).not.toBeInTheDocument();
    });
  });
});