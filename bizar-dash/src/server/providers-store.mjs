/**
 * src/server/providers-store.mjs
 *
 * v3.0.0 — OpenCode providers and MCPs management.
 *
 * Reads / writes the opencode.json at ~/.config/opencode/opencode.json
 * under the `provider` and `mcp` keys.
 *
 * API keys are never echoed back in full — the response masks them.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const OPENCODE_JSON = join(HOME, '.config', 'opencode', 'opencode.json');

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
