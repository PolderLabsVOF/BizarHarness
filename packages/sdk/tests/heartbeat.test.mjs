/**
 * heartbeat.test.mjs
 *
 * Pillar A — heartbeat smoke test.
 * Run via: vitest run --root packages/sdk
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startHeartbeat,
  stopHeartbeat,
  failHeartbeat,
  heartbeatPath,
} from "../src/agent/heartbeat.js";

describe("heartbeat", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "hb-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("startHeartbeat returns a sessionId and stop fn", () => {
    const { sessionId, stop } = startHeartbeat(10_000, tmp);
    assert.ok(sessionId, "sessionId must be a non-empty string");
    assert.ok(typeof stop === "function", "stop must be a function");
    stop();
  });

  it("stopHeartbeat appends a done record", () => {
    const { sessionId, stop } = startHeartbeat(10_000, tmp);
    stop();
    const content = readFileSync(heartbeatPath(tmp), "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const done = lines.find((l) => JSON.parse(l).status === "done");
    assert.ok(done, "a 'done' record must be present after stop");
  });

  it("failHeartbeat appends a failed record", () => {
    const { sessionId, stop } = startHeartbeat(10_000, tmp);
    stop();
    failHeartbeat(sessionId, tmp);
    const content = readFileSync(heartbeatPath(tmp), "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const failed = lines.find((l) => JSON.parse(l).status === "failed");
    assert.ok(failed, "a 'failed' record must be present");
  });
});
