/**
 * packages/sdk/tests/select-dispatch-model-evidence.test.mjs
 *
 * F-191 / IMP-018 — evidence-store wiring through the central
 * selector + failover walker. The companion to
 * `dispatch-evidence.test.mjs` (which covers the store surface in
 * isolation); this file drives the real `selectDispatchModel` +
 * `pickFailover` calls with a real `InMemoryEvidenceStore` and
 * pins the contract from IMPROVEMENTS.md line 879:
 *
 *   - 100% of subagent and team-member dispatches have a recorded
 *     model decision.
 *   - Deterministic replay for identical config, health snapshot,
 *     budget, task features, and router-policy version.
 *
 * Cases:
 *   1. Every call produces exactly one row.
 *   2. The row's `decision` matches the returned `ModelDecision` verbatim.
 *   3. `taskFeatures` matches the input verbatim.
 *   4. `inputs.selectedProfilesHash` is deterministic for identical inputs.
 *   5. `findByRunId(runId)` returns every row emitted under that runId.
 *   6. Failover path appends a follow-up row with the same routingDecisionId.
 */

import { describe, it, expect } from "vitest";

import {
  createInMemoryEvidenceStore,
} from "../src/router/dispatch-evidence.ts";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  selectDispatchModel,
} from "../src/router/select-dispatch-model.ts";
import { pickFailover } from "../src/router/failover.ts";
import { loadModelRegistry } from "../src/router/agent-model-registry.ts";

const STANDARD_PROFILES = [
  { id: "anthropic/claude-haiku", tier: "high" },
  { id: "anthropic/claude-sonnet", tier: "default" },
];

const SAMPLE_ROUTER = {
  $schema: "https://bizar.dev/schema/model-router.v3.json",
  version: "13.0.0",
  endpoint: "http://localhost:20128/v1",
  gateway: {
    endpoint: "http://localhost:20128/v1",
    availabilityProbe: "/models",
    unavailableBehavior: "inherit-session",
  },
  tiers: {
    premium: { models: ["provider/premium"], purpose: "hard", effort: "high" },
    high: { models: ["anthropic/claude-haiku"], purpose: "ordinary", effort: "medium" },
    default: { models: ["anthropic/claude-sonnet"], purpose: "ordinary", effort: "medium" },
    mid: { models: ["provider/mid"], purpose: "bounded", effort: "medium" },
  },
  roleDefaults: { mike: "premium", todd: "high", brenda: "mid" },
  policies: {
    mainOrchestrator: "mike",
    selectionOwner: "orchestrator",
    discoveryFailure: "inherit-session",
    unavailableModel: "inherit-session",
    retryModelAliases: false,
    maxDispatchModelAttempts: 1,
  },
  userSelected: {
    models: ["anthropic/claude-haiku", "anthropic/claude-sonnet"],
    tierHints: { "anthropic/claude-haiku": "high", "anthropic/claude-sonnet": "default" },
  },
};

let tmpDir;
let configPath;

function setupRouter() {
  tmpDir = mkdtempSync(join(tmpdir(), "bizar-evidence-router-"));
  configPath = join(tmpDir, "model-router.json");
  writeFileSync(configPath, JSON.stringify(SAMPLE_ROUTER));
  return loadModelRegistry({ configPath });
}

function teardownRouter() {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
}

function standardInput(overrides = {}) {
  return {
    task: { task: "draft a plan", role: "implementer", risk: "medium" },
    selectedProfiles: STANDARD_PROFILES,
    staticProfiles: [],
    activeSessionModel: "anthropic/claude-sonnet",
    budget: { remainingUsd: 100, maxUsdPerCall: 5 },
    health: { "anthropic/claude-haiku": { status: "healthy" }, "anthropic/claude-sonnet": { status: "healthy" } },
    runId: "run-evidence",
    ...overrides,
  };
}

describe("selectDispatchModel + EvidenceStore integration (F-191 / IMP-018)", () => {
  it("appends exactly one row per call", async () => {
    const store = createInMemoryEvidenceStore();
    const calls = [];
    for (let i = 0; i < 4; i++) {
      const decision = selectDispatchModel({ ...standardInput({ runId: `run-${i}` }), evidenceStore: store });
      calls.push(decision);
    }
    const tail = await store.tail();
    expect(tail).toHaveLength(4);
  });

  it("row's decision matches the returned ModelDecision verbatim", async () => {
    const store = createInMemoryEvidenceStore();
    const decision = selectDispatchModel({ ...standardInput(), evidenceStore: store });
    const row = await store.get(decision.routingDecisionId);
    expect(row).not.toBeNull();
    // Compare the JSON shape; the function reference equality doesn't matter.
    expect(row.decision.routingDecisionId).toBe(decision.routingDecisionId);
    expect(row.decision.modelId).toBe(decision.modelId);
    expect(row.decision.tier).toBe(decision.tier);
    expect(row.decision.confidence).toBe(decision.confidence);
    expect(row.decision.reason).toBe(decision.reason);
    expect(row.decision.fallbackChain).toEqual(decision.fallbackChain);
    expect(row.decision.ineligibleReasons).toEqual(decision.ineligibleReasons);
  });

  it("taskFeatures matches the input verbatim", async () => {
    const store = createInMemoryEvidenceStore();
    const taskFeatures = { task: "complex task", role: "implementer", risk: "high", capabilities: ["code"] };
    const decision = selectDispatchModel({ ...standardInput({ task: taskFeatures }), evidenceStore: store });
    const row = await store.get(decision.routingDecisionId);
    expect(row.taskFeatures).toEqual(taskFeatures);
  });

  it("selectedProfilesHash is deterministic for identical inputs", async () => {
    const store = createInMemoryEvidenceStore();
    const a = selectDispatchModel({ ...standardInput({ runId: "A" }), evidenceStore: store });
    const b = selectDispatchModel({ ...standardInput({ runId: "B" }), evidenceStore: store });
    const rowA = await store.get(a.routingDecisionId);
    const rowB = await store.get(b.routingDecisionId);
    expect(rowA.inputs.selectedProfilesHash).toBe(rowB.inputs.selectedProfilesHash);
    expect(rowA.inputs.budgetHash).toBe(rowB.inputs.budgetHash);
    expect(rowA.inputs.healthHash).toBe(rowB.inputs.healthHash);
  });

  it("findByRunId returns every row emitted under that runId", async () => {
    const store = createInMemoryEvidenceStore();
    for (let i = 0; i < 5; i++) {
      selectDispatchModel({ ...standardInput({ runId: "shared-run" }), evidenceStore: store });
    }
    selectDispatchModel({ ...standardInput({ runId: "other-run" }), evidenceStore: store });
    const shared = await store.findByRunId("shared-run");
    expect(shared).toHaveLength(5);
    const other = await store.findByRunId("other-run");
    expect(other).toHaveLength(1);
  });

  it("failover path appends a follow-up row with the same routingDecisionId", async () => {
    const store = createInMemoryEvidenceStore();
    // Step 1: a primary decision lands a row (sequence=0).
    const primary = selectDispatchModel({
      ...standardInput({ runId: "failover-run" }),
      evidenceStore: store,
    });
    // Step 2: simulate a transport failure on the primary and walk
    // the failover chain via the SDK's pickFailover walker.
    const registry = setupRouter();
    const verdict = pickFailover({
      registry,
      role: "implementer",
      attemptedIds: [primary.modelId ?? ""],
      failure: "provider-outage",
      primaryDecisionId: primary.routingDecisionId,
      evidenceStore: store,
      runId: "failover-run",
      taskFeatures: { task: "complex task", role: "implementer", risk: "high" },
      selectedProfiles: STANDARD_PROFILES,
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-sonnet",
      budget: { remainingUsd: 100, maxUsdPerCall: 5 },
      health: { "anthropic/claude-haiku": { status: "healthy" }, "anthropic/claude-sonnet": { status: "healthy" } },
    });
    expect(verdict.failover).not.toBeNull();
    expect(verdict.routingDecisionId).toBe(primary.routingDecisionId);

    // Allow the fire-and-forget append to flush; in-memory store is sync.
    await new Promise((r) => setImmediate(r));

    const chain = await store.findByRunId("failover-run");
    // Two rows: primary (sequence=0) + failover follow-up (sequence=1).
    expect(chain.length).toBeGreaterThanOrEqual(2);
    const followUps = chain.filter((r) => r.routingDecisionId === primary.routingDecisionId && (r.sequence ?? 0) > 0);
    expect(followUps).toHaveLength(1);
    expect(followUps[0].isFollowUp).toBe(true);
    expect(followUps[0].decision.modelId).toBe(verdict.failover.id);
    expect(followUps[0].decision.reason).toMatch(/^failover:/);
    teardownRouter();
  });

  it("failover path without an evidenceStore is the legacy behaviour (no rows added)", async () => {
    const store = createInMemoryEvidenceStore();
    const primary = selectDispatchModel({
      ...standardInput({ runId: "legacy" }),
      evidenceStore: store,
    });
    const registry = setupRouter();
    const verdict = pickFailover({
      registry,
      role: "implementer",
      attemptedIds: [primary.modelId ?? ""],
      failure: "provider-outage",
      primaryDecisionId: primary.routingDecisionId,
      // evidenceStore intentionally omitted.
    });
    expect(verdict.failover).not.toBeNull();
    await new Promise((r) => setImmediate(r));
    const chain = await store.findByRunId("legacy");
    // Only the primary row.
    expect(chain).toHaveLength(1);
    teardownRouter();
  });
});
