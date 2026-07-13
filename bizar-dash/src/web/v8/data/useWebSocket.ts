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

import { useEffect, useState } from 'react';
import type { WsMessage } from './types.js';

type Listener = (msg: WsMessage) => void;

interface SocketState {
  socket: WebSocket | null;
  listeners: Set<Listener>;
  retries: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  connectedListeners: Set<(connected: boolean) => void>;
  /** Last time we received ANY message from the server. Used by the
   *  client-side heartbeat to detect silently-dropped sockets where the
   *  close event hasn't fired yet. */
  lastMessageAt: number;
  /** Wall-clock ping interval handle. */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

const state: SocketState = {
  socket: null,
  listeners: new Set(),
  retries: 0,
  retryTimer: null,
  connectedListeners: new Set(),
  lastMessageAt: 0,
  heartbeatTimer: null,
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

function startHeartbeat(): void {
  if (state.heartbeatTimer) return;
  state.heartbeatTimer = setInterval(() => {
    const sock = state.socket;
    if (!sock) return;
    // If the open socket hasn't seen any traffic in HEARTBEAT_TIMEOUT_MS,
    // assume it's stuck (corporate proxy in the middle, server SIGSTOP,
    // etc) and force a reconnect so the topbar indicator + listeners
    // recover. The close event will not fire on a hung socket.
    if (sock.readyState === WebSocket.OPEN) {
      if (Date.now() - state.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        try { sock.close(); } catch { /* */ }
        return;
      }
      // Lightweight app-level ping. The server doesn't have to answer;
      // any incoming frame (including the WS pong) counts as liveness.
      try { sock.send('ping'); } catch { /* */ }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
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
    state.lastMessageAt = Date.now();
    notifyConnected(true);
    startHeartbeat();
  });
  sock.addEventListener('message', (ev) => {
    state.lastMessageAt = Date.now();
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
    stopHeartbeat();
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

/** Subscribe-friendly hook that returns the current connection state.
 *  Re-renders on connect/disconnect. */
export function useConnectionState(): boolean {
  const [connected, setConnected] = useState<boolean>(state.socket?.readyState === WebSocket.OPEN);
  useWsConnected(setConnected);
  return connected;
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
  stopHeartbeat();
  state.lastMessageAt = 0;
  state.retries = 0;
}