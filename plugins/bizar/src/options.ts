/**
 * Options — plugin option validation, clamping, and secret-dir refusal.
 *
 * Spec requirements satisfied here:
 *   - §6.1 — plugin option shape (defaults listed below).
 *   - §6.2 — clamping rules. The plugin NEVER throws on bad config.
 *   - §6.3 — threshold/window constraint (`loopThresholdBlock <= loopWindowSize + 2`).
 *   - §6.4 — secret-directory refusal. The plugin refuses to start if `logDir`
 *     or `stateDir` resolves inside `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, or
 *     `~/.kube/`. Matching uses the spec's exact algorithm: `path.resolve`
 *     on both sides, then test equality OR `startsWith(resolved + path.sep)`.
 *     The `+ path.sep` is critical — without it, `~/.ssh-foo` would falsely
 *     match the `~/.ssh` prefix.
 *   - §6.5 — environment-variable overrides (`BIZAR_DISABLE`,
 *     `BIZAR_DISABLE_LOOP`, `BIZAR_DISABLE_LOG`, `BIZAR_LOG_LEVEL`,
 *     `BIZAR_SERVE_PORT`, `BIZAR_MAX_CONCURRENT_INSTANCES`,
 *     `BIZAR_SERVE_DISABLE`, `BIZAR_BACKGROUND_TOOL_CALL_CAP`,
 *     `BIZAR_BACKGROUND_SKIP_PERMISSIONS`). Env vars are read once at init;
 *     mid-session changes are ignored.
 */

import path from "node:path";
import os from "node:os";

/** Raw plugin options as they appear in `opencode.json` (before clamping). */
export interface RawOptions {
  loopThresholdWarn?: unknown;
  loopThresholdEscalate?: unknown;
  loopThresholdBlock?: unknown;
  loopWindowSize?: unknown;
  logDir?: unknown;
  stateDir?: unknown;
  logRotationBytes?: unknown;
  servePort?: unknown;
  maxConcurrentInstances?: unknown;
  serveDisabled?: unknown;
  backgroundToolCallCap?: unknown;
  backgroundSkipPermissions?: unknown;
  httpTimeoutMs?: unknown;
}

/**
 * Normalized options — the output of `normalizeOptions`. Every field has a
 * safe, valid value. The loop guard and logger consume this shape.
 */
export interface NormalizedOptions {
  loopThresholdWarn: number;
  loopThresholdEscalate: number;
  loopThresholdBlock: number;
  loopWindowSize: number;
  logDir: string;
  stateDir: string;
  logRotationBytes: number;
  servePort: number;
  maxConcurrentInstances: number;
  serveDisabled: boolean;
  backgroundToolCallCap: number;
  backgroundSkipPermissions: boolean;
  httpTimeoutMs: number;
}

/** Environment-variable override flags. */
export interface EnvFlags {
  disable: boolean;
  disableLoop: boolean;
  disableLog: boolean;
}

/** Default values per spec §6.1 / §8. */
export const DEFAULT_OPTIONS: NormalizedOptions = {
  loopThresholdWarn: 5,
  loopThresholdEscalate: 8,
  loopThresholdBlock: 12,
  loopWindowSize: 10,
  logDir: "~/.cache/bizarharness/logs",
  stateDir: "~/.cache/bizarharness",
  logRotationBytes: 10_485_760, // 10 MB
  servePort: 0,                    // 0 = random OS-assigned port (§1.1)
  maxConcurrentInstances: 8,       // §8
  serveDisabled: false,            // §8
  backgroundToolCallCap: 500,      // §8 / §6.2
  backgroundSkipPermissions: false, // §8 / §6.4
  httpTimeoutMs: 30_000,           // §2.3 / §8
};

const SECRET_DIRS: readonly string[] = [
  "~/.ssh",
  "~/.gnupg",
  "~/.aws",
  "~/.kube",
] as const;

/**
 * Expand a leading `~` to the user's home directory. The spec's default
 * paths use `~/.cache/bizarharness`; we honor that.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Spec §6.4 matching algorithm. Returns the secret-dir kind that `target`
 * matches (e.g. `~/.ssh`), or `null` if `target` is safe.
 *
 *   resolvedTarget === resolvedSecret                     → equal
 *   resolvedTarget.startsWith(resolvedSecret + sep)      → strict descendant
 */
export function findSecretDirMatch(target: string): string | null {
  const resolvedTarget = path.resolve(expandHome(target));
  for (const secret of SECRET_DIRS) {
    const resolvedSecret = path.resolve(expandHome(secret));
    if (resolvedTarget === resolvedSecret) return secret;
    if (resolvedTarget.startsWith(resolvedSecret + path.sep)) return secret;
  }
  return null;
}

/** Coerce an unknown value to a finite integer, or return `undefined`. */
function toFiniteInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return undefined;
}

/** Coerce to a string path; return `undefined` if the value is not a string. */
function toStringPath(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  return undefined;
}

/**
 * Apply the clamping rules from spec §6.2. Returns the normalized options
 * and a list of "clamp notes" — human-readable strings describing each
 * non-default normalization applied. The caller is expected to log these
 * via `client.app.log` at warn level (spec §6.2: "After clamping, log a
 * `client.app.log` warning if any non-default normalization was applied").
 */
export function normalizeOptions(raw: RawOptions | undefined): {
  options: NormalizedOptions;
  notes: string[];
} {
  const notes: string[] = [];
  const r = raw ?? {};

  // --- Numeric thresholds (§6.2) ---
  const rawWarn = toFiniteInt(r.loopThresholdWarn);
  const rawEscalate = toFiniteInt(r.loopThresholdEscalate);
  const rawBlock = toFiniteInt(r.loopThresholdBlock);

  let warn = rawWarn !== undefined ? Math.max(1, rawWarn) : DEFAULT_OPTIONS.loopThresholdWarn;
  let escalate = rawEscalate !== undefined ? Math.max(1, rawEscalate) : DEFAULT_OPTIONS.loopThresholdEscalate;
  let block = rawBlock !== undefined ? Math.max(1, rawBlock) : DEFAULT_OPTIONS.loopThresholdBlock;

  if (rawWarn !== undefined && rawWarn < 1) {
    notes.push(`loopThresholdWarn ${rawWarn} clamped to 1`);
  } else if (rawWarn === undefined) {
    notes.push(`loopThresholdWarn defaulted to ${warn}`);
  }

  // --- Ordering: warn < escalate < block (§6.2) ---
  if (warn >= escalate) {
    const newEscalate = warn + 1;
    notes.push(`loopThresholdEscalate adjusted from ${escalate} to ${newEscalate} (must be > loopThresholdWarn)`);
    escalate = newEscalate;
  }
  if (escalate >= block) {
    const newBlock = escalate + 1;
    notes.push(`loopThresholdBlock adjusted from ${block} to ${newBlock} (must be > loopThresholdEscalate)`);
    block = newBlock;
  }

  // --- Window size (§6.2: clamped to [3, 50]) ---
  const rawWindow = toFiniteInt(r.loopWindowSize);
  let window: number;
  if (rawWindow === undefined) {
    window = DEFAULT_OPTIONS.loopWindowSize;
  } else if (rawWindow < 3) {
    window = 3;
    notes.push(`loopWindowSize ${rawWindow} clamped to 3 (minimum)`);
  } else if (rawWindow > 50) {
    window = 50;
    notes.push(`loopWindowSize ${rawWindow} clamped to 50 (maximum)`);
  } else {
    window = rawWindow;
  }

  // --- Threshold/window constraint (§6.3) ---
  if (block > window + 2) {
    const newBlock = window + 2;
    notes.push(
      `loopThresholdBlock ${block} adjusted to ${newBlock} (must be <= loopWindowSize + 2)`,
    );
    block = newBlock;
  }

  // --- logRotationBytes (§6.2: minimum 1024) ---
  const rawBytes = toFiniteInt(r.logRotationBytes);
  let bytes: number;
  if (rawBytes === undefined) {
    bytes = DEFAULT_OPTIONS.logRotationBytes;
  } else if (rawBytes < 1024) {
    bytes = 1024;
    notes.push(`logRotationBytes ${rawBytes} clamped to 1024 (minimum)`);
  } else {
    bytes = rawBytes;
  }

  // --- Background agent options (§6.5 / §8) ---
  // servePort: default 0 (random); env BIZAR_SERVE_PORT overrides
  const rawServePort = toFiniteInt(r.servePort);
  const envServePort = toFiniteInt(process.env.BIZAR_SERVE_PORT);
  const servePort = rawServePort !== undefined
    ? (rawServePort < 0 ? (notes.push(`servePort ${rawServePort} clamped to 0 (minimum)`), 0) : rawServePort)
    : envServePort !== undefined
      ? envServePort
      : DEFAULT_OPTIONS.servePort;

  // maxConcurrentInstances: default 8, max 32 (§6.5)
  const rawMaxInstances = toFiniteInt(r.maxConcurrentInstances);
  const envMaxInstances = toFiniteInt(process.env.BIZAR_MAX_CONCURRENT_INSTANCES);
  let maxConcurrentInstances: number;
  if (rawMaxInstances !== undefined) {
    maxConcurrentInstances = Math.min(Math.max(1, rawMaxInstances), 32);
    if (rawMaxInstances !== maxConcurrentInstances) {
      notes.push(`maxConcurrentInstances ${rawMaxInstances} clamped to ${maxConcurrentInstances} (range [1, 32])`);
    }
  } else if (envMaxInstances !== undefined) {
    maxConcurrentInstances = Math.min(Math.max(1, envMaxInstances), 32);
    if (envMaxInstances !== maxConcurrentInstances) {
      notes.push(`maxConcurrentInstances ${envMaxInstances} (env) clamped to ${maxConcurrentInstances} (range [1, 32])`);
    }
  } else {
    maxConcurrentInstances = DEFAULT_OPTIONS.maxConcurrentInstances;
  }

  // serveDisabled: default false; env BIZAR_SERVE_DISABLE=1 sets true (§8)
  const serveDisabled = process.env.BIZAR_SERVE_DISABLE === "1"
    ? true
    : (r.serveDisabled === true || r.serveDisabled === "true");

  // backgroundToolCallCap: default 500, max 5000 (§6.5)
  const rawToolCap = toFiniteInt(r.backgroundToolCallCap);
  const envToolCap = toFiniteInt(process.env.BIZAR_BACKGROUND_TOOL_CALL_CAP);
  let backgroundToolCallCap: number;
  if (rawToolCap !== undefined) {
    backgroundToolCallCap = Math.min(Math.max(1, rawToolCap), 5000);
    if (rawToolCap !== backgroundToolCallCap) {
      notes.push(`backgroundToolCallCap ${rawToolCap} clamped to ${backgroundToolCallCap} (range [1, 5000])`);
    }
  } else if (envToolCap !== undefined) {
    backgroundToolCallCap = Math.min(Math.max(1, envToolCap), 5000);
    if (envToolCap !== backgroundToolCallCap) {
      notes.push(`backgroundToolCallCap ${envToolCap} (env) clamped to ${backgroundToolCallCap} (range [1, 5000])`);
    }
  } else {
    backgroundToolCallCap = DEFAULT_OPTIONS.backgroundToolCallCap;
  }

  // backgroundSkipPermissions: default false; env BIZAR_BACKGROUND_SKIP_PERMISSIONS=1 sets true (§6.4)
  const backgroundSkipPermissions = process.env.BIZAR_BACKGROUND_SKIP_PERMISSIONS === "1"
    ? true
    : (r.backgroundSkipPermissions === true || r.backgroundSkipPermissions === "true");

  // httpTimeoutMs: default 30000, range [5000, 120000] (§2.3)
  const rawHttpTimeout = toFiniteInt(r.httpTimeoutMs);
  const envHttpTimeout = toFiniteInt(process.env.BIZAR_HTTP_TIMEOUT_MS);
  let httpTimeoutMs: number;
  if (rawHttpTimeout !== undefined) {
    httpTimeoutMs = Math.min(Math.max(5000, rawHttpTimeout), 120_000);
    if (rawHttpTimeout !== httpTimeoutMs) {
      notes.push(`httpTimeoutMs ${rawHttpTimeout} clamped to ${httpTimeoutMs} (range [5000, 120000])`);
    }
  } else if (envHttpTimeout !== undefined) {
    httpTimeoutMs = Math.min(Math.max(5000, envHttpTimeout), 120_000);
    if (envHttpTimeout !== httpTimeoutMs) {
      notes.push(`httpTimeoutMs ${envHttpTimeout} (env) clamped to ${httpTimeoutMs} (range [5000, 120000])`);
    }
  } else {
    httpTimeoutMs = DEFAULT_OPTIONS.httpTimeoutMs;
  }

  // --- Paths (§6.1 defaults) ---
  const logDir = toStringPath(r.logDir) ?? DEFAULT_OPTIONS.logDir;
  const stateDir = toStringPath(r.stateDir) ?? DEFAULT_OPTIONS.stateDir;

  return {
    options: {
      loopThresholdWarn: warn,
      loopThresholdEscalate: escalate,
      loopThresholdBlock: block,
      loopWindowSize: window,
      logDir,
      stateDir,
      logRotationBytes: bytes,
      servePort,
      maxConcurrentInstances,
      serveDisabled,
      backgroundToolCallCap,
      backgroundSkipPermissions,
      httpTimeoutMs,
    },
    notes,
  };
}

/**
 * Read environment-variable override flags per spec §6.5. Read once at
 * plugin init. Mid-session changes are ignored.
 */
export function readEnvFlags(): EnvFlags {
  return {
    disable: process.env.BIZAR_DISABLE === "1",
    disableLoop: process.env.BIZAR_DISABLE_LOOP === "1",
    disableLog: process.env.BIZAR_DISABLE_LOG === "1",
  };
}

/**
 * Spec §6.4: refuse to start if `logDir` or `stateDir` is inside a secret
 * directory. Returns the offending path and the matched secret kind, or
 * `null` if both paths are safe.
 */
export function findOffendingPath(options: NormalizedOptions): {
  path: string;
  kind: string;
} | null {
  const logMatch = findSecretDirMatch(options.logDir);
  if (logMatch !== null) {
    return { path: path.resolve(expandHome(options.logDir)), kind: logMatch };
  }
  const stateMatch = findSecretDirMatch(options.stateDir);
  if (stateMatch !== null) {
    return { path: path.resolve(expandHome(options.stateDir)), kind: stateMatch };
  }
  return null;
}
