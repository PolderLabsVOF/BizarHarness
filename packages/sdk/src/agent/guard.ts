/**
 * src/agent/guard.ts
 *
 * F-206 — `/guard` progress-guarding loop state.
 *
 * Exports:
 *   addGuard({ planPath, intervalMs, goal?, slug? })
 *   listGuards()
 *   getGuard(slug)
 *   removeGuard(slug)
 *   recordGuardCheck(slug, check)
 *   markGuardStopped(slug)
 *
 * Persists each guard to `.bizar/guards/<slug>/state.json` and appends
 * each check to `.bizar/guards/<slug>/checks.jsonl`. The directory layout
 * mirrors `.bizar/cron.json` so a future `bizar migrate` pass can lift
 * both into `.bizar/state/` without a schema break.
 *
 * The guard loop itself is not a persistent daemon. `addGuard` only
 * records intent; the host-side `/loop` primitive (Claude Code) or an
 * external scheduler re-invokes `recordGuardCheck` on cadence.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";

/** Bumped when the on-disk shape changes in a breaking way. */
export const GUARD_SCHEMA_VERSION = "1.0.0";

export type GuardStatus = "pending" | "running" | "stopped" | "done";

export type GuardVerdict = "healthy" | "drift" | "stuck" | "done";

export interface Guard {
  /** Stable slug; doubles as on-disk directory name. */
  slug: string;
  /** Filesystem path (relative or absolute) to the plan doc. */
  planPath: string;
  /** Check cadence in milliseconds. */
  intervalMs: number;
  /** Optional operator-stated goal of the plan (free text). */
  goal?: string;
  status: GuardStatus;
  /** ISO timestamp the guard was created. */
  startedAt: string;
  /** ISO timestamp the most recent check completed; undefined if none. */
  lastCheckedAt?: string;
  /** ISO timestamp the guard transitioned out of `pending | running`. */
  stoppedAt?: string;
  /** Most recent verdict recorded by `recordGuardCheck`. */
  lastVerdict?: GuardVerdict;
  /** Schema version for forward-compatible loaders. */
  schemaVersion: string;
}

export interface GuardCheck {
  /** ISO timestamp the check completed. */
  ts: string;
  /** Computed verdict. */
  verdict: GuardVerdict;
  /** Free-text list of signals that produced the verdict. */
  signals: string[];
  /** Operator-actionable recommendation. */
  recommendation: string;
  /** True when the guard self-terminated on this check. */
  selfTerminated: boolean;
}

function guardsRoot(repoRoot?: string): string {
  return join(repoRoot ?? process.cwd(), ".bizar", "guards");
}

function guardDir(slug: string, repoRoot?: string): string {
  return join(guardsRoot(repoRoot), slug);
}

function statePath(slug: string, repoRoot?: string): string {
  return join(guardDir(slug, repoRoot), "state.json");
}

function checksPath(slug: string, repoRoot?: string): string {
  return join(guardDir(slug, repoRoot), "checks.jsonl");
}

function ensureDir(fp: string): void {
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Validate a slug: lowercase letters, digits, and dashes only.
 * Throws on empty, missing, or malformed input so callers see a clear
 * error rather than a path-traversal vulnerability.
 */
export function normalizeSlug(slug: string | undefined): string {
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("GUARD_SLUG_REQUIRED: slug must be a non-empty string");
  }
  const trimmed = slug.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(trimmed)) {
    throw new Error(
      `GUARD_SLUG_INVALID: slug must match /^[a-z0-9][a-z0-9-]{0,63}$/, got: ${JSON.stringify(trimmed)}`,
    );
  }
  return trimmed;
}

function loadGuard(slug: string, repoRoot?: string): Guard | null {
  const fp = statePath(slug, repoRoot);
  if (!existsSync(fp)) return null;
  try {
    const parsed = JSON.parse(readFileSync(fp, "utf-8")) as Guard;
    if (!parsed.slug) return null;
    return parsed;
  } catch {
    // Malformed JSON: treat as missing so callers can re-add. The
    // per-guard checks.jsonl is the audit trail; the state.json is
    // rebuildable from `addGuard` + appended checks.
    return null;
  }
}

function saveGuard(guard: Guard, repoRoot?: string): void {
  const fp = statePath(guard.slug, repoRoot);
  ensureDir(fp);
  writeFileSync(fp, JSON.stringify(guard, null, 2), "utf-8");
}

/**
 * Add a guard. Returns the persisted record. Re-adding an existing slug
 * with identical options is allowed (idempotent — operator may have
 * re-run `bizar guard start` after a host crash), but re-adding with a
 * different `planPath` or `intervalMs` throws so the existing record
 * stays authoritative.
 */
export function addGuard(
  opts: {
    planPath: string;
    intervalMs: number;
    goal?: string;
    slug?: string;
    repoRoot?: string;
  },
): Guard {
  if (typeof opts.planPath !== "string" || opts.planPath.length === 0) {
    throw new Error("GUARD_PLAN_REQUIRED: planPath must be a non-empty string");
  }
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs < 1000) {
    throw new Error(
      `GUARD_INTERVAL_INVALID: intervalMs must be a positive integer >= 1000ms, got: ${opts.intervalMs}`,
    );
  }
  const slug = normalizeSlug(opts.slug ?? deriveSlug(opts.planPath));
  const existing = loadGuard(slug, opts.repoRoot);
  const now = new Date().toISOString();
  if (existing) {
    if (
      existing.planPath !== opts.planPath ||
      existing.intervalMs !== opts.intervalMs
    ) {
      throw new Error(
        `GUARD_SLUG_TAKEN: slug ${slug} already exists with different planPath=${existing.planPath} or intervalMs=${existing.intervalMs}; choose a different slug or remove the existing guard first`,
      );
    }
    return existing;
  }
  const guard: Guard = {
    slug,
    planPath: opts.planPath,
    intervalMs: opts.intervalMs,
    goal: opts.goal,
    status: "pending",
    startedAt: now,
    schemaVersion: GUARD_SCHEMA_VERSION,
  };
  saveGuard(guard, opts.repoRoot);
  return guard;
}

/**
 * Derive a deterministic slug from a plan path. Used when the operator
 * does not pass `--slug`. The slug is the plan's basename with extension
 * stripped and unsafe characters replaced by dashes.
 */
function deriveSlug(planPath: string): string {
  const base = planPath
    .replace(/\\/g, "/")
    .split("/")
    .pop() ?? "guard";
  const stripped = base.replace(/\.[^.]+$/, "");
  return normalizeSlug(stripped.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
}

/** List every guard on disk, sorted by `startedAt`. */
export function listGuards(repoRoot?: string): Guard[] {
  const root = guardsRoot(repoRoot);
  if (!existsSync(root)) return [];
  const entries = readdirSync(root) as string[];
  const guards: Guard[] = [];
  for (const entry of entries) {
    const g = loadGuard(entry, repoRoot);
    if (g) guards.push(g);
  }
  guards.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return guards;
}

/** Fetch a single guard by slug. Returns null if missing or malformed. */
export function getGuard(slug: string, repoRoot?: string): Guard | null {
  return loadGuard(normalizeSlug(slug), repoRoot);
}

/**
 * Remove a guard and its on-disk directory.
 * @returns true if the guard existed and was removed
 */
export function removeGuard(slug: string, repoRoot?: string): boolean {
  const normalized = normalizeSlug(slug);
  const dir = guardDir(normalized, repoRoot);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Append a check to `<slug>/checks.jsonl` and update the parent guard's
 * `lastCheckedAt` + `lastVerdict`. Returns the persisted guard after
 * the update so callers can inspect the new status without a second
 * read.
 */
export function recordGuardCheck(
  slug: string,
  check: GuardCheck,
  repoRoot?: string,
): Guard {
  const normalized = normalizeSlug(slug);
  const guard = loadGuard(normalized, repoRoot);
  if (!guard) {
    throw new Error(
      `GUARD_NOT_FOUND: no guard with slug ${normalized}; run 'bizar guard start' first`,
    );
  }
  const fp = checksPath(normalized, repoRoot);
  ensureDir(fp);
  appendFileSync(fp, JSON.stringify(check) + "\n", "utf-8");
  const next: Guard = {
    ...guard,
    status: check.verdict === "done" ? "done" : "running",
    lastCheckedAt: check.ts,
    lastVerdict: check.verdict,
    stoppedAt: check.verdict === "done" ? check.ts : guard.stoppedAt,
  };
  saveGuard(next, repoRoot);
  return next;
}

/**
 * Mark a guard as explicitly stopped by an operator (i.e. `bizar guard
 * stop`). Distinct from `recordGuardCheck`'s verdict-driven transition.
 */
export function markGuardStopped(slug: string, repoRoot?: string): Guard {
  const normalized = normalizeSlug(slug);
  const guard = loadGuard(normalized, repoRoot);
  if (!guard) {
    throw new Error(
      `GUARD_NOT_FOUND: no guard with slug ${normalized}; run 'bizar guard start' first`,
    );
  }
  const now = new Date().toISOString();
  const next: Guard = { ...guard, status: "stopped", stoppedAt: now };
  saveGuard(next, repoRoot);
  return next;
}

/** Read the most recent N checks for a guard (default 5). */
export function listGuardChecks(
  slug: string,
  limit = 5,
  repoRoot?: string,
): GuardCheck[] {
  const normalized = normalizeSlug(slug);
  const fp = checksPath(normalized, repoRoot);
  if (!existsSync(fp)) return [];
  const lines = readFileSync(fp, "utf-8").split("\n").filter(Boolean);
  const tail = lines.slice(-Math.max(1, limit));
  const checks: GuardCheck[] = [];
  for (const line of tail) {
    try {
      checks.push(JSON.parse(line) as GuardCheck);
    } catch {
      // skip malformed lines; the audit trail is best-effort.
    }
  }
  return checks;
}
