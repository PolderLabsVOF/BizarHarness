/**
 * config/workflows/lib/dispatch.js — host-side alias dispatch + workflow
 * artifact helpers for tests.
 *
 * Post-cutover, workflow scripts are self-contained: each `config/workflows/*.js`
 * inlines its own dispatch wrapper and never imports from this module.
 * This module exists for the workflow test suite (`alias-dispatch.test.mjs`,
 * etc.) and for any operator-side tooling that wants to validate a planned
 * alias before passing it to the native `agent(...)` primitive.
 *
 * The static-alias contract:
 *   - the harness picks one of FOUR native aliases: `haiku`, `sonnet`,
 *     `opus`, `fable`;
 *   - OmniRoute handles ordered failover between configured full IDs for
 *     that alias;
 *   - this module NEVER loads profile / health / budget / tier / registry
 *     state, NEVER reads `model-router.json`, and NEVER constructs an
 *     `args.routing` gateway-ID plumbing block;
 *   - workflow scripts MUST NOT pass `inherit` for the model field.
 *
 * The retained surface below is intentionally tiny:
 *
 *   1. `ALIASES` / `isAlias` / `assertAlias` — the finite alias validator.
 *   2. `ROLE_TO_BIZAR_AGENT` / `stableAgentName` — role → agent mapping
 *      used by the workflow dispatch wrappers.
 *   3. `dispatchAgent` — pass-through wrapper that validates the alias,
 *      surfaces `subagent_type`, and forwards the prompt. No profile
 *      loading, no evidence writes, no tier ranking.
 *   4. Artifact-store helpers (`writeArtifact`, `readArtifact`,
 *      `listArtifacts`, `listRuns`, `barrierRef`, `slugify`,
 *      `resolveRunRoot`, `WorkflowStateError`) — these are not model-
 *      routing concerns; they handle bounded run-state records for the
 *      workflow VM.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/* ────────────────────────────────────────────────────────────────────────── */
/*                       Static alias contract (the four aliases)             */
/* ────────────────────────────────────────────────────────────────────────── */

export const ALIASES = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);
const ALIAS_SET = new Set(ALIASES);

export function isAlias(value) {
  return typeof value === 'string' && ALIAS_SET.has(value.trim());
}

export function assertAlias(value) {
  if (!isAlias(value)) {
    throw new AliasValidationError(
      `Bizar dispatch: '${value}' is not a native alias. Pick one of: ${ALIASES.join(', ')}.`,
    );
  }
  return value.trim();
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                       Role → stable Bizar agent mapping                    */
/* ────────────────────────────────────────────────────────────────────────── */

export const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', 'researcher': 'greg',
  planner: 'paul', architect: 'paul', implementer: 'todd',
  verifier: 'linda',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda', 'debug-specialist': 'carl',
  'principal-engineer': 'karen', 'ui-designer': 'ria', 'it-lead': 'steve',
  'knowledge-manager': 'oscar', 'support-tech': 'kevin', 'exec-assistant': 'pam',
  'office-coordinator': 'brenda', 'office-greeter': 'janet', 'brand-designer': 'brad',
});

export function stableAgentName(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd');
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                       Pass-through dispatch wrapper                        */
/* ────────────────────────────────────────────────────────────────────────── */

export class AliasValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AliasValidationError';
    this.code = 'invalid-alias';
  }
}

/**
 * Pass-through dispatch wrapper for workflow scripts.
 *
 * Validates that `opts.model` (if supplied) is one of the four static
 * aliases, maps `opts.role` to a stable Bizar agent name, and forwards
 * the call to the runtime's `agentFn(prompt, agentOptions)` primitive.
 *
 * It deliberately does NOT load profile / health / budget / tier /
 * registry state, does NOT generate a `routingDecisionId`, does NOT
 * construct `args.routing`, and does NOT select a tier. The harness
 * picks the alias; OmniRoute handles failover.
 *
 * @param {(prompt: string, agentOptions: object) => Promise<any>} agentFn
 *   Native workflow `agent(...)` primitive.
 * @param {string} agentName Short identifier used in the dispatch prefix.
 * @param {string} prompt The task prompt.
 * @param {object} [opts]
 * @param {string} [opts.role] Role key (e.g. 'implementer') → mapped to a
 *   stable Bizar agent via `ROLE_TO_BIZAR_AGENT`.
 * @param {string} [opts.model] One of the four native aliases. Optional;
 *   the harness passes a `subagent_type` and lets the agent definition
 *   choose its default alias unless the caller explicitly requests
 *   otherwise.
 * @param {'low'|'medium'|'high'} [opts.risk] Informational only — the
 *   harness consumes it for the alias policy but the dispatch itself
 *   does not branch on it.
 * @param {object} [opts.schema] Optional response schema.
 * @param {string} [opts.isolation] 'worktree' for editing workers.
 * @param {string[]} [opts.disallowedTools] Forwarded to the runtime.
 */
export async function dispatchAgent(agentFn, agentName, prompt, opts = {}) {
  if (typeof agentFn !== 'function') {
    throw new TypeError('dispatchAgent requires an agent function');
  }
  if (typeof agentName !== 'string' || agentName.length === 0) {
    throw new TypeError('dispatchAgent requires a non-empty agentName');
  }
  const role = opts.role || 'implementer';
  const agentOptions = {
    subagent_type: stableAgentName(role),
  };
  if (opts.model !== undefined) {
    agentOptions.model = assertAlias(opts.model);
  }
  if (opts.isolation) agentOptions.isolation = opts.isolation;
  if (opts.schema) agentOptions.schema = opts.schema;
  if (Array.isArray(opts.disallowedTools)) agentOptions.disallowedTools = opts.disallowedTools;
  return agentFn(prompt, agentOptions);
}

/**
 * Dry-run variant: validates the alias + role mapping without invoking
 * the agentFn. Returns the `agentOptions` the runtime would receive.
 */
export function dispatchAgentDryRun(agentName, prompt, opts = {}) {
  if (typeof agentName !== 'string' || agentName.length === 0) {
    throw new TypeError('dispatchAgentDryRun requires a non-empty agentName');
  }
  const role = opts.role || 'implementer';
  const agentOptions = {
    subagent_type: stableAgentName(role),
  };
  if (opts.model !== undefined) {
    agentOptions.model = assertAlias(opts.model);
  }
  if (opts.isolation) agentOptions.isolation = opts.isolation;
  return { agentName, prompt, agentOptions };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                       Workflow artifact store (kept)                        */
/* ────────────────────────────────────────────────────────────────────────── */

export class WorkflowStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowStateError';
    this.code = code;
  }
}

export const ARTIFACT_SCHEMA_VERSION = 1;
export const MAX_SUMMARY_BYTES = 200;
export const MAX_BARRIER_BYTES = 3072;

export function slugify(input, maxLen = 64) {
  const raw = String(input ?? '').toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen);
  return safe || 'unknown';
}

export function resolveRunRoot({ cwd, env } = {}) {
  const root = cwd || process.cwd();
  const override = (env || process.env).BIZAR_RUNS_DIR;
  if (override && typeof override === 'string' && override.trim()) {
    return resolve(override);
  }
  return join(root, '.bizar', 'runs');
}

function runDirFor(runRoot, runId) {
  return join(runRoot, runId);
}

function manifestPathFor(runDir) {
  return join(runDir, 'manifest.json');
}

function readManifest(runDir) {
  const p = manifestPathFor(runDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function summaryHashHex(summary) {
  return createHash('sha256').update(String(summary ?? '')).digest('hex');
}

export function writeArtifact(args) {
  const { runId, phase, label, payload, summary, runRoot: passedRoot } = args || {};
  if (!args || typeof args !== 'object') {
    throw new WorkflowStateError('ARTIFACT_ARGS_REQUIRED', 'writeArtifact requires an args object');
  }
  if (!runId) throw new WorkflowStateError('RUN_ID_REQUIRED', 'writeArtifact requires a non-empty runId');
  if (!phase) throw new WorkflowStateError('PHASE_REQUIRED', 'writeArtifact requires a non-empty phase');
  if (!label) throw new WorkflowStateError('LABEL_REQUIRED', 'writeArtifact requires a non-empty label');
  if (payload === undefined || payload === null) {
    throw new WorkflowStateError('PAYLOAD_REQUIRED', 'writeArtifact requires a payload');
  }
  const runRoot = passedRoot || resolveRunRoot();
  const runDir = runDirFor(runRoot, runId);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const slug = `${slugify(phase)}__${slugify(label)}`;
  const artifactPath = join(runDir, `${slug}.json`);
  const summaryText = typeof summary === 'string' ? summary : '';
  const envelope = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    runId,
    phase,
    label,
    summary: summaryText,
    summaryHash: summaryHashHex(summaryText),
    payload,
    writtenAt: new Date().toISOString(),
  };
  const tmp = `${artifactPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  renameSync(tmp, artifactPath);
  const manifestPath = manifestPathFor(runDir);
  let manifest = readManifest(runDir) || { schemaVersion: 1, runId, createdAt: envelope.writtenAt, phases: [] };
  if (!Array.isArray(manifest.phases)) manifest.phases = [];
  manifest.phases = manifest.phases.filter((p) => p && !(p.phase === phase && p.label === label));
  manifest.phases.push({ phase, label, artifactPath, summaryHash: envelope.summaryHash, stale: false });
  manifest.updatedAt = envelope.writtenAt;
  const mTmp = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(mTmp, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  renameSync(mTmp, manifestPath);
  return { runDir, artifactPath, slug, manifestPath };
}

export function readArtifact(args) {
  const { runId, phase, label, runRoot: passedRoot } = args || {};
  if (!args || typeof args !== 'object') {
    throw new WorkflowStateError('ARTIFACT_KEY_REQUIRED', 'readArtifact requires { runId, phase, label }');
  }
  if (!runId) throw new WorkflowStateError('RUN_ID_REQUIRED', 'readArtifact requires runId');
  if (!phase) throw new WorkflowStateError('PHASE_REQUIRED', 'readArtifact requires phase');
  if (!label) throw new WorkflowStateError('LABEL_REQUIRED', 'readArtifact requires label');
  const runRoot = passedRoot || resolveRunRoot();
  const runDir = runDirFor(runRoot, runId);
  if (!existsSync(runDir)) {
    return { missing: true, payload: null, summary: null, manifest: null, stale: false };
  }
  const phaseSlug = slugify(phase);
  const labelSlug = slugify(label);
  const artifactPath = join(runDir, `${phaseSlug}__${labelSlug}.json`);
  if (!existsSync(artifactPath)) {
    return { missing: true, payload: null, summary: null, manifest: readManifest(runDir), stale: false };
  }
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch {
    return { stale: true, payload: null, summary: null, manifest: readManifest(runDir), missing: false };
  }
  const manifest = readManifest(runDir);
  let stale = false;
  if (!envelope || typeof envelope !== 'object') stale = true;
  else if (envelope.summaryHash !== summaryHashHex(envelope.summary)) stale = true;
  else if (Array.isArray(manifest?.phases)) {
    const entry = manifest.phases.find((p) => p && p.phase === phase && p.label === label);
    if (entry && entry.stale === true) stale = true;
    if (entry && entry.summaryHash && entry.summaryHash !== envelope.summaryHash) stale = true;
  }
  return {
    artifactPath,
    missing: false,
    stale,
    payload: stale ? null : envelope.payload,
    summary: stale ? null : envelope.summary,
    manifest,
  };
}

export function listArtifacts(args) {
  const { runId, runRoot: passedRoot } = args || {};
  if (!runId) throw new WorkflowStateError('RUN_ID_REQUIRED', 'listArtifacts requires runId');
  const runRoot = passedRoot || resolveRunRoot();
  const runDir = runDirFor(runRoot, runId);
  if (!existsSync(runDir)) return [];
  const out = [];
  for (const name of readdirSync(runDir)) {
    if (!name.endsWith('.json') || name === 'manifest.json') continue;
    const full = join(runDir, name);
    try {
      const env = JSON.parse(readFileSync(full, 'utf8'));
      if (env && typeof env === 'object' && env.phase && env.label) {
        out.push({ phase: env.phase, label: env.label, artifactPath: full });
      }
    } catch {
      // skip corrupt entries
    }
  }
  return out;
}

export function listRuns(args = {}) {
  const runRoot = args.runRoot || resolveRunRoot();
  if (!existsSync(runRoot)) return [];
  const out = [];
  for (const name of readdirSync(runRoot)) {
    const full = join(runRoot, name);
    if (existsSync(join(full, 'manifest.json'))) out.push({ runId: name, runDir: full });
  }
  return out;
}

export function barrierRef(args) {
  const { runId, phase, label, summary } = args || {};
  if (!runId || !phase || !label) {
    throw new WorkflowStateError('BARRIER_KEY_REQUIRED', 'barrierRef requires { runId, phase, label }');
  }
  const runRoot = args.runRoot || resolveRunRoot();
  const runDir = runDirFor(runRoot, runId);
  const slug = `${slugify(phase)}__${slugify(label)}`;
  const path = join(runDir, `${slug}.json`);

  let boundedSummary = typeof summary === 'string' ? summary : '';
  let truncated = false;
  if (boundedSummary.length > MAX_SUMMARY_BYTES) {
    boundedSummary = boundedSummary.slice(0, MAX_SUMMARY_BYTES);
    truncated = true;
  }
  const promptBlock = [
    `prior phase: ${phase}`,
    `prior label: ${label}`,
    `summary:     ${boundedSummary}`,
    `path:        ${path}`,
  ].join('\n');
  return { promptBlock, path, truncated: truncated || promptBlock.length > MAX_BARRIER_BYTES, bytes: Buffer.byteLength(promptBlock, 'utf8') };
}

// Re-export dirname for callers that compose paths off a run dir.
export { dirname };
