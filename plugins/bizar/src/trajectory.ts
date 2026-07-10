/**
 * plugins/bizar/src/trajectory.ts
 *
 * v6.0.0 — Trajectory capture + replay for the closed learning loop.
 *
 * Per MILESTONES.md Loop A, every tool/model call is recorded as a
 * structured event to enable replay, compression, skill extraction,
 * and the evaluation harness.
 *
 * Trajectory events are JSONL files at:
 *   ~/.bizar/trajectories/<sessionId>.jsonl
 *
 * Override the directory with BIZAR_TRAJECTORY_DIR.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type TrajectoryKind = "model" | "tool" | "session";
export type TrajectoryPhase =
  | "request"   // model: outgoing request; tool: pre-call args
  | "response"  // model: assistant response
  | "result"    // tool: post-call result
  | "start"     // session: session.start
  | "end"       // session: clean end
  | "error";    // any: failure captured

export interface TrajectoryEvent {
  /** ISO-8601 timestamp with millisecond precision. */
  ts: string;
  /** The session this event belongs to. */
  sessionId: string;
  /** The agent (e.g. "thor", "mimir"). Empty string for session-level. */
  agentId: string;
  /** 1-based iteration counter within the session. */
  iteration: number;
  /** Event category. */
  kind: TrajectoryKind;
  /** Phase within the kind. */
  phase: TrajectoryPhase;
  /** Kind-specific structured data. */
  payload: Record<string, unknown>;
}

/** Default trajectory directory. */
export function resolveTrajectoryDir(): string {
  return process.env.BIZAR_TRAJECTORY_DIR || join(homedir(), ".bizar", "trajectories");
}

/** Sanitize sessionId for safe filename use. */
function safeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Compute the trajectory file path for a session. */
export function trajectoryPath(sessionId: string, dir: string = resolveTrajectoryDir()): string {
  return join(dir, `${safeId(sessionId)}.jsonl`);
}

/** Ensure the trajectory directory exists. */
export function ensureTrajectoryDir(dir: string = resolveTrajectoryDir()): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Build a fully-populated event with the current timestamp. */
export function makeEvent(
  partial: Omit<TrajectoryEvent, "ts"> & { ts?: string },
): TrajectoryEvent {
  return {
    ts: partial.ts ?? new Date().toISOString(),
    sessionId: partial.sessionId,
    agentId: partial.agentId,
    iteration: partial.iteration,
    kind: partial.kind,
    phase: partial.phase,
    payload: partial.payload ?? {},
  };
}

/** Append one event to the session's JSONL file (async). */
export async function appendTrajectoryEvent(
  event: TrajectoryEvent,
  dir: string = resolveTrajectoryDir(),
): Promise<boolean> {
  try {
    if (!ensureTrajectoryDir(dir)) return false;
    const line = JSON.stringify(event) + "\n";
    // Use Node's portable appendFile rather than Bun.write — `Bun.write`
    // requires a BunFile destination when the {append:true} option is set,
    // which trips TypeScript overload resolution. The line-write semantics
    // are equivalent; one tool call per event.
    const { appendFile } = await import("node:fs/promises");
    await appendFile(trajectoryPath(event.sessionId, dir), line, "utf8");
    return true;
  } catch {
    return false;
  }
}