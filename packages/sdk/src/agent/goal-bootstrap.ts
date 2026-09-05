/**
 * src/agent/goal-bootstrap.ts
 *
 * F-207 — Mike autonomous goal / ultragoal bootstrap.
 *
 * Exports:
 *   bootstrapGoal({ openKanDir?, features?, specsDir }) → BootstrapVerdict
 *   loadOpenKanSeeds({ openKanDir? }) → OpenKanSeed[]
 *   bootstrapGoalFromFile({ openKanDir?, featureListPath?, specsDir }) → verdict
 *   GoalBootstrapError
 *
 * On every SessionStart the `office-manager` agent (Mike) must either
 * resume an in-flight ultragoal charter or self-seed one for the next
 * `not_started` feature. The decision is a pure discriminated union so
 * the host hook and CLI can route on it without re-deriving the answer:
 *
 *   { action: "resume", id, source }
 *     — `docs/specs/ultragoal-<id>.md` already exists AND the feature
 *       with that id is non-passing (in_progress, blocked, …).
 *   { action: "bootstrap", id, charterPath }
 *     — no resume possible AND at least one `not_started` feature.
 *       Picks the smallest F-ID and writes the aggregate charter.
 *   { action: "idle" }
 *     — zero `not_started` features (all passing or no features).
 *
 * Charter format mirrors `config/skills/ultragoal/SKILL.md` aggregate
 * shape: single ledger, one weighted subgoal. The charter is the
 * durable artifact the orchestrator passes to `bizar goal start`
 * downstream; bootstrap must be cheap, idempotent, and read-only
 * outside `specsDir`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** Bumped when the on-disk charter shape changes in a breaking way. */
export const GOAL_BOOTSTRAP_SCHEMA_VERSION = "1.0.0" as const;

/** Feature states the bootstrap accepts as "non-passing". */
const NON_PASSING_STATES = new Set<string>([
  "in_progress",
  "blocked",
  "not_started",
  "review",
  "reviewing",
  "verifying",
  "executing",
  "planning",
  "checkpointing",
  "active",
]);

/** A minimal feature record the bootstrap reads from a seed (legacy feature_list.json or OpenKan PRDs/plans). */
export interface BootstrapFeature {
  readonly id: string;
  readonly title?: string;
  readonly behavior?: string;
  readonly description?: string;
  readonly state?: string;
  readonly category?: string;
  readonly layer?: string;
  readonly owner?: string;
}

/**
 * A seed derived from a single OpenKan PRD goal plus its plan
 * acceptance. The bootstrap converts these into `BootstrapFeature`
 * records so the existing decision logic (resume / bootstrap / idle)
 * works unchanged against either the legacy `feature_list.json` or
 * the live OpenKan workspace.
 */
export interface OpenKanSeed {
  /** Synthetic id used to key the charter (e.g. `prd-zxfjEL_3/g2`). */
  readonly id: string;
  /** Goal text from the PRD's `goals[]` entry. */
  readonly title: string;
  /** PRD goal id (e.g. `g2`). */
  readonly goalId: string;
  /** PRD id this goal belongs to. */
  readonly prdId: string;
  /** PRD goal status (`open` maps to `not_started` for the bootstrap). */
  readonly status: string;
  /** Plan acceptance items joined into a single behavior string. */
  readonly behavior: string;
  /** Plan ids that reference this PRD, used as `layer` hint. */
  readonly planIds: ReadonlyArray<string>;
  /** PRD-level owner if set. */
  readonly owner?: string;
}

export interface BootstrapGoalInput {
  /**
   * Optional parsed legacy `feature_list.json` (object form). Bootstrap
   * is read-only here. If omitted, the bootstrap reads from the OpenKan
   * workspace at `openKanDir`.
   */
  readonly features?: { features?: ReadonlyArray<BootstrapFeature> } & Record<string, unknown>;
  /**
   * Path to the OpenKan workspace. Defaults to `.ok` at the process
   * `cwd`. Ignored when `features` is provided.
   */
  readonly openKanDir?: string;
  /** Directory under which `ultragoal-<id>.md` will be created / detected. */
  readonly specsDir: string;
}

export type BootstrapVerdict =
  | { readonly action: "resume"; readonly id: string; readonly source: "spec" }
  | { readonly action: "bootstrap"; readonly id: string; readonly charterPath: string }
  | { readonly action: "idle" };

export class GoalBootstrapError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "GoalBootstrapError";
    this.code = code;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asFeatureArray(features: unknown): BootstrapFeature[] {
  if (!isPlainRecord(features)) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_FEATURES_MALFORMED",
      "features must be an object with a `features` array",
    );
  }
  const list = features.features;
  if (!Array.isArray(list)) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_FEATURES_MALFORMED",
      "features.features must be an array",
    );
  }
  return list as BootstrapFeature[];
}

function isFeature(value: unknown): value is BootstrapFeature {
  if (!isPlainRecord(value)) return false;
  return typeof value.id === "string" && value.id.length > 0;
}

function charterPathFor(id: string, specsDir: string): string {
  // OpenKan synthetic ids use `/` (e.g. `prd-zxfjEL_3/g2`); strip path
  // separators so the bootstrap always writes a flat file inside
  // `specsDir` and never creates nested directories.
  const safeId = id.replaceAll("/", "_").replaceAll("\\", "_");
  return join(specsDir, `ultragoal-${safeId}.md`);
}

function pickSmallestId(features: ReadonlyArray<BootstrapFeature>): string {
  // Sort by the F-NNN style numeric tail first; fall back to locale
  // compare so the bootstrap is deterministic when feature IDs are not
  // numeric.
  const sorted = [...features].sort((a, b) => {
    const an = a.id.match(/^[A-Za-z]+-?(\d+)$/);
    const bn = b.id.match(/^[A-Za-z]+-?(\d+)$/);
    if (an && bn) {
      return Number(an[1]) - Number(bn[1]);
    }
    return a.id.localeCompare(b.id);
  });
  const head = sorted[0];
  if (!head || typeof head.id !== "string" || head.id.length === 0) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_PICK_FAILED",
      "no not_started feature with a valid id was found",
    );
  }
  return head.id;
}

function findResumable(
  features: ReadonlyArray<BootstrapFeature>,
  specsDir: string,
): { id: string } | null {
  for (const feature of features) {
    const state = typeof feature.state === "string" ? feature.state : "";
    if (NON_PASSING_STATES.has(state) && existsSync(charterPathFor(feature.id, specsDir))) {
      return { id: feature.id };
    }
  }
  return null;
}

function findFirstNotStarted(features: ReadonlyArray<BootstrapFeature>): BootstrapFeature[] {
  return features.filter((f) => f.state === "not_started");
}

function ensureSpecsDir(specsDir: string): void {
  if (typeof specsDir !== "string" || specsDir.length === 0) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_SPECSDIR_REQUIRED",
      "specsDir must be a non-empty string",
    );
  }
  if (!isAbsolute(specsDir)) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_SPECSDIR_ABSOLUTE",
      `specsDir must be an absolute path; got: ${specsDir}`,
    );
  }
  if (!existsSync(specsDir)) {
    try {
      mkdirSync(specsDir, { recursive: true });
    } catch (err) {
      throw new GoalBootstrapError(
        "GOAL_BOOTSTRAP_MKDIR_FAILED",
        `could not create specsDir ${specsDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Render the aggregate-mode charter that `bizar goal start --mode
 * aggregate` consumes. The shape mirrors
 * `config/skills/ultragoal/SKILL.md` (aggregate: single ledger,
 * weighted subtasks; one weighted subgoal matching the chosen
 * feature). The skill is the source of truth for the lifecycle and
 * four-lane fence; bootstrap only emits the durable opening
 * artifact.
 */
export function renderAggregateCharter(input: {
  id: string;
  title: string;
  behavior: string;
  owner?: string;
  layer?: string;
  category?: string;
  schemaVersion?: string;
}): string {
  const version = input.schemaVersion ?? GOAL_BOOTSTRAP_SCHEMA_VERSION;
  return `# Ultragoal Charter — ${input.id}

> Generated by F-207 autonomous goal bootstrap. The lifecycle
> (planning → executing → verifying → reviewing → checkpointing →
> done, plus blocked non-terminal) and the four-lane completion fence
> (\`cleaner\`, \`verification\`, \`review\`,
> \`architecture_invariant\`) live in
> \`config/skills/ultragoal/SKILL.md\`. This charter is the durable
> opening artifact; steer it through \`bizar goal steer\` and never
> edit the ledger by hand.

## Mode

\`aggregate\` — single ledger at
\`docs/specs/ultragoal/${input.id}.jsonl\` with one weighted subgoal.
The run completes when the weighted sum of completed subgoals reaches
the configured \`completionThreshold\` (default: 1.0).

## Goal

${input.title}

${input.behavior}

${input.owner ? `Owner: ${input.owner}` : "Owner: (unassigned)"}
${input.layer ? `Layer: ${input.layer}` : ""}
${input.category ? `Category: ${input.category}` : ""}

## Non-goals

- Anything outside the feature's stated behavior.
- Re-scoping mid-run; a fresh run replaces an in-flight one.

## Subtasks (aggregate weights)

| Subgoal id | Weight | Summary |
|---|---|---|
| ${input.id} | 1.0 | Implement and ship feature ${input.id}. |

## Stop condition

The run reaches \`done\` only when the
\`bizar goal steer complete\` quality-gate JSON satisfies all four
lanes (\`cleaner\`, \`verification\`, \`review\`,
\`architecture_invariant\`) for this feature. Partial completion
stays at \`reviewing\` or \`checkpointing\`.

## Hard-approval carve-outs

The seven-category floor in \`AGENTS.md\` (push, pull-request
mutation, release, package publication, deployment,
production/shared-infrastructure writes, credential changes,
public exposure, irreversible destruction) remains enforced by
\`permission-request.mjs\` for every subgoal. The bootstrap is
read-only; this carve-out applies to every downstream agent.

## Provenance

- Schema version: ${version}
- Bootstrap: F-207 autonomous goal / ultragoal bootstrap
- Charter path: \`docs/specs/ultragoal-${input.id}.md\`
`;
}

/**
 * Decide whether to resume, bootstrap, or stay idle. The function is
 * pure with respect to the input — it only writes when bootstrap is
 * the chosen action. Throws `GoalBootstrapError` on malformed
 * features JSON or a charter-write failure so callers can surface a
 * clear error instead of silently skipping the bootstrap.
 */
export function bootstrapGoal(input: BootstrapGoalInput): BootstrapVerdict {
  // Explicit `features` payload wins (legacy callers). When omitted,
  // read the OpenKan workspace at `openKanDir` (default `.ok`).
  const seeds = input.features !== undefined
    ? asFeatureArray(input.features).filter(isFeature)
    : loadOpenKanSeeds({ openKanDir: input.openKanDir ?? ".ok" }).map(seedToFeature);
  ensureSpecsDir(input.specsDir);

  // 1. Resume path — a charter already on disk whose feature is still
  //    non-passing.
  const resumable = findResumable(seeds, input.specsDir);
  if (resumable) {
    return { action: "resume", id: resumable.id, source: "spec" };
  }

  // 2. Bootstrap path — at least one not_started feature, smallest id wins.
  const notStarted = findFirstNotStarted(seeds);
  if (notStarted.length === 0) {
    return { action: "idle" };
  }
  const id = pickSmallestId(notStarted);
  const head = notStarted.find((f) => f.id === id) ?? notStarted[0]!;
  const path = charterPathFor(id, input.specsDir);
  const body = renderAggregateCharter({
    id,
    title: typeof head.title === "string" ? head.title : id,
    behavior:
      typeof head.behavior === "string"
        ? head.behavior
        : typeof head.description === "string"
          ? head.description
          : `Ship feature ${id}.`,
    owner: typeof head.owner === "string" ? head.owner : undefined,
    layer: typeof head.layer === "string" ? head.layer : undefined,
    category: typeof head.category === "string" ? head.category : undefined,
  });
  try {
    writeFileSync(path, body, { encoding: "utf-8", mode: 0o644 });
  } catch (err) {
    throw new GoalBootstrapError(
      "GOAL_BOOTSTRAP_WRITE_FAILED",
      `could not write charter ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { action: "bootstrap", id, charterPath: path };
}

/**
 * Read every PRD under `.ok/prds/` and every plan under `.ok/plans/`,
 * then synthesize one `OpenKanSeed` per PRD goal. Plan acceptance
 * items are joined into the seed's `behavior` field so the existing
 * `bootstrapGoal` decision logic can route on them without parsing
 * OpenKan schemas itself. Returns an empty array when the workspace
 * is missing or unreadable so callers degrade to `idle`.
 */
export function loadOpenKanSeeds(input: { openKanDir?: string } = {}): OpenKanSeed[] {
  const root = input.openKanDir ?? ".ok";
  const prdDir = isAbsolute(root) ? join(root, "prds") : join(process.cwd(), root, "prds");
  const planDir = isAbsolute(root) ? join(root, "plans") : join(process.cwd(), root, "plans");
  const prds = readJsonDir(prdDir, "ok.prd.v1");
  const plans = readJsonDir(planDir, "ok.plan.v1");
  const prdIds = new Set(
    prds
      .map((prd) => (typeof prd.id === "string" ? prd.id : ""))
      .filter((id) => id.length > 0),
  );
  const plansByPrd = new Map<string, Array<{ acceptance: ReadonlyArray<string> }>>();
  for (const plan of plans) {
    const planId = typeof plan.id === "string" ? plan.id : null;
    if (!planId) continue;
    const acceptance = Array.isArray(plan.acceptance)
      ? plan.acceptance.map((line) => String(line))
      : [];
    // Plans reference tasks, not PRDs directly. Treat the plan as
    // supporting every PRD whose id appears in `prdIds` for now —
    // acceptance is PRD-agnostic and stays useful as behavior text.
    for (const prdId of prdIds) {
      const bucket = plansByPrd.get(prdId) ?? [];
      bucket.push({ acceptance });
      plansByPrd.set(prdId, bucket);
    }
  }
  const seeds: OpenKanSeed[] = [];
  for (const prd of prds) {
    const prdId = typeof prd.id === "string" ? prd.id : null;
    if (!prdId) continue;
    const ownerRaw = Array.isArray(prd.owners) ? prd.owners[0] : undefined;
    const owner = typeof ownerRaw === "string" ? ownerRaw : undefined;
    const plansForPrd = plansByPrd.get(prdId) ?? [];
    const planIds = plans
      .map((plan) => (typeof plan.id === "string" ? plan.id : ""))
      .filter((id) => id.length > 0);
    const behavior = plansForPrd
      .flatMap((entry) => entry.acceptance)
      .map((line) => `- ${line}`)
      .join("\n");
    const goals = Array.isArray(prd.goals) ? prd.goals : [];
    for (const goal of goals) {
      if (!isPlainRecord(goal)) continue;
      const status = typeof goal.status === "string" ? goal.status : "open";
      const goalId = typeof goal.id === "string" ? goal.id : "";
      const title = typeof goal.text === "string" ? goal.text : "";
      if (!goalId || !title) continue;
      seeds.push({
        id: `${prdId}/${goalId}`,
        title,
        goalId,
        prdId,
        status,
        behavior: behavior || `Implement and ship ${prdId}/${goalId}.`,
        planIds,
        owner,
      });
    }
  }
  return seeds;
}

function seedToFeature(seed: OpenKanSeed): BootstrapFeature {
  // Map OpenKan goal status onto the bootstrap's expected states.
  // `open` goals are candidates; everything else (closed, archived,
  // blocked, in_progress) is treated as non-passing for resume.
  const state = seed.status === "open" ? "not_started" : seed.status;
  return {
    id: seed.id,
    title: seed.title,
    behavior: seed.behavior,
    description: seed.title,
    state,
    category: seed.prdId,
    layer: seed.planIds[0],
    owner: seed.owner,
  };
}

function readJsonDir(dir: string, schema: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const records: Array<Record<string, unknown>> = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), "utf-8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isPlainRecord(parsed)) continue;
    if (parsed.schema !== schema) continue;
    records.push(parsed);
  }
  return records;
}

/**
 * Convenience helper for the SessionStart hook. Loads planning state
 * from `.ok/` (preferred) or the legacy `feature_list.json` and
 * runs `bootstrapGoal`. Returns the verdict on success; returns
 * `{ action: "idle" }` with `warning` set when the source is missing
 * or malformed so the hook can degrade gracefully without aborting
 * SessionStart.
 */
export function bootstrapGoalFromFile(input: {
  /** @deprecated Use `openKanDir` instead. Tolerated with a warning. */
  featureListPath?: string;
  /** Path to the OpenKan workspace. Defaults to `.ok` at the process `cwd`. */
  openKanDir?: string;
  specsDir: string;
}): { verdict: BootstrapVerdict; warning?: string } {
  if (input.featureListPath) {
    const legacyWarning = `featureListPath is deprecated; prefer openKanDir (.ok/) — see .ok/ task tsk-T1Aobcjj for the migration.`;
    let raw: string;
    try {
      raw = readFileSync(input.featureListPath, "utf-8");
    } catch (err) {
      return {
        verdict: { action: "idle" },
        warning: `${legacyWarning} feature_list.json not readable at ${input.featureListPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        verdict: { action: "idle" },
        warning: `${legacyWarning} feature_list.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!isPlainRecord(parsed)) {
      return {
        verdict: { action: "idle" },
        warning: `${legacyWarning} feature_list.json must be a JSON object`,
      };
    }
    try {
      return { verdict: bootstrapGoal({ features: parsed, specsDir: input.specsDir }), warning: legacyWarning };
    } catch (err) {
      if (err instanceof GoalBootstrapError) {
        return { verdict: { action: "idle" }, warning: `${legacyWarning} ${err.message}` };
      }
      return {
        verdict: { action: "idle" },
        warning: `${legacyWarning} ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  try {
    return { verdict: bootstrapGoal({ openKanDir: input.openKanDir ?? ".ok", specsDir: input.specsDir }) };
  } catch (err) {
    if (err instanceof GoalBootstrapError) {
      return { verdict: { action: "idle" }, warning: err.message };
    }
    return {
      verdict: { action: "idle" },
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}
