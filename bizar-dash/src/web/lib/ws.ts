// src/lib/ws.ts — WebSocket with auto-reconnect + status + handlers.
//
// v3.6.0 — Bearer-token authentication. Browsers cannot set the
// Authorization header on the native WebSocket constructor, so we
// append the token as a `?token=<token>` query parameter on the
// connection URL. The server (auth.mjs) accepts both forms.
import type { WsMessage, WsStatus } from './types';
import { TOKEN_KEY } from './api';

type Handler = (msg: WsMessage) => void;
type StatusHandler = (status: WsStatus) => void;

/**
 * Build the WS URL with the auth token query param appended.
 * Returns just the bare /ws URL if no token is set (the server
 * will 401 and the connection will fail fast — the UI surfaces
 * "auth required" in that case).
 */
function buildWsUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost/ws';
  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let tok = '';
  try {
    tok = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    /* localStorage unavailable */
  }
  if (!tok) return base;
  return `${base}?token=${encodeURIComponent(tok)}`;
}

export class Ws {
  private readonly urlOverride?: string;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<StatusHandler>();
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 15000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: WsStatus = 'connecting';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(url?: string) {
    this.urlOverride = url;
    this.connect();
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    // Fire current status immediately
    handler(this._status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  get status(): WsStatus {
    return this._status;
  }

  send(msg: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setStatus('disconnected');
  }

  private connect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('connecting');
    const url = this.urlOverride ?? buildWsUrl();
    let socket: WebSocket;
    try {
      // Re-resolve the URL on every (re)connect — the token may have
      // changed since the last attempt (e.g. after Regenerate).
      socket = new WebSocket(url);
      this.ws = socket;
    } catch (err) {
      console.warn('[ws] construct failed:', err);
      this.scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      if (this.ws !== socket || this.closed) return;
      this.reconnectDelay = 1000;
      this.setStatus('connected');
      // Keep-alive ping every 30s
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this._status === 'connected') this.send({ type: 'ping' });
      }, 30_000);
    });
    socket.addEventListener('close', () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.setStatus('disconnected');
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.closed) this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (this.ws !== socket) return;
      // 'close' will follow — keep this for logs
      console.warn('[ws] error');
    });
    socket.addEventListener('message', (e) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        console.warn('[ws] bad message');
        return;
      }
      for (const h of this.handlers) {
        try {
          h(msg);
        } catch (err) {
          console.error('[ws] handler error:', err);
        }
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 1.6,
      this.maxReconnectDelay,
    );
  }

  private setStatus(s: WsStatus): void {
    this._status = s;
    for (const h of this.statusHandlers) {
      try {
        h(s);
      } catch (err) {
        console.error('[ws] status handler error:', err);
      }
    }
  }
}
