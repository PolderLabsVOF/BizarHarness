/**
 * cli/feature-list-bridge.mjs
 *
 * F-035 (MetaHarness) — wraps `feature_list.json` with claim semantics.
 *
 * Source-of-truth port from
 *   ruflo/v3/@claude-flow/cli/src/services/claim-service.ts (ClaimService,
 *   ADR-016) — issues.ts is the CLI surface we mirror.
 *
 * Status state machine:
 *   unclaimed -> claimed
 *   claimed -> active             (start work)
 *   active -> paused
 *   paused -> active
 *   active -> handoff-pending     (initiated)
 *   handoff-pending -> claimed    (accepted by recipient)
 *   active -> blocked             (caller marked a blocker)
 *   blocked -> active
 *   {claimed,active,paused,blocked,handoff-pending}
 *                          -> completed
 *   {claimed,active,...}   -> unclaimed (release)
 *
 * Steal reasons (per spec): overloaded | stale | blocked-timeout | voluntary
 *
 * Persistence model: we ADD the following fields on each feature entry —
 *   claimant      : { type: 'human'|'agent', id, name }
 *   claimStatus   : ClaimStatus
 *   claimedAt     : ISO timestamp
 *   claimHistory  : Array<{ event, claimant?, ts, reason? }>
 *
 * We MUST NOT modify the existing `vcr` / `passing` semantics of
 * feature_list.json — claims are additive fields only.
 *
 * File writes are atomic via the standard `writeFileSync` to .tmp +
 * `renameSync` pattern.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────────

export const CLAIM_STATUSES = Object.freeze([
  'unclaimed',
  'claimed',
  'active',
  'paused',
  'handoff-pending',
  'blocked',
  'completed',
]);

export const STEAL_REASONS = Object.freeze([
  'overloaded',
  'stale',
  'blocked-timeout',
  'voluntary',
]);

// Transitions the bridge will allow without complaint. Anything else
// emits a typed error.
const ALLOWED_TRANSITIONS = {
  unclaimed:          new Set(['claimed']),
  claimed:            new Set(['active', 'unclaimed', 'completed', 'handoff-pending']),
  active:             new Set(['paused', 'blocked', 'completed', 'handoff-pending', 'unclaimed']),
  paused:             new Set(['active', 'unclaimed', 'completed']),
  'handoff-pending':  new Set(['claimed', 'unclaimed']),
  blocked:            new Set(['active', 'unclaimed']),
  completed:          new Set([]),
};

// ── Errors ───────────────────────────────────────────────────────────

export class ClaimError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ClaimError';
    this.code = code;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    const txt = readFileSync(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
}

function appendHistory(feature, event, extra) {
  const prev = Array.isArray(feature.claimHistory) ? feature.claimHistory : [];
  feature.claimHistory = [...prev, { event, ts: nowIso(), ...(extra || {}) }];
}

function setClaim(feature, status, claimant, reason) {
  feature.claimant = claimant || null;
  feature.claimStatus = status;
  if (status === 'claimed' || status === 'active' || status === 'paused' || status === 'handoff-pending' || status === 'blocked') {
    if (!feature.claimedAt) feature.claimedAt = nowIso();
  }
  if (status === 'unclaimed' || status === 'completed') {
    // Keep claimedAt as historical record.
  }
  if (reason) feature.claimReason = reason;
}

function assertStatus(s) {
  if (!CLAIM_STATUSES.includes(s)) {
    throw new ClaimError('UNKNOWN_STATUS', `Unknown claim status: ${s}`);
  }
}

function assertReason(r) {
  if (!STEAL_REASONS.includes(r)) {
    throw new ClaimError('UNKNOWN_STEAL_REASON', `Unknown steal reason: ${r}`);
  }
}

// ── FeatureListBridge ────────────────────────────────────────────────

export class FeatureListBridge {
  /**
   * @param {object|string} opts Either a path string or `{ filePath, backup }`.
   *   - filePath: path to feature_list.json (default: ./feature_list.json)
   *   - backup  : write a .bak copy before each write (default: true)
   */
  constructor(opts = {}) {
    if (typeof opts === 'string') {
      this.filePath = resolve(opts);
    } else {
      this.filePath = resolve(opts.filePath || 'feature_list.json');
      this.backup = opts.backup !== false;
    }
  }

  /** Load the feature list from disk. Returns the parsed JSON. */
  load() {
    const data = readJsonSafe(this.filePath);
    if (!data) {
      throw new ClaimError('NO_FILE', `feature_list.json not found at ${this.filePath}`);
    }
    if (!Array.isArray(data.features)) {
      throw new ClaimError('SCHEMA', 'feature_list.json missing top-level features[]');
    }
    return data;
  }

  /** Save + atomic temp-rename. Creates a .bak if `backup=true`. */
  save(data, { reason = 'update' } = {}) {
    if (this.backup && existsSync(this.filePath)) {
      try { copyFileSync(this.filePath, `${this.filePath}.bak`); } catch { /* best-effort */ }
    }
    writeJsonAtomic(this.filePath, data);
    return { ok: true, path: this.filePath, reason };
  }

  _find(data, featureId) {
    const idx = data.features.findIndex((f) => f.id === featureId);
    if (idx === -1) {
      throw new ClaimError('NOT_FOUND', `Feature ${featureId} not in feature_list.json`);
    }
    return idx;
  }

  _getOrThrow(data, featureId) {
    return data.features[this._find(data, featureId)];
  }

  // ── claim ─────────────────────────────────────────────────────────

  /**
   * @param {string} featureId
   * @param {{type:'human'|'agent', id:string, name?:string}} claimant
   * @param {string} reason
   * @returns {{ ok: true, feature: object }}
   */
  claim(featureId, claimant, reason) {
    if (!claimant || (claimant.type !== 'human' && claimant.type !== 'agent')) {
      throw new ClaimError('BAD_CLAIMANT', 'claimant must be {type:"human"|"agent", id, name?}');
    }
    const data = this.load();
    const feature = this._getOrThrow(data, featureId);
    const prev = feature.claimant || null;
    const prevStatus = feature.claimStatus || 'unclaimed';

    if (prevStatus !== 'unclaimed' && prevStatus !== 'completed') {
      throw new ClaimError(
        'ALREADY_CLAIMED',
        `Feature ${featureId} is ${prevStatus} by ${prev?.name || prev?.id || 'unknown'} — release or steal first.`,
      );
    }

    feature.claimant = claimant;
    feature.claimStatus = 'claimed';
    feature.claimedAt = nowIso();
    if (reason) feature.claimReason = reason;
    appendHistory(feature, 'claim', { claimant, reason });

    this.save(data, { reason: `claim:${featureId}` });
    return { ok: true, feature, previousClaimant: prev };
  }

  // ── release ───────────────────────────────────────────────────────

  /**
   * @param {string} featureId
   * @param {{id:string}} claimant   expected to match the current claimant
   * @param {string} reason
   */
  release(featureId, claimant, reason) {
    const data = this.load();
    const feature = this._getOrThrow(data, featureId);
    const prevStatus = feature.claimStatus || 'unclaimed';
    if (prevStatus === 'unclaimed' || prevStatus === 'completed') {
      throw new ClaimError(
        'NOT_CLAIMED',
        `Feature ${featureId} is ${prevStatus}; nothing to release.`,
      );
    }
    if (claimant && feature.claimant && feature.claimant.id !== claimant.id) {
      throw new ClaimError(
        'WRONG_CLAIMANT',
        `Feature ${featureId} is claimed by ${feature.claimant.name || feature.claimant.id}, not ${claimant.name || claimant.id}.`,
      );
    }
    const prev = feature.claimant;
    feature.claimStatus = 'unclaimed';
    appendHistory(feature, 'release', { releasedBy: claimant, reason });
    // Keep claimant for historical record (the entry's `claimHistory`
    // captures who held it); but flip `claimant` to null so further
    // list({status: 'claimed'}) filters don't pick it up accidentally.
    feature.claimant = null;

    this.save(data, { reason: `release:${featureId}` });
    return { ok: true, feature, previousClaimant: prev };
  }

  // ── handoff ───────────────────────────────────────────────────────

  /**
   * Hand off the feature from one claimant to another.
   * The recipient must be a valid claimant shape.
   */
  handoff(featureId, fromClaimant, toClaimant, reason) {
    if (!toClaimant || (toClaimant.type !== 'human' && toClaimant.type !== 'agent')) {
      throw new ClaimError('BAD_CLAIMANT', 'toClaimant must be {type:"human"|"agent", id, name?}');
    }
    const data = this.load();
    const feature = this._getOrThrow(data, featureId);
    const prevStatus = feature.claimStatus || 'unclaimed';
    if (prevStatus === 'unclaimed' || prevStatus === 'completed') {
      throw new ClaimError('NOT_CLAIMED', `Feature ${featureId} is ${prevStatus}; cannot handoff.`);
    }
    if (fromClaimant && feature.claimant && feature.claimant.id !== fromClaimant.id) {
      throw new ClaimError(
        'WRONG_CLAIMANT',
        `Feature ${featureId} is held by ${feature.claimant.name || feature.claimant.id}, not ${fromClaimant.name || fromClaimant.id}.`,
      );
    }

    appendHistory(feature, 'handoff-initiated', { from: feature.claimant, to: toClaimant, reason });
    feature.handoffTo = toClaimant;
    feature.claimStatus = 'handoff-pending';

    // Synchronous accept per the simplest semantics — the CLI flag
    // `bizar claim handoff` accepts immediately. An async workflow
    // would split this into handoff-initiate + handoff-accept, but
    // v1 keeps it atomic.
    feature.claimant = toClaimant;
    feature.claimStatus = 'claimed';
    feature.claimedAt = nowIso();
    appendHistory(feature, 'handoff-accepted', { by: toClaimant, reason });
    delete feature.handoffTo;

    this.save(data, { reason: `handoff:${featureId}` });
    return { ok: true, feature };
  }

  // ── steal ─────────────────────────────────────────────────────────

  /**
   * Steal a feature from the current claimant. Requires a `stealReason`
   * (one of STEAL_REASONS). Records the event in `claimHistory`.
   */
  steal(featureId, newClaimant, reason) {
    assertReason(reason);
    if (!newClaimant || (newClaimant.type !== 'human' && newClaimant.type !== 'agent')) {
      throw new ClaimError('BAD_CLAIMANT', 'newClaimant must be {type:"human"|"agent", id, name?}');
    }
    const data = this.load();
    const feature = this._getOrThrow(data, featureId);
    const prevStatus = feature.claimStatus || 'unclaimed';
    if (prevStatus === 'unclaimed' || prevStatus === 'completed') {
      throw new ClaimError('NOT_CLAIMED', `Feature ${featureId} is ${prevStatus}; nothing to steal.`);
    }
    const prev = feature.claimant;
    appendHistory(feature, 'steal', { stolenFrom: prev, stolenBy: newClaimant, reason });
    feature.claimant = newClaimant;
    feature.claimStatus = 'claimed';
    feature.claimedAt = nowIso();
    feature.claimReason = reason;

    this.save(data, { reason: `steal:${featureId}` });
    return { ok: true, feature, previousClaimant: prev, stealReason: reason };
  }

  // ── transition ────────────────────────────────────────────────────

  /**
   * Generic status transition (active / paused / blocked / completed).
   * Used by the CLI to mark a claim actively-in-progress, paused,
   * blocked, or completed.
   */
  transition(featureId, newStatus, claimant, reason) {
    assertStatus(newStatus);
    const data = this.load();
    const feature = this._getOrThrow(data, featureId);
    const prevStatus = feature.claimStatus || 'unclaimed';
    if (newStatus === prevStatus) {
      return { ok: true, feature, unchanged: true };
    }
    const allowed = ALLOWED_TRANSITIONS[prevStatus] || new Set();
    if (!allowed.has(newStatus)) {
      throw new ClaimError(
        'BAD_TRANSITION',
        `Cannot transition ${featureId}: ${prevStatus} → ${newStatus} not allowed.`,
      );
    }
    if (claimant && feature.claimant && feature.claimant.id !== claimant.id) {
      throw new ClaimError(
        'WRONG_CLAIMANT',
        `Feature ${featureId} is held by ${feature.claimant.name || feature.claimant.id}, not ${claimant.name || claimant.id}.`,
      );
    }
    appendHistory(feature, 'transition', { from: prevStatus, to: newStatus, by: claimant, reason });
    feature.claimStatus = newStatus;

    this.save(data, { reason: `transition:${featureId}:${newStatus}` });
    return { ok: true, feature };
  }

  // ── list ──────────────────────────────────────────────────────────

  /**
   * List features, optionally filtered by status or claimant.
   * @param {{status?:string|string[], claimantId?:string}} filters
   */
  list(filters = {}) {
    const data = this.load();
    let out = data.features.slice();
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      out = out.filter((f) => statuses.includes(f.claimStatus || 'unclaimed'));
    }
    if (filters.claimantId) {
      out = out.filter((f) => f.claimant && f.claimant.id === filters.claimantId);
    }
    if (filters.claimedByHuman != null) {
      out = out.filter((f) => Boolean(f.claimant) === Boolean(filters.claimedByHuman) && (!f.claimant || f.claimant.type === 'human'));
    }
    if (filters.claimedByAgent != null) {
      out = out.filter((f) => Boolean(f.claimant) && f.claimant.type === 'agent');
    }
    return out;
  }

  /** Get a single feature with its full claim history. */
  get(featureId) {
    const data = this.load();
    return this._getOrThrow(data, featureId);
  }
}

// ── Path helper ──────────────────────────────────────────────────────

import { cwd } from 'node:process';

/** Default path under cwd / feature_list.json. */
export function defaultFeatureListPath() {
  if (process.env.BIZAR_FEATURE_LIST && process.env.BIZAR_FEATURE_LIST.trim()) {
    return resolve(process.env.BIZAR_FEATURE_LIST);
  }
  return join(cwd(), 'feature_list.json');
}
