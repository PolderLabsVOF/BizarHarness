/**
 * tests/sessions.test.mjs
 *
 * Pillar A — sessions route tests.
 * Tests: list sessions (empty), list sessions (with data), stop a session.
 */

import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionsRouter } from "../src/server/routes/sessions.mjs";

function fakeReq(method, url) {
  const http = require("node:http");
  const urlObj = new URL(url, "http://localhost");
  const req = new http.IncomingMessage();
  req.method = method;
  req.url = urlObj.pathname + urlObj.search;
  req.params = {};
  req.body = null;
  req.query = Object.fromEntries(urlObj.searchParams.entries());
  return req;
}

function fakeRes() {
  return {
    _status: 200,
    data: null,
    status(s) { this._status = s; return this; },
    json(d) { this.data = d; return d; },
    get statusCode() { return this._status; },
  };
}

test("GET /sessions returns empty list when file does not exist", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sessions-test-"));
  try {
    const router = createSessionsRouter({ projectRoot: tmp });
    const req = fakeReq("GET", "/sessions");
    const res = fakeRes();
    router.handle(req, res, () => {});
    assert.deepStrictEqual(res.data, { sessions: [] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("GET /sessions returns deduplicated live sessions", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sessions-test-"));
  try {
    const hb = join(tmp, ".harness", "traces");
    mkdirSync(hb, { recursive: true });
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
    router.handle(req, res, () => {});
    assert.strictEqual(res.data.sessions.length, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POST /sessions/:id/stop writes done record", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sessions-test-"));
  try {
    const hb = join(tmp, ".harness", "traces");
    mkdirSync(hb, { recursive: true });
    writeFileSync(join(hb, "heartbeat.jsonl"), "", "utf-8");
    const router = createSessionsRouter({ projectRoot: tmp });
    const req = fakeReq("POST", "/sessions/abc-123/stop");
    const res = fakeRes();
    router.handle(req, res, () => {});
    assert.strictEqual(res.data.session_id, "abc-123");
    assert.strictEqual(res.data.status, "done");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
