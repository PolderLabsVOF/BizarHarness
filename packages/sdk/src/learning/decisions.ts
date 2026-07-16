/**
 * learning/decisions.ts — Decisions log (append-only, tamper-evident).
 *
 * v10.1.1 — Pillar D: Decisions log backed by `.bizar/learning/decisions.jsonl`.
 *
 * Each entry:
 *   {id, ts, event: 'decide'|'supersede'|'redact',
 *    subject, rationale, refs?, prev_hash, hash}
 *
 * tamper-evident chain: sha256(prev_hash + entry_body) → current hash.
 * Datamark on render: escape unicode surrogates via JSON.stringify replacer
 * (same pattern as gstack's wrapUntrustedContent).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const LEARNING_DIR = ".bizar/learning";
const DECISIONS_FILE = "decisions.jsonl";

function decisionsPath(project?: string): string {
  const root = project && project !== "." ? project : process.cwd();
  return join(root, LEARNING_DIR, DECISIONS_FILE);
}

function ensureDir(project?: string): void {
  const dir = join(decisionsPath(project), "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** SHA256 hash of a string, truncated to 16 hex chars. */
function sha16(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/** Build a content-addressable id from event + subject + ts. */
function makeId(ts: number, subject: string, event: string): string {
  return sha16(`${ts}:${subject}:${event}`);
}

/** Compute the hash for an entry (excludes the hash field itself). */
function entryHash(entry: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash: _h, ...body } = entry;
  return sha16(JSON.stringify(body));
}

interface DecisionInput {
  event: "decide" | "supersede" | "redact";
  subject: string;
  rationale: string;
  refs?: string[];
  project?: string;
}

/** Record a new decision. Returns the created entry. */
export function recordDecision({
  event,
  subject,
  rationale,
  refs = [],
  project,
}: DecisionInput): Record<string, unknown> {
  ensureDir(project);
  const path = decisionsPath(project);

  // Read previous entry to get prev_hash.
  let prevHash = "0000000000000000";
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        prevHash = String(last.hash ?? prevHash);
      }
    } catch { /* best-effort: start from genesis */ }
  }

  const ts = Date.now();
  const id = makeId(ts, subject, event);
  const refsArr = Array.isArray(refs) ? refs : [];

  const entry: Record<string, unknown> = {
    id,
    ts,
    event,
    subject: String(subject),
    rationale: String(rationale),
    refs: refsArr.map(String),
    prev_hash: prevHash,
  };
  entry.hash = sha16(JSON.stringify({ ...entry }));

  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/** List all decisions. */
export function listDecisions(opts: { project?: string } = {}): Record<string, unknown>[] {
  const path = decisionsPath(opts.project);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((e): e is Record<string, unknown> => e !== null);
  } catch {
    return [];
  }
}

/**
 * Verify the tamper-evident chain.
 * Returns { ok: true } if every entry's hash matches the computed hash
 * and prev_hash chains correctly. Returns { ok: false, at: number } on
 * the first break.
 */
export function verifyChain(opts: { project?: string } = {}): { ok: boolean; at?: number } {
  const decisions = listDecisions(opts);
  if (decisions.length === 0) return { ok: true };
  let prevHash = "0000000000000000";
  for (let i = 0; i < decisions.length; i++) {
    const e = decisions[i];
    if (String(e.prev_hash) !== prevHash) return { ok: false, at: i };
    const computed = entryHash(e as Record<string, unknown>);
    if (String(e.hash) !== computed) return { ok: false, at: i };
    prevHash = String(e.hash);
  }
  return { ok: true };
}

/**
 * Datamark renderer — escape unicode surrogates so JSON.stringify never
 * emits invalid strings when rendering decisions in the UI.
 * Pattern borrowed from gstack's wrapUntrustedContent.
 */
export function datamark(value: unknown): unknown {
  if (typeof value !== "string") return value;
  // Replace isolated surrogates with U+FFFD REPLACEMENT CHARACTER.
  return value.replace(/[\uD800-\uDFFF]/g, (c) =>
    c.charCodeAt(0) >= 0xD800 ? "�" : c,
  );
}
