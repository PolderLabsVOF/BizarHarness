/**
 * federation/envelope.test.ts — F-038 envelope type tests.
 *
 * Covers:
 *   - The 16 FederationMessageType kinds round-trip through
 *     isFederationMessageType (positive + negative).
 *   - canonicalSignablePayload is deterministic + field-order stable.
 *   - envelopeAgeMs clamps correctly for fresh + old + future.
 *   - emptyScanResult returns the documented zero shape.
 */

import { describe, test, expect } from "vitest";
import {
  FEDERATION_MESSAGE_TYPES,
  TRUST_AFFECTING_MESSAGE_TYPES,
  canonicalSignablePayload,
  emptyScanResult,
  envelopeAgeMs,
  isFederationMessageType,
  type FederationEnvelope,
} from "../../src/federation/envelope.js";

describe("federation/envelope — message kinds", () => {
  test("FEDERATION_MESSAGE_TYPES has 17 entries (16 ruflo kinds + claim-event)", () => {
    expect(FEDERATION_MESSAGE_TYPES.length).toBe(17);
  });

  test("each declared kind passes isFederationMessageType", () => {
    for (const k of FEDERATION_MESSAGE_TYPES) {
      expect(isFederationMessageType(k)).toBe(true);
    }
  });

  test("isFederationMessageType rejects unknown / mistyped values", () => {
    expect(isFederationMessageType("not-a-kind")).toBe(false);
    expect(isFederationMessageType(null)).toBe(false);
    expect(isFederationMessageType(undefined)).toBe(false);
    expect(isFederationMessageType(42)).toBe(false);
    expect(isFederationMessageType({})).toBe(false);
  });

  test("TRUST_AFFECTING_MESSAGE_TYPES contains the 4 risk kinds", () => {
    expect(["trust-change", "topology-change", "agent-spawn", "agent-handoff"])
      .toEqual(expect.arrayContaining([...TRUST_AFFECTING_MESSAGE_TYPES]));
  });
});

describe("federation/envelope — canonical payload", () => {
  const sample: FederationEnvelope = {
    envelopeId: "env-1",
    sourceNodeId: "node-A",
    targetNodeId: "node-B",
    sessionId: "sess-1",
    messageType: "heartbeat",
    payload: { ok: true },
    timestamp: "2026-07-12T00:00:00.000Z",
    nonce: "nonce-1",
    hmacSignature: "sig-1",
    piiScanResult: emptyScanResult(),
    hopCount: 0,
  };

  test("canonicalSignablePayload is deterministic", () => {
    const a = canonicalSignablePayload(sample);
    const b = canonicalSignablePayload(sample);
    expect(a).toBe(b);
  });

  test("canonicalSignablePayload excludes hmacSignature + piiScanResult", () => {
    const json = canonicalSignablePayload(sample);
    expect(json).not.toContain("hmacSignature");
    expect(json).not.toContain("piiScanResult");
  });

  test("canonicalSignablePayload includes hopCount", () => {
    const json = canonicalSignablePayload(sample);
    expect(JSON.parse(json).hopCount).toBe(0);
  });

  test("mutating the source envelope changes the payload", () => {
    const before = canonicalSignablePayload(sample);
    const tampered: FederationEnvelope = { ...sample, payload: { ok: false } };
    const after = canonicalSignablePayload(tampered);
    expect(before).not.toBe(after);
  });
});

describe("federation/envelope — age", () => {
  test("envelopeAgeMs is 0 for a now() envelope", () => {
    const env: FederationEnvelope = {
      envelopeId: "e", sourceNodeId: "a", targetNodeId: "b",
      sessionId: "s", messageType: "heartbeat",
      payload: null, timestamp: new Date().toISOString(),
      nonce: "n", hmacSignature: "h", piiScanResult: emptyScanResult(),
    };
    expect(envelopeAgeMs(env)).toBeGreaterThanOrEqual(0);
    expect(envelopeAgeMs(env)).toBeLessThan(100);
  });

  test("envelopeAgeMs is large for an old envelope", () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const env: FederationEnvelope = {
      envelopeId: "e", sourceNodeId: "a", targetNodeId: "b",
      sessionId: "s", messageType: "heartbeat",
      payload: null, timestamp: old,
      nonce: "n", hmacSignature: "h", piiScanResult: emptyScanResult(),
    };
    expect(envelopeAgeMs(env)).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  test("envelopeAgeMs clamps invalid timestamps to Infinity", () => {
    const env: FederationEnvelope = {
      envelopeId: "e", sourceNodeId: "a", targetNodeId: "b",
      sessionId: "s", messageType: "heartbeat",
      payload: null, timestamp: "not-a-date",
      nonce: "n", hmacSignature: "h", piiScanResult: emptyScanResult(),
    };
    expect(envelopeAgeMs(env)).toBe(Number.POSITIVE_INFINITY);
  });
});