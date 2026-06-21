// src/lib/api.ts — REST client. Single instance, type-safe wrappers.
//
// v3.6.0 — Bearer-token authentication. The token is read from
// localStorage (key: `bizar-auth-token`). On first request the
// client probes /api/auth/status to check whether the server
// requires auth at all; if it does, the client must already have
// a token (set by the Settings tab via "Copy token" / "Regenerate
// token") or it surfaces 401s. We DO NOT silently redirect or
// prompt — the operator must paste the token explicitly into the
// Settings tab.
//
// For SSE routes, the token is also added as a `?token=...` query
// parameter (see Overview.tsx's EventSource usage) because browsers
// can't set custom headers on EventSource.

const TOKEN_KEY = 'bizar-auth-token';

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
      return text as unknown as T;
    }
  }
}

export const api = new ApiClient();
export { ApiClient, TOKEN_KEY };