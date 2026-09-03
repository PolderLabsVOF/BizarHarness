/**
 * handoff/ralplan.ts — Ralplan handoff contract (F-203, Phase 1 OMX adoption).
 *
 * When a `/ralplan` workflow finishes, the orchestrator hands off a
 * JSON document to the next autonomy surface (autopilot, ultragoal,
 * or a hand-rolled executor). The contract is intentionally small:
 *
 *   - The planner, architect, and critic each have a `complete` flag.
 *   - If a `complete` flag is `true`, the matching evidence object
 *     (planner/architect/critic artifact) MUST be present and
 *     self-consistent.
 *   - All three `complete: false` is also a valid terminal state —
 *     it means "no claim was made, do not trust this handoff for
 *     downstream execution". Downstream consumers reject that with
 *     a non-zero `missing` list so the operator can re-route.
 *
 * The validation is deliberately framework-free: callers in any
 * environment (SDK, CLI, MCP server, hook) can pass a plain object
 * in and get a discriminated-union result back. We do not import
 * a schema library at the SDK layer; the contract IS the shape.
 */

export const RALPLAN_HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Three roles of the ralplan lifecycle. The presence of `complete`
 * is the per-role ready-to-ship signal.
 */
export type RalplanRole = "planner" | "architect" | "critic";

export interface RalplanRoleEvidence {
  /** Markdown body or artifact descriptor for the role. */
  readonly body: string;
  /** Stable identifier (path, hash, or URI) of the artifact. */
  readonly artifactRef: string;
  /** ISO 8601 stamp the role finished. */
  readonly completedAt: string;
}

/**
 * The handoff record produced at the end of a `/ralplan` workflow.
 * Every field is optional at the type-system level because the
 * validator is the gate; callers SHOULD populate every field when
 * the corresponding role claimed completion.
 */
export interface RalplanHandoff {
  readonly schemaVersion?: string;
  /** Stable identifier for the originating workflow run. */
  readonly runId?: string;
  /** ISO 8601 timestamp the handoff was produced. */
  readonly producedAt?: string;

  readonly planner_complete?: boolean;
  readonly architect_complete?: boolean;
  readonly critic_complete?: boolean;

  readonly planner?: RalplanRoleEvidence;
  readonly architect?: RalplanRoleEvidence;
  readonly critic?: RalplanRoleEvidence;

  /** Optional deliberate-mode flag — `true` when the orchestrator
   *  required the planner→architect→critic loop. */
  readonly deliberate?: boolean;
  /** Optional advisory mode — `true` when orchestrator bypassed
   *  the loop after the user opted out via `force:` or matched
   *  context anchors. */
  readonly advisory?: boolean;
}

export type RalplanHandoffValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: ReadonlyArray<string> };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateEvidence(role: RalplanRole, raw: unknown): ReadonlyArray<string> {
  const missing: string[] = [];
  if (raw === undefined) {
    missing.push(`${role}.body`, `${role}.artifactRef`, `${role}.completedAt`);
    return Object.freeze(missing);
  }
  if (!isObject(raw)) {
    missing.push(`${role}.evidence`);
    return Object.freeze(missing);
  }
  const body = (raw as Record<string, unknown>).body;
  const artifactRef = (raw as Record<string, unknown>).artifactRef;
  const completedAt = (raw as Record<string, unknown>).completedAt;
  if (typeof body !== "string" || body.length === 0) missing.push(`${role}.body`);
  if (typeof artifactRef !== "string" || artifactRef.length === 0) missing.push(`${role}.artifactRef`);
  if (!isIsoDate(completedAt)) missing.push(`${role}.completedAt`);
  return Object.freeze(missing);
}

/**
 * Validate a `RalplanHandoff` payload.
 *
 * Rules:
 *   - `schemaVersion` MUST match `RALPLAN_HANDOFF_SCHEMA_VERSION`
 *     when present (missing is accepted as legacy compatibility,
 *     but `1.x.y` with non-matching patch is rejected).
 *   - If any of `planner_complete | architect_complete | critic_complete`
 *     is `true`, the matching `planner | architect | critic` evidence
 *     block MUST be present and self-consistent.
 *   - All three `false` (or all missing) is treated as an explicit
 *     "no claim made" handoff and accepted (`ok: true`).
 *
 * Returns `{ ok: false, missing: [...] }` on the first set of
 * violations; `missing` lists the path of every required-but-absent
 * or invalid field so the operator can fix all at once.
 */
export function validateRalplanHandoff(
  input: unknown,
): RalplanHandoffValidation {
  if (!isObject(input)) {
    return { ok: false, missing: ["root"] };
  }

  const missing: string[] = [];

  const schemaVersion = (input as Record<string, unknown>).schemaVersion;
  if (schemaVersion !== undefined) {
    if (typeof schemaVersion !== "string" || schemaVersion !== RALPLAN_HANDOFF_SCHEMA_VERSION) {
      missing.push("schemaVersion");
    }
  }

  const roles: ReadonlyArray<RalplanRole> = ["planner", "architect", "critic"];
  for (const role of roles) {
    const complete = (input as Record<string, unknown>)[`${role}_complete`];
    if (complete === true) {
      const evidenceRaw = (input as Record<string, unknown>)[role];
      for (const path of validateEvidence(role, evidenceRaw)) missing.push(path);
    } else if (complete !== undefined && typeof complete !== "boolean") {
      missing.push(`${role}_complete`);
    }
  }

  return missing.length === 0
    ? { ok: true }
    : { ok: false, missing: Object.freeze(missing) };
}
