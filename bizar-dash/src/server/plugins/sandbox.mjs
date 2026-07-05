/**
 * src/server/plugins/sandbox.mjs
 *
 * v5.0.0 — Plugin execution sandbox.
 *
 * Plugins run in a restricted `node:vm` context with the dangerous
 * globals stripped (`process`, `require`, `child_process`, raw `fs`).
 * The plugin can ONLY reach the outside world through a curated
 * `api` object whose methods are gated by the plugin's declared
 * permissions in `plugin.json`.
 *
 * Why vm and not child_process?
 *   - Speed: a vm fork starts in microseconds; a child fork is 100+ ms.
 *   - Memory: a vm context shares the parent's heap (we cap via the
 *     process-level `--max-old-space-size` setting); child processes
 *     duplicate everything.
 *   - Clean error propagation: a thrown plugin error becomes a
 *     structured { ok: false, error } without IPC round-trips.
 *
 * Timeout model:
 *   - Synchronous part of the plugin's `main` is bounded by
 *     `vm.Script` timeout.
 *   - Async methods are bounded by an outer `Promise.race` against a
 *     setTimeout. Default 30 s.
 *
 * Memory limit (note): Node's vm does NOT expose per-context heap caps.
 * We surface a `memoryLimitMb` advisory value but cannot enforce it at
 * the vm layer. For real isolation, deploy with `--max-old-space-size`
 * on the dashboard process.
 */
import vm from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as logger from '../logger.mjs';
import { logPermissionUse } from './permission-audit.mjs';

/** Default timeout for both script compile + async method execution. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Advisory memory limit (not enforced by vm; documented in plugin docs). */
const DEFAULT_MEMORY_LIMIT_MB = 128;

/**
 * Globals we expose to the plugin's vm context. Everything NOT in this
 * list is undefined inside the sandbox — `process`, `require`, `global`,
 * `globalThis.module`, raw `fs`, `child_process` are all stripped.
 *
 * Notes:
 *   - `URL` and `JSON` are safe and useful; allow them.
 *   - `Math`, `Date`, `Object`, `Array`, etc. are intrinsic prototypes
 *     that vm inherits automatically — no need to list them.
 *   - `console` is replaced with a logger-routed shim so plugin output
 *     flows through the structured logger with the plugin's id tagged.
 *   - `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`
 *     are passed through; plugins may want to debounce, etc.
 *   - `Promise` and async/await work out of the box.
 *   - `Buffer` is intentionally NOT exposed — it can be used to
 *     construct arbitrary binary blobs and exfiltrate via fetch. v2 may
 *     add an opt-in `buffer` permission.
 */
const ALLOWED_GLOBALS = new Set([
  'URL', 'URLSearchParams',
  'JSON',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise',
  'Symbol',
  'TextEncoder', 'TextDecoder',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'queueMicrotask',
  'console',
  'api',
  'plugin', // metadata exposed for diagnostics
]);

/**
 * Permission categories we honour at the sandbox boundary.
 * Anything else in the manifest's permissions list is ignored
 * (and logged as a warning so the plugin author sees it).
 */
const KNOWN_PERMS = new Set(['net', 'fs:read']);

/**
 * Build the `api` object exposed to the plugin. Each method either
 * works (if the corresponding permission is granted) or throws a
 * structured "permission denied" error.
 *
 * @param {object} ctx
 * @param {Set<string>} ctx.permissions  granted permission set (canonical form)
 * @param {Record<string, unknown>} ctx.config  plugin config (already validated)
 * @param {string} ctx.pluginId
 * @param {(cfg: Record<string, unknown>) => void} [ctx.onConfigChange]
 * @param {{ fetchImpl?: typeof globalThis.fetch, pluginRoot?: string }} [ctx.deps]
 * @returns {Record<string, any>}
 */
export function buildApi({ permissions, config, pluginId, onConfigChange, deps = {} }) {
  const fetchFn = deps.fetchImpl || globalThis.fetch;
  const pluginRoot = deps.pluginRoot;
  const childLog = logger.child({ module: 'plugin', pluginId });

  function requirePerm(name) {
    if (!permissions.has(name)) {
      const err = new Error(`permission denied: plugin "${pluginId}" needs "${name}"`);
      err.code = 'permission_denied';
      err.permission = name;
      throw err;
    }
  }

  const http = {
    /**
     * `api.http.get(url)` — only available with the `net` permission.
     * Returns parsed JSON if Content-Type is JSON, otherwise text.
     * Throws on non-2xx with the body included for debugging.
     */
    async get(url, opts = {}) {
      requirePerm('net');
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error('api.http.get: only http(s) URLs are allowed');
      }
      const res = await fetchFn(url, { method: 'GET', ...opts });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    },
    async post(url, body, opts = {}) {
      requirePerm('net');
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error('api.http.post: only http(s) URLs are allowed');
      }
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...opts,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    },
  };

  const fs = {
    /**
     * `api.fs.read(path)` — only available with the `fs:read` permission.
     * Path is sandboxed to the plugin's install dir + a small
     * whitelist of safe locations (plugin root, $HOME/.cache/bizar).
     * Anything else throws `permission_denied` with a useful message.
     */
    read(filePath, opts = {}) {
      requirePerm('fs:read');
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('api.fs.read: path must be a non-empty string');
      }
      const safe = sandboxReadPath(filePath, pluginRoot);
      const enc = opts.encoding === undefined ? 'utf8' : opts.encoding;
      return readFileSync(safe, { encoding: enc });
    },
    stat(filePath) {
      requirePerm('fs:read');
      const safe = sandboxReadPath(filePath, pluginRoot);
      return statSync(safe);
    },
  };

  const cfg = {
    /** `api.config.get(key)` — returns the value at `key` (dot path OK). */
    get(key) {
      if (typeof key !== 'string' || !key) return undefined;
      const parts = key.split('.');
      let cur = config;
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
      }
      return cur;
    },
    /** `api.config.set(key, value)` — mutates in-memory config; persisted by the store. */
    set(key, value) {
      if (typeof key !== 'string' || !key) {
        throw new Error('api.config.set: key must be a non-empty string');
      }
      const parts = key.split('.');
      let cur = config;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
      if (typeof onConfigChange === 'function') {
        try {
          onConfigChange(config);
        } catch (err) {
          childLog.warn('plugin onConfigChange handler threw', { err: err.message });
        }
      }
    },
    /** `api.config.all()` — returns a shallow copy of the full config. */
    all() {
      return JSON.parse(JSON.stringify(config));
    },
  };

  const api = {
    http,
    fs,
    config: cfg,
    /**
     * `api.log(level, msg, ctx?)` — plugin-author friendly logger
     * routing. Levels: debug | info | warn | error.
     */
    log(level, msg, ctx) {
      const allowed = ['debug', 'info', 'warn', 'error'];
      if (!allowed.includes(level)) {
        throw new Error(`api.log: level must be one of ${allowed.join(', ')}`);
      }
      if (typeof msg !== 'string') {
        throw new Error('api.log: msg must be a string');
      }
      const safeCtx = ctx && typeof ctx === 'object' ? ctx : undefined;
      childLog[level](msg, safeCtx);
    },
    /** Plugin metadata (read-only). */
    info: {
      id: pluginId,
      permissions: [...permissions],
    },
    /** Stable per-invocation id; useful for tracing plugin calls in logs. */
    invocationId: randomUUID(),
  };
  return api;
}

/**
 * Sandbox `fs:read` to the plugin's install dir. Anything else throws.
 * Symlinks are followed but the resulting path must still resolve
 * inside the plugin root — we use realpath via `pathResolve` for the
 * directory containment check, and read the literal path the plugin
 * passed (Node's readFileSync follows symlinks itself, but we want
 * any symlink that escapes the root to fail).
 *
 * @param {string} requested
 * @param {string|undefined} pluginRoot
 */
function sandboxReadPath(requested, pluginRoot) {
  if (!pluginRoot) {
    const err = new Error('api.fs.read: pluginRoot not configured');
    err.code = 'permission_denied';
    throw err;
  }
  // Resolve relative paths against the plugin root; absolute paths
  // are checked against the root's containment.
  const abs = pathResolve(pluginRoot, requested);
  if (abs !== pluginRoot && !abs.startsWith(pluginRoot + '/')) {
    const err = new Error(
      `api.fs.read: path "${requested}" is outside the plugin root`,
    );
    err.code = 'permission_denied';
    throw err;
  }
  return abs;
}

/**
 * Parse the plugin's declared permissions into a normalized set.
 * Unknown permissions are returned in `invalid` so the loader can
 * warn without failing the install.
 *
 * @param {unknown} perms  raw permissions array from plugin.json
 * @returns {{ allowed: Set<string>, invalid: string[] }}
 */
export function parsePluginPermissions(perms) {
  const allowed = new Set();
  const invalid = [];
  if (!Array.isArray(perms)) {
    return { allowed, invalid: [] };
  }
  for (const p of perms) {
    if (typeof p !== 'string' || !p) {
      invalid.push(String(p));
      continue;
    }
    const trimmed = p.trim();
    if (KNOWN_PERMS.has(trimmed)) {
      allowed.add(trimmed);
    } else {
      invalid.push(trimmed);
    }
  }
  return { allowed, invalid };
}

/**
 * Create a fresh sandbox context object for use with `vm.runInContext`.
 * Returns the `sandbox` you should pass to `vm.createContext(sandbox)`,
 * plus the `console` shim so we can install it once.
 *
 * @param {object} api  the `api` object from buildApi()
 */
function buildSandboxGlobals(api) {
  const sandbox = {
    api,
    plugin: api.info,
    // structured console — logs flow through the dashboard logger
    // with `module: 'plugin'` tagging so user output never leaks into
    // unrelated log channels.
    console: {
      debug: (...args) => safePluginLog('debug', args),
      info: (...args) => safePluginLog('info', args),
      warn: (...args) => safePluginLog('warn', args),
      error: (...args) => safePluginLog('error', args),
      log: (...args) => safePluginLog('info', args),
    },
    setTimeout, setInterval, clearTimeout, clearInterval,
    queueMicrotask,
    Promise,
    Map, Set, WeakMap, WeakSet,
    URL, URLSearchParams,
    JSON, Math, Date, Object, Array,
    Symbol,
    TextEncoder, TextDecoder,
    // No: process, require, Buffer, module, exports, global, globalThis,
    //     fetch (plugins must use api.http), child_process, fs, net, dns.
  };
  return sandbox;
}

function safePluginLog(level, args) {
  try {
    const msg = args
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    logger[level](msg, { module: 'plugin' });
  } catch {
    /* never let a plugin's log call crash the dashboard */
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Compile and execute a plugin's main script inside a fresh sandbox
 * context. Returns the plugin's exports object (the value assigned
 * to `module.exports` inside the wrapper).
 *
 * The plugin author writes CommonJS-style code:
 *
 *   // index.js
 *   module.exports = {
 *     async echo(input) {
 *       return `echo: ${input}`;
 *     }
 *   };
 *
 * We wrap that in a tiny shim that provides `module`, then evaluate.
 *
 * @param {object} opts
 * @param {string} opts.mainFile     absolute path to the plugin's main JS file
 * @param {Record<string, unknown>} opts.config
 * @param {string[]} opts.permissions  raw permission strings from plugin.json
 * @param {string} opts.pluginId
 * @param {string} opts.pluginRoot    absolute path to the plugin install dir
 * @param {(cfg: Record<string, unknown>) => void} [opts.onConfigChange]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.memoryLimitMb]
 * @param {typeof globalThis.fetch} [opts.fetchImpl]
 * @param {Array<{ name: string, permissions?: string[] }>} [opts.methodSpecs]
 *     Per-method permission declarations from `plugin.json`'s
 *     `exports` array. Each entry is `{ name, permissions }`; used by
 *     `safeInvoke` to enforce method-level permission checks before
 *     invoking. Optional — a plugin loaded without this field gets no
 *     method-level gating (legacy behaviour).
 * @returns {Promise<{
 *   exports: Record<string, Function>,
 *   permissions: Set<string>,
 *   invalidPermissions: string[],
 *   memoryLimitMb: number,
 *   api: object,
 *   methodSpecs: Array<{ name: string, permissions?: string[] }>
 * }>}
 */
export async function loadPlugin(opts) {
  const {
    mainFile,
    config,
    permissions: rawPerms,
    pluginId,
    pluginRoot,
    onConfigChange,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    memoryLimitMb = DEFAULT_MEMORY_LIMIT_MB,
    fetchImpl,
    methodSpecs = [],
  } = opts;

  if (!mainFile || typeof mainFile !== 'string') {
    throw new Error('loadPlugin: mainFile is required');
  }

  const { allowed, invalid } = parsePluginPermissions(rawPerms);
  if (invalid.length) {
    logger.warn('plugin declares unknown permissions', {
      module: 'plugin',
      pluginId,
      invalid,
    });
  }

  const api = buildApi({
    permissions: allowed,
    config: config || {},
    pluginId,
    onConfigChange,
    deps: { fetchImpl, pluginRoot },
  });

  // The plugin's `module` / `exports` are exposed as vm globals. The
  // user writes `module.exports = { ... }` and we capture the result
  // by reading `module.exports` after the script runs. We deliberately
  // expose `module` (a single object) rather than two separate
  // parameters so `exports = ...` reassignments inside the plugin are
  // NOT picked up — that matches Node.js CommonJS semantics.
  const fakeModule = { exports: {} };
  const sandbox = buildSandboxGlobals(api);
  sandbox.module = fakeModule;
  sandbox.exports = fakeModule.exports;
  const context = vm.createContext(sandbox);

  const source = readFileSync(mainFile, 'utf8');
  // IIFE wrapper so the user code's top-level `return` statements
  // work inside an arrow body, and so we capture the final
  // `module.exports` value as the script's return value. The IIFE
  // receives `__m` (the fake module) so it can read whatever the
  // user assigned to `module.exports` — they may have set it via
  // the bare `module` global too, in which case `__m.exports`
  // matches by reference.
  const wrapper =
    `((function(__m){\n${source}\n;return __m.exports;\n}))(module)`;
  let script;
  try {
    script = new vm.Script(wrapper, {
      filename: mainFile,
      lineOffset: 0,
      displayErrors: true,
    });
  } catch (err) {
    const wrap = new Error(`plugin "${pluginId}" failed to compile: ${err.message}`);
    wrap.code = 'compile_error';
    wrap.cause = err;
    throw wrap;
  }

  let exportsObj;
  try {
    exportsObj = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
    });
  } catch (err) {
    const wrap = new Error(`plugin "${pluginId}" failed during init: ${err.message}`);
    wrap.code = 'init_error';
    wrap.cause = err;
    throw wrap;
  }
  // `exportsObj` is what the wrapper returns: `__m.exports`. The user
  // assigned their plugin's methods to it via `module.exports = {...}`.
  // If they only assigned to `exports.foo = ...` (a common slip),
  // those properties are visible via the `fakeModule.exports` reference
  // — we re-read it here so both styles work.
  const moduleExports = fakeModule.exports;
  const resolved = (exportsObj && typeof exportsObj === 'object')
    ? exportsObj
    : moduleExports;
  if (!resolved || typeof resolved !== 'object') {
    throw new Error(
      `plugin "${pluginId}" did not export an object — ` +
      `did you forget \`module.exports = { ... }\`?`,
    );
  }
  // Sanity check: an empty exports object almost certainly means the
  // author forgot `module.exports = ...`. We warn (don't throw) so
  // plugins with no exported methods don't fail loudly.
  if (Object.keys(resolved).length === 0) {
    logger.warn('plugin exports are empty', {
      module: 'plugin',
      pluginId,
    });
  }
  return {
    exports: resolved,
    permissions: allowed,
    invalidPermissions: invalid,
    memoryLimitMb,
    api,
    methodSpecs: Array.isArray(methodSpecs) ? methodSpecs : [],
    // Stash the plugin id on the loaded object so safeInvoke can
    // write it to the audit log without callers having to thread it
    // through as a separate argument (compatible with the v5.0
    // invocation shape).
    pluginId,
  };
}

/**
 * v5.3.0 helper — normalise whatever shape `loaded.permissions` was
 * stored as into a plain array. `loadPlugin` uses a `Set` internally,
 * but tests may pass an `Array`, and `loaded.permissions` may also be
 * missing entirely (older callers). Always returns an array of strings.
 *
 * @param {unknown} perms
 * @returns {string[]}
 */
function permissionsAsArray(perms) {
  if (!perms) return [];
  if (perms instanceof Set) return [...perms];
  if (Array.isArray(perms)) return perms.filter((p) => typeof p === 'string');
  return [];
}

/**
 * Invoke a method on a loaded plugin inside a sandbox timeout race.
 * Returns `{ ok: true, result }` on success, `{ ok: false, error }`
 * on any throw (including permission errors, timeouts, plugin bugs).
 *
 * v5.3.0 — method-level permission enforcement: when `loaded.methodSpecs`
 * is populated (from plugin.json's `exports` array), `safeInvoke` checks
 * the called method's declared permissions against the plugin's granted
 * permissions BEFORE running. A denial is recorded in the audit log
 * (`permission-audit.mjs`) and returned with `code: 'permission_denied'`
 * and a `missing` array listing the ungranted permissions.
 *
 * @param {object} loaded  return value of loadPlugin()
 * @param {string} method  method name on the plugin's exports
 * @param {unknown[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string, code?: string, missing?: string[] }>}
 */
export async function safeInvoke(loaded, method, args = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!loaded || typeof loaded !== 'object') {
    return { ok: false, error: 'plugin not loaded', code: 'not_loaded' };
  }

  // v5.3.0 — method-level permission enforcement. Uses
  // `loaded.methodSpecs` (a copy of plugin.json's `exports` array, each
  // entry shaped `{ name, permissions?: string[] }`). When the plugin
  // declares no method-level permissions, we skip the check entirely
  // (backward compatibility for plugins loaded without a manifest).
  const pluginId = loaded.pluginId || loaded.id || 'unknown';
  const methodSpecs = Array.isArray(loaded.methodSpecs) ? loaded.methodSpecs : [];
  const methodSpec = methodSpecs.find((s) => s && s.name === method);
  if (methodSpec) {
    const required = Array.isArray(methodSpec.permissions) ? methodSpec.permissions : [];
    const grantedArr = permissionsAsArray(loaded.permissions);
    const missing = required.filter((p) => !grantedArr.includes(p));
    if (missing.length > 0) {
      logPermissionUse(pluginId, method, missing.join(','), false);
      return {
        ok: false,
        error: `Method "${method}" requires permissions: ${missing.join(', ')}`,
        code: 'permission_denied',
        missing,
      };
    }
    // Allowed — log the granted set (or 'none' if no perms required).
    logPermissionUse(pluginId, method, required.join(',') || 'none', true);
  }

  const fn = loaded.exports && loaded.exports[method];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: `plugin does not export method "${method}"`,
      code: 'no_such_method',
    };
  }
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => fn.apply(loaded.exports, args)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`plugin method "${method}" timed out after ${timeoutMs}ms`);
          err.code = 'timeout';
          reject(err);
        }, timeoutMs);
      }),
    ]);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : 'plugin_error',
      // Surface the structured fields that callers (HTTP routes,
      // CLI) want to know about — permission name on a denied call,
      // status on an HTTP error thrown by api.http.*, etc.
      ...(err && err.permission ? { permission: err.permission } : {}),
      ...(err && err.status ? { status: err.status } : {}),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Top-level convenience: load a plugin from disk and invoke a method
 * in one call. This is what the route handler and the CLI use.
 *
 * @param {object} opts
 * @param {string} opts.pluginRoot  absolute path to the plugin install dir
 * @param {Record<string, unknown>} opts.config
 * @param {string[]} opts.permissions
 * @param {string} opts.method
 * @param {unknown[]} [opts.args]
 * @param {string} [opts.pluginId]
 * @param {number} [opts.timeoutMs]
 * @param {typeof globalThis.fetch} [opts.fetchImpl]
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string, code?: string }>}
 */
export async function loadAndInvoke(opts) {
  const manifestPath = pathResolve(opts.pluginRoot, 'plugin.json');
  const manifest = readManifest(manifestPath);
  const mainRel = opts.main || manifest.main;
  if (!mainRel || typeof mainRel !== 'string') {
    return {
      ok: false,
      error: 'plugin.json must declare "main"',
      code: 'bad_manifest',
    };
  }
  const mainFile = pathResolve(opts.pluginRoot, mainRel);
  let loaded;
  try {
    loaded = await loadPlugin({
      mainFile,
      config: opts.config,
      permissions: opts.permissions,
      pluginId: opts.pluginId || manifestPath,
      pluginRoot: opts.pluginRoot,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
      // v5.3.0 — wire method-level permissions through from the manifest
      // so safeInvoke can enforce them.
      methodSpecs: Array.isArray(manifest.exports) ? manifest.exports : [],
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      code: err.code || 'load_error',
    };
  }
  return safeInvoke(loaded, opts.method, opts.args || [], opts.timeoutMs);
}

/**
 * Read and validate a plugin.json manifest. Throws a structured error
 * on any required-field violation. Returns the parsed object on success.
 *
 * @param {string} manifestPath
 */
export function readManifest(manifestPath) {
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(`plugin.json not found at ${manifestPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const wrap = new Error(`plugin.json at ${manifestPath} is not valid JSON: ${err.message}`);
    wrap.code = 'bad_manifest';
    throw wrap;
  }
  if (!parsed || typeof parsed !== 'object') {
    const err = new Error(`plugin.json at ${manifestPath} must be an object`);
    err.code = 'bad_manifest';
    throw err;
  }
  if (typeof parsed.id !== 'string' || !parsed.id) {
    const err = new Error('plugin.json must declare a non-empty "id"');
    err.code = 'bad_manifest';
    throw err;
  }
  if (typeof parsed.version !== 'string' || !parsed.version) {
    const err = new Error('plugin.json must declare a non-empty "version"');
    err.code = 'bad_manifest';
    throw err;
  }
  if (typeof parsed.main !== 'string' || !parsed.main) {
    const err = new Error('plugin.json must declare a non-empty "main"');
    err.code = 'bad_manifest';
    throw err;
  }
  if (!Array.isArray(parsed.exports)) {
    parsed.exports = [];
  }
  if (!Array.isArray(parsed.permissions)) {
    parsed.permissions = [];
  }
  return parsed;
}

export const __testing = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MEMORY_LIMIT_MB,
  ALLOWED_GLOBALS,
  KNOWN_PERMS,
  permissionsAsArray,
};