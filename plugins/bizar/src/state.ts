/**
 * state.ts
 *
 * Per-session state management with atomic writes, per-session mutex,
 * corrupt-state fallback, and stale-session cleanup. Per §4.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Minimal Logger interface compatible with opencode's client.app.log shape.
 * Matches what Tyr defines in logger.ts.
 */
export interface Logger {
  log(opts: { level: "debug" | "info" | "warn" | "error"; message: string }): void;
}

/** Per §4.1 schema + §4.7 empty-state shape */
export interface SessionState {
  sessionId: string;
  parentAgent: string | null;
  startedAt: number;
  lastActivityAt: number;
  turnCount: number;
  toolCalls: Array<{
    tool: string;
    fingerprint: string;
    at: number;
    outcome?: "ok" | "error";
  }>;
  warningsIssued: number;
  blocksTriggered: number;
}

/** Canonical empty-state per §4.7 */
export const EMPTY_STATE: SessionState = {
  sessionId: "",
  parentAgent: null,
  startedAt: 0,
  lastActivityAt: 0,
  turnCount: 0,
  toolCalls: [],
  warningsIssued: 0,
  blocksTriggered: 0,
};

/** Maximum age in days before a state file is considered stale */
const STALE_AGE_DAYS = 7;

/** Maximum number of tool calls to retain in the rolling window */
const MAX_TOOL_CALLS = 50;

/**
 * Per-session async mutex implemented as a Promise chain keyed by sessionId.
 * Different sessions do not block each other. See §4.3.
 * The lock map is an instance field so each StateStore has its own mutex domain.
 */
async function withLock<T>(
  locks: Map<string, Promise<unknown>>,
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = locks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(sessionId, next.catch(() => {}));
  return next;
}

function stateFilePath(stateDir: string, sessionId: string): string {
  return path.join(stateDir, `${sessionId}.json`);
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Recursive mkdirSync with EACCES/EROFS handling per §8.2.
 * Returns true if the directory is usable, false if we hit a permission/readonly error.
 */
function ensureDir(dir: string, logger: Logger): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EROFS") {
      logger.log({
        level: "error",
        message: `bizar: cannot create directory ${dir}: ${String(err)}`,
      });
      return false;
    }
    throw err;
  }
}

/**
 * Persist session state atomically: write to .tmp file then rename.
 * Prunes toolCalls to last MAX_TOOL_CALLS entries before writing.
 */
function writeStateAtomic(
  filePath: string,
  state: SessionState,
  logger: Logger
): void {
  // prune rolling window
  const pruned: SessionState = {
    ...state,
    toolCalls: state.toolCalls.slice(-MAX_TOOL_CALLS),
  };

  const tmp = `${filePath}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(pruned), "utf8");
    renameSync(tmp, filePath);
  } catch (err: unknown) {
    logger.log({
      level: "warn",
      message: `bizar: failed to write state file ${filePath}: ${String(err)}`,
    });
    // best-effort: try to clean up the tmp file if it exists
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // non-fatal
    }
  }
}

/**
 * Load state from a session file. Returns EMPTY_STATE on missing or corrupt file.
 * Does not throw. See §4.7 corrupt-state fallback.
 */
function readState(filePath: string, sessionId: string, logger: Logger): SessionState {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as SessionState;

    // Basic schema validation — ensure required fields exist
    if (
      typeof parsed.sessionId !== "string" ||
      !Array.isArray(parsed.toolCalls)
    ) {
      throw new Error("schema mismatch");
    }

    return parsed;
  } catch (err: unknown) {
    logger.log({
      level: "warn",
      message: `bizar: corrupt state file for session ${sessionId}, starting empty`,
    });
    return { ...EMPTY_STATE, sessionId };
  }
}

export class StateStore {
  private stateDir: string;
  private logger: Logger;
  private initialized = false;
  /** Per-session async mutex — instance-level so each store has independent locks */
  private locks = new Map<string, Promise<unknown>>();

  constructor(stateDir: string, logger: Logger) {
    // Expand ~ to home directory
    this.stateDir = expandHome(stateDir);
    this.logger = logger;
  }

  /**
   * Lazily ensure the state directory exists.
   * Returns false if directory creation fails (EACCES/EROFS) — caller should
   * disable the plugin for this session.
   */
  private ensureStateDir(): boolean {
    if (this.initialized) return true;
    this.initialized = true;
    return ensureDir(this.stateDir, this.logger);
  }

  /**
   * Load state for a session. Returns EMPTY_STATE if the file is missing or corrupt.
   * @see §4.7 corrupt-state fallback
   */
  async load(sessionId: string): Promise<SessionState> {
    if (!this.ensureStateDir()) return { ...EMPTY_STATE, sessionId };

    const filePath = stateFilePath(this.stateDir, sessionId);

    if (!existsSync(filePath)) {
      return { ...EMPTY_STATE, sessionId };
    }

    return Promise.resolve(readState(filePath, sessionId, this.logger));
  }

  /**
   * Persist session state. Atomic write via rename from .tmp file.
   */
  async save(state: SessionState): Promise<void> {
    if (!this.ensureStateDir()) return;

    const filePath = stateFilePath(this.stateDir, state.sessionId);
    writeStateAtomic(filePath, state, this.logger);
    return Promise.resolve();
  }

  /**
   * Delete the state file for a session.
   */
  async delete(sessionId: string): Promise<void> {
    const filePath = stateFilePath(this.stateDir, sessionId);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err: unknown) {
      this.logger.log({
        level: "warn",
        message: `bizar: failed to delete state file ${filePath}: ${String(err)}`,
      });
    }
  }

  /**
   * Cleanup stale session files:
   * 1. Files older than STALE_AGE_DAYS (by lastActivityAt)
   * 2. Files whose sessionId is not in the validSessionIds set
   *
   * Returns the number of files deleted.
   */
  async cleanup(
    maxAgeDays: number = STALE_AGE_DAYS,
    validSessionIds: Set<string> = new Set()
  ): Promise<number> {
    if (!this.ensureStateDir()) return 0;

    const { readdirSync, statSync } = await import("node:fs");
    let deleted = 0;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let files: string[];
    try {
      files = readdirSync(this.stateDir).filter((f) => f.endsWith(".json"));
    } catch (err: unknown) {
      this.logger.log({
        level: "warn",
        message: `bizar: failed to read state dir for cleanup: ${String(err)}`,
      });
      return 0;
    }

    for (const file of files) {
      const filePath = path.join(this.stateDir, file);
      let mtime: number;
      let sessionId: string;

      try {
        const stat = statSync(filePath);
        mtime = stat.mtimeMs;
        // sessionId is the filename without .json
        sessionId = file.replace(/\.json$/, "");
      } catch {
        // skip files we can't stat
        continue;
      }

      const tooOld = now - mtime > maxAgeMs;
      const orphaned = validSessionIds.size > 0 && !validSessionIds.has(sessionId);

      if (tooOld || orphaned) {
        try {
          unlinkSync(filePath);
          deleted++;
        } catch {
          // best-effort: leave files we can't delete
        }
      }
    }

    return deleted;
  }

  /**
   * Acquire the per-session mutex for the given sessionId.
   * The callback is serialized with all other state operations for the same session.
   */
  withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return withLock(this.locks, sessionId, fn);
  }
}
