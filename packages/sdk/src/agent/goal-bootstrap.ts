/**
 * src/agent/goal-bootstrap.ts
 *
 * F-207 — Mike autonomous goal / ultragoal bootstrap.
 *
 * Exports:
 *   bootstrapGoal({ features, specsDir }) → BootstrapVerdict
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** A minimal feature record the bootstrap reads from `feature_list.json`. */
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

export interface BootstrapGoalInput {
  /** Parsed `feature_list.json` (object form). Bootstrap is read-only here. */
  readonly features: { features?: ReadonlyArray<BootstrapFeature> } & Record<string, unknown>;
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
  return join(specsDir, `ultragoal-${id}.md`);
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
  const list = asFeatureArray(input.features).filter(isFeature);
  ensureSpecsDir(input.specsDir);

  // 1. Resume path — a charter already on disk whose feature is still
  //    non-passing.
  const resumable = findResumable(list, input.specsDir);
  if (resumable) {
    return { action: "resume", id: resumable.id, source: "spec" };
  }

  // 2. Bootstrap path — at least one not_started feature, smallest id wins.
  const notStarted = findFirstNotStarted(list);
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
 * Convenience helper for the SessionStart hook. Loads
 * `feature_list.json` from disk, resolves `docs/specs/`, and runs
 * `bootstrapGoal`. Returns the verdict on success; returns
 * `{ action: "idle" }` with `warning` set when the file is missing
 * or malformed so the hook can degrade gracefully without aborting
 * SessionStart.
 */
export function bootstrapGoalFromFile(input: {
  featureListPath: string;
  specsDir: string;
}): { verdict: BootstrapVerdict; warning?: string } {
  let raw: string;
  try {
    raw = readFileSync(input.featureListPath, "utf-8");
  } catch (err) {
    return {
      verdict: { action: "idle" },
      warning: `feature_list.json not readable at ${input.featureListPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      verdict: { action: "idle" },
      warning: `feature_list.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isPlainRecord(parsed)) {
    return {
      verdict: { action: "idle" },
      warning: "feature_list.json must be a JSON object",
    };
  }
  try {
    return { verdict: bootstrapGoal({ features: parsed, specsDir: input.specsDir }) };
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
