/**
 * federation/orchestrator.test.ts — F-038 orchestrator smoke tests.
 *
 * Covers the end-to-end `createFederation()` flow:
 *   - sign() produces a signed envelope.
 *   - receive() admits a fresh signed envelope.
 *   - PII redaction applies on sign() (soc2 mode).
 *   - status() returns the documented snapshot shape.
 *   - Two-instance roundtrip with shared HMAC secret.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFederation,
  type FederationHandle,
} from "../../src/federation/index.js";

describe("federation/orchestrator — single-instance flow", () => {
  let dir: string;
  let handle: FederationHandle;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bizar-fed-"));
    handle = createFederation({
      nodeId: "node-A",
      secret: "shared-secret",
      auditPath: join(dir, "audit.log"),
      budgetPath: join(dir, "budget.json"),
    });
    handle.services.trust.setAllowlisted("node-B", true);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("sign() produces a signed envelope with non-empty signature", () => {
    const env = handle.sign({
      targetNodeId: "node-B",
      sessionId: "s1",
      messageType: "heartbeat",
      payload: "ping",
    });
    expect(env.hmacSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(env.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.sourceNodeId).toBe("node-A");
    expect(env.targetNodeId).toBe("node-B");
  });

  test("receive() admits a fresh signed envelope from an allowlisted peer", () => {
    const peer = createFederation({
      nodeId: "node-B",
      secret: "shared-secret",
      auditPath: join(dir, "audit-B.log"),
      budgetPath: join(dir, "budget-B.json"),
    });
    const sent = peer.sign({
      targetNodeId: "node-A",
      sessionId: "s1",
      messageType: "heartbeat",
      payload: "hello",
    });
    const r = handle.receive(sent);
    expect(r.hmacValid).toBe(true);
    expect(r.trusted).toBe(true);
    expect(r.policyAllowed).toBe(true);
    expect(r.rejectionReason).toBeUndefined();
  });

  test("receive() rejects an envelope from a non-allowlisted peer", () => {
    const peer = createFederation({
      nodeId: "node-X",
      secret: "shared-secret",
      auditPath: join(dir, "audit-X.log"),
      budgetPath: join(dir, "budget-X.json"),
    });
    const sent = peer.sign({
      targetNodeId: "node-A",
      sessionId: "s1",
      messageType: "heartbeat",
      payload: "hello",
    });
    const r = handle.receive(sent);
    expect(r.hmacValid).toBe(true);
    expect(r.trusted).toBe(false);
    expect(r.rejectionReason).toMatch(/trust/);
  });

  test("receive() rejects a tampered envelope", () => {
    const peer = createFederation({
      nodeId: "node-B",
      secret: "shared-secret",
      auditPath: join(dir, "audit-B.log"),
      budgetPath: join(dir, "budget-B.json"),
    });
    const sent = peer.sign({
      targetNodeId: "node-A",
      sessionId: "s1",
      messageType: "heartbeat",
      payload: "hello",
    });
    const tampered = { ...sent, payload: "tampered" };
    const r = handle.receive(tampered);
    expect(r.hmacValid).toBe(false);
    expect(r.rejectionReason).toMatch(/hmac/);
  });

  test("PII redaction applies on sign() under soc2 mode", () => {
    const env = handle.sign({
      targetNodeId: "node-B",
      sessionId: "s1",
      messageType: "context-share",
      payload: "contact alice@example.com",
    });
    expect(env.payload).not.toContain("alice@example.com");
    expect(env.payload).toContain("[REDACTED:email]");
    expect(env.piiScanResult.scanned).toBe(true);
    expect(env.piiScanResult.piiFound).toBe(true);
  });

  test("skipPii disables redaction", () => {
    const env = handle.sign({
      targetNodeId: "node-B",
      sessionId: "s1",
      messageType: "context-share",
      payload: "contact alice@example.com",
      skipPii: true,
    });
    expect(env.payload).toBe("contact alice@example.com");
  });

  test("setPiiMode / getPiiMode round-trip", () => {
    expect(handle.getPiiMode()).toBe("soc2");
    handle.setPiiMode("gdpr");
    expect(handle.getPiiMode()).toBe("gdpr");
    expect(() => handle.setPiiMode("nope" as never)).toThrow();
  });

  test("status() returns the documented snapshot shape", () => {
    const snap = handle.status();
    expect(snap.nodeId).toBe("node-A");
    expect(snap.auditPath).toContain("audit.log");
    expect(snap.budget.path).toContain("budget.json");
    expect(Array.isArray(snap.budget.perPeer)).toBe(true);
    expect(typeof snap.nonceCacheSize).toBe("number");
    expect(typeof snap.auditSizeBytes).toBe("number");
  });

  test("constructor requires nodeId + secret", () => {
    expect(() => createFederation({ nodeId: "", secret: "x" } as never)).toThrow(/nodeId/);
    expect(() => createFederation({ nodeId: "x", secret: "" } as never)).toThrow(/secret/);
  });

  test("nonce replay is rejected on second delivery", () => {
    const peer = createFederation({
      nodeId: "node-B",
      secret: "shared-secret",
      auditPath: join(dir, "audit-B.log"),
      budgetPath: join(dir, "budget-B.json"),
    });
    const sent = peer.sign({
      targetNodeId: "node-A",
      sessionId: "s1",
      messageType: "heartbeat",
      payload: "hello",
    });
    const r1 = handle.receive(sent);
    const r2 = handle.receive(sent);
    expect(r1.hmacValid).toBe(true);
    expect(r2.hmacValid).toBe(false);
    if (r2.rejectionReason) expect(r2.rejectionReason).toMatch(/nonce_replay/);
  });
});