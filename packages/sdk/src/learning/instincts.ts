/**
 * learning/instincts.ts — Instinct log for Bizar self-learning.
 *
 * v10.1.1 — Pillar D: Instinct log backed by `.bizar/learning/instincts.jsonl`.
 *
 * Each entry:
 *   {id, trigger, action, confidence: 0-1, evidence: string[],
 *    scope: 'project'|'global', project, created_at, updated_at}
 *
 * Atomic append via fs.appendFileSync (Node's async form flushes by default;
 * verified by the smoke test in instincts.test.mjs).
 *
 * Auto-write path: PostToolUse hook on Bash for high-frequency commands
 * (npm install, git push, etc.) via `.claude/hooks/auto-instinct.sh`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const LEARNING_DIR = ".bizar/learning";
const INSTINCTS_FILE = "instincts.jsonl";

function instinctPath(project?: string): string {
  const root = project && project !== "." ? project : process.cwd();
  return join(root, LEARNING_DIR, INSTINCTS_FILE);
}

function ensureDir(project?: string): void {
  const dir = join(instinctPath(project), "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function makeId(trigger: string, action: string, ts: number): string {
  const h = createHash("sha256");
  h.update(String(ts));
  h.update(trigger);
  h.update(action);
  return h.digest("hex").slice(0, 16);
}

/** Record a new instinct. Returns the created entry. */
export function recordInstinct({
  trigger,
  action,
  confidence = 0.5,
  evidence = [],
  scope = "project",
  project,
}: {
  trigger: string;
  action: string;
  confidence?: number;
  evidence?: string[];
  scope?: "project" | "global";
  project?: string;
}): Record<string, unknown> {
  const ts = Date.now();
  const entry = {
    id: makeId(trigger, action, ts),
    trigger: String(trigger),
    action: String(action),
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    evidence: evidence.map(String),
    scope,
    project: project ?? (scope === "global" ? "" : process.cwd()),
    created_at: new Date(ts).toISOString(),
    updated_at: new Date(ts).toISOString(),
  };
  ensureDir(project);
  appendFileSync(instinctPath(project), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/** List all instincts, optionally filtered by scope. */
export function listInstincts(opts: { scope?: "project" | "global"; project?: string } = {}): Record<string, unknown>[] {
  const path = instinctPath(opts.project);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const all = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((e): e is Record<string, unknown> => e !== null);
    if (!opts.scope) return all;
    return all.filter((e) => String(e.scope) === opts.scope);
  } catch {
    return [];
  }
}

/** Promote an instinct's confidence (returns updated entry or null). */
export function promoteInstinct(
  id: string,
  newConfidence: number,
  opts: { project?: string } = {},
): Record<string, unknown> | null {
  const path = instinctPath(opts.project);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const entries: Record<string, unknown>[] = [];
  let found = false;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !found && String(e.id) === String(id)) {
        e.confidence = Math.max(0, Math.min(1, Number(newConfidence)));
        e.updated_at = new Date().toISOString();
        found = true;
      }
      if (e && typeof e === "object") entries.push(e);
    } catch { /* skip malformed lines */ }
  }
  if (!found) return null;
  // Re-write the file with updated entry.
  ensureDir(opts.project);
  const { writeFileSync } = require("node:fs");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return entries.find((e) => String(e.id) === String(id)) ?? null;
}

/** Drop an instinct by id (returns true if found and removed). */
export function dropInstinct(id: string, opts: { project?: string } = {}): boolean {
  const path = instinctPath(opts.project);
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const kept: string[] = [];
  let found = false;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && String(e.id) === String(id)) {
        found = true;
      } else if (e && typeof e === "object") {
        kept.push(line);
      }
    } catch { /* skip malformed lines */ }
  }
  if (!found) return false;
  ensureDir(opts.project);
  const { writeFileSync } = require("node:fs");
  writeFileSync(path, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
  return true;
}
