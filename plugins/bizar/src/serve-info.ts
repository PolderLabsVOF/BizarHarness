/**
 * serve-info.ts
 *
 * v0.5.4 (bug #3) — Publish the cline-serve connection details to a
 * small on-disk file so out-of-process consumers (the Bizar dashboard
 * server, the TUI, hooks, etc.) can talk to the same cline serve child
 * the plugin owns.
 *
 * Why this exists:
 *   The plugin owns the `cline serve` child process. It picks a
 *   random port (or the operator's `BIZAR_SERVE_PORT`) and generates
 *   a 32-byte `CLINE_SERVER_PASSWORD` on every start. Until now the
 *   only consumer of that child was the plugin itself (via
 *   {@link HttpClient} / {@link EventStream}). The dashboard, which
 *   lives in a separate process, had no way to reach the child — its
 *   `DELETE /background/:id` could only kill a tmux attach, never the
 *   underlying cline session.
 *
 * What this writes:
 *   `<stateDir>/serve.json` containing:
 *     {
 *       baseUrl: "http://127.0.0.1:4097",
 *       port: 4097,
 *       password: "<32-byte secret base64>",
 *       worktree: "/path/to/cwd",
 *       pid: 12345,
 *       startedAt: 1700000000000
 *     }
 *
 * The dashboard's `serve-info.mjs` looks for this file in the same
 * multi-path pattern as `BG_DIRS` and uses it to issue
 * `POST /api/session/{id}/abort` against the same cline child the
 * plugin is using.
 *
 * Lifecycle:
 *   - `write(info)` — called once after `ServeLifecycle.start()`
 *     succeeds. Atomic write via tmp+rename.
 *   - `clear()` — called from the plugin's signal handlers and from
 *     `shutdownAll` paths so a stale file from a dead serve does not
 *     confuse the dashboard.
 *   - `read()` — synchronous helper used by tests and by the dashboard's
 *     process (out-of-process via `serve-info.mjs`).
 *
 * Security note:
 *   The file contains the serve password. `stateDir` defaults to
 *   `~/.cache/bizar`, which is mode 0700 on most Linux systems but
 *   not enforced. We refuse to write to a path inside any of the
 *   `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube` directories (same refusal
 *   as `options.ts`).
 */

import { writeFileSync, renameSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { expandHome, findSecretDirMatch } from "./options.js";

// --- Public types ---------------------------------------------------------

/**
 * Connection info for one running `cline serve` child. See the
 * module header for the wire format.
 */
export interface ServeInfo {
  baseUrl: string;
  port: number;
  password: string;
  worktree: string;
  pid: number;
  startedAt: number;
}

// --- Logger interface -----------------------------------------------------

/**
 * Minimal Logger interface — matches the shape in `state.ts` / `logger.ts`.
 */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// --- File-path helpers ----------------------------------------------------

function infoFilePath(stateDir: string): string {
  return path.join(expandHome(stateDir), "serve.json");
}

// --- Read -----------------------------------------------------------------

/**
 * Synchronous read of the serve-info file. Returns `null` if the file is
 * missing, unreadable, malformed, or fails the schema check. Never throws.
 *
 * Intended for callers in the same process as the plugin. Out-of-process
 * consumers (the dashboard server) should use `serve-info.mjs`, which has
 * the same logic but lives in `.mjs`.
 */
export function readServeInfo(stateDir: string, _logger?: Logger): ServeInfo | null {
  const file = infoFilePath(stateDir);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.port !== "number" ||
      typeof parsed.password !== "string" ||
      typeof parsed.worktree !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      port: parsed.port,
      password: parsed.password,
      worktree: parsed.worktree,
      pid: parsed.pid,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

// --- Write / clear --------------------------------------------------------

/**
 * Atomically write the serve-info file. The temp file is renamed into
 * place so a concurrent reader never sees a half-written JSON. Returns
 * silently on success and logs a warning on failure.
 *
 * Refuses to write if `stateDir` resolves inside a secret directory
 * (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`).
 */
export function writeServeInfo(
  stateDir: string,
  info: ServeInfo,
  logger: Logger,
): boolean {
  // §6.4 — refuse to write if stateDir is inside a secret dir. Mirrors
  // the same refusal logic in `options.ts` so a misconfigured stateDir
  // cannot cause the password to leak into an unsafe location.
  const secretMatch = findSecretDirMatch(stateDir);
  if (secretMatch !== null) {
    logger.error(
      `bizar: refusing to write serve-info file — stateDir is inside secret dir ${secretMatch}`,
    );
    return false;
  }
  const finalPath = infoFilePath(stateDir);
  const tmpPath = `${finalPath}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(info, null, 2), "utf8");
    renameSync(tmpPath, finalPath);
    logger.debug(
      `bizar: wrote serve-info to ${finalPath} (port=${info.port}, pid=${info.pid})`,
    );
    return true;
  } catch (err: unknown) {
    logger.warn(
      `bizar: failed to write serve-info at ${finalPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    return false;
  }
}

/**
 * Best-effort delete of the serve-info file. Idempotent — missing files
 * are not an error. Used by signal handlers and the shutdown path so the
 * dashboard does not try to talk to a dead serve.
 */
export function clearServeInfo(stateDir: string, logger: Logger): void {
  const file = infoFilePath(stateDir);
  try {
    if (existsSync(file)) {
      unlinkSync(file);
      logger.debug(`bizar: cleared serve-info at ${file}`);
    }
  } catch (err: unknown) {
    logger.warn(
      `bizar: failed to clear serve-info at ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Convenience: resolve the path where the file would be written, without
 * writing. Exposed for diagnostics and for tests that want to clean up.
 */
export function serveInfoFilePath(stateDir: string): string {
  return infoFilePath(stateDir);
}

// Re-export for callers that want the raw `expandHome` from this module.
export { expandHome };

// --- Helpers --------------------------------------------------------------

/**
 * Defensive helper: validate that the resolved stateDir is writable in
 * the current process. Returns true on success. Used by `writeServeInfo`'s
 * call sites that want to log a single summary line before touching disk.
 */
export function canWriteStateDir(stateDir: string): boolean {
  try {
    const expanded = expandHome(stateDir);
    if (expanded === os.homedir()) return true;
    // We don't actually touch the disk here — the caller wants to know
    // whether `mkdirSync` is likely to succeed. Just check the path is
    // absolute after expansion.
    return path.isAbsolute(expanded);
  } catch {
    return false;
  }
}