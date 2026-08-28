/**
 * packages/sdk/tests/e2e/_fixtures/evidence-store-stub.mjs —
 * Local in-memory stand-in for the F-191 `EvidenceStore` (IMP-022 / F-192).
 *
 * F-191 (`packages/sdk/src/router/dispatch-evidence.ts`) is being shipped
 * by another Todd agent on `wt/todd-imp018-evidence` and is NOT YET ON
 * MASTER. IMP-022 must not depend on its specific export shape at module
 * load time. This stub implements the same contract — `append`, `get`,
 * `findByRunId`, `attachOutcome`, `verifyIntegrity`, `tail` — so the
 * E2E harness can wire a real evidence store today and swap to the
 * upstream import once F-191 lands.
 *
 * The shape mirrors `dispatch-evidence.ts`'s published surface verbatim
 * so the swap is mechanical: `import { createInMemoryEvidenceStore }
 * from '../src/router/dispatch-evidence.ts'` replaces the local helper
 * with zero changes to the E2E test bodies.
 *
 * Contract (matches F-191):
 *
 *   1. `append` stamps `createdAt` + `schemaVersion: 1` server-side.
 *   2. Duplicate `routingDecisionId` throws `DuplicateEvidenceError`.
 *   3. `attachOutcome` is exactly-once per `routingDecisionId`; calling
 *      twice with the SAME outcome is idempotent; calling twice with a
 *      DIFFERENT outcome throws `OutcomeConflictError`.
 *   4. `verifyIntegrity` recomputes structural invariants.
 *   5. `findByRunId` returns records in insertion order.
 *
 * IMPORTANT: this file is a TEST FIXTURE. Production code under
 * `packages/sdk/src/` MUST NOT import it. The drift guard in
 * `scripts/__tests__/autonomy-contract-e2e.test.mjs` enforces the
 * boundary.
 */

import { createHash, randomUUID } from 'node:crypto';

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Errors (F-018 taxonomy)                           */
/* ────────────────────────────────────────────────────────────────────────── */

export class EvidenceStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EvidenceStoreError';
    this.code = code;
  }
}

export class DuplicateEvidenceError extends EvidenceStoreError {
  constructor(routingDecisionId) {
    super('duplicate-routingDecisionId', `DispatchEvidence with routingDecisionId=${routingDecisionId} already exists`);
    this.name = 'DuplicateEvidenceError';
    this.routingDecisionId = routingDecisionId;
  }
}

export class OutcomeConflictError extends EvidenceStoreError {
  constructor(routingDecisionId) {
    super('outcome-conflict', `Outcome for routingDecisionId=${routingDecisionId} already attached with a different value`);
    this.name = 'OutcomeConflictError';
    this.routingDecisionId = routingDecisionId;
  }
}

export class EvidenceNotFoundError extends EvidenceStoreError {
  constructor(routingDecisionId) {
    super('not-found', `DispatchEvidence with routingDecisionId=${routingDecisionId} not found`);
    this.name = 'EvidenceNotFoundError';
    this.routingDecisionId = routingDecisionId;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Canonical hashing                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalOutcome(outcome) {
  return canonicalJson({
    status: outcome?.status ?? null,
    durationMs: outcome?.durationMs ?? null,
    errorMessage: outcome?.errorMessage ?? null,
    actualProviderModel: outcome?.actualProviderModel ?? null,
    capturedAt: outcome?.capturedAt ?? null,
    verifiedBy: outcome?.verifiedBy ?? null,
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Store                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Create a fresh in-memory evidence store. The store is intentionally
 * process-local: nothing is persisted to disk, nothing survives the
 * test process. For production durability the F-191
 * `createFileEvidenceStore` is the canonical implementation; this stub
 * exists purely so the IMP-022 E2E matrix can run before F-191 merges.
 *
 * @returns {{
 *   append: (record: object) => Promise<object>,
 *   get: (routingDecisionId: string) => Promise<object|null>,
 *   findByRunId: (runId: string) => Promise<object[]>,
 *   attachOutcome: (routingDecisionId: string, outcome: object) => Promise<object>,
 *   verifyIntegrity: (routingDecisionId: string) => Promise<{ ok: boolean, reason?: string }>,
 *   tail: (opts?: { limit?: number }) => Promise<object[]>,
 * }}
 */
export function createInMemoryEvidenceStore() {
  const byId = new Map();

  async function append(record) {
    if (!record || typeof record !== 'object') {
      throw new EvidenceStoreError('bad-input', 'append() requires a record object');
    }
    const { routingDecisionId, decision, taskFeatures, runId, selectedProfiles, staticProfiles, activeSessionModel, budget, health } = record;
    if (!routingDecisionId) throw new EvidenceStoreError('bad-input', 'routingDecisionId is required');
    if (byId.has(routingDecisionId)) throw new DuplicateEvidenceError(routingDecisionId);
    const stored = {
      routingDecisionId,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      decision,
      taskFeatures,
      runId: runId ?? 'ad-hoc',
      agentName: record.agentName,
      workflowPhase: record.workflowPhase,
      inputs: {
        selectedProfilesHash: sha256Hex(selectedProfiles ?? []),
        staticProfilesHash: sha256Hex(staticProfiles ?? []),
        activeSessionModel: activeSessionModel ?? undefined,
        budgetHash: sha256Hex(budget ?? {}),
        healthHash: sha256Hex(health ?? {}),
      },
      outcome: undefined,
    };
    byId.set(routingDecisionId, stored);
    return { ...stored };
  }

  async function get(routingDecisionId) {
    const row = byId.get(routingDecisionId);
    if (!row) return null;
    return { ...row };
  }

  async function findByRunId(runId) {
    const out = [];
    for (const row of byId.values()) {
      if (row.runId === runId) out.push({ ...row });
    }
    return out;
  }

  async function attachOutcome(routingDecisionId, outcome) {
    const row = byId.get(routingDecisionId);
    if (!row) throw new EvidenceNotFoundError(routingDecisionId);
    const incoming = canonicalOutcome(outcome);
    if (!row.outcome) {
      row.outcome = { ...outcome, capturedAt: outcome?.capturedAt ?? new Date().toISOString() };
      return { ...row };
    }
    const existing = canonicalOutcome(row.outcome);
    if (existing === incoming) {
      return { ...row };
    }
    throw new OutcomeConflictError(routingDecisionId);
  }

  async function verifyIntegrity(routingDecisionId) {
    const row = byId.get(routingDecisionId);
    if (!row) return { ok: false, reason: 'not-found' };
    if (row.schemaVersion !== 1) return { ok: false, reason: 'schema-version' };
    if (typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt))) {
      return { ok: false, reason: 'createdAt-parse' };
    }
    const hashes = row.inputs ?? {};
    for (const key of ['selectedProfilesHash', 'staticProfilesHash', 'budgetHash', 'healthHash']) {
      if (typeof hashes[key] !== 'string' || !/^[0-9a-f]{64}$/.test(hashes[key])) {
        return { ok: false, reason: `hash-shape-${key}` };
      }
    }
    if (row.decision?.routingDecisionId !== row.routingDecisionId) {
      return { ok: false, reason: 'decision-id-mismatch' };
    }
    return { ok: true };
  }

  async function tail(opts = {}) {
    const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
    const all = Array.from(byId.values());
    const slice = all.slice(-limit);
    return slice.map((r) => ({ ...r }));
  }

  return {
    append,
    get,
    findByRunId,
    attachOutcome,
    verifyIntegrity,
    tail,
    /** Internal handle used by tests to mint a stable routingDecisionId. */
    _mintRunId: () => `e2e-${randomUUID()}`,
  };
}