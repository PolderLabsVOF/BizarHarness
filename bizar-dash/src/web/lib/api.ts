// src/lib/api.ts — REST client. Single instance, type-safe wrappers.
//
// v3.6.2 — Token URL pickup for reverse-proxy / Tailscale Serve access.
// When the dashboard is accessed via Tailscale Serve (or any reverse
// proxy) the browser runs on a different origin than localhost. The server
// sees the remote client through the local proxy and requires auth.
// The `?token=…` URL param lets operators share a direct link that
// automatically installs the token into localStorage so the dashboard
// "just works" after the first paste — no separate localhost tab needed.
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

  /**
   * v3.6.2 — Check the URL search params for a `token` value and
   * persist it into localStorage if found. Strips the param from the
   * URL via `history.replaceState` so the token doesn't leak into
   * browser history or shared links.
   *
   * Returns `true` if a token was found and saved, `false` otherwise.
   * Safe to call multiple times (subsequent calls with no token in URL
   * return `false` and are no-ops).
   */
  pickupTokenFromUrl(): boolean {
    try {
      const params = new URLSearchParams(window.location.search);
      const tok = params.get('token');
      if (!tok) return false;
      this.setToken(tok);
      // Remove the token param from the URL without a page reload.
      params.delete('token');
      const newSearch = params.toString();
      const newUrl = newSearch
        ? `${window.location.pathname}?${newSearch}`
        : window.location.pathname;
      history.replaceState(null, '', newUrl);
      return true;
    } catch {
      return false;
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

  /**
   * Perform an authenticated GET against the dashboard server.
   *
   * IMPORTANT: do NOT include the `/api` prefix in `path` — the
   * wrapper adds it for you. Calling `api.get('/api/projects')` will
   * 404 because the server sees `/api/api/projects`. Use the
   * unprefixed form: `api.get('/projects')`.
   *
   * @example
   *   const r = await api.get<ProjectList>('/projects');
   */
  async get<T>(path: string): Promise<T> {
    return this.req<T>('GET', path);
  }

  /**
   * Perform an authenticated POST against the dashboard server.
   *
   * IMPORTANT: do NOT include the `/api` prefix in `path` — the
   * wrapper adds it. Use the unprefixed form: `api.post('/fs/mkdir', body)`.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('POST', path, body);
  }

  /**
   * Perform an authenticated PUT against the dashboard server.
   *
   * IMPORTANT: do NOT include the `/api` prefix in `path` — the
   * wrapper adds it. Use the unprefixed form: `api.put('/settings', body)`.
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('PUT', path, body);
  }

  /**
   * Perform an authenticated PATCH against the dashboard server.
   *
   * IMPORTANT: do NOT include the `/api` prefix in `path` — the
   * wrapper adds it. Use the unprefixed form: `api.patch('/settings', body)`.
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>('PATCH', path, body);
  }

  /**
   * Perform an authenticated DELETE against the dashboard server.
   *
   * IMPORTANT: do NOT include the `/api` prefix in `path` — the
   * wrapper adds it. Use the unprefixed form: `api.del('/projects/123')`.
   */
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

// v3.6.2 — Auto-pickup token from URL on module load so the dashboard
// works through reverse proxies (Tailscale Serve, nginx, etc.) without
// needing a separate localhost tab.
api.pickupTokenFromUrl();

export { ApiClient, TOKEN_KEY };

/**
 * Placeholder for the "Enhance prompt" feature.
 * TODO: call system LLM API to improve the prompt
 * Will use settings.systemLlm config
 * Endpoint: POST /api/enhance-prompt with { text }
 */
export async function enhancePrompt(text: string): Promise<string> {
  return text; // passthrough for now
}
