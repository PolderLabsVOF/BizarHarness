// @ts-nocheck — better-sqlite3's declaration types are not export-safe for
// declaration emit from this JavaScript module.

/**
 * Durable cross-worktree task coordination.
 *
 * The database lives under Git's common directory by default, so every linked
 * worktree observes the same dependency, lease, and path-ownership state.
 * SQLite transactions provide the cross-process serialization boundary.
 */

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const Database = (await import('better-sqlite3')).default;

export const TASK_STATES = Object.freeze([
  'pending',
  'active',
  'blocked',
  'completed',
  'integrating',
  'integrated',
  'failed',
  'cancelled',
]);

const DEPENDENCY_SATISFIED = new Set(['completed', 'integrated']);
const LIVE_SCOPE_STATES = new Set(['active']);
const DEFAULT_LEASE_MS = 30 * 60 * 1_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 2000;

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','active','blocked','completed','integrating','integrated','failed','cancelled')),
  priority          INTEGER NOT NULL DEFAULT 0,
  owner             TEXT,
  owner_session_id  TEXT,
  workspace         TEXT,
  scopes_json       TEXT NOT NULL DEFAULT '[]',
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  artifacts_json    TEXT NOT NULL DEFAULT '[]',
  evidence          TEXT,
  blocker           TEXT,
  lease_expires_at  INTEGER,
  attempt           INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  completed_at      INTEGER,
  integrated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on    TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);

CREATE TABLE IF NOT EXISTS task_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_state_lease
  ON tasks (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
  ON task_dependencies (depends_on);
CREATE INDEX IF NOT EXISTS idx_task_events_task_ts
  ON task_events (task_id, ts);
`;

export class TaskLedgerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TaskLedgerError';
    this.code = code;
    this.details = details;
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function requireText(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new TaskLedgerError('INVALID_INPUT', `${field} must be a non-empty string`);
  }
  return normalized;
}

function normalizeLeaseMs(value) {
  const parsed = Number(value ?? DEFAULT_LEASE_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_LEASE_MS;
  return Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, Math.floor(parsed)));
}

/**
 * Scopes are repository-relative exact paths or directory globs ending in
 * `/**`. Parent traversal and absolute paths are rejected.
 */
export function normalizeScope(value) {
  let scope = requireText(value, 'scope').replaceAll('\\', '/');
  if (scope.startsWith('./')) scope = scope.slice(2);
  if (scope.endsWith('/')) scope += '**';
  const wildcard = scope.endsWith('/**');
  const base = wildcard ? scope.slice(0, -3) : scope;
  if (!base || base === '.' || isAbsolute(base) || base.split('/').includes('..')) {
    throw new TaskLedgerError('INVALID_SCOPE', `invalid repository-relative scope: ${value}`);
  }
  return wildcard ? `${base.replace(/\/+$/, '')}/**` : base.replace(/\/+$/, '');
}

function scopeBase(scope) {
  return scope.endsWith('/**') ? scope.slice(0, -3) : scope;
}

function scopeContains(scope, path) {
  const base = scopeBase(scope);
  if (scope.endsWith('/**')) return path === base || path.startsWith(`${base}/`);
  return path === base;
}

export function scopesOverlap(left, right) {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if (a === b) return true;
  if (a.endsWith('/**') && scopeContains(a, scopeBase(b))) return true;
  if (b.endsWith('/**') && scopeContains(b, scopeBase(a))) return true;
  return false;
}

function normalizeRelativePath(value) {
  const path = String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!path || path === '.' || path.startsWith('../') || isAbsolute(path)) return null;
  return path;
}

function pathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function resolveTaskDatabase(cwd = process.cwd(), override) {
  const explicit = override || process.env.BIZAR_TASK_DB;
  if (explicit) return resolve(cwd, explicit);

  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout.trim()) {
    const common = result.stdout.trim();
    const commonPath = isAbsolute(common) ? common : resolve(cwd, common);
    return join(commonPath, 'bizar', 'tasks.sqlite');
  }
  return join(resolve(cwd, '.bizar'), 'tasks.sqlite');
}

export class TaskLedger {
  constructor(options = {}) {
    this.dbPath = resolve(options.dbPath || resolveTaskDatabase(options.cwd));
    this.now = options.now || (() => Date.now());
    mkdirSync(dirname(this.dbPath), { recursive: true });
    /** @type {import('better-sqlite3').Database} */
    this.db = new Database(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 2000');
  }

  close() {
    this.db.close();
  }

  _event(taskId, kind, payload = {}, now = this.now()) {
    this.db.prepare(
      `INSERT INTO task_events (task_id, kind, ts, payload_json) VALUES (?, ?, ?, ?)`,
    ).run(taskId, kind, now, JSON.stringify(payload));
  }

  _row(taskId) {
    return this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  }

  _dependencies(taskId) {
    return this.db.prepare(
      `SELECT depends_on FROM task_dependencies WHERE task_id = ? ORDER BY depends_on`,
    ).all(taskId).map((row) => row.depends_on);
  }

  _blockedDependencies(taskId) {
    return this.db.prepare(
      `SELECT d.depends_on AS id, t.state
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on
       WHERE d.task_id = ?
       ORDER BY d.depends_on`,
    ).all(taskId).filter((dependency) => !DEPENDENCY_SATISFIED.has(dependency.state));
  }

  _serialize(row) {
    if (!row) return null;
    const dependencies = this._dependencies(row.id);
    const blockedBy = this._blockedDependencies(row.id);
    return {
      id: row.id,
      title: row.title,
      state: row.state,
      ready: row.state === 'pending' && blockedBy.length === 0,
      priority: row.priority,
      owner: row.owner,
      ownerSessionId: row.owner_session_id,
      workspace: row.workspace,
      scopes: parseJson(row.scopes_json, []),
      dependencies,
      blockedBy,
      metadata: parseJson(row.metadata_json, {}),
      artifacts: parseJson(row.artifacts_json, []),
      evidence: row.evidence,
      blocker: row.blocker,
      leaseExpiresAt: row.lease_expires_at,
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      integratedAt: row.integrated_at,
    };
  }

  createTask(input) {
    const id = requireText(input?.id, 'id');
    const title = requireText(input?.title, 'title');
    const dependencies = [...new Set((input.dependencies || []).map((dep) => requireText(dep, 'dependency')))];
    const scopes = [...new Set((input.scopes || []).map(normalizeScope))].sort();
    const priority = Number.isFinite(Number(input.priority)) ? Math.trunc(Number(input.priority)) : 0;
    const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
    const now = this.now();

    const transaction = this.db.transaction(() => {
      if (this._row(id)) {
        throw new TaskLedgerError('TASK_EXISTS', `task already exists: ${id}`);
      }
      for (const dependency of dependencies) {
        if (dependency === id) {
          throw new TaskLedgerError('DEPENDENCY_CYCLE', `task ${id} cannot depend on itself`);
        }
        if (!this._row(dependency)) {
          throw new TaskLedgerError(
            'DEPENDENCY_NOT_FOUND',
            `dependency ${dependency} does not exist`,
          );
        }
      }

      this.db.prepare(
        `INSERT INTO tasks
          (id, title, priority, scopes_json, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, title, priority, JSON.stringify(scopes), JSON.stringify(metadata), now, now);
      const insertDependency = this.db.prepare(
        `INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)`,
      );
      for (const dependency of dependencies) insertDependency.run(id, dependency);
      this._event(id, 'created', { dependencies, scopes }, now);
      return this.getTask(id);
    });
    return transaction.immediate();
  }

  getTask(taskId) {
    const id = requireText(taskId, 'taskId');
    const row = this._row(id);
    if (!row) throw new TaskLedgerError('TASK_NOT_FOUND', `task not found: ${id}`);
    return this._serialize(row);
  }

  listTasks({ state } = {}) {
    const rows = state
      ? this.db.prepare(`SELECT * FROM tasks WHERE state = ? ORDER BY priority DESC, created_at, id`).all(state)
      : this.db.prepare(`SELECT * FROM tasks ORDER BY priority DESC, created_at, id`).all();
    return rows.map((row) => this._serialize(row));
  }

  listReady() {
    return this.listTasks().filter((task) => task.ready);
  }

  _sweepExpired(now) {
    const expired = this.db.prepare(
      `SELECT id, owner, workspace FROM tasks
       WHERE state IN ('active','blocked')
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at <= ?`,
    ).all(now);
    const reset = this.db.prepare(
      `UPDATE tasks
       SET state = 'pending', owner = NULL, owner_session_id = NULL,
           workspace = NULL, lease_expires_at = NULL, blocker = NULL,
           updated_at = ?
       WHERE id = ?`,
    );
    for (const task of expired) {
      reset.run(now, task.id);
      this._event(task.id, 'lease-expired', {
        previousOwner: task.owner,
        previousWorkspace: task.workspace,
      }, now);
    }
    return expired.length;
  }

  sweepExpiredLeases() {
    const transaction = this.db.transaction(() => this._sweepExpired(this.now()));
    return transaction.immediate();
  }

  claimTask(input) {
    const taskId = requireText(input?.taskId, 'taskId');
    const owner = requireText(input?.owner, 'owner');
    const workspace = resolve(requireText(input?.workspace, 'workspace'));
    const ownerSessionId = input.ownerSessionId ? String(input.ownerSessionId) : null;
    const leaseMs = normalizeLeaseMs(input.leaseMs);
    const now = this.now();

    const transaction = this.db.transaction(() => {
      this._sweepExpired(now);
      const row = this._row(taskId);
      if (!row) throw new TaskLedgerError('TASK_NOT_FOUND', `task not found: ${taskId}`);
      if (row.state !== 'pending') {
        throw new TaskLedgerError('TASK_NOT_READY', `task ${taskId} is ${row.state}`);
      }
      const blockedBy = this._blockedDependencies(taskId);
      if (blockedBy.length) {
        throw new TaskLedgerError(
          'DEPENDENCY_BLOCKED',
          `task ${taskId} has unfinished dependencies`,
          { blockedBy },
        );
      }

      const scopes = parseJson(row.scopes_json, []);
      const live = this.db.prepare(
        `SELECT id, owner, workspace, scopes_json
         FROM tasks
         WHERE id <> ? AND state = 'active'
           AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`,
      ).all(taskId, now);
      for (const other of live) {
        const otherScopes = parseJson(other.scopes_json, []);
        const collision = scopes.find((scope) =>
          otherScopes.some((otherScope) => scopesOverlap(scope, otherScope)));
        if (collision) {
          throw new TaskLedgerError(
            'SCOPE_CONFLICT',
            `task ${taskId} overlaps live task ${other.id}`,
            {
              taskId: other.id,
              owner: other.owner,
              workspace: other.workspace,
              scope: collision,
            },
          );
        }
      }

      const leaseExpiresAt = now + leaseMs;
      this.db.prepare(
        `UPDATE tasks
         SET state = 'active', owner = ?, owner_session_id = ?, workspace = ?,
             lease_expires_at = ?, attempt = attempt + 1, blocker = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).run(owner, ownerSessionId, workspace, leaseExpiresAt, now, taskId);
      this._event(taskId, 'claimed', {
        owner,
        ownerSessionId,
        workspace,
        leaseExpiresAt,
      }, now);
      return this.getTask(taskId);
    });
    return transaction.immediate();
  }

  heartbeatTask({ taskId, owner, leaseMs }) {
    const id = requireText(taskId, 'taskId');
    const expectedOwner = requireText(owner, 'owner');
    const now = this.now();
    const leaseExpiresAt = now + normalizeLeaseMs(leaseMs);
    const transaction = this.db.transaction(() => {
      const row = this._row(id);
      if (!row) throw new TaskLedgerError('TASK_NOT_FOUND', `task not found: ${id}`);
      if (!LIVE_SCOPE_STATES.has(row.state) || row.owner !== expectedOwner) {
        throw new TaskLedgerError('OWNER_MISMATCH', `task ${id} is not active for ${expectedOwner}`);
      }
      this.db.prepare(
        `UPDATE tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ?`,
      ).run(leaseExpiresAt, now, id);
      this._event(id, 'heartbeat', { owner: expectedOwner, leaseExpiresAt }, now);
      return this.getTask(id);
    });
    return transaction.immediate();
  }

  completeTask({ taskId, owner, evidence = '', artifacts = [] }) {
    const id = requireText(taskId, 'taskId');
    const expectedOwner = requireText(owner, 'owner');
    const now = this.now();
    const transaction = this.db.transaction(() => {
      const row = this._row(id);
      if (!row) throw new TaskLedgerError('TASK_NOT_FOUND', `task not found: ${id}`);
      if (row.state !== 'active') {
        throw new TaskLedgerError('TASK_NOT_ACTIVE', `task ${id} is ${row.state}`);
      }
      if (row.owner !== expectedOwner) {
        throw new TaskLedgerError('OWNER_MISMATCH', `task ${id} is owned by ${row.owner}`);
      }
      this.db.prepare(
        `UPDATE tasks
         SET state = 'completed', evidence = ?, artifacts_json = ?,
             lease_expires_at = NULL, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(String(evidence || ''), JSON.stringify(artifacts || []), now, now, id);
      this._event(id, 'completed', { owner: expectedOwner, evidence }, now);
      return this.getTask(id);
    });
    return transaction.immediate();
  }

  authorizeEdit({ cwd, filePath, repoRoot }) {
    const now = this.now();
    const workingDirectory = resolve(requireText(cwd, 'cwd'));
    const absoluteFile = resolve(workingDirectory, requireText(filePath, 'filePath'));
    const live = this.db.prepare(
      `SELECT * FROM tasks
       WHERE state = 'active'
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at > ?
       ORDER BY length(workspace) DESC`,
    ).all(now).map((row) => this._serialize(row));

    const current = live.find((task) =>
      task.workspace && pathInside(resolve(task.workspace), workingDirectory));
    if (current) {
      if (!pathInside(resolve(current.workspace), absoluteFile)) {
        return {
          allowed: false,
          reason: 'OUTSIDE_WORKSPACE',
          taskId: current.id,
        };
      }
      const relativePath = normalizeRelativePath(relative(current.workspace, absoluteFile));
      const allowed = relativePath &&
        current.scopes.some((scope) => scopeContains(scope, relativePath));
      return allowed
        ? { allowed: true, taskId: current.id, scope: current.scopes.find((scope) => scopeContains(scope, relativePath)) }
        : {
            allowed: false,
            reason: 'OUT_OF_SCOPE',
            taskId: current.id,
            path: relativePath,
            scopes: current.scopes,
          };
    }

    const root = resolve(repoRoot || workingDirectory);
    if (!pathInside(root, absoluteFile)) return { allowed: true };
    const relativePath = normalizeRelativePath(relative(root, absoluteFile));
    const owner = live.find((task) =>
      relativePath && task.scopes.some((scope) => scopeContains(scope, relativePath)));
    if (owner) {
      return {
        allowed: false,
        reason: 'SCOPE_OWNED',
        taskId: owner.id,
        owner: owner.owner,
        workspace: owner.workspace,
        path: relativePath,
      };
    }
    return { allowed: true };
  }
}
