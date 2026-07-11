/**
 * federation/trust.test.ts — F-038 TrustEvaluator tests.
 *
 * Covers:
 *   - evaluate() allows allowlisted peer with fresh envelope.
 *   - evaluate() denies non-allowlisted peer.
 *   - evaluate() denies too-old envelope.
 *   - recordOutcome() updates the recent fail rate.
 *   - Low score (high fail rate) triggers denial.
 *   - setAllowlisted mutates the runtime allowlist.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  MAX_TRUST_AGE_MS,
  MIN_TRUST_SCORE,
  TrustEvaluator,
  type PeerState,
} from "../../src/federation/trust.js";
import {
  emptyScanResult,
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
    ...overrides,
  };
}

function allowlistedPeer(nodeId = "node-A"): PeerState {
  return { nodeId, allowlisted: true, recentFailRate: 0, lastSeenMs: Date.now() };
}

describe("federation/trust — evaluate()", () => {
  let te: TrustEvaluator;

  beforeEach(() => {
    te = new TrustEvaluator({ allowlist: ["node-A"] });
  });

  test("allows an allowlisted peer with a fresh envelope", () => {
    const r = te.evaluate(makeEnvelope(), allowlistedPeer());
    expect(r.allowed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(MIN_TRUST_SCORE);
  });

  test("denies a non-allowlisted peer", () => {
    const peer: PeerState = { nodeId: "node-X", allowlisted: false, recentFailRate: 0 };
    const r = te.evaluate(makeEnvelope(), peer);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/allowlist/);
  });

  test("denies an envelope older than MAX_TRUST_AGE_MS", () => {
    const old = makeEnvelope({
      timestamp: new Date(Date.now() - MAX_TRUST_AGE_MS - 1000).toISOString(),
    });
    const r = te.evaluate(old, allowlistedPeer());
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/too_old/);
  });

  test("denies when score falls below MIN_TRUST_SCORE (high fail rate)", () => {
    te.recordOutcome("node-A", false);
    te.recordOutcome("node-A", false);
    te.recordOutcome("node-A", false);
    te.recordOutcome("node-A", false);
    const peer = te.getPeerState("node-A");
    const r = te.evaluate(makeEnvelope(), peer);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/score_below_floor/);
  });

  test("allows when only successes are recorded", () => {
    for (let i = 0; i < 5; i++) te.recordOutcome("node-A", true);
    const peer = te.getPeerState("node-A");
    expect(peer.recentFailRate).toBe(0);
    const r = te.evaluate(makeEnvelope(), peer);
    expect(r.allowed).toBe(true);
  });
});

describe("federation/trust — runtime mutations", () => {
  test("setAllowlisted adds a new peer at runtime", () => {
    const te = new TrustEvaluator({ allowlist: [] });
    expect(te.isAllowlisted("node-A")).toBe(false);
    te.setAllowlisted("node-A", true);
    expect(te.isAllowlisted("node-A")).toBe(true);
  });

  test("setAllowlisted(false) removes a peer at runtime", () => {
    const te = new TrustEvaluator({ allowlist: ["node-A"] });
    expect(te.isAllowlisted("node-A")).toBe(true);
    te.setAllowlisted("node-A", false);
    expect(te.isAllowlisted("node-A")).toBe(false);
  });

  test("getPeerState returns default zeros for an unknown peer", () => {
    const te = new TrustEvaluator();
    const peer = te.getPeerState("never-seen");
    expect(peer.allowlisted).toBe(false);
    expect(peer.recentFailRate).toBe(0);
    expect(peer.lastSeenMs).toBeUndefined();
  });

  test("computeScore is in [0, 1] for the corner cases", () => {
    const te = new TrustEvaluator({ allowlist: ["node-A"] });
    const env = makeEnvelope();
    expect(te.computeScore(env, { nodeId: "node-A", allowlisted: true, recentFailRate: 0 })).toBeLessThanOrEqual(1);
    expect(te.computeScore(env, { nodeId: "node-A", allowlisted: true, recentFailRate: 1 })).toBeGreaterThanOrEqual(0);
    expect(te.computeScore(env, { nodeId: "node-A", allowlisted: false, recentFailRate: 0 })).toBe(0);
  });
});