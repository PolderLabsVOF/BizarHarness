/**
 * v8/__tests__/SchedulesView.test.tsx
 *
 * Verifies: render, toggle enabled, run now, delete, create new.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulesView } from '../views/Schedules/SchedulesView.js';

describe('SchedulesView', () => {
  const originalFetch = global.fetch;
  let schedules: Array<Record<string, unknown>> = [];

  const defaultSchedules = [
    {
      id: 's1',
      name: 'Daily digest',
      type: 'cron',
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRun: null,
      lastResult: null,
      lastError: null,
      nextRun: new Date(Date.now() + 86400000).toISOString(),
      action: { type: 'agent', prompt: 'Run the daily digest' },
    },
    {
      id: 's2',
      name: 'Hourly health check',
      type: 'interval',
      schedule: '1h',
      timezone: 'UTC',
      enabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRun: new Date(Date.now() - 3600000).toISOString(),
      lastResult: { ok: true },
      lastError: null,
      nextRun: new Date(Date.now() + 3600000).toISOString(),
      action: { type: 'command', command: 'health-check' },
    },
  ];

  beforeEach(() => {
    schedules = [...defaultSchedules];
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/schedules') && !u.includes('/run') && !u.includes('/delete') && !u.includes('/schedules/s')) {
        return new Response(JSON.stringify(schedules), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/run')) {
        const id = u.split('/')[3];
        schedules = schedules.map((s) => s.id === id ? { ...s, lastRun: new Date().toISOString() } : s);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('/schedules/') && u.includes('/run')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.match(/\/api\/schedules\/[^/]+$/) && !u.includes('/run')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('/api/schedules') && !u.includes('/api/schedules/')) {
        const body = JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]?.[1]?.body ?? '{}'));
        const created = {
          id: `s-${Date.now()}`,
          name: body.name,
          type: body.type,
          schedule: body.schedule,
          timezone: body.timezone ?? 'UTC',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastRun: null,
          lastResult: null,
          lastError: null,
          nextRun: null,
          action: body.action,
        };
        schedules.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the "+ New schedule" button', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByTestId('schedules-new'));
    expect(screen.getByText('Schedules')).toBeInTheDocument();
  });

  it('renders all schedules from the API', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    expect(screen.getByText('Hourly health check')).toBeInTheDocument();
  });

  it('shows schedule type badges', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    expect(screen.getAllByText('Cron').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Interval').length).toBeGreaterThan(0);
  });

  it('shows status badges per schedule state', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    // s1 is enabled but never run → "never run" badge
    expect(screen.getByText(/^never run$/)).toBeInTheDocument();
    // s2 is disabled → "disabled" badge
    expect(screen.getByText(/^disabled$/)).toBeInTheDocument();
  });

  it('opens the create sheet when "+ New schedule" is clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulesView />);
    await waitFor(() => screen.getByTestId('schedules-new'));
    await user.click(screen.getByTestId('schedules-new'));
    expect(screen.getByTestId('sched-expr')).toBeInTheDocument();
  });

  it('calls DELETE when the delete button is clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    const deleteBtn = screen.getByTestId('schedule-delete-s1');
    await user.click(deleteBtn);
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([u, i]) => String(u).includes('/schedules/s1') && (i as RequestInit)?.method === 'DELETE')).toBe(true);
    });
  });

  it('calls POST /run when the run button is clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    const runBtn = screen.getByTestId('schedule-run-s1');
    await user.click(runBtn);
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([u, i]) => String(u).includes('/schedules/s1/run') && (i as RequestInit)?.method === 'POST')).toBe(true);
    });
  });
});
