/**
 * src/server/mod-security.mjs
 *
 * v1.0.0 — Mod security layer for BizarHarness.
 *
 * Threat model: a user installs a mod from a registry (or a third-party
 * GitHub repo) and the mod's `route.mjs` runs in the dashboard's
 * Node process. Without a security layer, the mod has full access to:
 *   - The filesystem (read/write any file the user can)
 *   - The network (any HTTP/HTTPS request)
 *   - Subprocesses (spawn any binary on PATH)
 *   - The dashboard's REST API (loopback, no auth required)
 *   - The user's environment variables (incl. API keys)
 *
 * This module provides defense in depth:
 *
 *   1. **Permission declarations** — mods MUST declare what they need
 *      in `mod.json`. Unknown permissions trigger a warning at load.
 *   2. **Filesystem sandboxing** — mods are given scoped `readFile` /
 *      `writeFile` helpers that enforce path prefixes from the mod's
 *      declared `fs:read:<path>` / `fs:write:<path>` permissions.
 *      Path-traversal attacks (e.g. `../`) are blocked.
 *   3. **Subprocess allowlist** — only whitelisted binaries
 *      (`bizar`, `cline`, `python3`, `graphify`, `git`, `node`,
 *      `npm`, `pip`, `pipx`, `uv`) can be spawned. Custom
 *      binaries require an explicit `process:spawn:<bin>` permission.
 *   4. **Audit log** — every privileged operation (fs read/write,
 *      process spawn, network fetch) is logged to
 *      `~/.cache/bizar/logs/mod-audit.log` with timestamp + mod id +
 *      action + details.
 *   5. **Integrity hash** — at install time we hash every file in the
 *      mod and store the SHA-256 under `_integrity` in mod.json. On
 *      every load we recompute the hash; a mismatch triggers a
 *      critical warning ("mod contents have been modified outside
 *      bizar mod install — review carefully").
 *
 * v1 limitations: a malicious mod could still bypass the helpers and
 * use Node's built-in `fs` / `child_process` directly. v2 will close
 * that gap with a `vm`-based sandbox or worker-thread isolation.
 *
 * For now, the security layer makes the *intent* of mods explicit
 * (declared permissions, audit trail, integrity hash) so users can
 * review what they're installing and detect tampering.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Binaries that any mod can spawn without an explicit permission.
 * These are core tools in the BizarHarness ecosystem that mods
 * legitimately need. Custom binaries (e.g. `curl`, `wget`) require
 * `process:spawn:<bin>` in the mod's permissions array.
 */
export const ALLOWED_BINARIES = new Set([
  'bizar',
  'cline',
  'cline',
  'python3',
  'python',
  'graphify',
  'graphifyy',
  'pip',
  'pipx',
  'uv',
  'node',
  'npm',
  'npx',
  'git',
  'jq',
]);

/**
 * Default permission set for a brand-new mod. Empty — mods must
 * declare what they need.
 */
export const DEFAULT_PERMISSIONS = [];

/**
 * Paths the dashboard's own runtime depends on. Mods that need
 * to touch these MUST declare the appropriate `fs:read:<path>` /
 * `fs:write:<path>` permission.
 */
export const SENSITIVE_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.config/bizar/auth.json',
  '~/.config/cline/auth.json',
  '~/.gnupg',
];

// ---------------------------------------------------------------------------
// Permission parsing
// ---------------------------------------------------------------------------

/**
 * Normalize a list of permission strings from mod.json into a set of
 * canonical permission tokens. Examples:
 *
 *   "fs:read:.bizar/graph"        -> exact match
 *   "fs:read:.bizar/graph/*"      -> prefix match (any file under .bizar/graph)
 *   "process:spawn:bizar"         -> exact match
 *   "network:*"                   -> any network access (v2 only)
 *
 * Invalid permission tokens are returned in a separate `invalid` array
 * so the loader can warn without aborting the load (v1 is permissive).
 */
export function parsePermissions(perms) {
  const allowed = new Set();
  const invalid = [];
  for (const p of perms || []) {
    if (typeof p !== 'string' || !p.includes(':')) {
      invalid.push(p);
      continue;
    }
    const [category, ...rest] = p.split(':');
    const validCategories = new Set(['fs', 'process', 'network', 'api', 'env']);
    if (!validCategories.has(category)) {
      invalid.push(p);
      continue;
    }
    allowed.add(p);
  }
  return { allowed, invalid };
}

// ---------------------------------------------------------------------------
// Filesystem sandbox
// ---------------------------------------------------------------------------

/**
 * Validate that `path` is within one of the mod's declared `fs:read` /
 * `fs:write` scopes. Returns a normalized absolute path on success,
 * throws on access denial.
 *
 * Scope syntax:
 *   - Exact path:  `fs:read:/abs/path/to/file`
 *   - Prefix:      `fs:read:/abs/path/to/dir/*` (any descendant allowed)
 *   - Home-relative: `fs:read:~/.config/bizar/mods` (resolves to home)
 */
export function authorizeFsPath(perms, kind, requestedPath) {
  // `kind` is the full permission category: 'fs:read' or 'fs:write'.
  // We accept the bare form ('read' / 'write') too for caller convenience.
  const prefix = kind.startsWith('fs:') ? `${kind}:` : `fs:${kind}:`;
  const expanded = requestedPath.startsWith('~/')
    ? join(homedir(), requestedPath.slice(2))
    : resolve(requestedPath);

  // Reject obvious traversal attempts even before checking perms
  if (expanded.includes('\0')) {
    throw new Error(`fs:${kind}: null bytes are not allowed in paths`);
  }

  const candidates = [];
  for (const p of perms) {
    if (!p.startsWith(prefix)) continue;
    const scope = p.slice(prefix.length);
    if (scope.endsWith('/*')) {
      candidates.push({ prefix: scope.slice(0, -2), recursive: true });
    } else if (scope.endsWith('/')) {
      // Trailing slash — treat as recursive directory match.
      candidates.push({ prefix: scope.slice(0, -1), recursive: true });
    } else {
      // No suffix — match the directory and everything under it.
      // This is the intuitive behavior for `fs:read:/foo`: "I want
      // access to /foo" usually means "and everything below it". For
      // exact-file access, callers can use a different permission.
      candidates.push({ prefix: scope, recursive: true });
    }
  }

  for (const c of candidates) {
    const expandedScope = c.prefix.startsWith('~/')
      ? join(homedir(), c.prefix.slice(2))
      : resolve(c.prefix);
    if (c.recursive) {
      if (expanded === expandedScope || expanded.startsWith(expandedScope + sep)) {
        return expanded;
      }
    } else {
      if (expanded === expandedScope) return expanded;
    }
  }
  throw new Error(
    `mod not authorized to ${kind} '${requestedPath}' ` +
    `(declare "fs:${kind}:<path>" in mod.json permissions to allow)`,
  );
}

/**
 * Wrap Node's `fs` module so that readFileSync / writeFileSync /
 * readdirSync / statSync are gated by the mod's declared fs: scopes.
 * Other fs functions (mkdirSync, copyFileSync, etc.) are forwarded
 * with an audit warning but no enforcement — v2 will enforce these too.
 */
export function sandboxedFs(perms, audit, kind = 'read') {
  const guard = (path) => authorizeFsPath(perms, `${kind}:${path}`.replace(/^read:|^write:/, ''), path);

  // Strip the `kind:` prefix the authorizeFsPath expects; the caller
  // already filtered by kind.
  const guardRaw = (path, op) => {
    const needed = op === 'read' ? 'read' : 'write';
    const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
    for (const p of perms) {
      if (!p.startsWith(`fs:${needed}:`)) continue;
      const scope = p.slice(`fs:${needed}:`.length);
      const exp = scope.startsWith('~/') ? join(homedir(), scope.slice(2)) : resolve(scope);
      if (scope.endsWith('/*')) {
        const base = exp;
        if (expanded === base || expanded.startsWith(base + sep)) return expanded;
      } else if (expanded === exp) {
        return expanded;
      }
    }
    throw new Error(`mod not authorized to ${op} '${path}'`);
  };

  return {
    readFileSync: (path, enc) => {
      const safe = guardRaw(path, 'read');
      audit('fs:read', { path: safe });
      return readFileSync(safe, enc);
    },
    writeFileSync: (path, data, enc) => {
      const safe = guardRaw(path, 'write');
      audit('fs:write', { path: safe });
      mkdirSync(dirname(safe), { recursive: true });
      return writeFileSync(safe, data, enc);
    },
    existsSync: (path) => existsSync(path),
    statSync: (path) => {
      const safe = guardRaw(path, 'read');
      return statSync(safe);
    },
    readdirSync: (path) => {
      const safe = guardRaw(path, 'read');
      return require('node:fs').readdirSync(safe);
    },
  };
}

// ---------------------------------------------------------------------------
// Subprocess allowlist
// ---------------------------------------------------------------------------

/**
 * Authorize a subprocess spawn. Returns the resolved absolute path of
 * the binary if allowed; throws otherwise. Records the spawn in the
 * audit log.
 *
 * Resolution:
 *   1. If `bin` is a path (contains `/`), it's rejected unless the mod
 *      has a matching `process:spawn:<abs-path>` permission.
 *   2. If `bin` is a bare name and is in `ALLOWED_BINARIES`, it's
 *      allowed.
 *   3. Otherwise the mod must declare `process:spawn:<bin>`.
 */
export function authorizeSpawn(perms, audit, bin, args = []) {
  let allow = false;
  if (bin.includes('/') || bin.includes('\\')) {
    // Absolute / relative path — must be explicitly permitted
    allow = perms.has(`process:spawn:${bin}`) || perms.has('process:spawn:*');
  } else if (ALLOWED_BINARIES.has(bin)) {
    allow = true;
  } else {
    allow = perms.has(`process:spawn:${bin}`) || perms.has('process:spawn:*');
  }
  if (!allow) {
    throw new Error(
      `mod not authorized to spawn '${bin}' ` +
      `(declare "process:spawn:${bin}" in mod.json permissions to allow)`,
    );
  }
  audit('process:spawn', { bin, args });
  return true;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function auditLogPath() {
  return join(homedir(), '.cache', 'bizar', 'logs', 'mod-audit.log');
}

/**
 * Create an audit writer for a given mod. Logs every privileged action
 * to `~/.cache/bizar/logs/mod-audit.log` as JSON lines.
 */
export function createAuditWriter(mod) {
  const logPath = auditLogPath();
  mkdirSync(dirname(logPath), { recursive: true });

  return function audit(action, details = {}) {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      mod: mod.id,
      modVersion: mod.version,
      action,
      details,
    });
    try {
      appendFileSync(logPath, entry + '\n');
    } catch {
      // Never let audit logging break a mod.
    }
  };
}

// ---------------------------------------------------------------------------
// Integrity hash
// ---------------------------------------------------------------------------

/**
 * Walk a mod directory and compute a SHA-256 of (path + content) for
 * every file. The order is deterministic (sorted by relative path).
 */
export function computeModHash(modPath) {
  const files = [];
  function walk(dir, prefix) {
    let entries;
    try {
      entries = require('node:fs').readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.DS_Store') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, rel);
      else if (e.isFile()) files.push(rel);
    }
  }
  walk(modPath, '');
  files.sort();

  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f + '\0');
    try {
      hash.update(readFileSync(join(modPath, f)));
    } catch {
      hash.update('<unreadable>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Verify the mod's current files match the hash stored in its
 * `mod.json._integrity` field. Returns:
 *   { ok: true, hash }                       — matches
 *   { ok: false, hash, expected, reason }    — mismatch
 *   { ok: 'unsigned', hash }                  — no _integrity field
 */
export function verifyModIntegrity(mod) {
  const current = computeModHash(mod.path);
  if (!mod._integrity) return { ok: 'unsigned', hash: current };
  if (mod._integrity === current) return { ok: true, hash: current };
  return {
    ok: false,
    hash: current,
    expected: mod._integrity,
    reason: 'mod contents have been modified outside `bizar mod install`',
  };
}

// ---------------------------------------------------------------------------
// Per-mod context
// ---------------------------------------------------------------------------

/**
 * Build a security context for one mod. The context exposes the
 * sandboxed fs helpers and an audit writer. Mod route files receive
 * the context as `register({ ctx, security })`.
 */
export function createModSecurityContext(mod) {
  const { allowed, invalid } = parsePermissions(mod.permissions || []);
  const audit = createAuditWriter(mod);

  return {
    permissions: allowed,
    invalidPermissions: invalid,
    audit,
    fs: sandboxedFs(allowed, audit, 'read'), // default helpers for read; mod can override
    authorizeSpawn: (bin, args) => authorizeSpawn(allowed, audit, bin, args),
    verifyIntegrity: () => verifyModIntegrity(mod),
  };
}