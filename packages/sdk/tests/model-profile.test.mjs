/**
 * Tests for the discriminated `ModelProfile` schema (F-190 / IMP-017).
 *
 * Pins the IMP-017 acceptance gate ("Eligibility filters reject
 * incapable / context-limited models") and the contract that
 * `bizar models --refresh` must never overwrite operator-set fields.
 */

import { describe, it, expect } from "vitest";
import {
  deriveExpiry,
  isStale,
  measuredScore,
  mergeProfile,
  needsRefresh,
  operatorExpiry,
  protocolMeets,
} from "../src/router/model-profile.ts";

function makeProfile(overrides = {}) {
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

describe("ModelProfile schema (F-190 / IMP-017)", () => {
  it("mergeProfile preserves operator overrides across fetch refresh", () => {
    const fetched = makeProfile({
      protocol: {
        toolUse: false,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 4096,
        maxOutputTokens: 1024,
      },
    });
    const merged = mergeProfile(fetched, {
      toolUse: true,
      contextTokens: 200000,
      modalities: ["text", "image"],
    });
    expect(merged.protocol.toolUse).toBe(true);
    expect(merged.protocol.contextTokens).toBe(200000);
    expect(merged.protocol.modalities).toEqual(["text", "image"]);
    expect(merged.protocol.reasoning).toBe(true);
    expect(merged.operatorOverrides).toEqual({
      toolUse: true,
      contextTokens: 200000,
      modalities: ["text", "image"],
    });
    // Fetched is not mutated.
    expect(fetched.protocol.toolUse).toBe(false);
    expect(fetched.protocol.contextTokens).toBe(4096);
  });

  it("mergeProfile returns the input unchanged when no overrides are supplied", () => {
    const fetched = makeProfile();
    const merged = mergeProfile(fetched, undefined);
    expect(merged).toBe(fetched);
    const mergedEmpty = mergeProfile(fetched, {});
    expect(mergedEmpty).toBe(fetched);
  });

  it("isStale flips from false to true once now >= expiresAt", () => {
    const fresh = makeProfile();
    expect(isStale(fresh, new Date("2026-08-25T00:00:00.000Z"))).toBe(false);
    expect(isStale(fresh, new Date("2026-08-27T00:00:00.001Z"))).toBe(true);
    // Operator-only profiles never expire.
    const operatorProfile = makeProfile({
      provenance: {
        source: "operator",
        retrievedAt: "2026-08-20T00:00:00.000Z",
        ...operatorExpiry(),
        matchType: "manual",
        confidence: 1,
      },
    });
    expect(isStale(operatorProfile, new Date("9999-12-31T23:59:59.000Z"))).toBe(false);
  });

  it("needsRefresh triggers one day before expiresAt", () => {
    const fresh = makeProfile();
    expect(needsRefresh(fresh, new Date("2026-08-25T00:00:00.000Z"))).toBe(false);
    expect(needsRefresh(fresh, new Date("2026-08-26T00:00:00.001Z"))).toBe(true);
    expect(needsRefresh(fresh, new Date("2026-08-27T00:00:00.001Z"))).toBe(true);
  });

  it("deriveExpiry produces 7-day expiresAt and 6-day refreshRequiredAfter", () => {
    const { expiresAt, refreshRequiredAfter } = deriveExpiry("2026-08-20T00:00:00.000Z");
    expect(expiresAt).toBe("2026-08-27T00:00:00.000Z");
    expect(refreshRequiredAfter).toBe("2026-08-26T00:00:00.000Z");
  });

  it("protocolMeets rejects on context-too-small", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: true,
        reasoning: true,
        modalities: ["text", "image"],
        structuredOutput: true,
        contextTokens: 4096,
        maxOutputTokens: 1024,
      },
    });
    const reasons = protocolMeets(profile, { minContextTokens: 32000 });
    expect(reasons).toEqual(["context-too-small: 4096 < 32000"]);
  });

  it("protocolMeets rejects on missing tool use", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: false,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 200000,
        maxOutputTokens: 8192,
      },
    });
    const reasons = protocolMeets(profile, { requireToolCall: true });
    expect(reasons).toEqual(["no-tool-use"]);
  });

  it("protocolMeets rejects on missing reasoning", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: true,
        reasoning: false,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 200000,
        maxOutputTokens: 8192,
      },
    });
    const reasons = protocolMeets(profile, { requireReasoning: true });
    expect(reasons).toEqual(["no-reasoning"]);
  });

  it("protocolMeets rejects on missing structured output", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: true,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: false,
        contextTokens: 200000,
        maxOutputTokens: 8192,
      },
    });
    const reasons = protocolMeets(profile, { requireStructuredOutput: true });
    expect(reasons).toEqual(["no-structured-output"]);
  });

  it("protocolMeets rejects on missing image modality", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: true,
        reasoning: true,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 200000,
        maxOutputTokens: 8192,
      },
    });
    const reasons = protocolMeets(profile, { requireImageInput: true });
    expect(reasons).toEqual(["no-image-input"]);
  });

  it("protocolMeets returns multiple reasons for multiple violated floors", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: false,
        reasoning: false,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 4096,
        maxOutputTokens: 1024,
      },
    });
    const reasons = protocolMeets(profile, {
      minContextTokens: 32000,
      requireToolCall: true,
      requireReasoning: true,
      requireImageInput: true,
    });
    expect(reasons).toEqual([
      "context-too-small: 4096 < 32000",
      "no-tool-use",
      "no-reasoning",
      "no-image-input",
    ]);
  });

  it("protocolMeets honours operator overrides that re-enable capability flags", () => {
    const fetched = makeProfile({
      protocol: {
        toolUse: false,
        reasoning: false,
        modalities: ["text"],
        structuredOutput: true,
        contextTokens: 4096,
        maxOutputTokens: 1024,
      },
    });
    const merged = mergeProfile(fetched, {
      toolUse: true,
      reasoning: true,
      contextTokens: 200000,
      modalities: ["text", "image"],
    });
    const reasons = protocolMeets(merged, {
      minContextTokens: 32000,
      requireToolCall: true,
      requireReasoning: true,
      requireImageInput: true,
    });
    expect(reasons).toEqual([]);
  });

  it("protocolMeets returns no reasons when no requirements are set", () => {
    const profile = makeProfile({
      protocol: {
        toolUse: false,
        reasoning: false,
        modalities: ["text"],
        structuredOutput: false,
        contextTokens: 1024,
        maxOutputTokens: 512,
      },
    });
    expect(protocolMeets(profile, {})).toEqual([]);
  });

  it("measuredScore returns the recorded value for known capabilities", () => {
    const profile = makeProfile();
    expect(measuredScore(profile, "coding")).toBeCloseTo(0.92);
    expect(measuredScore(profile, "security")).toBeCloseTo(0.79);
    expect(measuredScore(profile, "reliability")).toBeCloseTo(0.97);
  });

  it("measuredScore returns 0 for unknown capabilities and missing fields", () => {
    const profile = makeProfile({ measured: {} });
    expect(measuredScore(profile, "coding")).toBe(0);
    expect(measuredScore(profile, "unknown-capability")).toBe(0);
  });
});
