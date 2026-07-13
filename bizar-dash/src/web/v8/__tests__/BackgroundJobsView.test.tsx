/**
 * v8/__tests__/BackgroundJobsView.test.tsx
 *
 * Verifies: render, instance selection, pause/resume/retry/kill, output panel.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackgroundJobsView } from '../views/BackgroundJobs/BackgroundJobsView.js';

describe('BackgroundJobsView', () => {
  const originalFetch = global.fetch;
  let instances: Array<Record<string, unknown>> = [];

  const defaultInstances = [
    {
      instanceId: 'bg-001',
      agent: 'odin',
      status: 'running',
      worktree: '/home/drb0rk/projects/BizarHarness',
      createdAt: Date.now() - 120000,
      startedAt: Date.now() - 60000,
      pid: 12345,
      tags: ['debug'],
      action: { type: 'agent', prompt: 'Review PRs' },
    },
    {
      instanceId: 'bg-002',
      agent: 'frigg',
      status: 'paused',
      worktree: '/home/drb0rk/projects/BizarHarness',
      createdAt: Date.now() - 300000,
      startedAt: Date.now() - 240000,
      pid: 23456,
      tags: [],
      action: { type: 'agent', prompt: 'Run tests' },
    },
    {
      instanceId: 'bg-003',
      agent: 'tyr',
      status: 'error',
      worktree: '/home/drb0rk/projects/BizarHarness',
      createdAt: Date.now() - 600000,
      startedAt: Date.now() - 580000,
      pid: 34567,
      error: 'dispatch timeout',
      tags: ['prod'],
      action: { type: 'agent', prompt: 'Deploy' },
    },
  ];

  beforeEach(() => {
    instances = [...defaultInstances];
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === '/api/background' || u.includes('/api/background?')) {
        return new Response(JSON.stringify({ instances }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.match(/\/api\/background\/[^/]+\/output/)) {
        return new Response(JSON.stringify({
          lines: [
            '[09:00:01] Starting agent odin...',
            '[09:00:02] Tool: Read /api/tasks',
            '[09:00:03] Tool: Edit foo.ts — applied 2 changes',
            '[09:00:04] Done.',
          ],
        }), { status: 200 });
      }
      if (u.match(/\/api\/background\/[^/]+\/pause$/)) {
        const id = u.split('/')[3];
        instances = instances.map((i) => i.instanceId === id ? { ...i, status: 'paused' } : i);
        return new Response(JSON.stringify({ ok: true, status: 'paused' }), { status: 200 });
      }
      if (u.match(/\/api\/background\/[^/]+\/resume$/)) {
        const id = u.split('/')[3];
        instances = instances.map((i) => i.instanceId === id ? { ...i, status: 'running' } : i);
        return new Response(JSON.stringify({ ok: true, status: 'running' }), { status: 200 });
      }
      if (u.match(/\/api\/background\/[^/]+\/retry$/)) {
        const id = u.split('/')[3];
        instances = instances.map((i) => i.instanceId === id ? { ...i, status: 'running' } : i);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.match(/\/api\/background\/[^/]+$/) && !u.match(/\/output$|\/pause$|\/resume$|\/retry$/)) {
        const id = u.split('/')[3];
        instances = instances.filter((i) => i.instanceId !== id);
        return new Response(JSON.stringify({ ok: true, instanceId: id }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the view title', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('Background Jobs'));
  });

  it('renders all instances from the API', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('odin'));
    expect(screen.getByText('frigg')).toBeInTheDocument();
    expect(screen.getByText('tyr')).toBeInTheDocument();
  });

  it('shows status badges for each instance', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('odin'));
    // We should see some info/danger/warning badges
    const badges = await screen.findAllByText('running');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders the output panel when an instance is clicked', async () => {
    const user = userEvent.setup();
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('odin'));
    await user.click(screen.getByTestId('bg-instance-bg-001'));
    await waitFor(() => screen.getByText('Output'));
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('shows pause and kill buttons for running instances', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('odin'));
    expect(screen.getByTestId('bg-pause-bg-001')).toBeInTheDocument();
    expect(screen.getByTestId('bg-kill-bg-001')).toBeInTheDocument();
  });

  it('shows resume button for paused instances', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('frigg'));
    expect(screen.getByTestId('bg-resume-bg-002')).toBeInTheDocument();
  });

  it('shows retry button for error instances', async () => {
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('tyr'));
    expect(screen.getByTestId('bg-retry-bg-003')).toBeInTheDocument();
  });

  it('calls DELETE when kill is confirmed', async () => {
    const user = userEvent.setup();
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('odin'));
    await user.click(screen.getByTestId('bg-kill-bg-001'));
    // Kill confirmation dialog should appear
    const dialog = await waitFor(() => screen.getByTestId('bg-kill-confirm'));
    await user.click(within(dialog).getByRole('button', { name: /^kill$/i }));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([u, i]) => String(u).includes('/background/bg-001') && (i as RequestInit)?.method === 'DELETE')).toBe(true);
    });
  });

  it('renders the empty state when no instances', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ instances: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
    render(<BackgroundJobsView />);
    await waitFor(() => screen.getByText('No background jobs'));
    expect(screen.getByText('No background jobs')).toBeInTheDocument();
  });
});
