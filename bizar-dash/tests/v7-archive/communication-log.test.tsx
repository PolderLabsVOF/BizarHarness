// tests/communication-log.test.tsx — F-036 Goal Planner UI.
// Renders the CommunicationLog component with a mocked Ws class so
// we can drive agent:* events through the handler without opening a
// real socket.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '../src/web/components/Toast';
import { CommunicationLog } from '../src/web/components/agents/CommunicationLog';

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

describe('CommunicationLog', () => {
  it('renders empty state when no messages have arrived', () => {
    render(wrap(<CommunicationLog />));
    expect(screen.getByTestId('communication-log-empty')).toBeInTheDocument();
    expect(screen.getByTestId('communication-log-count').textContent?.trim()).toBe('0');
  });

  it('renders a single agent:status message', () => {
    render(wrap(<CommunicationLog />));
    emit('agent:status', { agent: { name: 'Odin', status: 'working' } });
    expect(screen.getByTestId('communication-log-count').textContent?.trim()).toBe('1');
    const rows = screen.getAllByTestId('communication-log-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-kind')).toBe('status');
  });

  it('renders multiple agent:* messages in reverse order', () => {
    render(wrap(<CommunicationLog />));
    emit('agent:status', { agent: { name: 'Odin', status: 'working' } });
    emit('agent:restarted', { agent: { name: 'Thor' } });
    emit('agent:message', { message: { from: 'Thor', to: 'Odin', text: 'done' } });
    const rows = screen.getAllByTestId('communication-log-row');
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute('data-kind')).toBe('message');
    expect(rows[1].getAttribute('data-kind')).toBe('restarted');
    expect(rows[2].getAttribute('data-kind')).toBe('status');
  });
});