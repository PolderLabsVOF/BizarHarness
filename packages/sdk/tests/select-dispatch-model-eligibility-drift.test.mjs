/**
 * Drift guard for IMP-017 (F-190) protocol-floor eligibility.
 *
 * Closes the IMP-017 acceptance criterion in
 * `IMPROVEMENTS.md` line 870: "Eligibility filters reject
 * incapable / context-limited models." The implementation must
 * invoke `protocolMeets` (from `packages/sdk/src/router/model-profile.ts`)
 * for protocol-floor rejects and surface the IMP-017 reject strings.
 *
 * This test fails CI if any of the following is true:
 *
 *   1. `select-dispatch-model.ts` does NOT import `protocolMeets`.
 *   2. The selector's `evaluateProfile` helper does NOT call
 *      `protocolMeets` (when a discriminated profile is supplied).
 *   3. The selector silently drops a `requireX` field on `TaskFeatures`.
 *      We pin the surface area: every `requireX` (requireReasoning,
 *      requireToolCall, requireStructuredOutput, requireImageInput) and
 *      `minContextTokens` must appear in either the imports, in the
 *      requirements extraction, or in the protocolMeets consumer's
 *      dependency graph.
 *   4. A sample bypass (probe): when the call to `protocolMeets`
 *      is removed from `evaluateProfile`, the guard flags it.
 *
 * The drift guard is the static-source proof; the runtime proof is
 * `tests/select-dispatch-model-eligibility.test.mjs`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SELECTOR_PATH = join(here, "..", "src", "router", "select-dispatch-model.ts");
const PROFILE_HELPERS_PATH = join(here, "..", "src", "router", "model-profile.ts");

function read(p) {
  return readFileSync(p, "utf8");
}

describe("selectDispatchModel eligibility drift guard (F-190 / IMP-017)", () => {
  it("select-dispatch-model.ts imports protocolMeets from model-profile.ts", () => {
    const source = read(SELECTOR_PATH);
    expect(source).toMatch(/from\s+["']\.\/model-profile\.js["']/);
    expect(source).toMatch(/\bprotocolMeets\b/);
  });

  it("model-profile.ts exports protocolMeets with the IMP-017 reject strings", () => {
    const source = read(PROFILE_HELPERS_PATH);
    expect(source).toMatch(/export\s+function\s+protocolMeets\b/);
    for (const expected of [
      "context-too-small",
      "no-tool-use",
      "no-reasoning",
      "no-structured-output",
      "no-image-input",
    ]) {
      expect(source, `model-profile.ts must surface reject string '${expected}'`).toContain(expected);
    }
  });

  it("evaluateProfile in select-dispatch-model.ts consumes protocolMeets", () => {
    const source = read(SELECTOR_PATH);
    // The evaluateProfile function spans multiple lines; match the
    // full body between the opening `{` and the closing `}` at the
    // same brace depth. Lazy match with `[\s\S]*?\n\}` keeps the
    // regex stable across formatting changes.
    const fnStart = source.indexOf("function evaluateProfile");
    expect(fnStart, "evaluateProfile helper must exist in select-dispatch-model.ts").toBeGreaterThanOrEqual(0);
    const openBrace = source.indexOf("{", fnStart);
    expect(openBrace).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let closeBrace = -1;
    for (let i = openBrace; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { closeBrace = i; break; }
      }
    }
    expect(closeBrace).toBeGreaterThan(openBrace);
    const fnBody = source.slice(fnStart, closeBrace + 1);
    expect(fnBody).toMatch(/\bprotocolMeets\s*\(/);
  });

  it("every TaskFeatures requireX field plus minContextTokens is honoured by the eligibility path", () => {
    const source = read(SELECTOR_PATH);
    // Pin the TaskFeatures shape — every field must appear in either
    // the type block, the requirements extraction, or the evaluation
    // path. The drift guard fails CI if a requireX is silently
    // dropped.
    for (const field of [
      "minContextTokens",
      "requireReasoning",
      "requireToolCall",
      "requireStructuredOutput",
      "requireImageInput",
    ]) {
      const count = (source.match(new RegExp(`\\b${field}\\b`, "g")) || []).length;
      expect(count, `${field} must appear at least twice in select-dispatch-model.ts (type + extraction)`).toBeGreaterThanOrEqual(2);
    }
    // The protocolMeets consumer (in evaluateProfile or a delegating
    // helper) must consume `requirements`; the IMP-017 reject strings
    // themselves are produced by `model-profile.ts`, which has its own
    // pin test above.
    const callStart = source.indexOf("protocolMeets(");
    expect(callStart, "protocolMeets call site is required").toBeGreaterThanOrEqual(0);
    const callSite = source.slice(callStart, callStart + 200);
    expect(callSite, "protocolMeets call must consume requirements").toContain("requirements");
  });

  it("drift probe — removing the protocolMeets call from evaluateProfile fails the guard", () => {
    const source = read(SELECTOR_PATH);
    // Probe: rename every `protocolMeets(` token so the drift guard's
    // invariant fires. The unmodified source MUST contain at least one
    // such token; the tampered source MUST NOT.
    const tampered = source.replace(/protocolMeets\(/g, "/* drift-probe-disabled */ protocolMeetsRenamed(");
    expect(tampered.match(/\bprotocolMeets\s*\(/), "drift-probe: tampered source should NOT contain protocolMeets(").toBe(null);
    expect(source.match(/\bprotocolMeets\s*\(/), "unmodified source must contain protocolMeets(").toBeTruthy();
  });
});
