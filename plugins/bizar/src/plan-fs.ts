/**
 * plan-fs.ts
 *
 * v0.5.0 — Plan filesystem operations.
 *
 * Pure file-I/O helpers for the on-disk plan layout used by the v2
 * canvas:
 *
 *     <worktree>/plans/<slug>/meta.json   — status + bookkeeping
 *     <worktree>/plans/<slug>/plan.json   — v2 canvas
 *
 * This module is the **only** place in the plugin that knows the
 * layout. Both `src/commands-impl.ts` (slash-command side effects)
 * and `src/tools/plan-action.ts` (the `bizar_plan_action` tool) build
 * on these primitives. The CLI in `cli/plan.mjs` duplicates the same
 * layout (language boundary: mjs vs ts); keep both copies in sync.
 *
 * Concurrency:
 *   - All writes go through a single async mutex so two concurrent
 *     `createPlan()` calls cannot both create the same slug, and so a
 *     `createPlan` racing with a `bizar_plan_action` write never
 *     produces a partial state on disk.
 *   - Writes are atomic: write to `<file>.tmp`, then `renameSync` to
 *     the final path. A crash mid-write leaves a `.tmp` orphan — the
 *     `rmSync` in the catch block is best-effort.
 *
 * Errors:
 *   - All functions return a discriminated result object (`{ ok: true, ... }`
 *     or `{ ok: false, error: ... }`) and NEVER throw. Callers can
 *     surface the error string to the user.
 *   - Slug validation: every public function validates the slug with
 *     `SLUG_REGEX` and returns `{ ok: false, error: ... }` on failure.
 *
 * [KEEP-IN-SYNC-WITH cli/plan.mjs] — the CLI in `cli/plan.mjs` mirrors
 * the layout. If you change the canvas or meta shape, update both.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Logger } from "./logger.js";

// --- Constants ------------------------------------------------------------

/** Same slug rule used everywhere in the project. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Initial status of a freshly created plan. */
const DEFAULT_STATUS = "draft" as const;

// --- Types ----------------------------------------------------------------

/** Public result type for all plan-fs operations. */
export type PlanFsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** A summary row used by `listPlans`. */
export interface PlanListEntry {
  slug: string;
  status: string;
  lastEdited: string;
}

/** The shape stored in `meta.json`. */
export interface PlanMeta {
  status: string;
  lastEdited: string;
  /** Anything else the viewer/agent has written into meta. */
  [key: string]: unknown;
}

/** The shape stored in `plan.json` (v2 canvas). */
export interface PlanCanvas {
  schemaVersion: 2;
  title: string;
  elements: unknown[];
  connections: unknown[];
  comments: unknown[];
  viewport: { x: number; y: number; zoom: number };
  lastEdited: string;
  [key: string]: unknown;
}

/** Returned by `createPlan` on success. */
export interface CreatePlanSuccess {
  meta: PlanMeta;
  canvas: PlanCanvas;
}

// --- Module-level mutex ---------------------------------------------------

/** Per-process mutex. Serializes every plan-fs mutation. */
const locks: { chain: Promise<unknown> } = { chain: Promise.resolve() };

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = locks.chain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.chain = next.catch(() => {});
  return next;
}

// --- Helpers --------------------------------------------------------------

function planDir(worktree: string, slug: string): string {
  return join(worktree, "plans", slug);
}

function metaPath(worktree: string, slug: string): string {
  return join(planDir(worktree, slug), "meta.json");
}

function canvasPath(worktree: string, slug: string): string {
  return join(planDir(worktree, slug), "plan.json");
}

function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(
  filePath: string,
  data: unknown,
  logger: Logger,
): { ok: true } | { ok: false; error: string } {
  const tmp = `${filePath}.tmp`;
  try {
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, filePath);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`bizar: plan-fs: failed to write ${filePath}: ${msg}`);
    try {
      if (existsSync(tmp)) rmSync(tmp);
    } catch {
      // best-effort cleanup
    }
    return { ok: false, error: `Failed to write ${filePath}: ${msg}` };
  }
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

// --- Public API -----------------------------------------------------------

/**
 * Create a new plan at `<worktree>/plans/<slug>/`. The directory
 * contains:
 *
 *   - `meta.json`  — `{ status: "draft", lastEdited: <iso>, title }`
 *   - `plan.json`  — minimal v2 canvas (empty elements / connections / comments)
 *
 * If a plan with the same slug already exists, returns
 * `{ ok: false, error: "Plan already exists: <slug>" }` — we never
 * clobber. Callers should explicitly `/plan delete` first if they
 * want a fresh canvas.
 *
 * The `template` option is currently informational only — the v0.5.0
 * MVP always scaffolds a blank canvas. Future versions may seed the
 * canvas with template-specific elements.
 */
export async function createPlan(
  worktree: string,
  slug: string,
  opts: { template?: string | null; logger: Logger },
): Promise<PlanFsResult<CreatePlanSuccess>> {
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: `Invalid slug "${slug}". Must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }

  return withLock(async () => {
    const dir = planDir(worktree, slug);
    if (existsSync(dir)) {
      return {
        ok: false,
        error:
          `Plan "${slug}" already exists at ${dir}. ` +
          `Use /plan delete ${slug} first, or pick a new slug.`,
      };
    }

    const now = new Date().toISOString();
    const title = titleCaseFromSlug(slug);
    const meta: PlanMeta = {
      status: DEFAULT_STATUS,
      lastEdited: now,
      title,
    };
    const canvas: PlanCanvas = {
      schemaVersion: 2,
      title,
      elements: [],
      connections: [],
      comments: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      lastEdited: now,
    };

    // Ensure the directory exists before writing (writeJsonAtomic also
    // mkdir's the parent, but doing it explicitly lets us return a
    // clearer error).
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.logger.warn(`bizar: plan-fs: mkdir failed for ${dir}: ${msg}`);
      return { ok: false, error: `Cannot create plan directory: ${dir} (${msg})` };
    }

    const metaRes = writeJsonAtomic(metaPath(worktree, slug), meta, opts.logger);
    if (!metaRes.ok) return metaRes;
    const canvasRes = writeJsonAtomic(canvasPath(worktree, slug), canvas, opts.logger);
    if (!canvasRes.ok) {
      // Roll back the partially-created directory so a retry has a
      // clean slate. Best-effort.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      return canvasRes;
    }

    opts.logger.info(
      `bizar: plan-fs: created plan "${slug}" at ${dir} (template=${opts.template ?? "blank"})`,
    );
    return { ok: true, value: { meta, canvas } };
  });
}

/**
 * List the plans in `<worktree>/plans/`. Returns an array sorted by
 * slug. Each entry has `slug`, `status` (from `meta.json` if present,
 * else `"unknown"`), and `lastEdited` (ISO timestamp or `""` if
 * missing).
 *
 * Returns `[]` when the worktree has no `plans/` directory — that's
 * the "no plans yet" case, not an error.
 */
export async function listPlans(
  worktree: string,
  _logger: Logger,
): Promise<PlanListEntry[]> {
  const dir = join(worktree, "plans");
  if (!existsSync(dir)) return [];

  // Use sync readdir here — the function is called rarely (from
  // /plan list) and the directory is small. Keeping the function
  // async lets us swap in an async implementation later.
  const { readdirSync, statSync } = await import("node:fs");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: PlanListEntry[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const stat = statSync(full);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    if (!isValidSlug(name)) continue; // skip non-slug dirs

    const meta = readJson<PlanMeta>(metaPath(worktree, name));
    out.push({
      slug: name,
      status: meta?.status ?? "unknown",
      lastEdited:
        typeof meta?.lastEdited === "string" ? meta.lastEdited : "",
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/**
 * Read `meta.json` for a plan. Returns `null` if the plan or the
 * meta file does not exist. The caller decides what "missing" means
 * (the slash command treats it as a soft error).
 */
export async function getPlanMeta(
  worktree: string,
  slug: string,
): Promise<PlanMeta | null> {
  if (!isValidSlug(slug)) return null;
  return readJson<PlanMeta>(metaPath(worktree, slug));
}
