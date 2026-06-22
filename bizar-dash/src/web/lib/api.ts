// src/lib/api.ts — REST client. Single instance, type-safe wrappers.
//
// v3.6.1 — Authentication is now loopback-aware on the server side.
// The browser makes API calls over 127.0.0.1 (or via Tailscale serve
// proxying to 127.0.0.1), and the server auto-trusts loopback
// connections. So a fresh browser tab "just works" — no token paste
// required for the normal case.
//
// The token still exists for non-loopback clients (external API
// consumers, scripts) and as a defense-in-depth option via the
// BIZAR_DASHBOARD_REQUIRE_AUTH=1 env var. The localStorage flow
// remains: probe /api/auth/status on load, send the token header
// if one is set, fall back to none if not (the server will trust
// us anyway because we're loopback).
//
// For SSE routes, the token is also added as a `?token=...` query
// parameter (browsers can't set custom headers on EventSource).
// Again, loopback makes this optional but kept for safety.

const TOKEN_KEY = 'bizar-auth-token';
const LOOPBACK_KEY = 'bizar-loopback-trusted';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

class ApiClient {
  base = '/api';

  /** Get the cached bearer token from localStorage, or '' if none. */
  getToken(): string {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  /** Persist the token. Called from the Settings tab after Reveal/Regenerate. */
  setToken(token: string): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* localStorage unavailable — token won't persist across reloads */
    }
  }

  /** Build the URL with the token appended as ?token=… if present. */
  urlWithToken(path: string): string {
    const url = this.base + path;
    const tok = this.getToken();
    if (!tok) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(tok)}`;
  }

  /**
   * v3.6.1 — Probe the server's /api/auth/status endpoint and cache
   * whether the current browser is on a loopback-trusted connection.
   * Called once on app mount so the rest of the client can decide
   * whether to surface the "paste your token" UI in Settings or
   * just let the dashboard work.
   *
   * Returns a snapshot of the status; result is also cached for
   * subsequent calls to isLoopbackTrusted().
   */
  async probeAuthStatus(): Promise<{ required: boolean; loopback: boolean; peer: string }> {
    try {
      const r = await this.get<{ required: boolean; loopback: boolean; peer: string }>('/auth/status');
      try { localStorage.setItem(LOOPBACK_KEY, r.loopback ? '1' : '0'); } catch { /* noop */ }
      return r;
    } catch {
      return { required: false, loopback: true, peer: '' };
    }
  }

  /** Cached result of the last /api/auth/status probe. */
  isLoopbackTrusted(): boolean {
    try { return localStorage.getItem(LOOPBACK_KEY) !== '0'; } catch { return true; }
  }

  async get<T>(path: string): Promise<T> {
    return this.req<T>('GET', path);
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('POST', path, body);
  }
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('PUT', path, body);
  }
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('PATCH', path, body);
  }
  async del<T = unknown>(path: string): Promise<T> {
    return this.req<T>('DELETE', path);
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const tok = this.getToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const opts: RequestInit = { method, headers };
    if (body !== undefined && body !== null) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const r = await fetch(this.base + path, opts);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await r.json();
      if (!r.ok) {
        const msg =
          (data && typeof data === 'object' && 'message' in data
            ? (data as { message?: string }).message
            : undefined) || `${method} ${path}: ${r.status}`;
        throw new ApiError(msg, r.status, data);
      }
      return data as T;
    }
    const text = await r.text();
    if (!r.ok) {
      throw new ApiError(
        `${method} ${path}: ${r.status} — ${text.slice(0, 200)}`,
        r.status,
        text,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

export const api = new ApiClient();
export { ApiClient, TOKEN_KEY };
