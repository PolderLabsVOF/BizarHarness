/**
 * loop-engineering.ts
 *
 * v6.0.0 — Structured loop patterns for continuous agent execution.
 *
 * Inspired by:
 *   - https://github.com/cobusgreyling/loop-engineering
 *   - https://github.com/rudy2steiner/awesome-agent-loops
 *
 * Patterns supported (v1):
 *
 *   1. **ralph** — repeat until output contains `[STOP]` marker, or until
 *      `maxIterations` is reached, or until a manual stop signal.
 *   2. **repl**  — interactive, awaits user input between iterations
 *      (not yet implemented in v1).
 *   3. **cron**  — interval-based; reruns every N seconds.
 *   4. **plan-execute** — decompose once, iterate over subtasks.
 *
 * Loops are stored on disk as JSON files at:
 *   ~/.bizar/loops/<loopId>.json
 *
 * Each loop has:
 *   - id, pattern, task, status (running | stopped | done)
 *   - iterations[] — log of { index, startedAt, durationMs, output, stopReason }
 *   - context — pattern-specific config (interval, maxIterations, etc.)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type LoopPattern = "ralph" | "repl" | "cron" | "plan-execute";
export type LoopStatus = "running" | "stopped" | "done";

export interface LoopIteration {
  index: number;
  startedAt: string;
  durationMs: number;
  output: string;
  stopReason?: string;
}

export interface LoopContext {
  maxIterations: number;
  stopMarker?: string;
  intervalSeconds?: number;
  subtasks?: string[];
}

export interface Loop {
  id: string;
  pattern: LoopPattern;
  task: string;
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
  context: LoopContext;
  iterations: LoopIteration[];
}

const LOOPS_DIR = join(homedir(), ".bizar", "loops");

function ensureLoopsDir(): void {
  if (!existsSync(LOOPS_DIR)) {
    mkdirSync(LOOPS_DIR, { recursive: true });
  }
}

function generateLoopId(): string {
  return `loop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface StartLoopInput {
  pattern: LoopPattern;
  task: string;
  context?: Partial<LoopContext>;
}

export interface StartLoopOutput {
  ok: true;
  loop: Loop;
}

export function startLoop(input: StartLoopInput): StartLoopOutput {
  ensureLoopsDir();
  const id = generateLoopId();
  const now = new Date().toISOString();
  const loop: Loop = {
    id,
    pattern: input.pattern,
    task: input.task,
    status: "running",
    createdAt: now,
    updatedAt: now,
    context: {
      maxIterations: input.context?.maxIterations ?? 10,
      stopMarker: input.context?.stopMarker,
      intervalSeconds: input.context?.intervalSeconds,
      subtasks: input.context?.subtasks,
    },
    iterations: [],
  };
  writeFileSync(join(LOOPS_DIR, `${id}.json`), JSON.stringify(loop, null, 2));
  return { ok: true, loop };
}

export function loadLoop(id: string): Loop | null {
  const path = join(LOOPS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Loop;
}

export function saveLoop(loop: Loop): void {
  loop.updatedAt = new Date().toISOString();
  writeFileSync(join(LOOPS_DIR, `${loop.id}.json`), JSON.stringify(loop, null, 2));
}

/**
 * Append an iteration result to a loop and update its status if a stop
 * condition was met.
 */
export function appendIteration(
  id: string,
  result: Omit<LoopIteration, "startedAt"> & { startedAt?: string },
): Loop | null {
  const loop = loadLoop(id);
  if (!loop) return null;
  const iter: LoopIteration = {
    index: loop.iterations.length,
    startedAt: result.startedAt ?? new Date().toISOString(),
    durationMs: result.durationMs,
    output: result.output,
    stopReason: result.stopReason,
  };
  loop.iterations.push(iter);
  if (loop.context.maxIterations > 0 && loop.iterations.length >= loop.context.maxIterations) {
    loop.status = "done";
  } else if (
    loop.pattern === "ralph" &&
    loop.context.stopMarker &&
    result.output.includes(loop.context.stopMarker)
  ) {
    loop.status = "done";
    iter.stopReason = `stop marker "${loop.context.stopMarker}" found`;
  }
  saveLoop(loop);
  return loop;
}

/**
 * Mark a loop as stopped (manual stop signal).
 *
 * If `reason` is given AND the loop has at least one iteration, attach
 * the reason to the most recent iteration. Otherwise, append a synthetic
 * "stopped" iteration so the reason is preserved in the audit log.
 */
export function stopLoop(id: string, reason?: string): Loop | null {
  const loop = loadLoop(id);
  if (!loop) return null;
  loop.status = "stopped";
  if (reason) {
    if (loop.iterations.length > 0) {
      const last = loop.iterations[loop.iterations.length - 1];
      if (last) last.stopReason = reason;
    } else {
      // Append a synthetic iteration so the reason isn't lost.
      loop.iterations.push({
        index: 0,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        output: "(loop stopped before any iterations ran)",
        stopReason: reason,
      });
    }
  }
  saveLoop(loop);
  return loop;
}

/**
 * Delete a loop from disk.
 */
export function deleteLoop(id: string): boolean {
  const path = join(LOOPS_DIR, `${id}.json`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * List all loops on disk, optionally filtered by status / pattern.
 */
export function listLoops(filter?: { status?: LoopStatus; pattern?: LoopPattern }): Loop[] {
  ensureLoopsDir();
  const files = readdirSync(LOOPS_DIR).filter((f) => f.endsWith(".json"));
  const out: Loop[] = [];
  for (const f of files) {
    try {
      const l = JSON.parse(readFileSync(join(LOOPS_DIR, f), "utf8")) as Loop;
      if (filter?.status && l.status !== filter.status) continue;
      if (filter?.pattern && l.pattern !== filter.pattern) continue;
      out.push(l);
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Pattern execution: given a loop, return the prompt for the next
 * iteration and the stop marker to look for (if any).
 */
export function buildNextIteration(loop: Loop): { prompt: string; stopMarker: string | null } {
  switch (loop.pattern) {
    case "ralph": {
      const stopMarker = loop.context.stopMarker ?? "[STOP]";
      const iterIndex = loop.iterations.length + 1;
      const prompt = [
        `Loop iteration ${iterIndex} of ${loop.context.maxIterations}.`,
        `Task: ${loop.task}`,
        ``,
        `Output the literal marker "${stopMarker}" on its own line when done.`,
      ].join("\n");
      return { prompt, stopMarker };
    }
    case "cron":
      return { prompt: loop.task, stopMarker: null };
    case "plan-execute": {
      const subs = loop.context.subtasks ?? [];
      const nextIdx = loop.iterations.length;
      const subtask = subs[nextIdx] ?? "(no more subtasks)";
      return {
        prompt: `Subtask ${nextIdx + 1} of ${subs.length}: ${subtask}`,
        stopMarker: null,
      };
    }
    case "repl":
      return { prompt: loop.task, stopMarker: null };
  }
}