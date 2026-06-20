/**
 * src/server/providers-store.mjs
 *
 * v3.0.0 — OpenCode providers and MCPs management.
 *
 * Reads / writes the opencode.json at ~/.config/opencode/opencode.json
 * under the `provider` and `mcp` keys.
 *
 * v3.5.6 — `listAll()` falls back to inferring providers from agent
 * `.md` frontmatter (the `model: provider/model-name` line) so the
 * dashboard can surface the providers that are actually in use even
 * when the user's opencode.json has no top-level `provider` key.
 * Also tries the running `opencode serve` HTTP API for the canonical
 * list. API keys are never echoed back in full — the response masks them.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const OPENCODE_JSON = join(HOME, '.config', 'opencode', 'opencode.json');
const OPENCODE_AGENTS_DIR = join(HOME, '.config', 'opencode', 'agents');

function safeReadJSON(file, fallback = {}) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function loadConfig() {
  return safeReadJSON(OPENCODE_JSON, {});
}

function saveConfig(data) {
  mkdirSync(dirname(OPENCODE_JSON), { recursive: true });
  writeFileSync(OPENCODE_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function mask(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '***' + value.slice(-4);
}

function unmask(stored, incoming) {
  // Incoming is the user-typed value. If it's the masked form, keep stored.
  if (typeof incoming === 'string' && incoming.startsWith('***') && incoming.endsWith('***')) {
    return stored;
  }
  return incoming;
}

export const providersStore = {
  OPENCODE_JSON,

  list() {
    const cfg = loadConfig();
    const providers = cfg.provider || {};
    return Object.entries(providers).map(([id, p]) => ({
      id,
      name: p.name || id,
      baseURL: p.baseURL || p.options?.baseURL || '',
      apiKey: mask(p.apiKey || p.options?.apiKey || ''),
      models: Array.isArray(p.models) ? p.models : [],
      enabled: p.enabled !== false,
    }));
  },

  /**
   * v3.5.6 — Robust provider discovery. Tries three sources in order
   * and merges them so the dashboard shows every provider that is
   * actually in use, even when opencode.json has no `provider` key.
   *
   *  1. opencode.json `provider` / `providers` key — explicit config.
   *  2. Agent `.md` frontmatter — every `model: provider/model` line
   *     implies a usable provider + model pair.
   *  3. opencode serve HTTP `/api/providers` (best-effort, 1.5s timeout).
   *
   * Each source contributes providers; duplicates (by id) are merged so
   * the explicit config wins on baseURL/apiKey and the inferred sources
   * contribute their known models.
   *
   * Returns an array of:
   *   { id, name, baseURL, apiKey, models: [{id, name, source?}],
   *     source: 'config'|'agents'|'serve'|'config+agents' }
   */
  async listAll() {
    const byId = new Map();

    const upsert = (id, patch, source) => {
      const cur = byId.get(id) || {
        id,
        name: id,
        baseURL: '',
        apiKey: '',
        models: [],
        enabled: true,
        source: '',
      };
      const next = { ...cur, ...patch };
      // Merge models by id
      const modelMap = new Map();
      for (const m of cur.models) modelMap.set(m.id, m);
      for (const m of patch.models || []) {
        const existing = modelMap.get(m.id);
        modelMap.set(m.id, existing ? { ...existing, ...m } : m);
      }
      next.models = Array.from(modelMap.values());
      next.source = cur.source
        ? cur.source.includes(source)
          ? cur.source
          : `${cur.source}+${source}`
        : source;
      byId.set(id, next);
    };

    // Source 1: opencode.json provider/providers key
    try {
      const cfg = loadConfig();
      const explicit = cfg.provider || cfg.providers || {};
      for (const [id, p] of Object.entries(explicit)) {
        if (!p || typeof p !== 'object') continue;
        upsert(
          id,
          {
            name: p.name || id,
            baseURL: p.baseURL || p.options?.baseURL || '',
            apiKey: mask(p.apiKey || p.options?.apiKey || ''),
            models: (Array.isArray(p.models) ? p.models : []).map((m) => ({
              id: typeof m === 'string' ? m : m.id || m.name || String(m),
              name: typeof m === 'string' ? m : m.name || m.id || String(m),
            })),
            enabled: p.enabled !== false,
          },
          'config',
        );
      }
    } catch {
      /* best-effort */
    }

    // Source 2: agent .md frontmatter
    try {
      if (existsSync(OPENCODE_AGENTS_DIR)) {
        for (const file of readdirSync(OPENCODE_AGENTS_DIR)) {
          if (!file.endsWith('.md')) continue;
          const full = join(OPENCODE_AGENTS_DIR, file);
          let raw;
          try {
            raw = readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          const modelMatch = raw.match(/^model:\s*([^\s#]+)/m);
          if (!modelMatch) continue;
          const modelRef = modelMatch[1].trim();
          const slashIdx = modelRef.indexOf('/');
          if (slashIdx <= 0) continue;
          const providerId = modelRef.slice(0, slashIdx);
          const modelId = modelRef.slice(slashIdx + 1);
          if (!providerId || !modelId) continue;
          upsert(
            providerId,
            {
              models: [{ id: modelId, name: modelId, source: `agents/${file.replace(/\.md$/, '')}` }],
            },
            'agents',
          );
        }
      }
    } catch {
      /* best-effort */
    }

    // Source 3: opencode serve HTTP API
    try {
      const { readServeInfo } = await import('./serve-info.mjs');
      const info = readServeInfo();
      if (info && info.baseUrl) {
        const auth = 'Basic ' + Buffer.from(`opencode:${info.password || ''}`).toString('base64');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        try {
          const resp = await fetch(`${info.baseUrl}/api/providers`, {
            headers: { Authorization: auth },
            signal: ctrl.signal,
          });
          if (resp.ok) {
            const body = await resp.json().catch(() => null);
            const list = Array.isArray(body?.providers)
              ? body.providers
              : Array.isArray(body?.data)
              ? body.data
              : Array.isArray(body)
              ? body
              : [];
            for (const p of list) {
              if (!p || typeof p !== 'object') continue;
              const id = p.id || p.name;
              if (!id) continue;
              const models = (Array.isArray(p.models) ? p.models : []).map((m) => {
                if (typeof m === 'string') return { id: m, name: m };
                return {
                  id: m.id || m.name || String(m),
                  name: m.name || m.id || String(m),
                };
              });
              upsert(
                id,
                {
                  name: p.name || id,
                  baseURL: p.baseURL || '',
                  models,
                },
                'serve',
              );
            }
          }
        } catch {
          /* serve unreachable — fall through */
        } finally {
          clearTimeout(timer);
        }
      }
    } catch {
      /* best-effort */
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  },

  /**
   * v3.5.6 — Return the currently configured default provider + model.
   * Reads from opencode.json (`model`, `provider`, `small_model`).
   * Falls back to scanning agents to find the default_agent's model.
   *
   * Returns: { providerId, modelId, source, agent?, smallModel? } or
   *          null if nothing can be determined.
   */
  async getActive() {
    let providerId = null;
    let modelId = null;
    let source = null;

    try {
      const cfg = loadConfig();
      const m = typeof cfg.model === 'string' ? cfg.model : '';
      if (m && m.includes('/')) {
        const slashIdx = m.indexOf('/');
        providerId = m.slice(0, slashIdx);
        modelId = m.slice(slashIdx + 1);
        source = 'opencode.json';
      } else if (cfg.provider && typeof cfg.provider === 'object') {
        const firstId = Object.keys(cfg.provider)[0];
        if (firstId) {
          providerId = firstId;
          source = 'opencode.json:provider';
        }
      }

      let smallModel = null;
      if (typeof cfg.small_model === 'string' && cfg.small_model.includes('/')) {
        smallModel = cfg.small_model;
      }

      let defaultAgent = typeof cfg.default_agent === 'string' ? cfg.default_agent : null;

      // If we got a providerId but no modelId, look up the default_agent's model
      let agentModel = null;
      if (providerId && !modelId && defaultAgent && existsSync(OPENCODE_AGENTS_DIR)) {
        try {
          const file = join(OPENCODE_AGENTS_DIR, `${defaultAgent}.md`);
          if (existsSync(file)) {
            const raw = readFileSync(file, 'utf8');
            const match = raw.match(/^model:\s*([^\s#]+)/m);
            if (match) {
              agentModel = match[1].trim();
              if (agentModel.includes('/')) {
                const slashIdx = agentModel.indexOf('/');
                const inferredProvider = agentModel.slice(0, slashIdx);
                if (!providerId) providerId = inferredProvider;
                modelId = agentModel.slice(slashIdx + 1);
                source = `agents/${defaultAgent}`;
              }
            }
          }
        } catch {
          /* best-effort */
        }
      }

      if (providerId) {
        return {
          providerId,
          modelId: modelId || null,
          source,
          agent: defaultAgent || null,
          smallModel,
        };
      }
    } catch {
      /* best-effort */
    }

    // Last-resort: scan all agents, pick the most-referenced provider/model
    try {
      if (existsSync(OPENCODE_AGENTS_DIR)) {
        const counts = new Map(); // 'provider/model' -> count
        for (const file of readdirSync(OPENCODE_AGENTS_DIR)) {
          if (!file.endsWith('.md')) continue;
          try {
            const raw = readFileSync(join(OPENCODE_AGENTS_DIR, file), 'utf8');
            const m = raw.match(/^model:\s*([^\s#]+)/m);
            if (m) {
              const ref = m[1].trim();
              counts.set(ref, (counts.get(ref) || 0) + 1);
            }
          } catch {
            /* skip */
          }
        }
        if (counts.size > 0) {
          const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
          const [ref] = top;
          if (ref.includes('/')) {
            const slashIdx = ref.indexOf('/');
            return {
              providerId: ref.slice(0, slashIdx),
              modelId: ref.slice(slashIdx + 1),
              source: 'agents:inferred',
              agent: null,
              smallModel: null,
            };
          }
        }
      }
    } catch {
      /* best-effort */
    }

    return null;
  },

  get(id) {
    return this.list().find((p) => p.id === id) || null;
  },

  add(input) {
    if (!input || typeof input !== 'object') throw new Error('input required');
    // Auto-generate id from name if not provided
    const id = input.id || (input.name ? input.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-') : `provider_${Date.now().toString(36)}`);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
      throw new Error('invalid id');
    }
    const cfg = loadConfig();
    cfg.provider = cfg.provider || {};
    if (cfg.provider[id]) throw new Error(`provider "${id}" exists`);
    cfg.provider[id] = {
      name: input.name || id,
      baseURL: input.baseURL || '',
      apiKey: input.apiKey || '',
      models: Array.isArray(input.models) ? input.models : [],
      enabled: input.enabled !== false,
    };
    saveConfig(cfg);
    return this.get(id);
  },

  update(id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch required');
    const cfg = loadConfig();
    cfg.provider = cfg.provider || {};
    const cur = cfg.provider[id];
    if (!cur) throw new Error(`provider "${id}" not found`);
    cfg.provider[id] = {
      ...cur,
      name: patch.name ?? cur.name,
      baseURL: patch.baseURL ?? cur.baseURL,
      apiKey: unmask(cur.apiKey, patch.apiKey),
      models: Array.isArray(patch.models) ? patch.models : cur.models,
      enabled: patch.enabled ?? cur.enabled,
    };
    saveConfig(cfg);
    return this.get(id);
  },

  remove(id) {
    const cfg = loadConfig();
    if (!cfg.provider || !cfg.provider[id]) return false;
    delete cfg.provider[id];
    saveConfig(cfg);
    return true;
  },
};

export const mcpsStore = {
  OPENCODE_JSON,

  list() {
    const cfg = loadConfig();
    const mcps = cfg.mcp || {};
    return Object.entries(mcps).map(([id, m]) => {
      const isRemote = m?.type === 'remote';
      // Local MCP: command is an array in newer opencode.json. Older
      // format had separate `command` (string) + `args` (array). Normalize.
      const command = isRemote
        ? ''
        : Array.isArray(m.command)
          ? m.command.join(' ')
          : (m.command || '');
      const args = isRemote
        ? []
        : Array.isArray(m.command)
          ? m.command
          : Array.isArray(m.args)
            ? m.args
            : [];
      return {
        id,
        type: isRemote ? 'remote' : 'local',
        command,
        args,
        env: m.env || {},
        url: m.url || '',
        headers: m.headers || {},
        oauth: !!m.oauth,
        enabled: m.enabled !== false,
      };
    });
  },

  get(id) {
    return this.list().find((m) => m.id === id) || null;
  },

  add(input) {
    if (!input || !input.id) throw new Error('id is required');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input.id)) {
      throw new Error('invalid id');
    }
    const cfg = loadConfig();
    cfg.mcp = cfg.mcp || {};
    if (cfg.mcp[input.id]) throw new Error(`mcp "${input.id}" exists`);
    const isRemote = input.type === 'remote';
    cfg.mcp[input.id] = isRemote
      ? {
          type: 'remote',
          url: input.url || '',
          headers: input.headers || {},
          oauth: !!input.oauth,
          enabled: input.enabled !== false,
        }
      : {
          type: 'local',
          command: Array.isArray(input.args) && input.args.length > 0
            ? [input.command || '', ...input.args].filter(Boolean)
            : (input.command || ''),
          enabled: input.enabled !== false,
          ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
        };
    saveConfig(cfg);
    return this.get(input.id);
  },

  update(id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch required');
    const cfg = loadConfig();
    cfg.mcp = cfg.mcp || {};
    const cur = cfg.mcp[id];
    if (!cur) throw new Error(`mcp "${id}" not found`);
    const wasRemote = cur.type === 'remote';
    const isRemote = patch.type ? patch.type === 'remote' : wasRemote;
    if (isRemote) {
      cfg.mcp[id] = {
        type: 'remote',
        url: patch.url ?? cur.url ?? '',
        headers: patch.headers ?? cur.headers ?? {},
        oauth: patch.oauth ?? cur.oauth ?? false,
        enabled: patch.enabled ?? cur.enabled ?? true,
      };
    } else {
      const nextCommand = Array.isArray(patch.args) && patch.args.length > 0
        ? [patch.command ?? cur.command ?? '', ...patch.args].filter(Boolean)
        : (patch.command ?? cur.command ?? '');
      cfg.mcp[id] = {
        type: 'local',
        command: nextCommand,
        enabled: patch.enabled ?? cur.enabled ?? true,
        ...((patch.env && Object.keys(patch.env).length > 0) || cur.env
          ? { env: patch.env ?? cur.env ?? {} }
          : {}),
      };
    }
    saveConfig(cfg);
    return this.get(id);
  },

  remove(id) {
    const cfg = loadConfig();
    if (!cfg.mcp || !cfg.mcp[id]) return false;
    delete cfg.mcp[id];
    saveConfig(cfg);
    return true;
  },
};
