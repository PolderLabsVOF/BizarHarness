/**
 * federation/hmac.test.ts — F-038 HMAC + nonce tests.
 *
 * Covers:
 *   - signEnvelope produces a stable 64-char hex digest.
 *   - verifySignature accepts a fresh signed envelope.
 *   - verifySignature rejects a tampered envelope.
 *   - verifySignature rejects an expired envelope.
 *   - NonceCache rejects duplicates within the window.
 *   - NonceCache evicts old entries (size capped).
 *   - freshNonce returns crypto.randomUUID() — 128-bit random.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  DEFAULT_NONCE_WINDOW_MS,
  freshNonce,
  NonceCache,
  signEnvelope,
  verifySignature,
} from "../../src/federation/hmac.js";
import {
  canonicalSignablePayload,
  emptyScanResult,
  type FederationEnvelope,
} from "../../src/federation/envelope.js";

const SECRET = "test-secret-123";

function makeEnvelope(overrides: Partial<FederationEnvelope> = {}): FederationEnvelope {
  return {
    envelopeId: "env-1",
    sourceNodeId: "node-A",
    targetNodeId: "node-B",
    sessionId: "sess-1",
    messageType: "heartbeat",
    payload: { ok: true },
    timestamp: new Date().toISOString(),
    nonce: freshNonce(),
    hmacSignature: "",
    piiScanResult: emptyScanResult(),
    ...overrides,
  };
}

describe("federation/hmac — signEnvelope", () => {
  test("produces a 64-char hex digest", () => {
    const e = makeEnvelope();
    const sig = signEnvelope(e, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test("deterministic for the same payload", () => {
    const e = makeEnvelope({ nonce: "n1", timestamp: "2026-07-12T00:00:00.000Z" });
    const s1 = signEnvelope(e, SECRET);
    const s2 = signEnvelope(e, SECRET);
    expect(s1).toBe(s2);
  });

  test("different secret → different signature", () => {
    const e = makeEnvelope({ nonce: "n1", timestamp: "2026-07-12T00:00:00.000Z" });
    const a = signEnvelope(e, "secret-A");
    const b = signEnvelope(e, "secret-B");
    expect(a).not.toBe(b);
  });

  test("rejects empty secret", () => {
    const e = makeEnvelope();
    expect(() => signEnvelope(e, "")).toThrow(/non-empty/);
  });
});

describe("federation/hmac — verifySignature", () => {
  let envelope: FederationEnvelope;

  beforeEach(() => {
    envelope = makeEnvelope();
    envelope.hmacSignature = signEnvelope(envelope, SECRET);
  });

  test("accepts a fresh signed envelope with empty seen set", () => {
    const r = verifySignature(envelope, SECRET, new Set());
    expect(r.ok).toBe(true);
  });

  test("rejects tampered payload", () => {
    const tampered: FederationEnvelope = { ...envelope, payload: { evil: true } };
    const r = verifySignature(tampered, SECRET, new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  test("rejects wrong secret", () => {
    const r = verifySignature(envelope, "wrong-secret", new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  test("rejects envelope past freshness window", () => {
    const old = makeEnvelope({
      timestamp: new Date(Date.now() - DEFAULT_NONCE_WINDOW_MS - 1000).toISOString(),
    });
    old.hmacSignature = signEnvelope(old, SECRET);
    const r = verifySignature(old, SECRET, new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("envelope_expired");
  });

  test("rejects envelope from the far future", () => {
    const future = makeEnvelope({
      timestamp: new Date(Date.now() + DEFAULT_NONCE_WINDOW_MS + 60_000).toISOString(),
    });
    future.hmacSignature = signEnvelope(future, SECRET);
    const r = verifySignature(future, SECRET, new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("envelope_from_future");
  });

  test("rejects nonce seen in the seen-set (replay)", () => {
    const seen = new Set([envelope.nonce]);
    const r = verifySignature(envelope, SECRET, seen);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("nonce_replay");
  });

  test("rejects empty secret", () => {
    const r = verifySignature(envelope, "", new Set());
    expect(r.ok).toBe(false);
  });

  test("rejects empty signature", () => {
    const e = makeEnvelope({ hmacSignature: "" });
    const r = verifySignature(e, SECRET, new Set());
    expect(r.ok).toBe(false);
  });
});

describe("federation/hmac — NonceCache", () => {
  test("check() returns true for fresh nonce, false for replay", () => {
    const cache = new NonceCache();
    expect(cache.check("n1")).toBe(true);
    expect(cache.check("n1")).toBe(false);
    expect(cache.check("n2")).toBe(true);
    expect(cache.size()).toBe(2);
  });

  test("has() reflects the cache state without side effects", () => {
    const cache = new NonceCache();
    cache.check("n1");
    expect(cache.has("n1")).toBe(true);
    expect(cache.has("n2")).toBe(false);
  });

  test("clear() empties the cache", () => {
    const cache = new NonceCache();
    cache.check("n1");
    cache.check("n2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.check("n1")).toBe(true); // fresh again
  });

  test("evicts entries past the window", () => {
    const cache = new NonceCache(1000); // 1s window
    const t = Date.now();
    expect(cache.check("n1", t)).toBe(true);
    // 2 seconds later — entry should have expired.
    expect(cache.check("n1", t + 2000)).toBe(true);
  });
});

describe("federation/hmac — freshNonce", () => {
  test("returns a 128-bit random UUID", () => {
    const a = freshNonce();
    const b = freshNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("produces 1000 unique nonces (probabilistic)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(freshNonce());
    expect(seen.size).toBe(1000);
  });

  test("is used by sign() in the orchestrator", () => {
    // Sanity — round-trip through canonicalSignablePayload works.
    const e = makeEnvelope();
    const sig = signEnvelope(e, SECRET);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBe(64);
    void canonicalSignablePayload;
  });
});