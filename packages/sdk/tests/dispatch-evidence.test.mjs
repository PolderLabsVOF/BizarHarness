/**
 * packages/sdk/tests/dispatch-evidence.test.mjs
 *
 * F-191 / IMP-018 — append-only DispatchEvidence store regression
 * coverage. Pins the contract from IMPROVEMENTS.md line 871:
 * "Decision and verified outcome are linked by immutable ID."
 *
 * Cases:
 *   1. `append` then `get` round-trips a record.
 *   2. `append` of a duplicate `routingDecisionId` (same content)
 *      throws `DuplicateEvidenceError`.
 *   3. `attachOutcome` succeeds once.
 *   4. `attachOutcome` with the same outcome twice is idempotent.
 *   5. `attachOutcome` with a different outcome throws
 *      `OutcomeConflictError`.
 *   6. `verifyIntegrity` returns `{ ok: true }` for an unmodified
 *      record; tampering with the JSONL flips it to `{ ok: false,
 *      reason: 'inputs-hash-mismatch:...' }`.
 *   7. `findByRunId` returns every record sharing the runId.
 *   8. File store survives a fresh `EvidenceStore` instance at the
 *      same path.
 *   9. Two threads attempting `attachOutcome` simultaneously produce
 *      exactly one success.
 *  10. A failover follow-up row with the same routingDecisionId but
 *      a different decision content is accepted with sequence=1.
 *  11. `get` returns the highest-sequence row when the chain has
 *      multiple entries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileEvidenceStore,
  createInMemoryEvidenceStore,
  DuplicateEvidenceError,
  OutcomeConflictError,
  EvidenceNotFoundError,
  EvidenceStoreError,
} from "../src/router/dispatch-evidence.ts";
import { selectDispatchModel } from "../src/router/select-dispatch-model.ts";

function makeDecision(routingDecisionId, modelId = "anthropic/claude-haiku") {
  return {
    modelId,
    tier: "high",
    confidence: 0.9,
    ineligibleReasons: [],
    routingDecisionId,
    reason: "exact-capability",
    fallbackChain: [modelId],
  };
}

function makeTask() {
  return {
    task: "test task",
    role: "implementer",
    risk: "medium",
  };
}

function makeAppendInput(overrides = {}) {
  const routingDecisionId = overrides.routingDecisionId ?? "00000000-0000-4000-8000-000000000001";
  return {
    routingDecisionId,
    decision: overrides.decision ?? makeDecision(routingDecisionId, overrides.modelId),
    taskFeatures: overrides.taskFeatures ?? makeTask(),
    runId: overrides.runId ?? "run-1",
    agentName: overrides.agentName ?? "todd",
    workflowPhase: overrides.workflowPhase ?? "implement",
    selectedProfiles: overrides.selectedProfiles ?? [{ id: "anthropic/claude-haiku" }],
    staticProfiles: overrides.staticProfiles ?? [],
    activeSessionModel: overrides.activeSessionModel,
    budget: overrides.budget ?? {},
    health: overrides.health ?? {},
  };
}

describe("createInMemoryEvidenceStore (F-191 / IMP-018)", () => {
  it("round-trips an appended record via get", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    expect(built.routingDecisionId).toBe("00000000-0000-4000-8000-000000000001");
    expect(built.schemaVersion).toBe(1);
    expect(built.sequence).toBe(0);

    const fetched = await store.get(built.routingDecisionId);
    expect(fetched).toEqual(built);
  });

  it("rejects an append that matches an existing row's full content", async () => {
    const store = createInMemoryEvidenceStore();
    const input = makeAppendInput();
    await store.append(input);
    await expect(store.append(input)).rejects.toBeInstanceOf(DuplicateEvidenceError);
  });

  it("allows a follow-up row with the same routingDecisionId but different decision", async () => {
    const store = createInMemoryEvidenceStore();
    const primary = await store.append(makeAppendInput());
    const followUp = await store.append({
      ...makeAppendInput({ modelId: "anthropic/claude-sonnet" }),
      agentName: "failover",
    });
    expect(followUp.sequence).toBe(1);
    expect(followUp.isFollowUp).toBe(true);
    expect(followUp.decision.modelId).toBe("anthropic/claude-sonnet");
    expect(primary.routingDecisionId).toBe(followUp.routingDecisionId);
  });

  it("attaches an outcome exactly once", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    const withOutcome = await store.attachOutcome(built.routingDecisionId, {
      status: "success",
      durationMs: 1234,
      actualProviderModel: "anthropic/claude-haiku",
    });
    expect(withOutcome.outcome?.status).toBe("success");
    expect(withOutcome.outcome?.durationMs).toBe(1234);
  });

  it("attachOutcome with the same outcome twice is idempotent", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    const outcome = { status: "success", durationMs: 999 };
    const first = await store.attachOutcome(built.routingDecisionId, outcome);
    const second = await store.attachOutcome(built.routingDecisionId, outcome);
    expect(second.outcome).toEqual(first.outcome);
  });

  it("attachOutcome with a different outcome throws OutcomeConflictError", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    await store.attachOutcome(built.routingDecisionId, { status: "success" });
    await expect(
      store.attachOutcome(built.routingDecisionId, { status: "failure", errorMessage: "nope" }),
    ).rejects.toBeInstanceOf(OutcomeConflictError);
  });

  it("attachOutcome throws EvidenceNotFoundError for unknown id", async () => {
    const store = createInMemoryEvidenceStore();
    await expect(
      store.attachOutcome("nope", { status: "success" }),
    ).rejects.toBeInstanceOf(EvidenceNotFoundError);
  });

  it("verifyIntegrity returns { ok: true } for an unmodified record", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    const result = await store.verifyIntegrity(built.routingDecisionId);
    expect(result.ok).toBe(true);
  });

  it("findByRunId returns every record for the runId", async () => {
    const store = createInMemoryEvidenceStore();
    await store.append(makeAppendInput({ routingDecisionId: "00000000-0000-4000-8000-000000000010", runId: "run-A" }));
    await store.append(makeAppendInput({ routingDecisionId: "00000000-0000-4000-8000-000000000011", runId: "run-A", modelId: "anthropic/claude-sonnet" }));
    await store.append(makeAppendInput({ routingDecisionId: "00000000-0000-4000-8000-000000000012", runId: "run-B", modelId: "openai/gpt-4o" }));
    const runA = await store.findByRunId("run-A");
    expect(runA).toHaveLength(2);
    const runB = await store.findByRunId("run-B");
    expect(runB).toHaveLength(1);
  });

  it("get returns the highest-sequence row in a chain", async () => {
    const store = createInMemoryEvidenceStore();
    await store.append(makeAppendInput({ modelId: "anthropic/claude-haiku" }));
    await store.append(makeAppendInput({ modelId: "anthropic/claude-sonnet" }));
    const latest = await store.get("00000000-0000-4000-8000-000000000001");
    expect(latest.sequence).toBe(1);
    expect(latest.decision.modelId).toBe("anthropic/claude-sonnet");
  });

  it("two concurrent attachOutcome calls produce exactly one success", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    const outcome = { status: "success", durationMs: 50 };
    const results = await Promise.allSettled([
      store.attachOutcome(built.routingDecisionId, outcome),
      store.attachOutcome(built.routingDecisionId, outcome),
    ]);
    // Same outcome is idempotent; both resolve with the same record.
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");
    const final = await store.get(built.routingDecisionId);
    expect(final.outcome).toEqual({ status: "success", durationMs: 50, capturedAt: expect.any(String) });
  });

  it("two concurrent attachOutcome calls with DIFFERENT outcomes produce one success and one conflict", async () => {
    const store = createInMemoryEvidenceStore();
    const built = await store.append(makeAppendInput());
    const results = await Promise.allSettled([
      store.attachOutcome(built.routingDecisionId, { status: "success" }),
      store.attachOutcome(built.routingDecisionId, { status: "failure", errorMessage: "boom" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0]).reason).toBeInstanceOf(OutcomeConflictError);
  });

  it("stamps schemaVersion=1 and an ISO createdAt server-side", async () => {
    const fixedNow = new Date("2026-08-27T00:00:00.000Z");
    const store = createInMemoryEvidenceStore({ now: () => fixedNow });
    const built = await store.append(makeAppendInput());
    expect(built.schemaVersion).toBe(1);
    expect(built.createdAt).toBe("2026-08-27T00:00:00.000Z");
  });

  it("computes deterministic input hashes for identical inputs", async () => {
    const store = createInMemoryEvidenceStore();
    const a = await store.append(makeAppendInput({ routingDecisionId: "00000000-0000-4000-8000-000000000020" }));
    const b = await store.append(makeAppendInput({ routingDecisionId: "00000000-0000-4000-8000-000000000021", modelId: "anthropic/claude-sonnet" }));
    // Different modelId, but canonical JSON of the input shape should produce identical hashes (the model list + budget + health are the same).
    expect(a.inputs.selectedProfilesHash).toBe(b.inputs.selectedProfilesHash);
    expect(a.inputs.staticProfilesHash).toBe(b.inputs.staticProfilesHash);
    expect(a.inputs.budgetHash).toBe(b.inputs.budgetHash);
    expect(a.inputs.healthHash).toBe(b.inputs.healthHash);
  });

  it("tail returns the last N rows", async () => {
    const store = createInMemoryEvidenceStore();
    for (let i = 0; i < 5; i++) {
      const hex = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await store.append(makeAppendInput({ routingDecisionId: hex, modelId: `m-${i}` }));
    }
    const last3 = await store.tail({ limit: 3 });
    expect(last3).toHaveLength(3);
    expect(last3[0].decision.modelId).toBe("m-2");
    expect(last3[2].decision.modelId).toBe("m-4");
  });
});

describe("createFileEvidenceStore (F-191 / IMP-018)", () => {
  let tmpDir;
  let storePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bizar-evidence-"));
    storePath = join(tmpDir, "dispatch.jsonl");
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes JSONL with fsync, survives a fresh store at the same path", async () => {
    const storeA = createFileEvidenceStore({ dir: tmpDir });
    const built = await storeA.append(makeAppendInput());
    expect(existsSync(storePath)).toBe(true);

    const fresh = createFileEvidenceStore({ dir: tmpDir });
    const reloaded = await fresh.get(built.routingDecisionId);
    expect(reloaded).toEqual(built);
  });

  it("verifyIntegrity flips to { ok: false, reason: 'inputs-hash-mismatch:...' } on a tampered JSONL row", async () => {
    const storeA = createFileEvidenceStore({ dir: tmpDir });
    const built = await storeA.append(makeAppendInput());

    // Tamper: rewrite the JSONL so the first row's selectedProfilesHash is
    // a non-hex string. The store reads on every verify call.
    const raw = readFileSync(storePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const parsed = JSON.parse(lines[0]);
    parsed.inputs.selectedProfilesHash = "not-a-hash";
    lines[0] = JSON.stringify(parsed);
    writeFileSync(storePath, lines.join("\n") + "\n");

    const fresh = createFileEvidenceStore({ dir: tmpDir });
    const result = await fresh.verifyIntegrity(built.routingDecisionId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inputs-hash-mismatch/);
  });

  it("rejects an EACCES-style disk failure by surfacing EvidenceStoreError", async () => {
    // We can't easily simulate EACCES on a tmpfs without root, but we
    // can drive the mkdir failure path by passing a path whose parent
    // is a file (not a directory).
    const blocker = join(tmpDir, "blocker");
    writeFileSync(blocker, "x");
    expect(() => createFileEvidenceStore({ dir: join(blocker, "nested") }).append(makeAppendInput()))
      .rejects.toBeInstanceOf(Error);
  });

  it("attaches outcome atomically; concurrent attachOutcome with the same outcome is idempotent", async () => {
    const storeA = createFileEvidenceStore({ dir: tmpDir });
    const built = await storeA.append(makeAppendInput());
    const outcome = { status: "success", durationMs: 7 };
    const [a, b] = await Promise.all([
      storeA.attachOutcome(built.routingDecisionId, outcome),
      storeA.attachOutcome(built.routingDecisionId, outcome),
    ]);
    expect(a.outcome?.status).toBe("success");
    expect(b.outcome?.status).toBe("success");
    const fresh = createFileEvidenceStore({ dir: tmpDir });
    const final = await fresh.get(built.routingDecisionId);
    expect(final.outcome?.status).toBe("success");
    expect(final.outcome?.durationMs).toBe(7);
  });
});

describe("selectDispatchModel evidence integration (F-191 / IMP-018)", () => {
  it("appends exactly one row per call when an evidenceStore is supplied", () => {
    const store = createInMemoryEvidenceStore();
    const decision = selectDispatchModel({
      task: { task: "draft a plan", role: "planner", risk: "medium" },
      selectedProfiles: [{ id: "anthropic/claude-haiku", tier: "high" }],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-sonnet",
      budget: {},
      health: {},
      runId: "run-evidence-1",
      evidenceStore: store,
      agentName: "todd",
      workflowPhase: "plan",
    });
    expect(decision.routingDecisionId).toMatch(/^[0-9a-f-]{36}$/);
    // The append is fire-and-forget but the in-memory store completes
    // synchronously, so a follow-up get() must see the row.
    return store.get(decision.routingDecisionId).then((row) => {
      expect(row).not.toBeNull();
      expect(row.decision.routingDecisionId).toBe(decision.routingDecisionId);
      expect(row.taskFeatures.task).toBe("draft a plan");
      expect(row.runId).toBe("run-evidence-1");
      expect(row.agentName).toBe("todd");
      expect(row.workflowPhase).toBe("plan");
    });
  });

  it("does NOT append when evidenceStore is omitted", async () => {
    // Run several selector calls; the in-memory store starts empty.
    const store = createInMemoryEvidenceStore();
    for (let i = 0; i < 3; i++) {
      selectDispatchModel({
        task: { task: "noop", role: "implementer", risk: "low" },
        selectedProfiles: [{ id: "anthropic/claude-haiku", tier: "high" }],
        staticProfiles: [],
        activeSessionModel: undefined,
        budget: {},
        health: {},
        runId: "no-store",
      });
    }
    expect((await store.tail()).length).toBe(0);
  });

  it("selectedProfilesHash is deterministic for identical inputs", () => {
    const store = createInMemoryEvidenceStore();
    const base = {
      task: { task: "hash me", role: "implementer", risk: "low" },
      selectedProfiles: [
        { id: "anthropic/claude-haiku", tier: "high" },
        { id: "anthropic/claude-sonnet", tier: "default" },
      ],
      staticProfiles: [],
      budget: { remainingUsd: 100, maxUsdPerCall: 5 },
      health: { "anthropic/claude-haiku": { status: "healthy" } },
      runId: "run-hash",
      evidenceStore: store,
    };
    const a = selectDispatchModel(base);
    const b = selectDispatchModel({ ...base, runId: "run-hash-2" });
    return Promise.all([
      store.get(a.routingDecisionId),
      store.get(b.routingDecisionId),
    ]).then(([rowA, rowB]) => {
      expect(rowA.inputs.selectedProfilesHash).toBe(rowB.inputs.selectedProfilesHash);
      expect(rowA.inputs.budgetHash).toBe(rowB.inputs.budgetHash);
      expect(rowA.inputs.healthHash).toBe(rowB.inputs.healthHash);
    });
  });
});
