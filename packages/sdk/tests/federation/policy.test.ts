/**
 * federation/policy.test.ts — F-038 PolicyEngine tests.
 *
 * Covers:
 *   - maxHops enforcement: hopCount >= maxHops denies.
 *   - Action allowlist: unknown + disallowed message kinds denied.
 *   - Peer blocklist: blocked source node denied.
 *   - Budget validation: missing + invalid budget denied.
 *   - Runtime mutators: allowMessageType / denyMessageType / setBlocked.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { PolicyEngine, DEFAULT_MAX_HOPS } from "../../src/federation/policy.js";
import {
  emptyScanResult,
  type EnvelopeBudget,
  type FederationEnvelope,
} from "../../src/federation/envelope.js";

function makeEnvelope(overrides: Partial<FederationEnvelope> = {}): FederationEnvelope {
  return {
    envelopeId: "env-1",
    sourceNodeId: "node-A",
    targetNodeId: "node-B",
    sessionId: "sess-1",
    messageType: "heartbeat",
    payload: null,
    timestamp: new Date().toISOString(),
    nonce: "nonce-1",
    hmacSignature: "sig-1",
    piiScanResult: emptyScanResult(),
    hopCount: 0,
    ...overrides,
  };
}

const defaultBudget: EnvelopeBudget = { maxTokens: 1000, maxUsd: 1.0, maxHops: 3 };

describe("federation/policy — enforce()", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  test("admits a fresh envelope with default budget", () => {
    const e = makeEnvelope();
    const r = engine.enforce(e, defaultBudget);
    expect(r.allowed).toBe(true);
  });

  test("denies when hopCount >= maxHops", () => {
    const e = makeEnvelope({ hopCount: 3 });
    const r = engine.enforce(e, defaultBudget);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("max_hops_exceeded");
  });

  test("denies when hopCount exceeds the engine ceiling (default 3)", () => {
    const e = makeEnvelope({ hopCount: 4, budget: { maxTokens: 10, maxUsd: 1, maxHops: 100 } });
    const r = engine.enforce(e, { maxTokens: 10, maxUsd: 1, maxHops: 100 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("max_hops_exceeded");
  });

  test("admits hopCount=2 with maxHops=3 budget", () => {
    const e = makeEnvelope({ hopCount: 2 });
    const r = engine.enforce(e, defaultBudget);
    expect(r.allowed).toBe(true);
  });

  test("denies unknown message kind", () => {
    const e = makeEnvelope({ messageType: "not-a-kind" as never });
    const r = engine.enforce(e, defaultBudget);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("message_type_not_allowed");
  });

  test("denies message kind outside the configured allowlist", () => {
    const strict = new PolicyEngine({ allowedMessageTypes: ["heartbeat"] });
    const e = makeEnvelope({ messageType: "agent-spawn" });
    const r = strict.enforce(e, defaultBudget);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("message_type_not_allowed");
  });

  test("denies peer in the blocklist", () => {
    const strict = new PolicyEngine({ peerBlocklist: ["node-A"] });
    const e = makeEnvelope();
    const r = strict.enforce(e, defaultBudget);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("peer_blocked");
  });

  test("denies when budget is missing", () => {
    const r = engine.enforce(makeEnvelope(), undefined);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("budget_missing");
  });

  test("denies when budget has invalid maxHops", () => {
    const r = engine.enforce(makeEnvelope(), { maxTokens: 1, maxUsd: 1, maxHops: Number.NaN });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("budget_invalid");
  });
});

describe("federation/policy — runtime mutators", () => {
  test("allowMessageType / denyMessageType mutate the allowlist", () => {
    const engine = new PolicyEngine({ allowedMessageTypes: ["heartbeat"] });
    const e = makeEnvelope({ messageType: "agent-spawn" });
    expect(engine.enforce(e, defaultBudget).allowed).toBe(false);
    engine.allowMessageType("agent-spawn");
    expect(engine.enforce(e, defaultBudget).allowed).toBe(true);
    engine.denyMessageType("heartbeat");
    expect(engine.enforce(makeEnvelope({ messageType: "heartbeat" }), defaultBudget).allowed).toBe(false);
  });

  test("setBlocked mutates the blocklist", () => {
    const engine = new PolicyEngine();
    const e = makeEnvelope();
    expect(engine.enforce(e, defaultBudget).allowed).toBe(true);
    engine.setBlocked("node-A", true);
    expect(engine.enforce(e, defaultBudget).allowed).toBe(false);
    engine.setBlocked("node-A", false);
    expect(engine.enforce(e, defaultBudget).allowed).toBe(true);
  });

  test("DEFAULT_MAX_HOPS is 3 per spec", () => {
    expect(DEFAULT_MAX_HOPS).toBe(3);
  });

  test("engine ceiling override is respected", () => {
    const strict = new PolicyEngine({ maxHops: 1 });
    const e = makeEnvelope({ hopCount: 1 });
    const r = strict.enforce(e, { maxTokens: 10, maxUsd: 1, maxHops: 99 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denialReason).toBe("max_hops_exceeded");
  });
});