import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { AgentDetail } from '../ui/agents/AgentDetail.js';
import { GoalDetail } from '../ui/goals/GoalDetail.js';

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AgentDetail (S11 control plane)', () => {
  const baseProps = {
    agentId: 'cc:sess-abc-123',
    name: 'Atlas',
    role: 'CC background',
    status: 'busy' as const,
    open: true,
    onOpenChange: () => {},
  };

  it('renders the agent name + role + source badge', () => {
    render(<Providers><AgentDetail {...baseProps} currentTask="Wiring v8" /></Providers>);
    expect(screen.getByText('Atlas')).toBeInTheDocument();
    expect(screen.getByText('CC background')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('shows the current task callout when provided', () => {
    render(<Providers><AgentDetail {...baseProps} currentTask="Wiring v8 plumbing" /></Providers>);
    expect(screen.getByText(/Wiring v8 plumbing/i)).toBeInTheDocument();
  });

  it('calls the right endpoint when Send is clicked (CC source)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, sessionId: 'sess-new' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    render(<Providers><AgentDetail {...baseProps} /></Providers>);
    const ta = screen.getByPlaceholderText(/follow-up/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'continue from S10' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => {
      const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const hasSend = calls.some((c) => String(c[0] ?? '').includes('/api/cc-agents/sess-abc-123/send'));
      expect(hasSend).toBe(true);
    });
  });

  it('renders Copy id + Restart buttons alongside Send', () => {
    render(<Providers><AgentDetail {...baseProps} /></Providers>);
    expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restart/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy id/i })).toBeInTheDocument();
  });
});

describe('GoalDetail (S12 goal editor)', () => {
  const goal = {
    id: 'g1',
    title: 'Ship v8',
    status: 'active' as const,
    progress: 0.5,
    keyResults: [
      { id: 'kr1', title: 'Cut S9 polish in half', done: false },
      { id: 'kr2', title: 'Publish Plan.md with 17 sections', done: true },
    ],
    owner: 'sam',
    due: '2026-09-30',
  };

  it('renders editable title, status, owner, and due', () => {
    render(<Providers><GoalDetail goal={goal} open onOpenChange={() => {}} /></Providers>);
    expect(screen.getByDisplayValue('Ship v8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sam')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-09-30')).toBeInTheDocument();
  });

  it('lists key results with toggle checkboxes', () => {
    render(<Providers><GoalDetail goal={goal} open onOpenChange={() => {}} /></Providers>);
    expect(screen.getByText(/Cut S9 polish/i)).toBeInTheDocument();
    expect(screen.getByText(/Publish Plan.md/i)).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('Patches /api/goals/:id when the title field is edited and blurred', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    render(<Providers><GoalDetail goal={goal} open onOpenChange={() => {}} /></Providers>);
    const input = screen.getByDisplayValue('Ship v8') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ship v8 dashboard' } });
    fireEvent.blur(input);
    await waitFor(() => {
      const calls = (fetchMock as unknown as { mock: { calls: { toString: () => string }[] } }).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].toString()).toContain('/api/goals/g1');
    });
  });
});