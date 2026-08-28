/**
 * router/failover.ts — Health-aware selected-pool failover (F-185 / IMP-019).
 *
 * Picker picks survive gateway outages only if the dispatch layer can
 * distinguish "model is wrong" from "transport failed" and walk to the
 * next eligible user-selected ID. This module owns that decision:
 *
 *   - `FailureReason` enumerates every category the dispatch surface may
 *     surface (transport vs. correctness vs. operator-misconfig). The
 *     taxonomy is stable; adding a new reason requires updating the
 *     `TRANSPORT_OR_AVAILABILITY` whitelist here AND the audit doc.
 *   - `FailoverVerdict` is the audit trail returned to the orchestrator
 *     and the telemetry layer: the primary selection, the chosen failover
 *     candidate (or `null` when none eligible), the running attempt count,
 *     and the chain of considered candidates with their outcomes.
 *   - `pickFailover` is the deterministic next-candidate walker. It calls
 *     `rankUserSelectedForRole` to derive the failover chain, skips any
 *     ID already in `attemptedIds`, and applies the whitelist. It caps
 *     the chain at one new failover attempt — once the orchestrator has
 *     tried both the primary and the failover, the chain is exhausted
 *     and any further failure must surface to the user.
 *
 * No alias cycling. No random picks. No retry of the same failed request.
 */

import {
  rankUserSelectedForRole,
  type ModelRegistry,
  type RankedUserSelectedEntry,
  type RoleRequirements,
} from "./agent-model-registry.js";
import {
  type EvidenceStore,
} from "./dispatch-evidence.js";
import type {
  ModelDecision,
  TaskFeatures,
  ModelCandidate,
  BudgetState,
  ProviderHealthMap,
} from "./select-dispatch-model.js";
import type { BizarTier } from "./agent-model-registry.js";

function deriveTierForId(id: string): BizarTier {
  const lower = String(id ?? "").toLowerCase();
  if (/opus|premium/.test(lower)) return "premium";
  if (/sonnet|high/.test(lower)) return "high";
  if (/haiku|mid-design|design/.test(lower)) return "mid-design";
  if (/mini|small/.test(lower)) return "default";
  if (/flash|mid/.test(lower)) return "mid";
  if (/nano|cheap|budget/.test(lower)) return "budget";
  return "default";
}

/**
 * Closed taxonomy of dispatch-time failure modes. The names are stable
 * wire-level identifiers: the dispatch wrapper classifies each failure
 * into exactly one of these strings before calling `pickFailover`.
 */
export type FailureReason =
  | "invalid-model"
  | "auth-failure"
  | "rate-limit"
  | "timeout"
  | "context-overflow"
  | "provider-outage"
  | "model-quality";

/**
 * Whitelist of reasons that may trigger a deterministic failover. A
 * different model is unlikely to fix `context-overflow` (the prompt is
 * too large regardless of provider) or `model-quality` (re-selection
 * with tighter requirements is the fix, not failover), so those two
 * reasons are explicitly NOT eligible.
 */
export const TRANSPORT_OR_AVAILABILITY: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "invalid-model",
  "auth-failure",
  "rate-limit",
  "timeout",
  "provider-outage",
]);

/**
 * Per-candidate record emitted by `pickFailover`. The `attempted` flag
 * is true for entries that were tried by the dispatch surface; `outcome`
 * carries the deterministic verdict the orchestrator should record.
 *
 * Outcomes:
 *   - `primary` — the original (ranked[0]) candidate the orchestrator
 *     dispatched; either before or after the failure the caller passed
 *     in via `attemptedIds`.
 *   - `failover` — the new candidate `pickFailover` is returning for
 *     the next dispatch. At most one per verdict.
 *   - `skipped-already-attempted` — eligible candidate that the caller
 *     already tried (was in `attemptedIds`). Not a valid failover target.
 *   - `skipped-non-transport-reason` — synthetic record emitted when the
 *     caller passed a non-transport reason (the whitelist refused).
 *   - `exhausted` — chain could not pick a failover because every
 *     eligible candidate was already attempted (the 1-failover cap was
 *     reached). The verdict's `exhaustReason` carries the same flag at
 *     the top level.
 */
export interface FailoverChainEntry {
  id: string;
  eligible: boolean;
  capabilityScore: number;
  attempted: boolean;
  outcome: "primary" | "failover" | "skipped-already-attempted" | "skipped-non-transport-reason" | "exhausted";
}

/**
 * Audit record returned by `pickFailover`. `chain` is the full walk
 * over the eligible ranking (including entries skipped because they
 * were already attempted) so the telemetry layer can reconstruct the
 * decision without re-running the resolver.
 */
export interface FailoverVerdict {
  primary: { id: string; reason: FailureReason } | null;
  failover: { id: string; reason: FailureReason } | null;
  attempts: number;
  exhaustReason: FailureReason | null;
  chain: FailoverChainEntry[];
  /**
   * The F-188 routing decision ID for the primary selection, threaded
   * from `PickFailoverInput.primaryDecisionId` so the audit trail ties
   * the failover back to the originating selector decision. `null` when
   * the caller did not supply a pre-decided ID (legacy behaviour).
   */
  routingDecisionId: string | null;
}

export interface PickFailoverInput {
  registry: ModelRegistry;
  role: string;
  requirements?: RoleRequirements;
  attemptedIds: readonly string[];
  failure: FailureReason;
  /**
   * Optional pre-decided routing decision ID minted by the F-188 central
   * selector (`selectDispatchModel`). When supplied, the value is
   * surfaced on the returned `FailoverVerdict.routingDecisionId` so the
   * F-185 audit trail and downstream telemetry can correlate the
   * failover with the originating dispatch decision. When omitted, the
   * verdict uses `null` (legacy behaviour preserved).
   */
  primaryDecisionId?: string;
  /**
   * F-191 / IMP-018 evidence store. When supplied AND a failover
   * candidate is found, a follow-up `DispatchEvidence` row is appended
   * carrying the same `routingDecisionId` as the primary decision plus
   * a failover description on the decision object. When omitted, the
   * verdict is returned without an evidence write (legacy callers,
   * tests, and the F-185 dry-run path).
   */
  evidenceStore?: EvidenceStore;
  /** Required when `evidenceStore` is supplied; reused as the audit run id. */
  runId?: string;
  agentName?: string;
  workflowPhase?: string;
  taskFeatures?: TaskFeatures;
  selectedProfiles?: readonly ModelCandidate[];
  staticProfiles?: readonly ModelCandidate[];
  activeSessionModel?: string;
  budget?: BudgetState;
  health?: ProviderHealthMap;
}

/**
 * Pick the next eligible user-selected ID for a transport/availability
 * failure. Deterministic: the first eligible entry in
 * `rankUserSelectedForRole(registry, role).eligible` that has not been
 * tried yet wins.
 *
 * Behaviour matrix:
 *
 *   - Non-transport reason (`context-overflow`, `model-quality`) →
 *     return `exhaustReason: failure, failover: null`. Failover is the
 *     wrong tool; the orchestrator should re-select or surface the
 *     failure. A single synthetic chain entry with outcome
 *     `skipped-non-transport-reason` is emitted so the audit trail is
 *     never empty.
 *   - No `userSelected.models` → return `exhaustReason: failure, failover: null, chain: []`.
 *   - First eligible ID already attempted, no other eligible → return
 *     `exhaustReason: failure, failover: null`. `attempts` reflects the
 *     number of IDs the orchestrator has already tried.
 *   - First eligible ID not attempted → that ID is the primary AND the
 *     failover (the caller hasn't dispatched yet). `attempts` stays 0
 *     because no transport failure has happened.
 *   - First eligible ID attempted, second eligible ID not attempted →
 *     second ID becomes the failover. `attempts` becomes
 *     `attemptedIds.length + 1`. `exhaustReason: null` (we have not
 *     exhausted the chain).
 *
 * The function never throws; it returns a verdict so the dispatch
 * surface can `process.stdout.write(JSON.stringify(verdict))` and exit.
 */
export function pickFailover(input: PickFailoverInput): FailoverVerdict {
  const { registry, role, requirements, attemptedIds, failure, primaryDecisionId } = input;
  const attempted = new Set<string>(attemptedIds.filter((id): id is string => typeof id === "string"));
  const routingDecisionId = typeof primaryDecisionId === "string" && primaryDecisionId.length > 0 ? primaryDecisionId : null;

  if (!TRANSPORT_OR_AVAILABILITY.has(failure)) {
    return {
      primary: null,
      failover: null,
      attempts: 0,
      exhaustReason: failure,
      chain: [{ id: "", eligible: false, capabilityScore: 0, attempted: false, outcome: "skipped-non-transport-reason" }],
      routingDecisionId,
    };
  }

  const { eligible, ranked } = rankUserSelectedForRole(registry, role, requirements);
  if (ranked.length === 0) {
    return { primary: null, failover: null, attempts: 0, exhaustReason: failure, chain: [], routingDecisionId };
  }

  // The orchestrator's first dispatch is the ranked[0] entry. Record it
  // as the chain's `primary` regardless of whether the caller pre-tried
  // it; that history is what `attempted` carries.
  const head = ranked[0];
  const chain: FailoverChainEntry[] = [
    {
      id: head.id,
      eligible: head.eligible,
      capabilityScore: head.capabilityScore,
      attempted: attempted.has(head.id),
      outcome: "primary",
    },
  ];
  const primary: FailoverVerdict["primary"] = { id: head.id, reason: failure };

  // Walk the eligible list past the primary, looking for the first
  // candidate that is not in `attempted`. The very first such entry
  // becomes the failover. Everything past it is silently ignored — the
  // 1-failover cap means we never surface more than one candidate to the
  // caller in a single verdict.
  let failover: FailoverVerdict["failover"] = null;
  let exhaustedAtTopLevel = false;

  for (const entry of eligible) {
    if (entry.id === head.id) continue;
    if (attempted.has(entry.id)) {
      chain.push({
        id: entry.id,
        eligible: entry.eligible,
        capabilityScore: entry.capabilityScore,
        attempted: true,
        outcome: "skipped-already-attempted",
      });
      continue;
    }
    if (failover === null) {
      failover = { id: entry.id, reason: failure };
      chain.push({
        id: entry.id,
        eligible: entry.eligible,
        capabilityScore: entry.capabilityScore,
        attempted: false,
        outcome: "failover",
      });
    } else {
      // We already returned a failover for this verdict. Per the 1-failover
      // cap we do not walk further; the candidate is unreachable from this
      // call. Mark the entry so the audit trail still reflects it.
      chain.push({
        id: entry.id,
        eligible: entry.eligible,
        capabilityScore: entry.capabilityScore,
        attempted: false,
        outcome: "exhausted",
      });
    }
  }

  if (failover === null) {
    // Either every eligible entry was already attempted, or the head
    // was the only eligible entry. Either way the chain is exhausted
    // at the verdict level.
    exhaustedAtTopLevel = true;
  }

  const verdict: FailoverVerdict = {
    primary,
    failover,
    attempts: attempted.size + (failover !== null ? 1 : 0),
    exhaustReason: exhaustedAtTopLevel ? failure : null,
    chain,
    routingDecisionId,
  };

  // F-191 / IMP-018: when a failover was actually picked AND the
  // caller supplied an evidence store + the canonical inputs, append
  // a follow-up `DispatchEvidence` row tied to the primary decision.
  // The follow-up row carries the same `routingDecisionId` so the
  // audit trail is grouped by dispatch; the decision's modelId is
  // the failover candidate. The store distinguishes follow-ups from
  // primary rows by sequence number, so duplicate-id semantics are
  // preserved.
  if (
    verdict.failover !== null
    && routingDecisionId !== null
    && input.evidenceStore
    && typeof input.runId === "string"
    && input.taskFeatures
  ) {
    const failoverDecision: ModelDecision = {
      modelId: verdict.failover.id,
      tier: deriveTierForId(verdict.failover.id) as BizarTier,
      confidence: 0.7,
      ineligibleReasons: [],
      routingDecisionId,
      reason: `failover:${failure}`,
      fallbackChain: chain.map((entry) => entry.id).filter((id) => Boolean(id)),
    };
    void input.evidenceStore.append({
      routingDecisionId,
      decision: failoverDecision,
      taskFeatures: input.taskFeatures,
      runId: input.runId,
      agentName: input.agentName,
      workflowPhase: input.workflowPhase,
      selectedProfiles: [...(input.selectedProfiles ?? [])],
      staticProfiles: [...(input.staticProfiles ?? [])],
      activeSessionModel: input.activeSessionModel,
      budget: input.budget ?? {},
      health: input.health ?? {},
    });
  }

  return verdict;
}

/**
 * Convenience helper: classify a wire-level error into a `FailureReason`.
 * Intended for dispatch wrappers that need a stable mapping; the
 * wrapper may still pass through an explicit `FailureReason` from the
 * provider's response metadata.
 */
export function classifyError(message: string): FailureReason {
  const m = String(message || "").toLowerCase();
  if (!m) return "invalid-model";
  if (/(context.*length|context.*overflow|context.*window|too long|maximum context)/.test(m)) return "context-overflow";
  if (/(429|rate.?limit|too many requests|quota)/.test(m)) return "rate-limit";
  if (/(401|403|unauthorized|forbidden|auth.?token|invalid.*api.*key)/.test(m)) return "auth-failure";
  if (/(timeout|timed out|etimedout|aborted|deadline)/.test(m)) return "timeout";
  if (/(502|503|504|bad gateway|service unavailable|gateway timeout|provider outage|upstream)/.test(m)) return "provider-outage";
  if (/(invalid.*model|unknown.*model|model not found|no such model|not a valid model)/.test(m)) return "invalid-model";
  if (/(quality|incomplete|truncated|garbage|low quality|incoherent)/.test(m)) return "model-quality";
  return "invalid-model";
}

/**
 * Re-export the ranking entry type so consumers do not need to import
 * from `agent-model-registry.ts` directly.
 */
export type { RankedUserSelectedEntry };