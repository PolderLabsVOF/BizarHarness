/**
 * sessions.test.mjs
 *
 * Pillar A — sessions route tests.
 * Tests: list sessions (empty), list sessions (with data), stop a session.
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionsRouter } from "./sessions.mjs";

function fakeReq(method, url, body = null) {
  const http = require("node:http");
  const urlObj = new URL(url, "http://localhost");
  const req = new http.IncomingMessage();
  req.method = method;
  req.url = urlObj.pathname + urlObj.search;
  req.params = {};
  req.body = body;
  req.query = Object.fromEntries(urlObj.searchParams.entries());
  return req;
}

function fakeRes() {
  let status = 200;
  let payload = null;
  return {
    statusCode: status,
    data: null,
    status(s) { status = s; return this; },
    json(d) { this.data = d; this.statusCode = status; return d; },
    get statusCode() { return status; },
  };
}

describe("sessions route", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sessions-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("GET /sessions returns empty list when file does not exist", () => {
    const router = createSessionsRouter({ projectRoot: tmp });
    const req = fakeReq("GET", "/sessions");
    const res = fakeRes();
    const handler = router.stack.find(
      (l) => l.route?.path === "/sessions" && l.route?.methods?.get
    );
    assert.ok(handler, "GET /sessions handler not found");
    handler.route.stack[0](req, res, () => {});
    assert.deepStrictEqual(res.data, { sessions: [] });
  });

  it("GET /sessions returns deduplicated live sessions", () => {
    const hb = join(tmp, ".harness", "traces");
    writeFileSync(join(hb, "heartbeat.jsonl"), "", "utf-8");
    appendFileSync(
      join(hb, "heartbeat.jsonl"),
      JSON.stringify({ session_id: "aaa", started_at: "2024-01-01T00:00:00Z", last_heartbeat_at: "2024-01-01T00:00:01Z", status: "running" }) + "\n"
    );
    appendFileSync(
      join(hb, "heartbeat.jsonl"),
      JSON.stringify({ session_id: "bbb", started_at: "2024-01-01T00:00:00Z", last_heartbeat_at: "2024-01-01T00:00:01Z", status: "running" }) + "\n"
    );
    const router = createSessionsRouter({ projectRoot: tmp });
    const req = fakeReq("GET", "/sessions");
    const res = fakeRes();
    const handler = router.stack.find(
      (l) => l.route?.path === "/sessions" && l.route?.methods?.get
    );
    handler.route.stack[0](req, res, () => {});
    assert.strictEqual(res.data.sessions.length, 2);
  });

  it("POST /sessions/:id/stop writes done record", () => {
    const hb = join(tmp, ".harness", "traces");
    writeFileSync(join(hb, "heartbeat.jsonl"), "", "utf-8");
    const router = createSessionsRouter({ projectRoot: tmp });
    const req = fakeReq("POST", "/sessions/abc-123/stop");
    const res = fakeRes();
    const handler = router.stack.find(
      (l) => l.route?.path === "/sessions/:id/stop" && l.route?.methods?.post
    );
    handler.route.stack[0](req, res, () => {});
    assert.strictEqual(res.data.session_id, "abc-123");
    assert.strictEqual(res.data.status, "done");
  });
});
