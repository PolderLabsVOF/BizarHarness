/**
 * src/agent/heartbeat.ts
 *
 * Pillar A — Heartbeat + session resume.
 *
 * Exports `startHeartbeat(intervalMs)` which returns a session ID and a
 * JSONL writer that appends heartbeat records to
 * `.harness/traces/heartbeat.jsonl`. Each record carries:
 *   session_id, started_at, last_heartbeat_at, status
 *
 * Status transitions: running → idle → done | failed
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type SessionStatus = "running" | "idle" | "failed" | "done";

export interface HeartbeatRecord {
  session_id: string;
  started_at: string;
  last_heartbeat_at: string;
  status: SessionStatus;
}

/** Returns the path to the heartbeat log, resolved from repo root. */
export function heartbeatPath(repoRoot: string): string {
  return join(repoRoot, ".harness", "traces", "heartbeat.jsonl");
}

/**
 * Start a heartbeat ticker.
 *
 * @param intervalMs  — milliseconds between heartbeat writes (default 30_000)
 * @param repoRoot    — repository root (default process.cwd())
 * @returns {{ sessionId: string, stop: () => void }}
 */
export function startHeartbeat(
  intervalMs = 30_000,
  repoRoot?: string,
): { sessionId: string; stop: () => void } {
  const root = repoRoot ?? process.cwd();
  const dir = join(root, ".harness", "traces");
  const fp = heartbeatPath(root);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();

  function writeRecord(status: SessionStatus): void {
    const record: HeartbeatRecord = {
      session_id: sessionId,
      started_at: startedAt,
      last_heartbeat_at: new Date().toISOString(),
      status,
    };
    appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
  }

  writeRecord("running");

  const interval = setInterval(() => {
    writeRecord("running");
  }, intervalMs);

  return {
    sessionId,
    stop: () => {
      clearInterval(interval);
      writeRecord("done");
    },
  };
}

/**
 * Mark a session as failed in the heartbeat log.
 * Reads the original started_at from the JSONL file if available.
 */
export function failHeartbeat(sessionId: string, repoRoot?: string): void {
  const root = repoRoot ?? process.cwd();
  const fp = heartbeatPath(root);
  if (!existsSync(fp)) return;

  const startedAt = _readStartedAt(fp, sessionId);
  const record: HeartbeatRecord = {
    session_id: sessionId,
    started_at: startedAt,
    last_heartbeat_at: new Date().toISOString(),
    status: "failed",
  };
  appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
}

/**
 * Mark a session as done.
 * Reads the original started_at from the JSONL file if available.
 */
export function stopHeartbeat(sessionId: string, repoRoot?: string): void {
  const root = repoRoot ?? process.cwd();
  const fp = heartbeatPath(root);
  if (!existsSync(fp)) return;

  const startedAt = _readStartedAt(fp, sessionId);
  const record: HeartbeatRecord = {
    session_id: sessionId,
    started_at: startedAt,
    last_heartbeat_at: new Date().toISOString(),
    status: "done",
  };
  appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
}

/** Find the original started_at for a session from the JSONL file. */
function _readStartedAt(fp: string, sessionId: string): string {
  try {
    const raw = readFileSync(fp, "utf-8");
    for (const line of raw.split("\n").reverse()) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as HeartbeatRecord;
        if (rec.session_id === sessionId && rec.started_at) {
          return rec.started_at;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // ignore read errors
  }
  return new Date().toISOString();
}
