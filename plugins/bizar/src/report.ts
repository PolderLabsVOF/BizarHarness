/**
 * report.ts
 *
 * Per-session log writer. Appends metadata-only lines (no args) to
 * ~/.cache/bizarharness/logs/<sessionId>.log with 10 MB rotation.
 * Per §7.1, §7.6, §8.3, §10.1.
 */

import { appendFileSync, renameSync, unlinkSync, existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Minimal Logger interface — same shape as state.ts */
export interface Logger {
  log(opts: { level: "debug" | "info" | "warn" | "error"; message: string }): void;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Log line format (per §7.1):
 * 2026-06-17T14:30:01.123Z agent=thor tool=read fingerprint=ab12cd outcome=ok duration=45ms
 */
function formatLine(
  sessionId: string,
  agent: string | null,
  tool: string,
  fingerprint: string,
  outcome: "ok" | "error",
  durationMs: number
): string {
  const ts = new Date().toISOString();
  const agentPart = agent ? ` agent=${agent}` : "";
  return `${ts}${agentPart} tool=${tool} fingerprint=${fingerprint} outcome=${outcome} duration=${durationMs}ms\n`;
}

/**
 * Recursive mkdirSync with EACCES handling per §8.2.
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
        message: `bizar: cannot create log directory ${dir}: ${String(err)}`,
      });
      return false;
    }
    throw err;
  }
}

/**
 * Rotate log files when current file exceeds maxBytes:
 * 1. Delete .3.log (if exists)
 * 2. Rename .2.log → .3.log
 * 3. Rename .1.log → .2.log
 * 4. Rename <sessionId>.log → .1.log
 *
 * Each step in its own try/catch. Best-effort — never blocks the write.
 * Per §8.3.
 */
function rotateLog(logPath: string, logger: Logger): void {
  const dir = path.dirname(logPath);

  // Step 1: delete .3.log
  const p3 = path.join(dir, ".3.log");
  if (existsSync(p3)) {
    try { unlinkSync(p3); } catch { /* non-fatal */ }
  }

  // Step 2: rename .2.log → .3.log
  const p2 = path.join(dir, ".2.log");
  if (existsSync(p2)) {
    try { renameSync(p2, p3); } catch {
      logger.log({ level: "warn", message: `bizar: log rotation .2→.3 failed` });
    }
  }

  // Step 3: rename .1.log → .2.log
  const p1 = path.join(dir, ".1.log");
  if (existsSync(p1)) {
    try { renameSync(p1, p2); } catch {
      logger.log({ level: "warn", message: `bizar: log rotation .1→.2 failed` });
    }
  }

  // Step 4: rename current → .1.log
  if (existsSync(logPath)) {
    try { renameSync(logPath, p1); } catch {
      logger.log({ level: "warn", message: `bizar: log rotation current→.1 failed` });
    }
  }
}

export class LogWriter {
  private logDir: string;
  private maxBytes: number;
  private logger: Logger;
  private initialized = false;

  constructor(logDir: string, maxBytes: number, logger: Logger) {
    this.logDir = expandHome(logDir);
    this.maxBytes = Math.max(1024, Math.floor(maxBytes));
    this.logger = logger;
  }

  /**
   * Lazily ensure the log directory exists.
   */
  private ensureLogDir(): boolean {
    if (this.initialized) return true;
    this.initialized = true;
    return ensureDir(this.logDir, this.logger);
  }

  /**
   * Append a metadata-only log line for a tool call.
   *
   * Per §7.1 / §7.6: NO args are written. Only:
   * - ISO timestamp
   * - session ID
   * - tool name
   * - fingerprint hash
   * - outcome (ok | error)
   * - duration in milliseconds
   */
  async write(event: {
    sessionId: string;
    agent: string | null;
    tool: string;
    fingerprint: string;
    outcome: "ok" | "error";
    durationMs: number;
  }): Promise<void> {
    if (!this.ensureLogDir()) return;

    const logPath = path.join(this.logDir, `${event.sessionId}.log`);
    const line = formatLine(
      event.sessionId,
      event.agent,
      event.tool,
      event.fingerprint,
      event.outcome,
      event.durationMs
    );

    // Check rotation threshold
    try {
      if (existsSync(logPath)) {
        const stat = statSync(logPath);
        if (stat.size + Buffer.byteLength(line, "utf8") > this.maxBytes) {
          rotateLog(logPath, this.logger);
        }
      }
    } catch {
      // best-effort rotation check
    }

    try {
      appendFileSync(logPath, line, "utf8");
    } catch (err: unknown) {
      this.logger.log({
        level: "warn",
        message: `bizar: failed to write to log ${logPath}: ${String(err)}`,
      });
    }
  }
}