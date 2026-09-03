/**
 * router/failover-mirror.mjs
 *
 * Pure-JavaScript mirror of `packages/sdk/src/router/failover.ts` for
 * direct Node loading (`node --test`, `bizar models explain`). This is
 * NOT a runtime import path for the SDK — the SDK ships the TypeScript
 * source — but the CLI is `mjs` and cannot import TS directly without a
 * build step. The mirror keeps the algorithm byte-identical:
 *
 *   - `defaultTierHintForId` regex set matches `cli/commands/models.mjs:defaultTierHint`
 *     and the SDK's `defaultTierHintForId` verbatim.
 *   - The eligible ranking rules mirror `rankUserSelectedForRole`'s sort
 *     key (`eligible desc, capabilityScore desc, hasProfile desc,
 *     originalIndex asc`).
 *   - `pickFailover` walks the eligible list, skips `attemptedIds`,
 *     applies the same transport/availability whitelist, and caps at
 *     one failover attempt.
 *
 * If `failover.ts` and `failover-mirror.mjs` ever diverge, the unit
 * tests in `cli/__tests__/models-picker.test.mjs` will fail with a
 * divergence diff.
 */

/**
 * Default tier classification for a model ID. Mirrors
 * `cli/commands/models.mjs:defaultTierHint` and
 * `packages/sdk/src/router/agent-model-registry.ts:defaultTierHintForId`
 * byte-for-byte. Most-specific patterns run first.
 */
export function defaultTierHintForId(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (!id) return "default";
  if (/(qwen3\.8|gpt-5|opus|o3-pro|o4-mini|sonnet-4)/.test(id)) return "premium";
  if (/(haiku-4|sonnet-3-7|mini-high|m3-high|grok-3|glm[-/]?5\.3[-/]?flash)/.test(id)) return "high";
  if (/(sonnet|gpt-4|m3(-|$)|(^|[^a-z])default($|[^a-z]))/.test(id)) return "default";
  if (/(nano|mini[-/]|flash|lite|tiny|haiku($|[-_]\d))/.test(id)) return "budget";
  return "mid";
}

/**
 * Weighted capability score, byte-identical to `scoreCapabilityProfile`.
 *   reasoning=0.3, toolCall=0.25, structuredOutput=0.15, attachment=0.1,
 *   temperature=0.05, +0.15 when `inputModalities` includes "image".
 * Missing/partial profiles score 0.
 */
export function scoreCapabilityProfile(profile) {
  if (!profile || !profile.capabilities) return 0;
  const caps = profile.capabilities;
  let score = 0;
  if (caps.reasoning) score += 0.3;
  if (caps.toolCall) score += 0.25;
  if (caps.structuredOutput) score += 0.15;
  if (caps.attachment) score += 0.1;
  if (caps.temperature) score += 0.05;
  if (Array.isArray(caps.inputModalities) && caps.inputModalities.includes("image")) score += 0.15;
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Mirror of `evaluateRoleRequirements`. Returns
 * `{ eligible, ineligibleReasons }`. Profiles missing the relevant data
 * (e.g., `null` context tokens) pass unknown-values — the resolver
 * only downgrades when a known value violates a floor.
 */
export function evaluateRoleRequirements(profile, requirements, tier) {
  const reasons = [];
  if (typeof requirements?.minContextTokens === "number" && profile?.limits && Number.isFinite(profile.limits.contextTokens) && profile.limits.contextTokens < requirements.minContextTokens) {
    reasons.push(`contextTokens ${profile.limits.contextTokens} < required ${requirements.minContextTokens}`);
  }
  if (requirements?.requireReasoning && profile?.capabilities && profile.capabilities.reasoning !== true) {
    reasons.push("missing required reasoning capability");
  }
  if (requirements?.requireToolCall && profile?.capabilities && profile.capabilities.toolCall !== true) {
    reasons.push("missing required tool-call capability");
  }
  if (requirements?.requireStructuredOutput && profile?.capabilities && profile.capabilities.structuredOutput !== true) {
    reasons.push("missing required structured-output capability");
  }
  if (requirements?.requireImageInput && profile?.capabilities && !(Array.isArray(profile.capabilities.inputModalities) && profile.capabilities.inputModalities.includes("image"))) {
    reasons.push("missing required image input modality");
  }
  if (Array.isArray(requirements?.preferredTiers) && requirements.preferredTiers.length > 0 && !requirements.preferredTiers.includes(tier)) {
    reasons.push(`tier ${tier} not in preferred list`);
  }
  return { eligible: reasons.length === 0, ineligibleReasons: reasons };
}

/**
 * F-190 / IMP-017 protocol-floor mirror. Byte-identical to
 * `protocolMeets` in `packages/sdk/src/router/model-profile.ts`. Returns
 * an array of strings describing each violated floor; empty when all
 * floors pass. The discriminator is the discriminated
 * `ModelProfile` shape; the legacy F-184 `ModelCapabilityProfile`
 * falls through to an empty array (legacy `evaluateRoleRequirements`
 * owns those floors).
 *
 * IMP-017 reject strings (mirrored):
 *   - `context-too-small: <actual> < <required>`
 *   - `no-tool-use`
 *   - `no-reasoning`
 *   - `no-structured-output`
 *   - `no-image-input`
 */
export function protocolMeetsMirror(discriminatedProfile, requirements) {
  if (!discriminatedProfile || typeof discriminatedProfile !== "object") return [];
  const protocol = discriminatedProfile.protocol;
  if (!protocol || typeof protocol !== "object") return [];
  const reasons = [];
  if (typeof requirements?.minContextTokens === "number" && Number.isFinite(protocol.contextTokens) && protocol.contextTokens < requirements.minContextTokens) {
    reasons.push(`context-too-small: ${protocol.contextTokens} < ${requirements.minContextTokens}`);
  }
  if (requirements?.requireToolCall === true && protocol.toolUse !== true) {
    reasons.push("no-tool-use");
  }
  if (requirements?.requireReasoning === true && protocol.reasoning !== true) {
    reasons.push("no-reasoning");
  }
  if (requirements?.requireStructuredOutput === true && protocol.structuredOutput !== true) {
    reasons.push("no-structured-output");
  }
  if (requirements?.requireImageInput === true && !(Array.isArray(protocol.modalities) && protocol.modalities.includes("image"))) {
    reasons.push("no-image-input");
  }
  return reasons;
}

/**
 * Rank user-selected models for a role. Byte-identical algorithm to
 * `packages/sdk/src/router/agent-model-registry.ts:rankUserSelectedForRole`.
 *
 * Sort key (descending primary, ascending tie-breaker):
 *   1. `eligible` desc
 *   2. `capabilityScore` desc
 *   3. `hasProfile` desc
 *   4. `originalIndex` asc
 *
 * @param {object} registry
 * @param {string} role
 * @param {object} [requirements]
 * @returns {{ ranked: object[], eligible: object[] }}
 */
export function rankUserSelectedForRole(registry, role, requirements = {}) {
  const userSelected = registry.userSelected;
  if (!userSelected || !Array.isArray(userSelected.models) || userSelected.models.length === 0) {
    return { ranked: [], eligible: [] };
  }
  const tierHints = userSelected.tierHints;
  const profiles = userSelected.profiles;
  const discriminatedProfiles = userSelected.discriminatedProfiles && typeof userSelected.discriminatedProfiles === "object"
    ? userSelected.discriminatedProfiles
    : {};
  const ranked = userSelected.models
    .map((id, originalIndex) => {
      const profile = profiles?.[id];
      const discriminatedProfile = discriminatedProfiles?.[id];
      const hasProfile = Boolean(profile) || Boolean(discriminatedProfile);
      const tier = (tierHints && typeof tierHints[id] === "string" ? tierHints[id] : defaultTierHintForId(id));
      const legacy = evaluateRoleRequirements(profile, requirements, tier);
      const protocolReasons = protocolMeetsMirror(discriminatedProfile, requirements);
      const ineligibleReasons = [...protocolReasons, ...legacy.ineligibleReasons];
      const eligible = ineligibleReasons.length === 0;
      const capabilityScore = scoreCapabilityProfile(profile);
      return {
        id,
        tier,
        eligible,
        ineligibleReasons,
        capabilityScore,
        hasProfile,
        originalIndex,
        ...(discriminatedProfile ? { discriminatedProfile, reasons: protocolReasons } : {}),
        ...(discriminatedProfile?.measured ? { measured: discriminatedProfile.measured } : {}),
        ...(discriminatedProfile?.provenance ? { provenance: discriminatedProfile.provenance } : {}),
      };
    });
  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;
    if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
    return a.hasProfile !== b.hasProfile ? (a.hasProfile ? -1 : 1) : 0;
  });
  // Tier-aware filtering (parity with the CLI's
  // resolveDispatchModel#hinted): narrow `eligible` to entries whose
  // tier hint matches the requested tier; fall back to the full eligible
  // ranking when no tier-matched candidate exists so a stale tierHints
  // map never strands a dispatch with no candidates at all.
  const tierMatched = role ? ranked.filter((entry) => entry.eligible && entry.tier === role) : ranked.filter((entry) => entry.eligible);
  const eligible = tierMatched.length > 0 ? tierMatched : ranked.filter((entry) => entry.eligible);
  return { ranked, eligible };
}

export const TRANSPORT_OR_AVAILABILITY = new Set([
  "invalid-model",
  "auth-failure",
  "rate-limit",
  "timeout",
  "provider-outage",
]);

/**
 * Walk the ranked eligible list and pick the next ID that has not been
 * attempted. Returns the same `FailoverVerdict` shape as the TS module.
 *
 *   - Non-transport reason → exhausts immediately (no failover).
 *   - First eligible ID already attempted → it stays as `primary`; the
 *     next un-attempted eligible ID becomes the failover.
 *   - One-failover cap. A second transport failure on the failover
 *     target marks subsequent entries as `exhausted` and refuses to walk.
 */
export function pickFailover({ registry, role, requirements, attemptedIds, failure, primaryDecisionId }) {
  const attempted = new Set((attemptedIds || []).filter((id) => typeof id === "string"));
  const routingDecisionId = typeof primaryDecisionId === "string" && primaryDecisionId.length > 0 ? primaryDecisionId : null;
  // IMP-020 / F-192: ordered list of attempted-and-failed IDs. The
  // learner updates only the FINAL model's posterior; the IMP-018
  // evidence store records per-attempt outcomes against this list. We
  // always populate it with the primary's id when the primary was
  // already attempted, and with subsequent attempted failover IDs.
  const failoverFrom = [];

  if (!TRANSPORT_OR_AVAILABILITY.has(failure)) {
    return {
      primary: null,
      failover: null,
      attempts: 0,
      exhaustReason: failure,
      chain: [{ id: "", eligible: false, capabilityScore: 0, attempted: false, outcome: "skipped-non-transport-reason" }],
      routingDecisionId,
      failoverFrom,
    };
  }

  const { eligible, ranked } = rankUserSelectedForRole(registry, role, requirements);
  if (ranked.length === 0) {
    return { primary: null, failover: null, attempts: 0, exhaustReason: failure, chain: [], routingDecisionId, failoverFrom };
  }

  const head = ranked[0];
  const chain = [{
    id: head.id,
    eligible: head.eligible,
    capabilityScore: head.capabilityScore,
    attempted: attempted.has(head.id),
    outcome: "primary",
  }];
  // IMP-020: if the primary was already attempted, it counts as a
  // failed-and-skipped ID in the `failoverFrom` list.
  if (attempted.has(head.id)) {
    failoverFrom.push(head.id);
  }
  const primary = { id: head.id, reason: failure };

  let failover = null;
  let exhaustedAtTopLevel = false;

  for (const entry of eligible) {
    if (entry.id === head.id) continue;
    if (attempted.has(entry.id)) {
      failoverFrom.push(entry.id);
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
      chain.push({
        id: entry.id,
        eligible: entry.eligible,
        capabilityScore: entry.capabilityScore,
        attempted: false,
        outcome: "exhausted",
      });
    }
  }

  if (failover === null) exhaustedAtTopLevel = true;

  return {
    primary,
    failover,
    attempts: attempted.size + (failover !== null ? 1 : 0),
    exhaustReason: exhaustedAtTopLevel ? failure : null,
    chain,
    routingDecisionId,
    failoverFrom,
  };
}

/**
 * Convenience classifier for the dispatch wrapper.
 */
export function classifyError(message) {
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
