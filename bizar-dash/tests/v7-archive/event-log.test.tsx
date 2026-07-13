// tests/event-log.test.tsx — F-036 Goal Planner UI.
// Renders the RealTimeEventLog with a mocked Ws class.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '../src/web/components/Toast';
import { RealTimeEventLog } from '../src/web/components/agents/RealTimeEventLog';

type Handler = (msg: { type: string; ts?: number } & Record<string, unknown>) => void;
let registeredHandler: Handler | null = null;

vi.mock('../src/web/lib/ws', () => ({
  Ws: class {
    constructor() {}
    on(handler: Handler) {
      registeredHandler = handler;
      return () => { registeredHandler = null; };
    }
    close() {}
  },
}));

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

function emit(type: string, payload: Record<string, unknown> = {}) {
  if (!registeredHandler) throw new Error('no ws handler registered');
  act(() => {
    registeredHandler!({ type, ts: Date.now(), ...payload });
  });
}

beforeEach(() => {
  registeredHandler = null;
});

describe('RealTimeEventLog', () => {
  it('renders empty state when no events arrived', () => {
    render(wrap(<RealTimeEventLog />));
    expect(screen.getByTestId('event-log-empty')).toBeInTheDocument();
    expect(screen.getByTestId('event-log-count').textContent?.trim()).toBe('0');
  });

  it('renders a single info event', () => {
    render(wrap(<RealTimeEventLog />));
    emit('tasks:change', { task: { id: 't1' } });
    const rows = screen.getAllByTestId('event-log-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-severity')).toBe('info');
  });

  it('renders multiple events with severity coding', () => {
    render(wrap(<RealTimeEventLog />));
    emit('task:progress', { taskId: 't1', progress: 50 });
    emit('agent:stuck', { agents: [{ name: 'Odin' }] });
    emit('goal:planned', { planId: 'p1' });
    const rows = screen.getAllByTestId('event-log-row');
    expect(rows.length).toBe(3);
    expect(screen.getByTestId('event-log-count').textContent?.trim()).toBe('3');
  });
});