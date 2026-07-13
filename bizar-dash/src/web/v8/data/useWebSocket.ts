/**
 * v8/data/useWebSocket.ts — singleton WS client for the v8 dashboard.
 *
 * The dashboard server exposes `/ws` (one WebSocket per browser tab).
 * We open the socket exactly once per page-load and fan-out messages
 * to every subscriber via a tiny event-bus.
 *
 * Why a module-singleton instead of a per-component socket? The
 * dashboard has at least 7 views that all want live updates — opening
 * one socket per view would multiply the server's fan-out cost.
 */

import { useEffect } from 'react';
import type { WsMessage } from './types.js';

type Listener = (msg: WsMessage) => void;

interface SocketState {
  socket: WebSocket | null;
  listeners: Set<Listener>;
  retries: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  connectedListeners: Set<(connected: boolean) => void>;
}

const state: SocketState = {
  socket: null,
  listeners: new Set(),
  retries: 0,
  retryTimer: null,
  connectedListeners: new Set(),
};

function url(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function notifyConnected(connected: boolean): void {
  for (const fn of state.connectedListeners) {
    try { fn(connected); } catch { /* swallow */ }
  }
}

function connect(): void {
  if (typeof window === 'undefined') return;
  if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) return;
  let sock: WebSocket;
  try {
    sock = new WebSocket(url());
  } catch {
    scheduleReconnect();
    return;
  }
  state.socket = sock;
  sock.addEventListener('open', () => {
    state.retries = 0;
    notifyConnected(true);
  });
  sock.addEventListener('message', (ev) => {
    let msg: WsMessage;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); }
    catch { return; }
    for (const fn of state.listeners) {
      try { fn(msg); } catch { /* swallow listener errors */ }
    }
  });
  sock.addEventListener('close', () => {
    state.socket = null;
    notifyConnected(false);
    scheduleReconnect();
  });
  sock.addEventListener('error', () => {
    // close handler will run after this.
  });
}

function scheduleReconnect(): void {
  if (state.retryTimer) return;
  const delay = Math.min(30_000, 500 * Math.pow(2, state.retries++));
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    connect();
  }, delay);
}

/** Force a reconnect (useful for the topbar "Reconnect" button). */
export function reconnect(): void {
  if (state.socket) {
    try { state.socket.close(); } catch { /* */ }
    state.socket = null;
  }
  state.retries = 0;
  connect();
}

/**
 * Subscribe to every WS message. The listener is called once per
 * matching message. Cleanup happens on unmount.
 */
export function useWsMessages(cb: (msg: WsMessage) => void): void {
  useEffect(() => {
    state.listeners.add(cb);
    if (!state.socket) connect();
    return () => {
      state.listeners.delete(cb);
    };
  }, [cb]);
}

/**
 * Subscribe only to messages whose `type` matches `predicate`. Convenience
 * over `useWsMessages` for the common case of "just give me X events".
 */
export function useWsMessage(
  predicate: string | string[],
  cb: (msg: WsMessage) => void,
): void {
  const set = Array.isArray(predicate) ? new Set(predicate) : new Set([predicate]);
  useWsMessages((msg) => {
    if (typeof msg === 'object' && msg && 'type' in msg && set.has((msg as { type: string }).type)) {
      cb(msg);
    }
  });
}

/** Track WS connection status (for the topbar live indicator). */
export function useWsConnected(cb: (connected: boolean) => void): void {
  useEffect(() => {
    state.connectedListeners.add(cb);
    // Seed with current state.
    cb(state.socket?.readyState === WebSocket.OPEN);
    return () => {
      state.connectedListeners.delete(cb);
    };
  }, [cb]);
}

/** Test seam — reset module state. Not exported from the barrel. */
export function _resetForTests(): void {
  if (state.socket) {
    try { state.socket.close(); } catch { /* */ }
  }
  state.socket = null;
  state.listeners.clear();
  state.connectedListeners.clear();
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  state.retries = 0;
}