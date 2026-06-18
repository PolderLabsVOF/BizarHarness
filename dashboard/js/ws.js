// dashboard/js/ws.js — WebSocket with auto-reconnect.
export class Ws {
  constructor(url) {
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.handlers = new Set();
    this.statusHandlers = new Set();
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.connect();
  }

  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler) {
    this.statusHandlers.add(handler);
    handler(this._status || 'connecting');
    return () => this.statusHandlers.delete(handler);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  connect() {
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('WS construct failed:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      this.reconnectDelay = 1000;
      this.setStatus('connected');
    });
    this.ws.addEventListener('close', () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // 'close' will fire too — keep this for logs
      console.warn('WS error');
    });
    this.ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        console.warn('Bad WS message:', err);
        return;
      }
      for (const h of this.handlers) {
        try { h(msg); } catch (err) { console.error('WS handler error:', err); }
      }
    });
  }

  scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, this.maxReconnectDelay);
  }

  setStatus(s) {
    this._status = s;
    for (const h of this.statusHandlers) {
      try { h(s); } catch (err) { console.error('WS status handler error:', err); }
    }
  }

  close() {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
