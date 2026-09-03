/**
 * handoff/ralplan.test.ts — Unit tests for the Ralplan handoff validator.
 *
 * Verifies the contract over the required-`false` reject matrix:
 *   - All `complete=false` (or absent) → accepted
 *   - Any `complete=true` without matching evidence → rejected
 *   - Any `complete=true` with malformed evidence → rejected
 *   - Schema-version mismatch → rejected
 *   - Non-object root → rejected
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  RALPLAN_HANDOFF_SCHEMA_VERSION,
  validateRalplanHandoff,
} from "../../src/handoff/ralplan.js";

const validEvidence = {
  body: "plan body",
  artifactRef: "plans/run-1/plan.md",
  completedAt: "2026-09-03T12:00:00.000Z",
};

describe("validateRalplanHandoff — accept matrix", () => {
  it("accepts an empty object", () => {
    const r = validateRalplanHandoff({});
    assert.deepEqual(r, { ok: true });
  });

  it("accepts when all three roles report complete=false", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: false,
      architect_complete: false,
      critic_complete: false,
    });
    assert.deepEqual(r, { ok: true });
  });

  it("accepts a planner-only completion with valid evidence", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      architect_complete: false,
      critic_complete: false,
      planner: validEvidence,
    });
    assert.deepEqual(r, { ok: true });
  });

  it("accepts all three roles complete with valid evidence", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      architect_complete: true,
      critic_complete: true,
      planner: validEvidence,
      architect: { ...validEvidence, artifactRef: "plans/run-1/architect.md" },
      critic: { ...validEvidence, artifactRef: "plans/run-1/critic.md" },
    });
    assert.deepEqual(r, { ok: true });
  });

  it("accepts an absent schemaVersion (legacy)", () => {
    const r = validateRalplanHandoff({
      planner_complete: true,
      planner: validEvidence,
    });
    assert.deepEqual(r, { ok: true });
  });
});

describe("validateRalplanHandoff — reject matrix (required-`false` semantics)", () => {
  it("rejects planner_complete=true without evidence", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      architect_complete: false,
      critic_complete: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.body"));
  });

  it("rejects architect_complete=true without evidence", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: false,
      architect_complete: true,
      critic_complete: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("architect.body"));
  });

  it("rejects critic_complete=true without evidence", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: false,
      architect_complete: false,
      critic_complete: true,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("critic.body"));
  });

  it("rejects multiple roles complete without matching evidence (all listed)", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      architect_complete: true,
      critic_complete: true,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.missing.includes("planner.body"));
      assert.ok(r.missing.includes("architect.body"));
      assert.ok(r.missing.includes("critic.body"));
    }
  });

  it("rejects evidence with empty body", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      planner: { ...validEvidence, body: "" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.body"));
  });

  it("rejects evidence with empty artifactRef", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      planner: { ...validEvidence, artifactRef: "" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.artifactRef"));
  });

  it("rejects evidence with non-ISO completedAt", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      planner: { ...validEvidence, completedAt: "yesterday" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.completedAt"));
  });

  it("rejects evidence passed as a string", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: true,
      planner: "oops",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner.evidence"));
  });

  it("rejects non-boolean *_complete flags", () => {
    const r = validateRalplanHandoff({
      schemaVersion: RALPLAN_HANDOFF_SCHEMA_VERSION,
      planner_complete: "yes",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("planner_complete"));
  });
});

describe("validateRalplanHandoff — schema version mismatch", () => {
  it("rejects a mismatching schemaVersion", () => {
    const r = validateRalplanHandoff({
      schemaVersion: "0.9.0",
      planner_complete: false,
      architect_complete: false,
      critic_complete: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("schemaVersion"));
  });

  it("rejects a malformed schemaVersion", () => {
    const r = validateRalplanHandoff({
      schemaVersion: 42,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.missing.includes("schemaVersion"));
  });
});

describe("validateRalplanHandoff — root type", () => {
  it("rejects null root", () => {
    const r = validateRalplanHandoff(null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual([...r.missing], ["root"]);
  });

  it("rejects array root", () => {
    const r = validateRalplanHandoff([]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual([...r.missing], ["root"]);
  });

  it("rejects primitive root", () => {
    const r = validateRalplanHandoff("not a handoff");
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual([...r.missing], ["root"]);
  });
});
