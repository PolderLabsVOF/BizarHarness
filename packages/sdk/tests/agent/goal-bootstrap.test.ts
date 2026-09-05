/**
 * goal-bootstrap.test.ts
 *
 * F-207 — autonomous goal / ultragoal bootstrap SDK smoke test.
 *
 * Coverage (per brief):
 *   1. empty features list → idle
 *   2. all passing features → idle
 *   3. one not_started → bootstrap + charter file exists + readable
 *   4. existing charter for in_progress feature → resume (source: spec)
 *   5. malformed features JSON (null / non-object) → GoalBootstrapError
 *   6. read-only specsDir (chmod 0555) → GoalBootstrapError
 *
 * OpenKan cutover (tsk-T1Aobcjj) coverage:
 *   7. bootstrapGoal from a .ok/ workspace with one open goal → bootstrap
 *   8. bootstrapGoalFromFile({ openKanDir }) routes to the .ok/ reader
 *   9. bootstrapGoalFromFile({ featureListPath }) emits a deprecation
 *      warning and still returns a verdict for legacy callers
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapGoal,
  bootstrapGoalFromFile,
  GoalBootstrapError,
  loadOpenKanSeeds,
  renderAggregateCharter,
  GOAL_BOOTSTRAP_SCHEMA_VERSION,
} from "../../src/agent/goal-bootstrap.js";

describe("goal-bootstrap", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "goal-bootstrap-"));
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns idle when features is empty", () => {
    const verdict = bootstrapGoal({ features: { features: [] }, specsDir: tmp });
    expect(verdict).toEqual({ action: "idle" });
  });

  it("returns idle when every feature is passing", () => {
    const verdict = bootstrapGoal({
      features: {
        features: [
          { id: "F-100", state: "passing", title: "Old" },
          { id: "F-101", state: "passing", title: "Older" },
        ],
      },
      specsDir: tmp,
    });
    expect(verdict).toEqual({ action: "idle" });
  });

  it("writes the aggregate charter when exactly one not_started feature exists", () => {
    const verdict = bootstrapGoal({
      features: {
        features: [
          { id: "F-209", state: "passing", title: "Old" },
          { id: "F-210", state: "not_started", title: "Ship the SDK helper", behavior: "Test the bootstrap" },
        ],
      },
      specsDir: tmp,
    });
    expect(verdict.action).toBe("bootstrap");
    if (verdict.action !== "bootstrap") return;
    expect(verdict.id).toBe("F-210");
    expect(verdict.charterPath).toBe(join(tmp, "ultragoal-F-210.md"));
    expect(existsSync(verdict.charterPath)).toBe(true);

    const body = readFileSync(verdict.charterPath, "utf-8");
    expect(body).toContain("# Ultragoal Charter — F-210");
    expect(body).toContain("`aggregate`");
    expect(body).toContain("docs/specs/ultragoal/F-210.jsonl");
    expect(body).toContain("Ship the SDK helper");
    expect(body).toContain("Test the bootstrap");
    expect(body).toContain("F-207 autonomous goal / ultragoal bootstrap");
  });

  it("picks the smallest F-ID when multiple not_started features exist", () => {
    const verdict = bootstrapGoal({
      features: {
        features: [
          { id: "F-310", state: "not_started", title: "Far future" },
          { id: "F-302", state: "not_started", title: "Mid future" },
          { id: "F-205", state: "not_started", title: "Next up", behavior: "Do the work" },
        ],
      },
      specsDir: tmp,
    });
    expect(verdict.action).toBe("bootstrap");
    if (verdict.action !== "bootstrap") return;
    expect(verdict.id).toBe("F-205");
    expect(verdict.charterPath).toBe(join(tmp, "ultragoal-F-205.md"));
  });

  it("resumes an existing charter for an in_progress feature", () => {
    const existingId = "F-207";
    const existingPath = join(tmp, `ultragoal-${existingId}.md`);
    writeFileSync(existingPath, "# old charter\n", "utf-8");

    const verdict = bootstrapGoal({
      features: {
        features: [
          { id: "F-207", state: "in_progress", title: "Self-bootstrap" },
          { id: "F-208", state: "not_started", title: "Next" },
        ],
      },
      specsDir: tmp,
    });
    expect(verdict).toEqual({ action: "resume", id: existingId, source: "spec" });
    // Resume must not rewrite the charter.
    expect(readFileSync(existingPath, "utf-8")).toBe("# old charter\n");
  });

  it("falls through to bootstrap when an existing charter's feature is passing", () => {
    // A stale charter whose feature already shipped should not block a
    // fresh bootstrap on the next not_started target.
    writeFileSync(join(tmp, "ultragoal-F-100.md"), "stale\n", "utf-8");
    const verdict = bootstrapGoal({
      features: {
        features: [
          { id: "F-100", state: "passing", title: "Done" },
          { id: "F-200", state: "not_started", title: "Next" },
        ],
      },
      specsDir: tmp,
    });
    expect(verdict.action).toBe("bootstrap");
    if (verdict.action !== "bootstrap") return;
    expect(verdict.id).toBe("F-200");
  });

  it("throws GoalBootstrapError on null features payload", () => {
    expect(() =>
      bootstrapGoal({ features: null as unknown as { features?: unknown }, specsDir: tmp }),
    ).toThrowError(GoalBootstrapError);
  });

  it("throws GoalBootstrapError on a non-object features payload", () => {
    expect(() =>
      bootstrapGoal({ features: "not an object" as unknown as { features?: unknown }, specsDir: tmp }),
    ).toThrowError(GoalBootstrapError);
  });

  it("throws GoalBootstrapError when features.features is not an array", () => {
    expect(() =>
      bootstrapGoal({ features: { features: "bad" } as unknown as { features?: unknown }, specsDir: tmp }),
    ).toThrowError(GoalBootstrapError);
  });

  it("throws GoalBootstrapError when the specsDir is unwritable (chmod 0555)", () => {
    if (process.platform === "win32") {
      // chmod 0o555 is meaningless on Windows; skip the OS-level
      // assertion there. The earlier ensureSpecsDir check still runs
      // and would catch a bogus path.
      return;
    }
    const roDir = join(tmp, "ro");
    mkdirSync(roDir, { recursive: true });
    chmodSync(roDir, 0o555);
    try {
      expect(() =>
        bootstrapGoal({
          features: { features: [{ id: "F-1", state: "not_started", title: "x" }] },
          specsDir: roDir,
        }),
      ).toThrowError(GoalBootstrapError);
    } finally {
      chmodSync(roDir, 0o755);
    }
  });

  it("renderAggregateCharter renders a markdown body referencing the ultragoal skill", () => {
    const body = renderAggregateCharter({
      id: "F-501",
      title: "Edge case",
      behavior: "Cover an edge case",
      owner: "@todd",
      layer: "harness",
      category: "agent",
    });
    expect(body).toContain("# Ultragoal Charter — F-501");
    expect(body).toContain("config/skills/ultragoal/SKILL.md");
    expect(body).toContain("Owner: @todd");
    expect(body).toContain(GOAL_BOOTSTRAP_SCHEMA_VERSION);
  });

  it("bootstrapGoalFromFile degrades gracefully when the file is missing", () => {
    const result = bootstrapGoalFromFile({
      featureListPath: join(tmp, "missing.json"),
      specsDir: tmp,
    });
    expect(result.verdict).toEqual({ action: "idle" });
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/deprecated/);
  });

  it("bootstrapGoalFromFile degrades gracefully on malformed JSON", () => {
    const fp = join(tmp, "feature_list.json");
    writeFileSync(fp, "{ this is not json", "utf-8");
    const result = bootstrapGoalFromFile({ featureListPath: fp, specsDir: tmp });
    expect(result.verdict).toEqual({ action: "idle" });
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/deprecated/);
  });

  it("bootstrapGoalFromFile returns the bootstrap verdict on a healthy file", () => {
    const fp = join(tmp, "feature_list.json");
    writeFileSync(
      fp,
      JSON.stringify({
        features: [
          { id: "F-300", state: "passing", title: "old" },
          { id: "F-301", state: "not_started", title: "next", behavior: "do it" },
        ],
      }),
      "utf-8",
    );
    const result = bootstrapGoalFromFile({ featureListPath: fp, specsDir: tmp });
    expect(result.verdict.action).toBe("bootstrap");
    expect(result.warning).toMatch(/deprecated/);
    if (result.verdict.action !== "bootstrap") return;
    expect(result.verdict.id).toBe("F-301");
  });
});

describe("goal-bootstrap OpenKan cutover", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "goal-bootstrap-openkan-"));
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function seedOpenKanFixture() {
    const ok = join(tmp, ".ok");
    mkdirSync(join(ok, "prds"), { recursive: true });
    mkdirSync(join(ok, "plans"), { recursive: true });
    writeFileSync(
      join(ok, "prds", "prd-fake.json"),
      JSON.stringify({
        schema: "ok.prd.v1",
        id: "prd-fake",
        title: "Fake PRD",
        goals: [
          { id: "g1", text: "Ship goal one", status: "open" },
          { id: "g2", text: "Ship goal two", status: "closed" },
        ],
        status: "active",
      }),
    );
    writeFileSync(
      join(ok, "plans", "pln-fake.json"),
      JSON.stringify({
        schema: "ok.plan.v1",
        id: "pln-fake",
        title: "Fake plan",
        status: "active",
        acceptance: ["Tests pass", "Docs updated"],
      }),
    );
  }

  it("loadOpenKanSeeds returns one seed per PRD goal", () => {
    seedOpenKanFixture();
    const seeds = loadOpenKanSeeds({ openKanDir: join(tmp, ".ok") });
    expect(seeds).toHaveLength(2);
    expect(seeds.map((s) => s.goalId).sort()).toEqual(["g1", "g2"]);
    expect(seeds[0]).toMatchObject({
      prdId: "prd-fake",
      id: "prd-fake/g1",
    });
  });

  it("bootstrapGoal picks an open goal from .ok/ and writes a charter", () => {
    seedOpenKanFixture();
    const verdict = bootstrapGoal({ openKanDir: join(tmp, ".ok"), specsDir: tmp });
    expect(verdict.action).toBe("bootstrap");
    if (verdict.action !== "bootstrap") return;
    expect(verdict.id).toBe("prd-fake/g1");
    const charter = join(tmp, "ultragoal-prd-fake_g1.md");
    expect(existsSync(charter)).toBe(true);
    const text = readFileSync(charter, "utf-8");
    expect(text).toContain("Ship goal one");
    expect(text).toContain("Tests pass");
  });

  it("bootstrapGoalFromFile({ openKanDir }) routes to the .ok/ reader", () => {
    seedOpenKanFixture();
    const result = bootstrapGoalFromFile({
      openKanDir: join(tmp, ".ok"),
      specsDir: tmp,
    });
    expect(result.warning).toBeUndefined();
    expect(result.verdict.action).toBe("bootstrap");
    if (result.verdict.action !== "bootstrap") return;
    expect(result.verdict.id).toBe("prd-fake/g1");
  });

  it("bootstrapGoalFromFile({ featureListPath }) tolerates legacy callers with a warning", () => {
    const fp = join(tmp, "feature_list.json");
    writeFileSync(
      fp,
      JSON.stringify({
        features: [
          { id: "F-401", state: "not_started", title: "legacy" },
        ],
      }),
      "utf-8",
    );
    const result = bootstrapGoalFromFile({ featureListPath: fp, specsDir: tmp });
    expect(result.warning).toMatch(/deprecated/);
    expect(result.verdict.action).toBe("bootstrap");
    if (result.verdict.action !== "bootstrap") return;
    expect(result.verdict.id).toBe("F-401");
  });
});
