// src/lib/api.ts — REST client. Single instance, type-safe wrappers.

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
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
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
export { ApiClient };
