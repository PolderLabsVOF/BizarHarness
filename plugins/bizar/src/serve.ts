/**
 * serve.ts
 *
 * ServeLifecycle — owns the `opencode serve` child process.
 *
 * Spec contract (v0.4.2 §1.1, §5, §6.1):
 *   - `Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], …)`
 *   - `OPENCODE_SERVER_PASSWORD` set in the child env to a 32-byte secret
 *     base64-encoded.
 *   - All subsequent HTTP calls include `Authorization: Basic <b64>` with
 *     username "opencode".
 *   - `--hostname 127.0.0.1` is hardcoded; not configurable.
 *   - `--dangerously-skip-permissions` is NOT in the default args. It is
 *     added only when `BIZAR_BACKGROUND_SKIP_PERMISSIONS=1`.
 *   - Health check: poll `GET /health` on the bound port with 100ms
 *     interval and 5s timeout.
 *   - Crash recovery: `proc.exited.then(...)` callback; on unexpected
 *     exit, notify a registered callback (caller marks instances failed).
 *   - Restart with exponential backoff (250ms, 500ms, 1s; max 3 retries).
 *
 * This file is the ONLY place in the plugin allowed to import
 * `node:crypto` (NEW-H1, HIGH-24, NEW-H9). The forbidden-imports check
 * (scripts/check-forbidden-imports.sh) enforces this exception.
 */

import { getRandomValues } from "node:crypto";
import type { Subprocess } from "bun";

// --- Logger interface -----------------------------------------------------

/**
 * Minimal Logger interface — matches the shape in `state.ts` / `logger.ts`.
 */
export interface Logger {
  log(opts: { level: "debug" | "info" | "warn" | "error"; message: string }): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// --- Public surface -------------------------------------------------------

/**
 * Callback invoked when the serve child exits unexpectedly. The plugin
 * uses this to mark all in-memory instances `failed` with
 * `error: "serve child exited unexpectedly"`.
 */
export type OnUnexpectedExit = (exitCode: number | null) => void;

/**
 * Result of a successful `start()`. The plugin stores these so the
 * `HttpClient` can authenticate and the `EventStream` can subscribe.
 */
export interface ServeInfo {
  pid: number;
  port: number;
  password: string;
  baseUrl: string;
  worktree: string;
  startedAt: number;
}

/**
 * Lifecycle owner for one `opencode serve` child process.
 *
 * Public surface (the interface contract for Thor's tests):
 *   - `start()` — spawn the child, wait for the listening line, health-check.
 *   - `stop()` — SIGTERM the child, wait 5s, then SIGKILL.
 *   - `healthCheck()` — poll `GET /health` once.
 *   - `pid`, `port`, `password`, `baseUrl` getters.
 *   - `onUnexpectedExit(cb)` — register a crash-recovery callback.
 *   - `tryRestart()` — exponential backoff restart (250/500/1000ms, 3 tries).
 *
 * The class is single-use: after `stop()`, the instance is dead and a
 * new one must be constructed. `tryRestart()` reuses the same object.
 */
export class ServeLifecycle {
  private _port: number | null = null;
  private _pid: number | null = null;
  private _password: string | null = null;
  private _proc: Subprocess | null = null;
  private _worktree: string;
  private _logger: Logger;
  private _unexpectedExitCb: OnUnexpectedExit | null = null;
  private _intentionalShutdown = false;
  private _exitedAttached = false;
  private _initialPort: number;

  constructor(opts: { port: number; worktree: string; logger: Logger }) {
    this._initialPort = opts.port;
    this._worktree = opts.worktree;
    this._logger = opts.logger;
  }

  // --- Getters (per interface contract) -----------------------------------

  get pid(): number | null {
    return this._pid;
  }

  get port(): number | null {
    return this._port;
  }

  get password(): string | null {
    return this._password;
  }

  get baseUrl(): string {
    if (this._port === null) {
      throw new Error("serve.ts: baseUrl accessed before start()");
    }
    return `http://127.0.0.1:${this._port}`;
  }

  get worktree(): string {
    return this._worktree;
  }

  // --- Startup ------------------------------------------------------------

  /**
   * Spawn the serve child and wait for it to be ready.
   *
   * Sequence (spec §5.1):
   *   1. Generate 32-byte secret (NEW-H9: `Buffer.from(...).toString("base64")`).
   *   2. `Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], …)`.
   *   3. Read stdout line-by-line until "opencode server listening on http://127.0.0.1:<port>".
   *      Parse the bound port (the OS may have remapped 0 → <random>).
   *   4. Health-check: `GET /health` with 100ms interval, 5s timeout.
   *   5. Attach `proc.exited` for crash recovery.
   *   6. Return `{ pid, port, password }`.
   *
   * Errors:
   *   - ENOENT (opencode not on PATH) → log, set `pid = null`, throw.
   *   - EACCES → same.
   *   - Listening line not seen in 5s → log, set `pid = null`, throw.
   *   - Health check fails in 5s → log, kill child, throw.
   */
  async start(): Promise<ServeInfo> {
    if (this._proc !== null) {
      throw new Error("serve.ts: start() called twice without stop()");
    }
    const initialPort = this._initialPort;
    const password = generatePassword();

    const skipPerms = process.env.BIZAR_BACKGROUND_SKIP_PERMISSIONS === "1";
    const args = [
      "opencode",
      "serve",
      "--port",
      String(initialPort),
      "--hostname",
      "127.0.0.1",
    ];
    if (skipPerms) args.push("--dangerously-skip-permissions");

    let proc: Subprocess;
    try {
      proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this._logger.error(
          "bizar: opencode binary not found on PATH; background agents disabled",
        );
      } else if (code === "EACCES") {
        this._logger.error(
          `bizar: cannot execute opencode binary: ${msg}; background agents disabled`,
        );
      } else {
        this._logger.error(`bizar: failed to spawn opencode serve: ${msg}`);
      }
      this._pid = null;
      throw err;
    }

    this._proc = proc;
    this._password = password;
    this._pid = proc.pid;
    this._intentionalShutdown = false;

    // Wait for the listening line on stdout.
    let boundPort: number;
    try {
      boundPort = await waitForListeningLine(proc, this._logger, 5_000);
    } catch (err: unknown) {
      this._logger.error(
        `bizar: opencode serve did not announce listening line: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.cleanupOnStartFailure();
      throw err;
    }
    this._port = boundPort;

    // Health check loop.
    const healthy = await pollHealthCheck(boundPort, password, 5_000);
    if (!healthy) {
      this._logger.error("bizar: opencode serve did not pass health check in 5s");
      this.cleanupOnStartFailure();
      throw new Error("opencode serve failed health check");
    }

    this.attachExitHandler();
    const startedAt = Date.now();
    this._logger.info(
      `bizar: opencode serve ready on http://127.0.0.1:${boundPort} (pid=${proc.pid})`,
    );

    return {
      pid: proc.pid,
      port: boundPort,
      password,
      baseUrl: `http://127.0.0.1:${boundPort}`,
      worktree: this._worktree,
      startedAt,
    };
  }

  // --- Stop ---------------------------------------------------------------

  /**
   * Graceful stop: SIGTERM, wait up to 5s, then SIGKILL. Idempotent.
   */
  async stop(): Promise<void> {
    const proc = this._proc;
    if (proc === null) return;
    this._intentionalShutdown = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
    try {
      await withTimeout(proc.exited, 5_000);
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this._proc = null;
    this._pid = null;
    this._port = null;
    this._password = null;
    this._exitedAttached = false;
  }

  // --- Health check -------------------------------------------------------

  /**
   * Single `GET /health` call with a short timeout. Returns the boolean.
   * Uses the global `fetch` directly (not `HttpClient`) to keep this
   * method usable before `HttpClient` is constructed.
   */
  async healthCheck(): Promise<boolean> {
    if (this._port === null || this._password === null) return false;
    return await pollHealthCheck(this._port, this._password, 2_000);
  }

  // --- Crash recovery -----------------------------------------------------

  /**
   * Register a callback for unexpected exits. The callback is invoked
   * exactly once per unexpected exit. The plugin uses this to mark
   * all in-memory instances `failed` and clear the in-memory map.
   */
  onUnexpectedExit(cb: OnUnexpectedExit): void {
    this._unexpectedExitCb = cb;
  }

  /**
   * Try to restart the serve child with exponential backoff
   * (250ms, 500ms, 1s — max 3 retries). Returns the new `ServeInfo` or
   * throws if all retries fail.
   */
  async tryRestart(): Promise<ServeInfo> {
    const delays = [250, 500, 1000];
    let lastErr: unknown = null;
    for (let i = 0; i < delays.length; i++) {
      const delay = delays[i];
      if (delay === undefined) continue;
      await sleep(delay);
      this._logger.warn(`bizar: retrying serve start (attempt ${i + 1}/3)…`);
      // Reset internal state so start() is happy.
      this._proc = null;
      this._pid = null;
      this._port = this._port ?? 0;
      try {
        return await this.start();
      } catch (err: unknown) {
        lastErr = err;
        this._logger.warn(
          `bizar: serve restart attempt ${i + 1}/3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`serve restart failed: ${String(lastErr)}`);
  }

  // --- Internal -----------------------------------------------------------

  private attachExitHandler(): void {
    const proc = this._proc;
    if (proc === null || this._exitedAttached) return;
    this._exitedAttached = true;
    proc.exited
      .then((exitCode) => {
        if (this._intentionalShutdown) return;
        this._pid = null;
        this._port = null;
        this._password = null;
        this._proc = null;
        this._exitedAttached = false;
        const cb = this._unexpectedExitCb;
        if (cb) {
          try {
            cb(exitCode);
          } catch {
            // callbacks must never throw across the boundary
          }
        }
      })
      .catch(() => {
        // proc.exited only rejects if the proc was already awaited or
        // never spawned; safe to ignore.
      });
  }

  private cleanupOnStartFailure(): void {
    const proc = this._proc;
    if (proc !== null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this._proc = null;
    this._pid = null;
    this._port = null;
    this._password = null;
    this._exitedAttached = false;
  }
}

// --- Helpers --------------------------------------------------------------

/**
 * Generate a 32-byte secret, base64-encoded (NEW-H9).
 */
function generatePassword(): string {
  const bytes = new Uint8Array(32);
  getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

/**
 * Read stdout from `proc` line-by-line and resolve with the bound port
 * when we see the "opencode server listening on http://127.0.0.1:<port>"
 * line. The actual port may differ from the requested port (especially
 * when port=0 for OS-assigned).
 *
 * Throws on timeout. The reader is released so the `ReadableStream` is
 * cleaned up.
 */
async function waitForListeningLine(
  proc: Subprocess,
  logger: Logger,
  timeoutMs: number,
): Promise<number> {
  // `stdout` is `ReadableStream<Uint8Array>` when stdout is "pipe". We
  // assert the type because Bun's type inference for the generic param
  // is not always narrow enough.
  const stdout = proc.stdout as ReadableStream<Uint8Array> | number | null | undefined;
  if (stdout === null || stdout === undefined) {
    throw new Error("opencode serve: no stdout pipe");
  }
  if (typeof stdout === "number") {
    throw new Error(`opencode serve: stdout is fd=${stdout}; expected a stream`);
  }
  const reader = stdout.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const portRegex = /opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/;
  try {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`listening line not seen within ${timeoutMs}ms`);
      }
      const readResult = await Promise.race([
        reader.read(),
        sleep(remaining).then(() => ({
          done: true as const,
          value: undefined as unknown as Uint8Array,
        })),
      ]);
      if (readResult.done) {
        // Stream ended or timeout fired; check buffer one last time.
        const m = buffer.match(portRegex);
        if (m && m[1]) {
          const port = parseInt(m[1], 10);
          return port;
        }
        throw new Error(
          `opencode serve exited before listening line. Last stdout: ${buffer.slice(-200)}`,
        );
      }
      const chunk = decoder.decode(readResult.value as Uint8Array, { stream: true });
      buffer += chunk;
      const m = buffer.match(portRegex);
      if (m && m[1]) {
        const port = parseInt(m[1], 10);
        logger.debug(`bizar: serve listening line observed (port=${port})`);
        return port;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * Poll `GET /health` with 100ms interval and `totalMs` total timeout.
 * Returns true on first 2xx; false on timeout.
 */
async function pollHealthCheck(
  port: number,
  password: string,
  totalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + totalMs;
  const authHeader = `Basic ${btoa(`opencode:${password}`)}`;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), remaining);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: "GET",
        headers: { Authorization: authHeader },
        signal: ac.signal,
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // ignore — keep polling
    } finally {
      clearTimeout(timer);
    }
    await sleep(100);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timed out after ${ms}ms`);
    }),
  ]);
}
