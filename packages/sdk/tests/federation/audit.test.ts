/**
 * federation/audit.test.ts — F-038 AuditService tests.
 *
 * Covers:
 *   - record() appends NDJSON lines to the file.
 *   - size() reports on-disk bytes.
 *   - tail() returns parsed entries from the tail.
 *   - rotate() moves the file to .log.1.
 *   - reset() wipes the log file.
 *   - Constructor throws on missing nodeId.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService, DEFAULT_AUDIT_PATH } from "../../src/federation/audit.js";

describe("federation/audit — AuditService", () => {
  let dir: string;
  let path: string;
  let audit: AuditService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bizar-audit-"));
    path = join(dir, "federation-audit.log");
    audit = new AuditService({ nodeId: "test-node", path });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("record() appends an NDJSON line", () => {
    audit.record({
      ts: new Date().toISOString(),
      envelopeId: "env-1",
      sourceNodeId: "node-A",
      targetNodeId: "node-B",
      messageType: "heartbeat",
      nonce: "n1",
      allowed: true,
      reason: "ok",
      layer: "sent",
    });
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.envelopeId).toBe("env-1");
    expect(parsed.nodeId).toBe("test-node");
  });

  test("size() reports on-disk bytes", () => {
    expect(audit.size()).toBe(0);
    audit.record({
      ts: new Date().toISOString(),
      envelopeId: "env-1",
      sourceNodeId: "node-A",
      targetNodeId: "node-B",
      messageType: "heartbeat",
      nonce: "n1",
      allowed: true,
      reason: "ok",
      layer: "sent",
    });
    expect(audit.size()).toBeGreaterThan(0);
  });

  test("tail() returns parsed entries from the end of the file", () => {
    for (let i = 0; i < 5; i++) {
      audit.record({
        ts: new Date().toISOString(),
        envelopeId: `env-${i}`,
        sourceNodeId: "node-A",
        targetNodeId: "node-B",
        messageType: "heartbeat",
        nonce: `n${i}`,
        allowed: true,
        reason: `entry-${i}`,
        layer: "sent",
      });
    }
    const tail = audit.tail(3);
    expect(tail.length).toBe(3);
    expect(tail[2].envelopeId).toBe("env-4");
    expect(tail[2].reason).toBe("entry-4");
  });

  test("tail() returns [] when file missing", () => {
    const a = new AuditService({ nodeId: "x", path: join(dir, "never-created.log") });
    expect(a.tail()).toEqual([]);
  });

  test("rotate() moves the current log to .log.1", () => {
    audit.record({
      ts: new Date().toISOString(),
      envelopeId: "env-1",
      sourceNodeId: "node-A",
      targetNodeId: "node-B",
      messageType: "heartbeat",
      nonce: "n1",
      allowed: true,
      reason: "ok",
      layer: "sent",
    });
    audit.rotate();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.1`)).toBe(true);
  });

  test("getPath() returns the configured path", () => {
    expect(audit.getPath()).toBe(path);
  });

  test("constructor requires nodeId", () => {
    expect(() => new AuditService({ nodeId: "" as unknown as string })).toThrow(/nodeId/);
  });

  test("reset() removes the file (rename to .deleted)", () => {
    audit.record({
      ts: new Date().toISOString(),
      envelopeId: "env-1",
      sourceNodeId: "node-A",
      targetNodeId: "node-B",
      messageType: "heartbeat",
      nonce: "n1",
      allowed: true,
      reason: "ok",
      layer: "sent",
    });
    audit.reset();
    // After reset, the file was renamed to .deleted (or removed on race).
    expect(existsSync(path)).toBe(false);
  });

  test("DEFAULT_AUDIT_PATH is the harness-local path", () => {
    expect(DEFAULT_AUDIT_PATH).toBe(".harness/federation-audit.log");
  });

  test("rotation triggered when appending would exceed threshold", () => {
    // Pre-fill the file to just below the threshold.
    const huge = "x".repeat(10 * 1024 * 1024 - 200);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, huge, "utf-8");
    expect(statSync(path).size).toBeGreaterThan(10 * 1024 * 1024 - 1024);
    audit.record({
      ts: new Date().toISOString(),
      envelopeId: "env-1",
      sourceNodeId: "node-A",
      targetNodeId: "node-B",
      messageType: "heartbeat",
      nonce: "n1",
      allowed: true,
      reason: "ok",
      layer: "sent",
    });
    // After the write, the previous file should have been rotated to .log.1
    // and the new entry written to the fresh .log.
    expect(existsSync(`${path}.1`)).toBe(true);
    const newSize = statSync(path).size;
    expect(newSize).toBeLessThan(1024);
  });
});