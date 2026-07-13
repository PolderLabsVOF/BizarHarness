/**
 * v8/__tests__/useWebSocket.test.ts
 *
 * Sprint S10 — Verifies the WS subscriber wiring in jsdom.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWsMessages, useWsMessage, _resetForTests } from '../data/useWebSocket.js';

class FakeSocket {
  readyState = 0;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  addEventListener(name: string, cb: (ev: unknown) => void) {
    (this.listeners[name] ||= []).push(cb);
  }
  removeEventListener() { /* no-op */ }
  fire(name: string, ev: unknown) {
    for (const cb of this.listeners[name] || []) cb(ev);
  }
  close() { this.readyState = 3; this.fire('close', {}); }
  // unused
  send() {}
}

let fakeSocket: FakeSocket | null = null;

beforeEach(() => {
  _resetForTests();
  fakeSocket = new FakeSocket();
  // @ts-expect-error -- substitute a fake WebSocket for the singleton.
  global.WebSocket = class {
    constructor() { return fakeSocket!; }
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    readyState = 0;
    addEventListener = fakeSocket!.addEventListener.bind(fakeSocket!);
    close = fakeSocket!.close.bind(fakeSocket!);
  };
});

describe('useWsMessages', () => {
  it('subscribes and forwards matching messages', () => {
    const cb = vi.fn();
    renderHook(() => useWsMessages(cb));
    // open then message.
    fakeSocket!.fire('open', {});
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'tasks:change', task: { id: 't1' } }) });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: 'tasks:change' }));
  });

  it('unmount removes the listener', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useWsMessages(cb));
    unmount();
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'tasks:change' }) });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('useWsMessage', () => {
  it('filters by single type', () => {
    const cb = vi.fn();
    renderHook(() => useWsMessage('goals:change', cb));
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'tasks:change' }) });
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'goals:change', goal: { id: 'g1' } }) });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: 'goals:change' }));
  });

  it('filters by multiple types', () => {
    const cb = vi.fn();
    renderHook(() => useWsMessage(['tasks:change', 'goals:change'], cb));
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'activity:new' }) });
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'tasks:change' }) });
    fakeSocket!.fire('message', { data: JSON.stringify({ type: 'goals:change' }) });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed JSON', () => {
    const cb = vi.fn();
    renderHook(() => useWsMessages(cb));
    fakeSocket!.fire('message', { data: 'not-json{' });
    expect(cb).not.toHaveBeenCalled();
  });
});