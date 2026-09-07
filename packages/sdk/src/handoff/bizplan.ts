/**
 * handoff/bizplan.ts — Bizplan handoff + tier contract (F-203, OMX bizplan-overhaul).
 *
 * Bizplan is Bizar's unified planning surface, replacing the legacy
 * `/ralplan` workflow. Every `/bizplan` invocation produces a typed
 * handoff document that downstream surfaces (autopilot, ultragoal,
 * MCP, executor tasks) consume without re-deriving shape. The contract
 * is intentionally framework-free: callers in any environment (SDK,
 * CLI, MCP server, hook) can pass a plain object in and get a
 * discriminated-union result back. We do not import a schema library
 * at the SDK layer; the contract IS the shape.
 *
 * Three tiers:
 *   - `light`    — one file, no behavior change. spec → plan (interview only).
 *   - `standard` — multi-file, single lane fits. spec → plan → architect → critic → plan-final.
 *   - `heavy`    — architectural, multi-lane, worktree split. spec → plan → pre-mortem →
 *                  architect → critic → lane-split → plan-final.
 *
 * Tier selection is request-shape driven (`tierFromRequest` below);
 * ambiguity above 0.20 forces `heavy` regardless of file count.
 */

export const BIZPLAN_HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

export type BizplanTier = "light" | "standard" | "heavy";

/**
 * Three roles of the bizplan lifecycle. Each role emits a self-
 * contained evidence block (body + artifactRef + ISO timestamp)
 * that downstream consumers can verify independently.
 */
export type BizplanRole = "planner" | "architect" | "critic";

export interface BizplanRoleEvidence {
  /** Markdown body or artifact descriptor for the role. */
  readonly body: string;
  /** Stable identifier (path, hash, or URI) of the artifact. */
  readonly artifactRef: string;
  /** ISO 8601 stamp the role finished. */
  readonly completedAt: string;
}

/**
 * A persisted bizplan plan. `phases` is required; `lanes` and
 * `worktreeStrategy` are only populated for multi-lane work
 * (tier `heavy`). `prdId` is the cross-reference to an open PRD
 * in `.ok/prds/` populated by `persistBizplanPlan`.
 */
export interface BizplanPlan {
  readonly id: string;
  readonly tier: BizplanTier;
  readonly title: string;
  readonly prdId?: string;
  readonly phases: ReadonlyArray<{
    readonly name: string;
    readonly owner: string;
    readonly evidence?: BizplanRoleEvidence;
  }>;
  readonly lanes?: ReadonlyArray<{
    readonly name: string;
    readonly owner: string;
    readonly worktreeBranch?: string;
  }>;
  readonly worktreeStrategy?: "single" | "split";
  readonly ambiguityScore?: number;
  readonly createdAt: string;
}

/**
 * The handoff record produced at the end of a `/bizplan` workflow.
 * Every field is optional at the type-system level because the
 * validator is the gate; callers SHOULD populate every field when
 * the corresponding role claimed completion. The legacy `_complete`
 * flag pair from the ralplan contract is gone — completion is now
 * inferred from the presence of a self-consistent evidence block.
 */
export interface BizplanHandoff {
  readonly schemaVersion?: string;
  /** Stable identifier for the originating workflow run. */
  readonly runId?: string;
  /** ISO 8601 timestamp the handoff was produced. */
  readonly producedAt?: string;
  /** Selected tier at handoff time. */
  readonly tier?: BizplanTier;

  readonly planner?: BizplanRoleEvidence;
  readonly architect?: BizplanRoleEvidence;
  readonly critic?: BizplanRoleEvidence;
}

/**
 * Discriminated-union result returned by `validateBizplanHandoff`.
 * On success the validated (default-populated) value is returned
 * so callers don't have to re-narrow. On failure `missing` lists
 * the dot-path of every required-but-absent or invalid field so
 * the operator can fix all at once.
 */
export type BizplanHandoffValidation =
  | { readonly ok: true; readonly value: BizplanHandoff }
  | { readonly ok: false; readonly missing: ReadonlyArray<string> };

export interface TierSelectionInput {
  /** Number of files the change is expected to touch. */
  readonly files: number;
  /** Whether the change alters observable behavior. */
  readonly behaviorChange: boolean;
  /** Number of concurrent owner lanes (worktree branches). */
  readonly lanes: number;
  /** Architecture blast radius. */
  readonly architectureImpact: "isolated" | "shared" | "cross-cutting";
  /** Ambiguity score in [0, 1] from the deep-interview spec. */
  readonly ambiguity: number;
}

/**
 * Pick a bizplan tier from a request-shape snapshot. The selection
 * rule is a strict if-else cascade:
 *
 *   1. `ambiguity > 0.20`                → `heavy`  (forces deep review)
 *   2. `files === 1 && !behaviorChange`  → `light`  (single-file, no churn)
 *   3. `lanes === 1 || impact == "isolated"` → `standard`
 *   4. otherwise                         → `heavy`
 *
 * The cascade is deliberately ordered so that ambiguity always wins,
 * then the cheap single-file fast path, then the default standard
 * tier, with `heavy` as the catch-all for architectural / multi-lane
 * requests.
 */
export function tierFromRequest(input: TierSelectionInput): BizplanTier {
  if (input.ambiguity > 0.20) return "heavy";
  if (input.files === 1 && input.behaviorChange === false) return "light";
  if (input.lanes === 1 || input.architectureImpact === "isolated") return "standard";
  return "heavy";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBizplanTier(value: unknown): value is BizplanTier {
  return value === "light" || value === "standard" || value === "heavy";
}

function validateRoleEvidence(role: BizplanRole, raw: unknown): ReadonlyArray<string> {
  const missing: string[] = [];
  if (raw === undefined) {
    // Absent role evidence is treated as "no claim made" — the role
    // did not run, so there is nothing to validate. Operators who
    // require the role must populate the evidence block explicitly.
    return Object.freeze(missing);
  }
  if (!isObject(raw)) {
    missing.push(`${role}.evidence`);
    return Object.freeze(missing);
  }
  const body = raw.body;
  const artifactRef = raw.artifactRef;
  const completedAt = raw.completedAt;
  if (typeof body !== "string" || body.length === 0) missing.push(`${role}.body`);
  if (typeof artifactRef !== "string" || artifactRef.length === 0) missing.push(`${role}.artifactRef`);
  if (!isIsoDate(completedAt)) missing.push(`${role}.completedAt`);
  return Object.freeze(missing);
}

/**
 * Validate a `BizplanHandoff` payload.
 *
 * Rules:
 *   - `schemaVersion`, when present, MUST equal
 *     `BIZPLAN_HANDOFF_SCHEMA_VERSION`. Missing is accepted for
 *     legacy compatibility; a present-but-mismatched value is
 *     rejected.
 *   - `tier`, when present, MUST be one of `"light" | "standard" | "heavy"`.
 *   - `producedAt`, when present, MUST be a valid ISO 8601 string.
 *   - Each of `planner | architect | critic` evidence blocks, when
 *     present, MUST be self-consistent (non-empty body, non-empty
 *     artifactRef, valid ISO completedAt).
 *   - An entirely empty handoff (`{}`) is accepted as an explicit
 *     "no claim made" terminal state.
 *
 * Returns `{ ok: false, missing: [...] }` listing the dot-path of
 * every violation so the operator can fix all at once. On success
 * returns `{ ok: true, value }` where `value` is the input with
 * `schemaVersion` defaulted to `BIZPLAN_HANDOFF_SCHEMA_VERSION`
 * if absent.
 */
export function validateBizplanHandoff(
  input: unknown,
): BizplanHandoffValidation {
  if (!isObject(input)) {
    return { ok: false, missing: Object.freeze(["root"]) };
  }

  const missing: string[] = [];

  const schemaVersion = input.schemaVersion;
  if (schemaVersion !== undefined) {
    if (
      typeof schemaVersion !== "string" ||
      schemaVersion !== BIZPLAN_HANDOFF_SCHEMA_VERSION
    ) {
      missing.push("schemaVersion");
    }
  }

  const tier = input.tier;
  if (tier !== undefined && !isBizplanTier(tier)) {
    missing.push("tier");
  }

  const producedAt = input.producedAt;
  if (producedAt !== undefined && !isIsoDate(producedAt)) {
    missing.push("producedAt");
  }

  const roles: ReadonlyArray<BizplanRole> = ["planner", "architect", "critic"];
  for (const role of roles) {
    const evidenceRaw = (input as Record<string, unknown>)[role];
    for (const path of validateRoleEvidence(role, evidenceRaw)) missing.push(path);
  }

  if (missing.length > 0) {
    return { ok: false, missing: Object.freeze(missing) };
  }

  const effectiveSchemaVersion: string =
    typeof schemaVersion === "string"
      ? schemaVersion
      : BIZPLAN_HANDOFF_SCHEMA_VERSION;

  const value: BizplanHandoff = {
    schemaVersion: effectiveSchemaVersion,
    ...(typeof input.runId === "string" ? { runId: input.runId } : {}),
    ...(typeof producedAt === "string" ? { producedAt } : {}),
    ...(isBizplanTier(tier) ? { tier } : {}),
    ...(input.planner !== undefined ? { planner: input.planner as BizplanRoleEvidence } : {}),
    ...(input.architect !== undefined ? { architect: input.architect as BizplanRoleEvidence } : {}),
    ...(input.critic !== undefined ? { critic: input.critic as BizplanRoleEvidence } : {}),
  };

  return { ok: true, value: Object.freeze(value) };
}

// ── Persistence (bizplan → .ok/plans/ + .ok/tasks/) ────────────────────────────

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PersistedPlan extends BizplanPlan {
  readonly persistedAt: string;
  readonly schemaVersion: string;
}

export interface SpawnedTask {
  readonly id: string;
  readonly planId: string;
  readonly status: "claimed";
  readonly assignedAt: string;
  readonly assignee?: string;
  readonly links: { readonly planId: string };
}

export interface PersistOptions {
  /** Absolute path to the `.ok/` workspace root. */
  readonly okDir: string;
  /** Optional override for the prd-scanner (testing). */
  readonly prdReader?: (okDir: string) => ReadonlyArray<{ id: string; status: string }>;
}

export interface SpawnOptions extends PersistOptions {
  readonly assignee?: string;
}

function generateId(prefix: "pln" | "tsk"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function atomicWrite(filePath: string, contents: string): void {
  const tmpPath = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmpPath, contents, "utf8");
  renameSync(tmpPath, filePath);
}

function defaultPrdReader(okDir: string): ReadonlyArray<{ id: string; status: string }> {
  const prdsDir = join(okDir, "prds");
  if (!existsSync(prdsDir)) return [];
  const out: Array<{ id: string; status: string }> = [];
  for (const name of readdirSync(prdsDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(prdsDir, name), "utf8")) as { id?: string; status?: string };
      if (parsed.id && parsed.status) out.push({ id: parsed.id, status: parsed.status });
    } catch {
      // ignore unparseable PRD
    }
  }
  return out;
}

/**
 * Persist a BizplanPlan to `.ok/plans/pln-<id>.json` and cross-reference
 * an open PRD from `.ok/prds/` if one matches the plan scope. Returns
 * the persisted record with `persistedAt` + `schemaVersion` populated.
 *
 * Atomic write-and-rename per DEC-022: writes to a `.tmp-<random>` file
 * first, then renames to the final path. The `.ok/plans/` directory is
 * created on demand. If multiple open PRDs match, `prdId` is left
 * unset and a warning is logged via `console.warn` — non-fatal.
 */
export function persistBizplanPlan(plan: BizplanPlan, opts: PersistOptions): PersistedPlan {
  if (!plan.title || typeof plan.title !== "string") {
    throw new Error("persistBizplanPlan: plan.title is required");
  }
  if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
    throw new Error("persistBizplanPlan: plan.phases must be a non-empty array");
  }

  const id = plan.id && plan.id.length > 0 ? plan.id : generateId("pln");
  const reader = opts.prdReader ?? defaultPrdReader;
  const openPrds = reader(opts.okDir).filter((p) => p.status === "open");
  let prdId = plan.prdId;
  if (!prdId) {
    if (openPrds.length === 1) {
      prdId = openPrds[0].id;
    } else if (openPrds.length > 1) {
      console.warn(
        `persistBizplanPlan: ${openPrds.length} open PRDs found; cross-ref left unset (plan=${id}). ` +
          `Specify plan.prdId explicitly to disambiguate.`,
      );
    }
  }

  const persistedAt = new Date().toISOString();
  const persisted: PersistedPlan = Object.freeze({
    ...plan,
    id,
    prdId,
    persistedAt,
    schemaVersion: BIZPLAN_HANDOFF_SCHEMA_VERSION,
  });

  const plansDir = join(opts.okDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  atomicWrite(join(plansDir, `${id}.json`), JSON.stringify(persisted, null, 2) + "\n");

  return persisted;
}

/**
 * Spawn an executor task under `.ok/tasks/` linked to the given plan.
 * The task is written with `status: "claimed"` so downstream autopilot
 * / ultragoal surfaces pick it up on the next turn without manual
 * routing.
 */
export function spawnExecutorTask(plan: BizplanPlan, opts: SpawnOptions): SpawnedTask {
  if (!plan.id) {
    throw new Error("spawnExecutorTask: plan.id is required (call persistBizplanPlan first)");
  }
  const id = generateId("tsk");
  const assignedAt = new Date().toISOString();
  const task: SpawnedTask = Object.freeze({
    id,
    planId: plan.id,
    status: "claimed",
    assignedAt,
    ...(opts.assignee ? { assignee: opts.assignee } : {}),
    links: Object.freeze({ planId: plan.id }),
  });

  const tasksDir = join(opts.okDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  atomicWrite(join(tasksDir, `${id}.json`), JSON.stringify(task, null, 2) + "\n");

  return task;
}
