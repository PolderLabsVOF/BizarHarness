/**
 * handoff/bizplan.test.ts — Unit tests for the Bizplan handoff contract.
 *
 * Mirrors the legacy `ralplan.test.ts` shape and adds coverage for the
 * new tier-selection rule, the schema-defaulting behaviour of
 * `validateBizplanHandoff`, and the discrimination between `light`,
 * `standard`, and `heavy` evidence payloads.
 */

import { describe, it, beforeEach, afterEach, test } from "vitest";
import assert from "node:assert/strict";

import {
  BIZPLAN_HANDOFF_SCHEMA_VERSION,
  tierFromRequest,
  validateBizplanHandoff,
} from "../../src/handoff/bizplan.js";

const validEvidence = {
  body: "plan body",
  artifactRef: "plans/run-1/plan.md",
  completedAt: "2026-09-03T12:00:00.000Z",
};

describe("BIZPLAN_HANDOFF_SCHEMA_VERSION", () => {
  it("is the canonical 1.0.0", () => {
    assert.equal(BIZPLAN_HANDOFF_SCHEMA_VERSION, "1.0.0");
  });
});

describe("tierFromRequest", () => {
  it("forces heavy when ambiguity exceeds 0.20 even for a single isolated file", () => {
    assert.equal(
      tierFromRequest({
        files: 1,
        behaviorChange: false,
        lanes: 1,
        architectureImpact: "isolated",
        ambiguity: 0.21,
      }),
      "heavy",
    );
  });

  it("forces heavy when ambiguity is well above 0.20", () => {
    assert.equal(
      tierFromRequest({
        files: 1,
        behaviorChange: false,
        lanes: 1,
        architectureImpact: "isolated",
        ambiguity: 0.85,
      }),
      "heavy",
    );
  });

  it("returns light for a single file with no behavior change", () => {
    assert.equal(
      tierFromRequest({
        files: 1,
        behaviorChange: false,
        lanes: 1,
        architectureImpact: "shared",
        ambiguity: 0.05,
      }),
      "light",
    );
  });

  it("returns light even when architectureImpact is isolated if the file and behavior gate match", () => {
    assert.equal(
      tierFromRequest({
        files: 1,
        behaviorChange: false,
        lanes: 1,
        architectureImpact: "isolated",
        ambiguity: 0.05,
      }),
      "light",
    );
  });

  it("does not return light when behaviorChange is true even if files === 1", () => {
    assert.equal(
      tierFromRequest({
        files: 1,
        behaviorChange: true,
        lanes: 1,
        architectureImpact: "isolated",
        ambiguity: 0.05,
      }),
      "standard",
    );
  });

  it("returns standard for a multi-file single-lane request with shared impact", () => {
    assert.equal(
      tierFromRequest({
        files: 4,
        behaviorChange: true,
        lanes: 1,
        architectureImpact: "shared",
        ambiguity: 0.1,
      }),
      "standard",
    );
  });

  it("returns standard when architectureImpact is isolated (regardless of file count)", () => {
    assert.equal(
      tierFromRequest({
        files: 12,
        behaviorChange: true,
        lanes: 2,
        architectureImpact: "isolated",
        ambiguity: 0.1,
      }),
      "standard",
    );
  });

  it("returns heavy for cross-cutting multi-lane requests with non-trivial ambiguity", () => {
    assert.equal(
      tierFromRequest({
        files: 6,
        behaviorChange: true,
        lanes: 2,
        architectureImpact: "cross-cutting",
        ambiguity: 0.18,
      }),
      "heavy",
    );
  });

  it("returns heavy for ambiguous 0.20 boundary inputs (only > 0.20 forces heavy)", () => {
    assert.equal(
      tierFromRequest({
        files: 3,
        behaviorChange: true,
        lanes: 1,
        architectureImpact: "shared",
        ambiguity: 0.2,
      }),
      "standard",
    );
  });
});

describe("validateBizplanHandoff — happy path", () => {
  it("accepts an empty handoff (no claim made)", () => {
    const r = validateBizplanHandoff({});
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.schemaVersion, BIZPLAN_HANDOFF_SCHEMA_VERSION);
    }
  });

  it("accepts a handoff with all three role evidence blocks", () => {
    const r = validateBizplanHandoff({
      runId: "run-42",
      producedAt: "2026-09-03T12:00:00.000Z",
      tier: "standard",
      planner: validEvidence,
      architect: { ...validEvidence, artifactRef: "plans/run-1/architect.md" },
      critic: { ...validEvidence, artifactRef: "plans/run-1/critic.md" },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.runId, "run-42");
      assert.equal(r.value.tier, "standard");
      assert.ok(r.value.planner);
      assert.ok(r.value.architect);
      assert.ok(r.value.critic);
    }
  });

  it("accepts a handoff with light tier and only planner evidence", () => {
    const r = validateBizplanHandoff({
      producedAt: "2026-09-03T12:00:00.000Z",
      tier: "light",
      planner: validEvidence,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.tier, "light");
      assert.deepEqual(r.value.architect, undefined);
    }
  });

  it("defaults schemaVersion to the canonical version when omitted", () => {
    const r = validateBizplanHandoff({ planner: validEvidence });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.schemaVersion, BIZPLAN_HANDOFF_SCHEMA_VERSION);
    }
  });

  it("preserves a matching explicit schemaVersion", () => {
    const r = validateBizplanHandoff({ schemaVersion: BIZPLAN_HANDOFF_SCHEMA_VERSION });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.schemaVersion, BIZPLAN_HANDOFF_SCHEMA_VERSION);
    }
  });
});

describe("validateBizplanHandoff — rejection paths", () => {
  it("rejects non-object root", () => {
    assert.equal(validateBizplanHandoff(null).ok, false);
    assert.equal(validateBizplanHandoff([]).ok, false);
    assert.equal(validateBizplanHandoff("not a handoff").ok, false);
  });

  it("rejects mismatched schemaVersion", () => {
    const r = validateBizplanHandoff({ schemaVersion: "2.0.0" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("schemaVersion"));
  });

  it("rejects non-string schemaVersion", () => {
    const r = validateBizplanHandoff({ schemaVersion: 1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("schemaVersion"));
  });

  it("rejects unknown tier", () => {
    const r = validateBizplanHandoff({ tier: "ultra" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("tier"));
  });

  it("rejects non-string tier", () => {
    const r = validateBizplanHandoff({ tier: 7 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("tier"));
  });

  it("rejects invalid producedAt", () => {
    const r = validateBizplanHandoff({ producedAt: "not-a-date" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("producedAt"));
  });

  it("rejects planner evidence with empty body", () => {
    const r = validateBizplanHandoff({ planner: { ...validEvidence, body: "" } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.body"));
  });

  it("rejects planner evidence with missing completedAt", () => {
    const { completedAt: _completedAt, ...rest } = validEvidence;
    void _completedAt;
    const r = validateBizplanHandoff({ planner: rest });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.completedAt"));
  });

  it("rejects architect evidence when the role block is not an object", () => {
    const r = validateBizplanHandoff({ architect: "not an object" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("architect.evidence"));
  });

  it("rejects critic evidence with empty artifactRef", () => {
    const r = validateBizplanHandoff({ critic: { ...validEvidence, artifactRef: "" } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("critic.artifactRef"));
  });

  it("aggregates missing paths across roles", () => {
    const r = validateBizplanHandoff({
      planner: { body: "", artifactRef: "", completedAt: "garbage" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.missing.includes("planner.body"));
      assert.ok(r.missing.includes("planner.artifactRef"));
      assert.ok(r.missing.includes("planner.completedAt"));
    }
  });
});

// ── Persistence tests ──────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistBizplanPlan,
  spawnExecutorTask,
  type BizplanPlan,
} from "../../src/handoff/bizplan.js";

function makeOkDir(): string {
  return mkdtempSync(join(tmpdir(), "bizplan-test-"));
}

function samplePlan(overrides: Partial<BizplanPlan> = {}): BizplanPlan {
  return {
    id: "",
    tier: "standard",
    title: "test plan",
    phases: [{ name: "spec", owner: "todd" }],
    createdAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("persistBizplanPlan", () => {
  let okDir: string;
  beforeEach(() => {
    okDir = makeOkDir();
  });
  afterEach(() => {
    rmSync(okDir, { recursive: true, force: true });
  });

  test("writes .ok/plans/pln-<id>.json with schemaVersion + persistedAt", () => {
    const persisted = persistBizplanPlan(samplePlan({ title: "first plan" }), { okDir });
    const planFile = join(okDir, "plans", `${persisted.id}.json`);
    assert.ok(existsSync(planFile), `expected ${planFile} to exist`);
    const parsed = JSON.parse(readFileSync(planFile, "utf8")) as Record<string, unknown>;
    assert.equal(parsed.title, "first plan");
    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.ok(typeof parsed.persistedAt === "string" && parsed.persistedAt.length > 0);
  });

  test("no leftover .tmp-* files after success", () => {
    persistBizplanPlan(samplePlan({ title: "atomic" }), { okDir });
    const plansDir = join(okDir, "plans");
    const files = readdirSync(plansDir);
    const tmps = files.filter((f) => f.includes(".tmp-"));
    assert.equal(tmps.length, 0, `expected zero .tmp- files, found: ${tmps.join(", ")}`);
  });

  test("cross-references single open PRD automatically", () => {
    const prdsDir = join(okDir, "prds");
    mkdirSync(prdsDir, { recursive: true });
    writeFileSync(
      join(prdsDir, "prd-foo.json"),
      JSON.stringify({ id: "prd-foo", status: "open", title: "matching PRD" }),
      "utf8",
    );
    const persisted = persistBizplanPlan(samplePlan({ title: "auto cross-ref" }), { okDir });
    assert.equal(persisted.prdId, "prd-foo");
  });

  test("warns + leaves prdId unset when multiple open PRDs match", () => {
    const prdsDir = join(okDir, "prds");
    mkdirSync(prdsDir, { recursive: true });
    writeFileSync(join(prdsDir, "a.json"), JSON.stringify({ id: "prd-a", status: "open" }));
    writeFileSync(join(prdsDir, "b.json"), JSON.stringify({ id: "prd-b", status: "open" }));
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const persisted = persistBizplanPlan(samplePlan({ title: "ambiguous" }), { okDir });
      assert.equal(persisted.prdId, undefined);
      assert.ok(warned, "expected console.warn when multiple PRDs match");
    } finally {
      console.warn = originalWarn;
    }
  });

  test("throws when title is empty", () => {
    assert.throws(() => persistBizplanPlan(samplePlan({ title: "" }), { okDir }), /title is required/);
  });

  test("throws when phases is empty", () => {
    assert.throws(() =>
      persistBizplanPlan(samplePlan({ title: "no phases", phases: [] }), { okDir }),
      /phases must be a non-empty array/,
    );
  });
});

describe("spawnExecutorTask", () => {
  let okDir: string;
  beforeEach(() => {
    okDir = makeOkDir();
  });
  afterEach(() => {
    rmSync(okDir, { recursive: true, force: true });
  });

  test("writes .ok/tasks/tsk-<id>.json with status=claimed and links.planId", () => {
    const plan = samplePlan({ id: "pln-test01", title: "with task" });
    const task = spawnExecutorTask(plan, { okDir });
    assert.match(task.id, /^tsk-[a-z0-9]+$/);
    assert.equal(task.planId, "pln-test01");
    assert.equal(task.status, "claimed");
    assert.equal(task.links.planId, "pln-test01");
    const taskFile = join(okDir, "tasks", `${task.id}.json`);
    assert.ok(existsSync(taskFile));
    const parsed = JSON.parse(readFileSync(taskFile, "utf8")) as Record<string, unknown>;
    assert.equal(parsed.status, "claimed");
    const links = parsed.links as { planId: string };
    assert.equal(links.planId, "pln-test01");
  });

  test("no leftover .tmp-* files after success", () => {
    const plan = samplePlan({ id: "pln-atomic", title: "atomic task" });
    spawnExecutorTask(plan, { okDir });
    const tasksDir = join(okDir, "tasks");
    const files = readdirSync(tasksDir);
    const tmps = files.filter((f) => f.includes(".tmp-"));
    assert.equal(tmps.length, 0, `expected zero .tmp- files, found: ${tmps.join(", ")}`);
  });

  test("records assignee when provided", () => {
    const plan = samplePlan({ id: "pln-with-assignee", title: "with assignee" });
    const task = spawnExecutorTask(plan, { okDir, assignee: "todd" });
    assert.equal(task.assignee, "todd");
    const taskFile = join(okDir, "tasks", `${task.id}.json`);
    const parsed = JSON.parse(readFileSync(taskFile, "utf8")) as { assignee?: string };
    assert.equal(parsed.assignee, "todd");
  });

  test("throws when plan.id is missing", () => {
    assert.throws(
      () => spawnExecutorTask(samplePlan({ id: "", title: "no id" }), { okDir }),
      /plan.id is required/,
    );
  });
});
