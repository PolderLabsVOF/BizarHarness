// src/lib/ws.ts — WebSocket with auto-reconnect + status + handlers.
import type { WsMessage, WsStatus } from './types';

type Handler = (msg: WsMessage) => void;
type StatusHandler = (status: WsStatus) => void;

export class Ws {
  private url: string;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<StatusHandler>();
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 15000;
  private _status: WsStatus = 'connecting';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(url?: string) {
    this.url =
      url ||
      (typeof location !== 'undefined'
        ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
        : 'ws://localhost/ws');
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
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  private connect(): void {
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[ws] construct failed:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      this.reconnectDelay = 1000;
      this.setStatus('connected');
      // Keep-alive ping every 30s
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this._status === 'connected') this.send({ type: 'ping' });
      }, 30_000);
    });
    this.ws.addEventListener('close', () => {
      this.setStatus('disconnected');
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.closed) this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // 'close' will follow — keep this for logs
      console.warn('[ws] error');
    });
    this.ws.addEventListener('message', (e) => {
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
    setTimeout(() => this.connect(), this.reconnectDelay);
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
