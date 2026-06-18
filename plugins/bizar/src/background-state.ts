/**
 * background-state.ts
 *
 * Per-instance state management for background agents (v0.4.2 spec §3).
 *
 * Why a separate file from `state.ts` (spec §3.1):
 *   - The existing per-session `SessionState` is keyed on `sessionId` and
 *     contains loop-detection fields tied to the opencode session lifecycle.
 *   - Background instances have a different lifecycle: `instanceId`
 *     (plugin-generated `bgr_<ulid>`), spawn source, parent, model override,
 *     terminal status separate from session status.
 *   - Coupling these into `SessionState` would require 8 new fields on a
 *     schema that already has 8 existing fields — exactly the field
 *     proliferation Forseti flagged.
 *   - The new `BackgroundState` lives at
 *     `~/.cache/bizarharness/bg/<instanceId>.json`. The existing `state.ts`
 *     is unchanged.
 *
 * Concurrency model (spec §3.3):
 *   - Per-instance async mutex, keyed on `instanceId` (NOT on `sessionId`).
 *   - Independent of the per-session mutex in `state.ts` — they do not
 *     block each other.
 *
 * File I/O:
 *   - Atomic write via `writeFile(tmp)` + `renameSync(tmp, final)`.
 *   - Best-effort cleanup of `.tmp` on failure.
 *   - Corrupt JSON → `load()` returns null; caller decides what to do
 *     (logger warning, skip, etc.).
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

// --- Public types (spec §3.2) ---------------------------------------------

/**
 * Background instance status. Maps opencode events and lifecycle transitions
 * to a small, stable set of terminal and in-flight states.
 */
export type BackgroundStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "killed"
  | "timed_out";

/**
 * Per-instance state for a background agent.
 * Field-by-field notes (spec §3.2):
 *   - `instanceId` — plugin identifier, `bgr_<ulid>`. Returned to callers.
 *     Used as the filename stem.
 *   - `sessionId` — opencode session ID returned from POST /session. Used
 *     for all HTTP calls. Also the key for the existing per-session state,
 *     log, and loop detection.
 *   - `status` — see {@link BackgroundStatus} for the lifecycle.
 *   - `startedAt` — epoch ms when the instance was added.
 *   - `completedAt` — epoch ms when the instance reached a terminal state.
 *   - `model` — resolved model ID, `"<providerID>/<modelID>"` format.
 *   - `promptPreview` — first 200 chars of the prompt.
 *   - `resultPreview` — last 200 chars of result, refreshed on
 *     `EventMessagePartUpdated` for assistant text parts.
 *   - `resultMessageIds` — incrementally populated as
 *     `EventMessagePartUpdated` events arrive. The full text is NOT
 *     stored; reconstructed on `bizar_collect`.
 *   - `error` — set on terminal failure; cleared on retry from
 *     `failed` to `running` (retry is not in v0.4).
 *   - `parentAgent` — who spawned it (always "odin" in v0.4 per §6.3).
 *   - `parentInstanceId` — for nested spawns (reserved, not in v0.4).
 *   - `logPath` — path to `~/.cache/bizarharness/logs/<sessionId>.log`.
 *   - `toolCallCount` — updated via `EventMessagePartUpdated` events.
 *   - `loopGuardTool` — set when threshold-12 throw is captured. Used at
 *     `bizar_collect` to prepend the marker.
 *   - `timeoutMs` — collect-time timeout requested by caller.
 *   - `lastEventAt` — epoch ms when the most recent SSE event arrived for
 *     this instance. Set on every event the manager observes (tool/text
 *     part updates, session.idle, session.error, session.created/updated/
 *     deleted). Used by the stall checker (§v0.3.0). Optional in the
 *     type but always populated by `InstanceManager.add()` (the manager
 *     seeds it from `startedAt`); older on-disk files written before
 *     v0.3.0 are backfilled in `readState`.
 *   - `lastToolOrTextAt` — epoch ms when the most recent `tool` or `text`
 *     part arrived. `thinking` parts do NOT advance this timestamp; that
 *     is the whole point — repeated `thinking` parts with no `tool` or
 *     `text` is what we detect as a thinking loop (§v0.3.0).
 *   - `interventionCount` — number of research interventions sent for
 *     this instance. Reset to 0 when the agent makes progress (tool or
 *     text part after an intervention). Default 0.
 *   - `interventionAt` — epoch ms of the most recent intervention.
 *   - `interventionReason` — short human-readable description of the
 *     intervention, e.g. `"thinking loop (5m 12s without tool/text)"`.
 */
export interface BackgroundState {
  instanceId: string;
  sessionId: string;
  agent: string;
  status: BackgroundStatus;
  startedAt: number;
  completedAt?: number;
  model: string;
  promptPreview: string;
  resultPreview?: string;
  resultMessageIds?: string[];
  error?: string;
  parentAgent: string;
  parentInstanceId?: string;
  logPath: string;
  timeoutMs: number;
  toolCallCount: number;
  loopGuardTool?: string;
  // v0.3.0 — stall and thinking-loop protection. These are typed as
  // optional in the schema because (a) the field can be absent in older
  // files on disk, and (b) the `InstanceManager.add()` input (AddDraft)
  // does not require them — the manager seeds them itself.
  lastEventAt?: number;
  lastToolOrTextAt?: number;
  interventionCount?: number;
  interventionAt?: number;
  interventionReason?: string;
}

/**
 * Partial state used during a `pending` insert, before the HTTP call has
 * assigned a `sessionId`. After the call, the full state is updated.
 *
 * Note: the spec contract (see task description) types `EMPTY_BACKGROUND_STATE`
 * as `Omit<BackgroundState, "instanceId" | "sessionId" | "agent" | "parentAgent"
 * | "logPath" | "timeoutMs" | "model" | "promptPreview" | "startedAt">`.
 */
export const EMPTY_BACKGROUND_STATE: Omit<
  BackgroundState,
  | "instanceId"
  | "sessionId"
  | "agent"
  | "parentAgent"
  | "logPath"
  | "timeoutMs"
  | "model"
  | "promptPreview"
  | "startedAt"
> = {
  status: "pending",
  toolCallCount: 0,
  // v0.3.0 — stall and thinking-loop protection defaults. The manager
  // seeds `lastEventAt` and `lastToolOrTextAt` from `Date.now()` at
  // `add()` time; we set them to 0 here so a draft shape remains valid
  // even if it is constructed without the manager (the manager always
  // overwrites them).
  lastEventAt: 0,
  lastToolOrTextAt: 0,
  interventionCount: 0,
};

/**
 * Terminal states per spec §1.6 / §4.4. Used by collect/await logic.
 */
export const TERMINAL_STATUSES: ReadonlySet<BackgroundStatus> = new Set<BackgroundStatus>([
  "done",
  "failed",
  "killed",
  "timed_out",
]);

// --- Logger interface -----------------------------------------------------

/**
 * Minimal Logger interface — matches the shape in `state.ts` / `logger.ts`.
 * Synchronous, void-returning. We intentionally use a structural type so
 * the plugin's `Logger` (which has additional convenience methods) is
 * assignable.
 */
export interface Logger {
  log(opts: { level: "debug" | "info" | "warn" | "error"; message: string }): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// --- File-path helpers ----------------------------------------------------

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function backgroundStateDir(stateDir: string): string {
  // Background state lives in a subdirectory to keep it isolated from the
  // per-session `state.ts` files (which sit directly in `stateDir`).
  return path.join(expandHome(stateDir), "bg");
}

function backgroundStateFilePath(stateDir: string, instanceId: string): string {
  return path.join(backgroundStateDir(stateDir), `${instanceId}.json`);
}

// --- Mutex (spec §3.3) ----------------------------------------------------

/**
 * Per-instance async mutex, identical pattern to the one in `state.ts`
 * but keyed on `instanceId`. Each `BackgroundStateStore` has its own
 * lock domain.
 */
async function withLock<T>(
  locks: Map<string, Promise<unknown>>,
  instanceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(instanceId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(instanceId, next.catch(() => {}));
  return next;
}

// --- Directory bootstrap --------------------------------------------------

/**
 * Recursive mkdir with EACCES/EROFS handling per spec §8.2 (pattern borrowed
 * from `state.ts` / `report.ts`).
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
        message: `bizar: cannot create background state directory ${dir}: ${String(err)}`,
      });
      return false;
    }
    throw err;
  }
}

// --- Read / write ---------------------------------------------------------

/**
 * Atomic write: write to `.tmp` then rename. Best-effort cleanup of `.tmp`
 * on failure. Mirrors `state.ts` / `report.ts`.
 */
function writeStateAtomic(
  filePath: string,
  state: BackgroundState,
  logger: Logger,
): void {
  const tmp = `${filePath}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, filePath);
  } catch (err: unknown) {
    logger.log({
      level: "warn",
      message: `bizar: failed to write background state file ${filePath}: ${String(err)}`,
    });
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // non-fatal
    }
  }
}

/**
 * Read & validate a single background state file. Returns null on missing
 * or corrupt input. Logs a warning on corrupt files.
 *
 * Backward compatibility (v0.3.0): state files written before the stall
 * and thinking-loop fields existed may not carry `lastEventAt` /
 * `lastToolOrTextAt` / `interventionCount`. We backfill them here from
 * `startedAt` so the stall and thinking-loop checkers have a sensible
 * baseline (and so a plugin restart does not immediately flag a
 * pre-existing live instance as stalled).
 */
function readState(
  filePath: string,
  instanceId: string,
  logger: Logger,
): BackgroundState | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as BackgroundState;
    if (
      typeof parsed.instanceId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.agent !== "string" ||
      typeof parsed.status !== "string"
    ) {
      throw new Error("schema mismatch");
    }
    // Backfill v0.3.0 fields for files written by older versions.
    if (typeof parsed.lastEventAt !== "number") {
      parsed.lastEventAt = parsed.startedAt;
    }
    if (typeof parsed.lastToolOrTextAt !== "number") {
      parsed.lastToolOrTextAt = parsed.startedAt;
    }
    if (typeof parsed.interventionCount !== "number") {
      parsed.interventionCount = 0;
    }
    return parsed;
  } catch (err: unknown) {
    logger.log({
      level: "warn",
      message: `bizar: corrupt background state file for instance ${instanceId}: ${String(err)}`,
    });
    return null;
  }
}

// --- Public store ---------------------------------------------------------

/**
 * Persistent store for `BackgroundState`. File-backed, with a per-instance
 * mutex and best-effort corrupt-file handling.
 *
 * Public surface (the interface contract for Thor's tests):
 *   - `load(instanceId)` — read one instance (or null if missing/corrupt).
 *   - `save(state)` — atomic write.
 *   - `list()` — read all instances in the bg directory.
 *   - `cleanup(maxAgeDays)` — delete terminal instances older than the
 *     threshold. Returns the count deleted.
 *   - `withLock(instanceId, fn)` — per-instance async mutex.
 *
 * The directory is created lazily on first use. If creation fails, all
 * read/write operations are silent no-ops and the caller should disable
 * background agents for this session (spec §8.2).
 */
export class BackgroundStateStore {
  private stateDir: string;
  private logger: Logger;
  private initialized = false;
  private locks = new Map<string, Promise<unknown>>();
  /** True if the bg directory became unusable (EACCES/EROFS on init). */
  private dirUsable: boolean | null = null;

  constructor(stateDir: string, logger: Logger) {
    this.stateDir = stateDir;
    this.logger = logger;
  }

  /**
   * Lazily ensure the bg directory exists. Caches the result so the
   * EACCES/EROFS branch is taken at most once per process.
   */
  private ensureDir(): boolean {
    if (this.dirUsable !== null) return this.dirUsable;
    const ok = ensureDir(backgroundStateDir(this.stateDir), this.logger);
    this.dirUsable = ok;
    this.initialized = true;
    return ok;
  }

  /** Resolve the bg directory for callers that need to enumerate it. */
  get bgDir(): string {
    return backgroundStateDir(this.stateDir);
  }

  /**
   * Load a single instance. Returns null if the file is missing or corrupt.
   * Does not throw. The corrupt-file warning is logged inside `readState`.
   */
  async load(instanceId: string): Promise<BackgroundState | null> {
    if (!this.ensureDir()) return null;
    const filePath = backgroundStateFilePath(this.stateDir, instanceId);
    return withLock(this.locks, instanceId, () =>
      Promise.resolve(readState(filePath, instanceId, this.logger)),
    );
  }

  /**
   * Persist a `BackgroundState` atomically.
   */
  async save(state: BackgroundState): Promise<void> {
    if (!this.ensureDir()) return;
    const filePath = backgroundStateFilePath(this.stateDir, state.instanceId);
    return withLock(this.locks, state.instanceId, () => {
      writeStateAtomic(filePath, state, this.logger);
      return Promise.resolve();
    });
  }

  /**
   * Read every instance in the bg directory. Corrupt files are skipped
   * (warning already logged by `readState`). Best-effort; returns [] on
   * directory read error.
   */
  async list(): Promise<BackgroundState[]> {
    if (!this.ensureDir()) return [];
    const dir = backgroundStateDir(this.stateDir);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out: BackgroundState[] = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, "");
      const filePath = path.join(dir, f);
      const state = readState(filePath, id, this.logger);
      if (state !== null) out.push(state);
    }
    return out;
  }

  /**
   * Delete terminal instances whose `completedAt` (or `startedAt` as a
   * fallback) is older than `maxAgeDays`. Returns the number of files
   * removed. Non-terminal instances are NEVER removed.
   */
  async cleanup(maxAgeDays: number): Promise<number> {
    if (!this.ensureDir()) return 0;
    const all = await this.list();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let deleted = 0;
    for (const s of all) {
      if (!TERMINAL_STATUSES.has(s.status)) continue;
      const ts = s.completedAt ?? s.startedAt;
      if (now - ts <= maxAgeMs) continue;
      const filePath = backgroundStateFilePath(this.stateDir, s.instanceId);
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          deleted += 1;
        }
      } catch (err: unknown) {
        this.logger.log({
          level: "warn",
          message: `bizar: failed to delete background state file ${filePath}: ${String(err)}`,
        });
      }
    }
    // touch statSync to silence the unused import if no other consumer
    void statSync;
    return deleted;
  }

  /**
   * Acquire the per-instance mutex. The callback is serialized with all
   * other state operations for the same `instanceId`.
   */
  withLock<T>(instanceId: string, fn: () => Promise<T>): Promise<T> {
    return withLock(this.locks, instanceId, fn);
  }
}
