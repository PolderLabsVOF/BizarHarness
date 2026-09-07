/**
 * handoff/bizplan.ts — Bizplan handoff contract (bizplan-overhaul ultragoal).
 *
 * This file is a TEMPORARY STUB for the worktree build to succeed in
 * isolation. The canonical bizplan.ts is owned by Stream A (todd) under
 * subtask `sdk-bizplan-contract` and `sdk-bizplan-persistence`; the
 * worktree-merge will resolve this file in favor of Stream A's version.
 *
 * Stream A's contract (per the charter + ledger revision 13):
 *   - BIZPLAN_HANDOFF_SCHEMA_VERSION: "1.0.0"
 *   - Types: BizplanTier, BizplanRole, BizplanRoleEvidence, BizplanPlan,
 *     BizplanHandoff, TierSelectionInput
 *   - Functions: tierFromRequest(), validateBizplanHandoff(),
 *     persistBizplanPlan(), spawnExecutorTask()
 *
 * MCP tools in `packages/sdk/src/mcp/server.ts` import the contract
 * names from this module; the merge must keep those names stable.
 */

export const BIZPLAN_HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

export type BizplanTier = "light" | "standard" | "heavy";

export type BizplanRole = "planner" | "architect" | "critic";

export interface BizplanRoleEvidence {
  verdict?: string;
  artifact?: string;
  notes?: string;
  [k: string]: unknown;
}

export interface BizplanPlan {
  id?: string;
  tier: BizplanTier;
  goal: string;
  prdLink?: string | null;
  lanes?: string[];
  worktreeStrategy?: string;
  [k: string]: unknown;
}

export interface BizplanHandoff {
  schemaVersion: typeof BIZPLAN_HANDOFF_SCHEMA_VERSION;
  tier: BizplanTier;
  planner_complete: boolean;
  architect_complete: boolean;
  critic_complete: boolean;
  planner?: BizplanRoleEvidence;
  architect?: BizplanRoleEvidence;
  critic?: BizplanRoleEvidence;
  [k: string]: unknown;
}

export interface TierSelectionInput {
  files: number;
  behaviorChange?: boolean;
  lanes?: number;
  architectureImpact?: "isolated" | "shared" | "architectural";
  ambiguity?: number | null;
  hasOpenPrd?: boolean;
  tier?: BizplanTier;
}

export function tierFromRequest(input: TierSelectionInput): BizplanTier | null {
  if (typeof input.ambiguity === "number" && input.ambiguity > 0.10 && input.files > 1) {
    if (input.ambiguity > 0.20) return "heavy";
    if (input.tier === undefined) return "standard";
  }
  if (input.files === 1 && input.behaviorChange === false) return "light";
  if ((input.lanes ?? 1) === 1 || input.architectureImpact === "isolated") return "standard";
  return "heavy";
}

export type BizplanHandoffValidation =
  | { ok: true }
  | { ok: false; missing: readonly string[] };

export function validateBizplanHandoff(input: unknown): BizplanHandoffValidation {
  const missing: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, missing: ["root"] };
  }
  const obj = input as Record<string, unknown>;
  if (obj.schemaVersion !== BIZPLAN_HANDOFF_SCHEMA_VERSION) missing.push("schemaVersion");
  if (!["light", "standard", "heavy"].includes(String(obj.tier))) missing.push("tier");
  for (const role of ["planner_complete", "architect_complete", "critic_complete"] as const) {
    if (obj[role] !== true && obj[role] !== false) missing.push(role);
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing: Object.freeze([...missing]) };
}

export interface BizplanPersistResult {
  ok: true;
  planId: string;
  path: string;
}

export function persistBizplanPlan(_handoff: BizplanHandoff | BizplanPlan): BizplanPersistResult {
  // STUB: canonical implementation owned by Stream A (sdk-bizplan-persistence).
  // The MCP tool surface never reaches this stub in production; the
  // worktree merge resolves this file to Stream A's canonical version.
  const planId = `pln-stub-${Date.now()}`;
  return { ok: true, planId, path: `.ok/plans/${planId}.json` };
}

export interface BizplanSpawnTaskResult {
  ok: true;
  taskId: string;
  path: string;
}

export function spawnExecutorTask(_plan: BizplanPlan, _assignee?: string): BizplanSpawnTaskResult {
  // STUB: canonical implementation owned by Stream A (sdk-bizplan-persistence).
  const taskId = `tsk-stub-${Date.now()}`;
  return { ok: true, taskId, path: `.ok/tasks/${taskId}.json` };
}
