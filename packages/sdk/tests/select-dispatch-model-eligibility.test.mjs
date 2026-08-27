/**
 * Tests for IMP-017 (F-190) protocol-floor eligibility in the central
 * dispatch selector.
 *
 * Pins the IMP-017 acceptance gate: "Eligibility filters reject
 * incapable / context-limited models." The discriminated `ModelProfile`
 * shape (from `packages/sdk/src/router/model-profile.ts`) is the
 * canonical input; operator overrides re-enable capability flags the
 * catalogue marked false.
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";

import { selectDispatchModel, REASON } from "../src/router/select-dispatch-model.ts";

function makeDiscriminatedProfile(overrides = {}) {
  const base = {
    id: "anthropic/claude-3-5-sonnet",
    provider: "anthropic",
    enabled: true,
    protocol: {
      toolUse: true,
      reasoning: true,
      modalities: ["text", "image"],
      structuredOutput: true,
      contextTokens: 200000,
      maxOutputTokens: 8192,
    },
    measured: {
      coding: 0.92,
      debugging: 0.88,
      architecture: 0.81,
      security: 0.79,
      reliability: 0.97,
      latencyMsP50: 1200,
      costUsdPer1kInput: 0.003,
      costUsdPer1kOutput: 0.015,
    },
    provenance: {
      source: "models.dev",
      retrievedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-27T00:00:00.000Z",
      refreshRequiredAfter: "2026-08-26T00:00:00.000Z",
      matchType: "exact",
      confidence: 0.9,
    },
  };
  return { ...base, ...overrides };
}

function makeCandidate(id, discriminatedProfile, tier) {
  return { id, tier, discriminatedProfile };
}

describe("selectDispatchModel eligibility (F-190 / IMP-017)", () => {
  it("rejects a profile with contextTokens: 4096 when minContextTokens: 32000", () => {
    const d = selectDispatchModel({
      task: { task: "long task", role: "todd", minContextTokens: 32000 },
      selectedProfiles: [
        makeCandidate("provider/tiny", makeDiscriminatedProfile({
          protocol: {
            toolUse: true,
            reasoning: true,
            modalities: ["text"],
            structuredOutput: true,
            contextTokens: 4096,
            maxOutputTokens: 1024,
          },
        }), "mid"),
      ],
      budget: {},
      health: {},
      runId: "run-ctx",
    });
    assert.equal(d.modelId, null, "no eligible model");
    assert.equal(d.reason, REASON.NO_ELIGIBLE);
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/tiny"));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("context-too-small: 4096 < 32000");
  });

  it("rejects a profile with toolUse: false when requireToolCall: true", () => {
    const d = selectDispatchModel({
      task: { task: "needs tools", role: "todd", requireToolCall: true },
      selectedProfiles: [
        makeCandidate("provider/notext", makeDiscriminatedProfile({
          protocol: {
            toolUse: false,
            reasoning: true,
            modalities: ["text"],
            structuredOutput: true,
            contextTokens: 200000,
            maxOutputTokens: 8192,
          },
        }), "mid"),
      ],
      budget: {},
      health: {},
      runId: "run-tools",
    });
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/notext"));
    expect(reasons.some((r) => r.includes("no-tool-use"))).toBe(true);
  });

  it("rejects a profile with modalities: ['text'] when requireImageInput: true", () => {
    const d = selectDispatchModel({
      task: { task: "needs vision", role: "todd", requireImageInput: true },
      selectedProfiles: [
        makeCandidate("provider/text-only", makeDiscriminatedProfile({
          protocol: {
            toolUse: true,
            reasoning: true,
            modalities: ["text"],
            structuredOutput: true,
            contextTokens: 200000,
            maxOutputTokens: 8192,
          },
        }), "mid"),
      ],
      budget: {},
      health: {},
      runId: "run-vision",
    });
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/text-only"));
    expect(reasons.some((r) => r.includes("no-image-input"))).toBe(true);
  });

  it("accepts a profile whose operatorOverrides widen contextTokens to 200000", () => {
    const merged = {
      id: "anthropic/claude-haiku",
      provider: "anthropic",
      enabled: true,
      protocol: {
        toolUse: true,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 200000,
        maxOutputTokens: 8192,
      },
      measured: {},
      provenance: {
        source: "models.dev",
        retrievedAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-08-27T00:00:00.000Z",
        refreshRequiredAfter: "2026-08-26T00:00:00.000Z",
        matchType: "exact",
        confidence: 0.9,
      },
      operatorOverrides: {
        contextTokens: 200000,
      },
    };
    const d = selectDispatchModel({
      task: { task: "long task", role: "todd", minContextTokens: 32000 },
      selectedProfiles: [makeCandidate("anthropic/claude-haiku", merged, "high")],
      budget: {},
      health: {},
      runId: "run-override",
    });
    assert.equal(d.modelId, "anthropic/claude-haiku");
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("anthropic/claude-haiku"));
    expect(reasons).toHaveLength(0);
  });

  it("surfaces multiple reject strings in ineligibleReasons", () => {
    const d = selectDispatchModel({
      task: {
        task: "complex task",
        role: "todd",
        minContextTokens: 32000,
        requireToolCall: true,
        requireReasoning: true,
        requireImageInput: true,
        requireStructuredOutput: true,
      },
      selectedProfiles: [
        makeCandidate("provider/bare", makeDiscriminatedProfile({
          protocol: {
            toolUse: false,
            reasoning: false,
            modalities: ["text"],
            structuredOutput: false,
            contextTokens: 4096,
            maxOutputTokens: 512,
          },
        }), "budget"),
      ],
      budget: {},
      health: {},
      runId: "run-multi",
    });
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/bare"));
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    const joined = reasons.join("\n");
    expect(joined).toContain("context-too-small: 4096 < 32000");
    expect(joined).toContain("no-tool-use");
    expect(joined).toContain("no-reasoning");
    expect(joined).toContain("no-image-input");
    expect(joined).toContain("no-structured-output");
  });

  it("returns reason: 'no-eligible-selected' when all profiles are filtered", () => {
    const d = selectDispatchModel({
      task: { task: "needs reasoning", role: "todd", requireReasoning: true },
      selectedProfiles: [
        makeCandidate("provider/no-reasoning", makeDiscriminatedProfile({
          protocol: {
            toolUse: true,
            reasoning: false,
            modalities: ["text"],
            structuredOutput: true,
            contextTokens: 200000,
            maxOutputTokens: 8192,
          },
        }), "high"),
        makeCandidate("provider/also-no-reasoning", makeDiscriminatedProfile({
          protocol: {
            toolUse: true,
            reasoning: false,
            modalities: ["text"],
            structuredOutput: true,
            contextTokens: 100000,
            maxOutputTokens: 4096,
          },
        }), "default"),
      ],
      activeSessionModel: undefined,
      budget: {},
      health: {},
      runId: "run-all-filtered",
    });
    assert.equal(d.modelId, null);
    assert.equal(d.reason, REASON.NO_ELIGIBLE);
    expect(d.ineligibleReasons.length).toBeGreaterThan(0);
  });

  it("honours the discriminated profile when both discriminatedProfile and legacy profile are present", () => {
    const legacyProfile = {
      capabilities: {
        reasoning: true,
        toolCall: true,
        structuredOutput: true,
        attachment: true,
        temperature: true,
      },
      limits: { contextTokens: 200000, inputTokens: null, outputTokens: null },
    };
    const discriminated = makeDiscriminatedProfile({
      protocol: {
        toolUse: false,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 4096,
        maxOutputTokens: 1024,
      },
    });
    const d = selectDispatchModel({
      task: { task: "needs tools", role: "todd", requireToolCall: true, minContextTokens: 32000 },
      selectedProfiles: [
        {
          id: "provider/hybrid",
          tier: "high",
          profile: legacyProfile,
          discriminatedProfile: discriminated,
        },
      ],
      budget: {},
      health: {},
      runId: "run-hybrid",
    });
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/hybrid"));
    expect(reasons.some((r) => r.includes("no-tool-use"))).toBe(true);
    expect(reasons.some((r) => r.includes("context-too-small"))).toBe(true);
  });

  it("falls back to the legacy evaluator when no discriminated profile is supplied", () => {
    const legacyProfile = {
      capabilities: {
        reasoning: false,
        toolCall: false,
        structuredOutput: true,
        attachment: false,
        temperature: true,
      },
      limits: { contextTokens: 4096, inputTokens: null, outputTokens: null },
    };
    const d = selectDispatchModel({
      task: { task: "needs reasoning", role: "todd", requireReasoning: true, minContextTokens: 32000 },
      selectedProfiles: [
        { id: "provider/legacy", tier: "budget", profile: legacyProfile },
      ],
      budget: {},
      health: {},
      runId: "run-legacy",
    });
    const reasons = d.ineligibleReasons.filter((r) => r.startsWith("provider/legacy"));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join("\n")).toContain("reasoning");
  });
});