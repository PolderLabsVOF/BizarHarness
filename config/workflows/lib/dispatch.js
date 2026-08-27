/**
 * config/workflows/lib/dispatch.js — Workflow-side dispatch wrapper (F-189 / IMP-014).
 *
 * Closes the IMP-014 P0 gap from `IMPROVEMENTS.md` line 867: every
 * `agent(...)` call emitted by native workflow scripts (`config/workflows/*.js`)
 * MUST route through `selectDispatchModel` so the recorded model + `routingDecisionId`
 * ride on every dispatch. The acceptance gate is verbatim: "Captured nested
 * Agent payloads contain expected models."
 *
 * This module is the single entry point for workflow-side dispatch. It:
 *
 *   1. Reads the operator's `userSelected.profiles`, the provider-health
 *      snapshot, and the budget from the canonical config paths.
 *   2. Embeds a JS mirror of `packages/sdk/src/router/select-dispatch-model.ts`
 *      so the workflow runtime does not require an SDK build step. The
 *      mirror matches the canonical algorithm verbatim — see
 *      `__tests__/dispatch.test.mjs` for the divergence test.
 *   3. Wraps the runtime's `agent(...)` primitive so every dispatch
 *      records `model`, `routingDecisionId`, and `tier` alongside the
 *      agent payload.
 *   4. Supports `dryRun: true` so the capture test can introspect
 *      payloads without invoking a real agent.
 *
 * IMPORTANT: every workflow script in `config/workflows/*.js` MUST import
 * `dispatchAgent` from this module. The drift guard
 * `scripts/__tests__/autonomy-contract-workflow.test.mjs` fails CI when a
 * bare `agent(` call is reintroduced without a documented bypass.
 */

import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const { O_APPEND, O_CREAT, O_WRONLY } = fsConstants;

/* ────────────────────────────────────────────────────────────────────────── */
/*                         JS mirror of selectDispatchModel                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Tier strength ordering — strongest first. Mirrors
 * `packages/sdk/src/router/select-dispatch-model.ts:TIER_STRENGTH`.
 */
const TIER_STRENGTH = ['premium', 'high', 'mid-design', 'default', 'mid', 'budget'];

/**
 * Tier cheapness ordering — cheapest first. Mirrors
 * `packages/sdk/src/router/select-dispatch-model.ts:TIER_CHEAPNESS`.
 */
const TIER_CHEAPNESS = ['budget', 'mid', 'default', 'mid-design', 'high', 'premium'];

/**
 * Roles that must never downgrade. Mirrors `NEVER_DOWNGRADE_ROLES` in
 * the canonical TS source.
 */
const NEVER_DOWNGRADE_ROLES = new Set([
  'security',
  'architecture',
  'adversarial',
  'audit',
  'karen',
]);

/**
 * Canonical reason strings — surface in audit trails and tests.
 */
export const REASON = {
  EXACT: 'exact-capability',
  NEXT_STRONGER: 'next-stronger',
  STRONGEST_RISK_HIGH: 'strongest-healthy-risk-high',
  STRONGEST_NEVER_DOWNGRADE: 'strongest-healthy-never-downgrade',
  CHEAPEST_RISK_LOW: 'cheapest-healthy-risk-low',
  SESSION_INHERIT: 'session-inherit',
  NO_ELIGIBLE: 'no-eligible-selected',
};

/**
 * Default tier classification (heuristic). Mirrors
 * `packages/sdk/src/router/agent-model-registry.ts:defaultTierHintForId`.
 * Most-specific patterns first.
 */
function defaultTierHintForId(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return 'default';
  if (/(qwen3\.8|gpt-5|opus|o3-pro|o4-mini|sonnet-4)/.test(id)) return 'premium';
  if (/(haiku-4|sonnet-3-7|mini-high|m3-high|grok-3)/.test(id)) return 'high';
  if (/(sonnet|gpt-4|m3(-|$)|(^|[^a-z])default($|[^a-z]))/.test(id)) return 'default';
  if (/(nano|mini[-/]|flash|lite|tiny|haiku($|[-_]\d))/.test(id)) return 'budget';
  return 'mid';
}

function deriveTier(entry) {
  return entry.tier ?? defaultTierHintForId(entry.id);
}

/**
 * Weighted capability score. Mirrors `scoreCapabilityProfile`.
 * reasoning=0.3, toolCall=0.25, structuredOutput=0.15, attachment=0.1,
 * temperature=0.05, +0.15 when inputModalities includes "image".
 */
function scoreCapabilityProfile(profile) {
  if (!profile || !profile.capabilities) return 0;
  const caps = profile.capabilities;
  let score = 0;
  if (caps.reasoning) score += 0.3;
  if (caps.toolCall) score += 0.25;
  if (caps.structuredOutput) score += 0.15;
  if (caps.attachment) score += 0.1;
  if (caps.temperature) score += 0.05;
  if (Array.isArray(caps.inputModalities) && caps.inputModalities.includes('image')) score += 0.15;
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Evaluate role requirements against a (possibly missing) profile.
 * Mirrors `evaluateRoleRequirements` in the canonical SDK.
 */
function evaluateRoleRequirements(profile, requirements, tier) {
  const reasons = [];
  if (
    typeof requirements.minContextTokens === 'number' &&
    profile?.limits &&
    Number.isFinite(profile.limits.contextTokens) &&
    profile.limits.contextTokens < requirements.minContextTokens
  ) {
    reasons.push(`contextTokens ${profile.limits.contextTokens} < required ${requirements.minContextTokens}`);
  }
  if (requirements.requireReasoning && profile?.capabilities && profile.capabilities.reasoning !== true) {
    reasons.push('missing required reasoning capability');
  }
  if (requirements.requireToolCall && profile?.capabilities && profile.capabilities.toolCall !== true) {
    reasons.push('missing required tool-call capability');
  }
  if (requirements.requireStructuredOutput && profile?.capabilities && profile.capabilities.structuredOutput !== true) {
    reasons.push('missing required structured-output capability');
  }
  if (
    requirements.requireImageInput &&
    profile?.capabilities &&
    !(Array.isArray(profile.capabilities.inputModalities) && profile.capabilities.inputModalities.includes('image'))
  ) {
    reasons.push('missing required image input modality');
  }
  if (Array.isArray(requirements.preferredTiers) && requirements.preferredTiers.length > 0 && !requirements.preferredTiers.includes(tier)) {
    reasons.push(`tier ${tier} not in preferred list`);
  }
  return { eligible: reasons.length === 0, ineligibleReasons: reasons };
}

function isHealthy(modelId, health) {
  const h = health?.[modelId];
  if (!h) return true;
  if (h.status === 'unhealthy') return false;
  if (h.status === 'degraded') return false;
  if (typeof h.recentFailureCount === 'number' && h.recentFailureCount >= 3) return false;
  return true;
}

function isNeverDowngradeRole(role) {
  if (!role) return false;
  return NEVER_DOWNGRADE_ROLES.has(role);
}

/**
 * Build the role+capability lookup key used for history bias.
 */
function roleCapabilityKey(role, capabilities) {
  const r = role ?? '';
  const c = (capabilities ?? []).slice().sort().join('+');
  return c ? `${r}|${c}` : r;
}

/**
 * Pure selector. Mirrors `selectDispatchModel` in the canonical SDK.
 *
 * @param {object} input
 * @param {object} input.task - TaskFeatures
 * @param {Array} input.selectedProfiles - operator-selected profiles
 * @param {Array} [input.staticProfiles] - shipped tier defaults (metadata only)
 * @param {string} [input.activeSessionModel]
 * @param {object} input.budget
 * @param {object} input.health
 * @returns {object} ModelDecision
 */
export function selectDispatchModelMirror(input) {
  const features = input.task;
  const requirements = {
    minContextTokens: features.minContextTokens,
    requireReasoning: features.requireReasoning,
    requireToolCall: features.requireToolCall,
    requireStructuredOutput: features.requireStructuredOutput,
    requireImageInput: features.requireImageInput,
  };
  const historyKey = roleCapabilityKey(features.role, features.capabilities);
  const routingDecisionId = randomUUID();

  const merged = mergeProfilesMirror(input.selectedProfiles, input.staticProfiles);
  const rankedAll = merged.map((entry) => evaluateProfileMirror(entry, requirements));

  const ineligibleReasons = [];
  const selectedRanked = [];
  for (const entry of rankedAll) {
    if (!entry.eligible) {
      for (const reason of entry.ineligibleReasons) ineligibleReasons.push(`${entry.id}: ${reason}`);
      continue;
    }
    selectedRanked.push(entry);
  }

  const ranked = [...selectedRanked].sort((a, b) => {
    const ai = TIER_STRENGTH.indexOf(a.tier);
    const bi = TIER_STRENGTH.indexOf(b.tier);
    if (ai !== bi) return ai - bi;
    if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
    return 0;
  });

  const consideredSet = new Set();
  const fallbackChain = [];
  const pushConsidered = (id) => {
    if (!consideredSet.has(id)) {
      consideredSet.add(id);
      fallbackChain.push(id);
    }
  };
  for (const entry of ranked) pushConsidered(entry.id);
  for (const entry of rankedAll) if (!entry.eligible) pushConsidered(entry.id);

  if (input.selectedProfiles.length === 0) {
    return {
      modelId: input.activeSessionModel ?? null,
      tier: deriveTier({ id: input.activeSessionModel ?? '' }),
      confidence: input.activeSessionModel ? 0.5 : 0,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.SESSION_INHERIT,
      fallbackChain,
    };
  }

  const eligible = ranked.filter((entry) => isHealthy(entry.id, input.health));
  const unhealthySkipped = ranked.filter((entry) => !isHealthy(entry.id, input.health));
  for (const entry of unhealthySkipped) fallbackChain.push(`${entry.id}:unhealthy`);

  const role = features.role;
  const risk = features.risk ?? 'medium';

  if (isNeverDowngradeRole(role) && eligible.length > 0) {
    const strongest = eligible[0];
    return {
      modelId: strongest.id,
      tier: strongest.tier,
      confidence: 1.0,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.STRONGEST_NEVER_DOWNGRADE,
      fallbackChain,
    };
  }

  if (eligible.length > 0 && risk === 'high') {
    const strongest = eligible[0];
    return {
      modelId: strongest.id,
      tier: strongest.tier,
      confidence: 0.95,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.STRONGEST_RISK_HIGH,
      fallbackChain,
    };
  }

  if (eligible.length > 0 && risk === 'low') {
    const cheapest = [...eligible].sort((a, b) => {
      const ai = TIER_CHEAPNESS.indexOf(a.tier);
      const bi = TIER_CHEAPNESS.indexOf(b.tier);
      if (ai !== bi) return ai - bi;
      if (a.capabilityScore !== b.capabilityScore) return a.capabilityScore - b.capabilityScore;
      return 0;
    })[0];
    return {
      modelId: cheapest.id,
      tier: cheapest.tier,
      confidence: 0.7,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.CHEAPEST_RISK_LOW,
      fallbackChain,
    };
  }

  const requestedCapabilities = features.capabilities ?? [];
  if (requestedCapabilities.length > 0 && eligible.length > 0) {
    const exact = eligible[0];
    if (exact.hasProfile) {
      return {
        modelId: exact.id,
        tier: exact.tier,
        confidence: 1.0,
        ineligibleReasons,
        routingDecisionId,
        reason: REASON.EXACT,
        fallbackChain,
      };
    }
  }

  if (eligible.length > 0) {
    const next = eligible[0];
    return {
      modelId: next.id,
      tier: next.tier,
      confidence: 0.85,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.NEXT_STRONGER,
      fallbackChain,
    };
  }

  return {
    modelId: input.activeSessionModel ?? null,
    tier: input.activeSessionModel ? deriveTier({ id: input.activeSessionModel }) : 'default',
    confidence: input.activeSessionModel ? 0.4 : 0,
    ineligibleReasons,
    routingDecisionId,
    reason: input.activeSessionModel ? REASON.SESSION_INHERIT : REASON.NO_ELIGIBLE,
    fallbackChain,
  };
}

function mergeProfilesMirror(selected, staticProfiles) {
  if (!staticProfiles || staticProfiles.length === 0) return [...selected];
  const staticById = new Map();
  for (const p of staticProfiles) staticById.set(p.id, p);
  const merged = selected.map((p) => {
    if (p.profile) return p;
    const fallback = staticById.get(p.id);
    if (!fallback) return p;
    return {
      ...p,
      profile: p.profile ?? fallback.profile,
      tier: p.tier ?? fallback.tier,
    };
  });
  return merged;
}

function evaluateProfileMirror(entry, requirements) {
  const tier = deriveTier(entry);
  const { eligible, ineligibleReasons } = evaluateRoleRequirements(entry.profile, requirements, tier);
  return {
    id: entry.id,
    tier,
    eligible,
    ineligibleReasons,
    capabilityScore: scoreCapabilityProfile(entry.profile),
    hasProfile: Boolean(entry.profile),
    originalIndex: 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                        Dispatch context loading                            */
/* ────────────────────────────────────────────────────────────────────────── */

function defaultConfigPaths() {
  const home = homedir();
  return {
    modelRouter: resolve(process.cwd(), 'config', 'claude', 'model-router.json'),
    health: resolve(home, '.config', 'bizar', 'health.json'),
    budget: resolve(home, '.config', 'bizar', 'budget.json'),
    userSelected: resolve(home, '.config', 'bizar', 'userSelected.json'),
  };
}

function readJson(path) {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function loadModelProfiles(routerPath) {
  const router = readJson(routerPath);
  if (!router || typeof router !== 'object') return { selectedProfiles: [], staticProfiles: [] };
  const userSelected = router.userSelected;
  const selectedProfiles = [];
  if (userSelected && Array.isArray(userSelected.models)) {
    const tierHints = userSelected.tierHints || {};
    const profiles = userSelected.profiles || {};
    for (const id of userSelected.models) {
      if (typeof id !== 'string' || !id.trim()) continue;
      const trimmed = id.trim();
      const hint = tierHints[trimmed];
      selectedProfiles.push({
        id: trimmed,
        tier: typeof hint === 'string' ? hint : undefined,
        profile: profiles[trimmed],
      });
    }
  }
  return { selectedProfiles, staticProfiles: [] };
}

function loadActiveSessionModel() {
  return process.env.BIZAR_ACTIVE_SESSION_MODEL || undefined;
}

/**
 * Build the full `selectDispatchModelMirror` input from canonical paths.
 * Returns `{ selectedProfiles, staticProfiles, activeSessionModel, budget, health }`.
 */
export function loadDispatchContext({ cwd = process.cwd(), env = process.env } = {}) {
  const paths = defaultConfigPaths();
  if (!isAbsolute(paths.modelRouter)) paths.modelRouter = resolve(cwd, 'config', 'claude', 'model-router.json');
  const { selectedProfiles, staticProfiles } = loadModelProfiles(paths.modelRouter);
  const budget = readJson(paths.budget) ?? { remainingUsd: undefined, maxUsdPerCall: undefined };
  const healthRaw = readJson(paths.health) ?? {};
  const health = (healthRaw && typeof healthRaw === 'object' && healthRaw.models) || {};
  const activeSessionModel = env.BIZAR_ACTIVE_SESSION_MODEL ?? loadActiveSessionModel();
  return { selectedProfiles, staticProfiles, activeSessionModel, budget, health, evidenceDir: resolveEvidenceDir() };
}

function resolveEvidenceDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.BIZAR_EVIDENCE_DIR && typeof env.BIZAR_EVIDENCE_DIR === 'string') {
    return isAbsolute(env.BIZAR_EVIDENCE_DIR) ? env.BIZAR_EVIDENCE_DIR : resolve(cwd, env.BIZAR_EVIDENCE_DIR);
  }
  const home = env.BIZAR_HOME || (env.HOME ? `${env.HOME}/.config/bizar` : null);
  if (!home) return resolve(cwd, '.config', 'bizar', 'evidence');
  return join(home, 'evidence');
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                   F-191 / IMP-018 evidence writer                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * JS mirror of `packages/sdk/src/router/dispatch-evidence.ts`. The
 * workflow runtime is plain Node ESM without a build step, so we
 * duplicate the wire format (JSONL, O_APPEND, fsync, sha256 canonical
 * hash, sequence-numbered follow-ups) here. The CLI reader
 * (`cli/commands/evidence.mjs`) and the SDK `EvidenceStore` both
 * consume the same line format — divergence fails the CLI tests.
 */
const EVIDENCE_SCHEMA_VERSION = 1;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function computeEvidenceHashes({ selectedProfiles, staticProfiles, activeSessionModel, budget, health }) {
  return {
    selectedProfilesHash: sha256Hex(JSON.stringify(canonicalize(selectedProfiles ?? []))),
    staticProfilesHash: sha256Hex(JSON.stringify(canonicalize(staticProfiles ?? []))),
    activeSessionModel,
    budgetHash: sha256Hex(JSON.stringify(canonicalize(budget ?? {}))),
    healthHash: sha256Hex(JSON.stringify(canonicalize(health ?? {}))),
  };
}

/**
 * Read every line in the JSONL evidence file into memory. The file
 * is small (one row per dispatch); this is a deliberate whole-file
 * rewrite strategy for outcome attachment, mirroring the SDK's
 * file-backed store.
 */
function readEvidenceFile(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
  }
  return rows;
}

function appendEvidenceLine(filePath, line) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  let fd = null;
  try {
    fd = openSync(filePath, O_APPEND | O_CREAT | O_WRONLY, 0o600);
    writeFileSync(fd, line, { encoding: 'utf8' });
    try { fsyncSync(fd); } catch { /* fsync unsupported on some FS */ }
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function writeEvidenceFile(filePath, rows) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  const tmp = `${filePath}.tmp`;
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, filePath);
}

function sameRowContent(existing, next) {
  const a = JSON.stringify(canonicalize({
    decision: next.decision,
    taskFeatures: next.taskFeatures,
    inputs: computeEvidenceHashes(next),
  }));
  const b = JSON.stringify(canonicalize({
    decision: existing.decision,
    taskFeatures: existing.taskFeatures,
    inputs: existing.inputs,
  }));
  return a === b;
}

/**
 * Append a DispatchEvidence row to the JSONL store. Mirrors the SDK's
 * `EvidenceStore.append`:
 *   - schemaVersion=1 stamped server-side;
 *   - createdAt stamped server-side (default ISO now);
 *   - sequence number assigned from the existing chain (0 for primary,
 *     N for follow-up);
 *   - throws a plain Error on duplicate content.
 *
 * @param {object} record same shape as the SDK's EvidenceStoreAppendInput
 * @param {object} [opts]
 * @param {string} [opts.evidenceDir] override the default evidence dir
 * @param {() => Date} [opts.now] clock injection for deterministic tests
 * @returns {object} the persisted record
 */
export function appendEvidence(record, opts = {}) {
  const dir = opts.evidenceDir ?? resolveEvidenceDir();
  const filePath = join(dir, 'dispatch.jsonl');
  const now = opts.now ?? (() => new Date());
  const existing = readEvidenceFile(filePath);
  const dup = existing.find((row) => row.routingDecisionId === record.routingDecisionId && sameRowContent(row, record));
  if (dup) {
    const err = new Error(`DispatchEvidence with routingDecisionId=${record.routingDecisionId} already exists`);
    err.code = 'duplicate-routingDecisionId';
    throw err;
  }
  const chain = existing.filter((row) => row.routingDecisionId === record.routingDecisionId);
  const sequence = chain.length;
  const built = {
    routingDecisionId: record.routingDecisionId,
    createdAt: now().toISOString(),
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    decision: record.decision,
    taskFeatures: record.taskFeatures,
    inputs: computeEvidenceHashes(record),
    runId: record.runId,
    agentName: record.agentName,
    workflowPhase: record.workflowPhase,
    sequence,
    isFollowUp: sequence > 0 ? true : undefined,
  };
  appendEvidenceLine(filePath, JSON.stringify(built) + '\n');
  return built;
}

/**
 * Attach an outcome block to the primary (sequence=0) row of a
 * dispatch chain. Mirrors the SDK's `EvidenceStore.attachOutcome`:
 * idempotent on identical outcome, throws on conflict.
 *
 * @param {string} routingDecisionId
 * @param {object} outcome the DispatchOutcome payload
 * @param {object} [opts]
 * @param {string} [opts.evidenceDir]
 * @param {() => Date} [opts.now]
 * @returns {object} the updated primary row
 */
export function attachEvidenceOutcome(routingDecisionId, outcome, opts = {}) {
  const dir = opts.evidenceDir ?? resolveEvidenceDir();
  const filePath = join(dir, 'dispatch.jsonl');
  const now = opts.now ?? (() => new Date());
  const rows = readEvidenceFile(filePath);
  const chain = rows.filter((r) => r.routingDecisionId === routingDecisionId);
  if (chain.length === 0) {
    const err = new Error(`DispatchEvidence with routingDecisionId=${routingDecisionId} not found`);
    err.code = 'not-found';
    throw err;
  }
  const primary = chain.find((r) => r.sequence === 0) ?? chain[0];
  if (primary.outcome) {
    if (JSON.stringify(canonicalize(primary.outcome)) === JSON.stringify(canonicalize(outcome))) {
      return primary;
    }
    const err = new Error(`Outcome for routingDecisionId=${routingDecisionId} already attached with a different value`);
    err.code = 'outcome-conflict';
    throw err;
  }
  const idx = rows.findIndex((r) => r.routingDecisionId === routingDecisionId && r.sequence === primary.sequence);
  const capturedAt = outcome.capturedAt ?? now().toISOString();
  rows[idx] = { ...primary, outcome: { ...outcome, capturedAt } };
  writeEvidenceFile(filePath, rows);
  return rows[idx];
}

/**
 * Convenience: read every evidence row back from the JSONL store.
 * Used by tests + the `evidence run <id>` CLI subcommand.
 */
export function readEvidenceRows(opts = {}) {
  const dir = opts.evidenceDir ?? resolveEvidenceDir();
  const filePath = join(dir, 'dispatch.jsonl');
  return readEvidenceFile(filePath);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public dispatch wrapper                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Capture hook for tests. When set, every dispatch records the payload
 * (including `model`, `routingDecisionId`, `tier`, and `selectorReason`)
 * into the supplied array. The runtime `agent(...)` is NOT invoked when
 * `opts.dryRun === true`; the capture test relies on this.
 */
let captureFn = null;

export function setCaptureFn(fn) {
  captureFn = typeof fn === 'function' ? fn : null;
}

export function resetCaptureFn() {
  captureFn = null;
}

/**
 * Build a `TaskFeatures` shape from dispatch opts. `task` defaults to a
 * trimmed prefix of the prompt so the audit trail is self-describing.
 */
function buildTaskFeatures(agentName, prompt, opts) {
  return {
    task: typeof prompt === 'string' ? prompt.slice(0, 200) : `agent=${agentName}`,
    role: opts.role,
    phase: opts.phase,
    risk: opts.risk,
    capabilities: Array.isArray(opts.capabilities) ? [...opts.capabilities] : undefined,
    minContextTokens: opts.minContextTokens,
    requireReasoning: opts.requireReasoning,
    requireToolCall: opts.requireToolCall,
    requireStructuredOutput: opts.requireStructuredOutput,
    requireImageInput: opts.requireImageInput,
  };
}

/**
 * Run the selector and return its `ModelDecision`. Pure — no I/O beyond
 * `loadDispatchContext`. Exported for testability.
 */
export function computeDecision(agentName, prompt, opts, context) {
  const ctx = context ?? loadDispatchContext();
  const task = buildTaskFeatures(agentName, prompt, opts);
  return selectDispatchModelMirror({
    task,
    selectedProfiles: ctx.selectedProfiles,
    staticProfiles: ctx.staticProfiles,
    activeSessionModel: ctx.activeSessionModel,
    budget: ctx.budget,
    health: ctx.health,
    history: ctx.history,
    runId: opts.runId ?? randomUUID(),
  });
}

/**
 * Persist the dispatch decision to the F-191 evidence store. Best-effort:
 * a write failure MUST NOT abort the dispatch — telemetry is downstream
 * of the user-facing contract. Returns the persisted record (or null
 * when no evidence context was supplied).
 */
export function writeDispatchEvidence(agentName, prompt, opts, decision, context) {
  const ctx = context ?? loadDispatchContext();
  const task = buildTaskFeatures(agentName, prompt, opts);
  try {
    return appendEvidence({
      routingDecisionId: decision.routingDecisionId,
      decision,
      taskFeatures: task,
      runId: opts.runId ?? decision.routingDecisionId,
      agentName,
      workflowPhase: opts.phase,
      selectedProfiles: ctx.selectedProfiles,
      staticProfiles: ctx.staticProfiles,
      activeSessionModel: ctx.activeSessionModel,
      budget: ctx.budget,
      health: ctx.health,
    }, { evidenceDir: ctx.evidenceDir });
  } catch (err) {
    // Best-effort: never fail a dispatch because telemetry is down.
    return null;
  }
}

/**
 * Attach the post-dispatch outcome to the evidence row. Best-effort.
 */
export function writeDispatchOutcome(routingDecisionId, outcome, context) {
  const ctx = context ?? loadDispatchContext();
  try {
    return attachEvidenceOutcome(routingDecisionId, outcome, { evidenceDir: ctx.evidenceDir });
  } catch (err) {
    return null;
  }
}

/**
 * Map a dispatch result (success / thrown error) into the F-191
 * DispatchOutcome shape. Best-effort — the dispatch wrapper never
 * blocks on outcome capture.
 */
export function classifyDispatchOutcome(result, error, startMs) {
  const durationMs = Date.now() - startMs;
  if (!error) {
    return {
      status: 'success',
      durationMs,
      actualProviderModel: result && typeof result === 'object' && typeof result.model === 'string' ? result.model : undefined,
      capturedAt: new Date().toISOString(),
    };
  }
  const message = String(error?.message ?? error ?? '');
  const lower = message.toLowerCase();
  let status = 'failure';
  if (/(timeout|timed out|etimedout|aborted|deadline)/.test(lower)) status = 'timeout';
  else if (/(context.*length|context.*overflow|context.*window|too long|maximum context)/.test(lower)) status = 'context-overflow';
  return {
    status,
    durationMs,
    errorMessage: message,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Build the augmented agent-call payload. Adds `model`,
 * `routingDecisionId`, `tier`, and `selectorReason` so the Agent
 * tool can route correctly and the audit trail can prove which
 * selector step fired.
 */
export function augmentPayload(opts, decision, agentName) {
  return {
    ...opts,
    model: decision.modelId ?? undefined,
    routingDecisionId: decision.routingDecisionId,
    tier: decision.tier,
    selectorReason: decision.reason,
    fallbackChain: decision.fallbackChain,
    routedAgent: agentName,
  };
}

/**
 * The single dispatch entry point every workflow script MUST call.
 *
 * Replaces bare `agent(prompt, opts)` calls. The signature
 * `(agentFn, agentName, prompt, opts, context?)` makes the agent-factory
 * explicit so the helper is testable and the workflow runtime's `agent`
 * is passed through (the runtime injects `agent` via the script's
 * argument list, not via a module import).
 *
 * Behaviour:
 *   1. Builds a `TaskFeatures` from `opts`.
 *   2. Loads `userSelected` + health + budget via `loadDispatchContext`
 *      (or uses the supplied `context` for tests).
 *   3. Runs `selectDispatchModelMirror` to compute the decision.
 *   4. Optionally records the augmented payload into the capture hook.
 *   5. When `opts.dryRun === true`, returns the decision (the runtime
 *      `agent(...)` is NOT invoked).
 *   6. Otherwise, calls `agentFn(prompt, augmentedOpts)` and returns
 *      the agent's response.
 *
 * @param {Function} agentFn - runtime-injected `agent` primitive
 * @param {string} agentName - logical agent label (e.g. "mike", "todd")
 * @param {string} prompt - prompt sent to the agent
 * @param {object} opts - role/phase/capabilities/risk + workflow opts
 * @param {object} [context] - optional dispatch context override (tests)
 * @returns {Promise<*>} the agent's response (or the decision when dryRun)
 */
export async function dispatchAgent(agentFn, agentName, prompt, opts = {}, context) {
  if (typeof agentFn !== 'function' && opts.dryRun !== true) {
    throw new TypeError('dispatchAgent requires an agent function (or opts.dryRun=true)');
  }
  if (!agentName || typeof agentName !== 'string') {
    throw new TypeError('dispatchAgent requires a non-empty agentName');
  }
  const decision = computeDecision(agentName, prompt, opts, context);
  const augmented = augmentPayload(opts, decision, agentName);

  // F-191 / IMP-018 audit trail — persist the decision before invoking
  // the agent. Best-effort: telemetry failures MUST NOT abort the
  // dispatch. Tests can disable the write via opts.dryRun=true or by
  // passing an explicit context with a missing evidenceDir.
  if (opts.dryRun !== true) {
    writeDispatchEvidence(agentName, prompt, opts, decision, context);
  }

  if (captureFn) {
    try {
      captureFn({
        agentName,
        prompt,
        opts: augmented,
        decision,
        dryRun: opts.dryRun === true,
      });
    } catch {
      // Capture is best-effort: never fail a dispatch because telemetry is down.
    }
  }

  if (opts.dryRun === true) {
    return { __dispatchDecision: decision, payload: augmented };
  }

  if (opts.forceModel && typeof opts.forceModel === 'string') {
    augmented.model = opts.forceModel;
  }

  const startMs = Date.now();
  try {
    const result = await agentFn(prompt, augmented);
    writeDispatchOutcome(decision.routingDecisionId, classifyDispatchOutcome(result, null, startMs), context);
    return result;
  } catch (err) {
    writeDispatchOutcome(decision.routingDecisionId, classifyDispatchOutcome(null, err, startMs), context);
    throw err;
  }
}

/**
 * Convenience wrapper for the capture test: runs the dispatch without
 * an agent function. Always returns the payload, never calls `agentFn`.
 */
export async function dispatchAgentDryRun(agentName, prompt, opts = {}) {
  return dispatchAgent(undefined, agentName, prompt, { ...opts, dryRun: true });
}
