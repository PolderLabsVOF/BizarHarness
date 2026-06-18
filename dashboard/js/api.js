// dashboard/js/api.js — REST client wrapper.
export class Api {
  constructor(base = '/api') {
    this.base = base;
  }

  async get(path) {
    return this.req('GET', path);
  }

  async post(path, body) {
    return this.req('POST', path, body);
  }

  async put(path, body) {
    return this.req('PUT', path, body);
  }

  async del(path) {
    return this.req('DELETE', path);
  }

  async req(method, path, body) {
    const opts = {
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
        const err = new Error(data.message || `${method} ${path}: ${r.status}`);
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    }
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`${method} ${path}: ${r.status} — ${text.slice(0, 200)}`);
    }
    try { return JSON.parse(text); } catch { return text; }
  }
}
