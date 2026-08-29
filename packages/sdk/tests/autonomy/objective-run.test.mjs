/**
 * autonomy/objective-run.test.mjs — Phase B.1 (F-194) unit tests for
 * the typed ObjectiveRun schema. Verifies:
 *   - `newObjectiveRunId()` returns a UUID v4 string
 *   - `createObjectiveRun()` stamps objectiveRunId + timestamps + initial phase/status
 *   - The factory rejects an empty goal, an empty evaluatorVersion, a negative budget
 *   - AllowedSideEffect objects pass through verbatim; forbiddenPaths are normalized
 *   - `wallClockSeconds` only round-trips when defined
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  newObjectiveRunId,
  createObjectiveRun,
} from "../../src/autonomy/objective-run.js";

describe("objective-run schema", () => {
  it("newObjectiveRunId returns a UUID v4 string", () => {
    const id = newObjectiveRunId();
    assert.equal(typeof id, "string");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("createObjectiveRun stamps objectiveRunId + initial phase + status", () => {
    const run = createObjectiveRun({
      goal: "implement F-194 typed schema",
      allowedSideEffects: [{ kind: "Bash", matcher: "npm test" }],
      forbiddenPaths: ["secrets.env"],
      budget: { usd: 1000 },
      evaluatorVersion: "v1",
    });
    assert.equal(typeof run.objectiveRunId, "string");
    assert.match(run.objectiveRunId, /^[0-9a-f-]{36}$/);
    assert.equal(run.phase, "planning");
    assert.equal(run.status, "active");
    assert.equal(run.goal, "implement F-194 typed schema");
    assert.equal(run.evaluatorVersion, "v1");
    assert.equal(run.constraints.allowedSideEffects.length, 1);
    assert.equal(run.constraints.allowedSideEffects[0].kind, "Bash");
    assert.equal(run.constraints.allowedSideEffects[0].matcher, "npm test");
    assert.deepEqual(run.constraints.forbiddenPaths, ["secrets.env"]);
    assert.equal(run.constraints.budget.usd, 1000);
    assert.equal(run.constraints.budget.wallClockSeconds, undefined);
    assert.equal(typeof run.createdAt, "string");
    assert.equal(run.createdAt, run.updatedAt);
  });

  it("rejects an empty goal", () => {
    assert.throws(
      () =>
        createObjectiveRun({
          goal: "",
          allowedSideEffects: [],
          forbiddenPaths: [],
          budget: { usd: 0 },
          evaluatorVersion: "v1",
        }),
      /goal must be a non-empty string/,
    );
  });

  it("rejects an empty evaluatorVersion", () => {
    assert.throws(
      () =>
        createObjectiveRun({
          goal: "ok",
          allowedSideEffects: [],
          forbiddenPaths: [],
          budget: { usd: 0 },
          evaluatorVersion: "",
        }),
      /evaluatorVersion must be a non-empty string/,
    );
  });

  it("rejects a negative or non-integer budget", () => {
    assert.throws(
      () =>
        createObjectiveRun({
          goal: "ok",
          allowedSideEffects: [],
          forbiddenPaths: [],
          budget: { usd: -1 },
          evaluatorVersion: "v1",
        }),
      /budget\.usd must be a non-negative integer/,
    );
    assert.throws(
      () =>
        createObjectiveRun({
          goal: "ok",
          allowedSideEffects: [],
          forbiddenPaths: [],
          budget: { usd: 1.5 },
          evaluatorVersion: "v1",
        }),
      /budget\.usd must be a non-negative integer/,
    );
  });

  it("preserves wallClockSeconds when supplied and omits it when undefined", () => {
    const withCap = createObjectiveRun({
      goal: "x",
      allowedSideEffects: [],
      forbiddenPaths: [],
      budget: { usd: 0, wallClockSeconds: 60 },
      evaluatorVersion: "v1",
    });
    assert.equal(withCap.constraints.budget.wallClockSeconds, 60);

    const withoutCap = createObjectiveRun({
      goal: "x",
      allowedSideEffects: [],
      forbiddenPaths: [],
      budget: { usd: 0 },
      evaluatorVersion: "v1",
    });
    assert.equal(withoutCap.constraints.budget.wallClockSeconds, undefined);
    assert.ok(!("wallClockSeconds" in withoutCap.constraints.budget));
  });

  it("passes through scope when supplied and omits it when undefined", () => {
    const scoped = createObjectiveRun({
      goal: "x",
      scope: "packages/sdk",
      allowedSideEffects: [],
      forbiddenPaths: [],
      budget: { usd: 0 },
      evaluatorVersion: "v1",
    });
    assert.equal(scoped.scope, "packages/sdk");

    const unscoped = createObjectiveRun({
      goal: "x",
      allowedSideEffects: [],
      forbiddenPaths: [],
      budget: { usd: 0 },
      evaluatorVersion: "v1",
    });
    assert.equal(unscoped.scope, undefined);
    assert.ok(!("scope" in unscoped));
  });
});