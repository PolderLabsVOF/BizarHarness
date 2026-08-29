/**
 * learning/behavior-capture.test.mjs — F-194 Phase B.3 unit tests.
 *
 * Asserts:
 *   - fingerprint64 returns 16-hex-char SHA-256 prefix, stable across
 *     whitespace-only variations
 *   - createBehaviorRecord stamps the timestamp server-side and
 *     omits `rejectReason` when not provided
 *   - FORBIDDEN_BEHAVIOR_KEYS is a non-empty frozen list containing
 *     prompt / promptRedacted / rawPrompt
 *   - validateBehaviorRecord rejects any forbidden key, bad fingerprint,
 *     missing workerId, non-boolean accept
 *   - createInMemoryBehaviorCapture / createFileBehaviorCapture round-trip
 *   - File capture creates the parent dir at 0o700 and tightens pre-existing
 *   - summarizeBehavior aggregates accept/reject counts per workerId
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BEHAVIOR_DIR_MODE,
  FORBIDDEN_BEHAVIOR_KEYS,
  fingerprint64,
  validateBehaviorRecord,
  createBehaviorRecord,
  createInMemoryBehaviorCapture,
  createFileBehaviorCapture,
  summarizeBehavior,
} from "../../src/learning/behavior-capture.js";

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bizar-behavior-"));
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("behavior-capture schema", () => {
  it("BEHAVIOR_DIR_MODE is 0o700", () => {
    assert.equal(BEHAVIOR_DIR_MODE, 0o700);
  });

  it("FORBIDDEN_BEHAVIOR_KEYS includes prompt, promptRedacted, rawPrompt", () => {
    assert.ok(Array.isArray(FORBIDDEN_BEHAVIOR_KEYS));
    assert.ok(FORBIDDEN_BEHAVIOR_KEYS.includes("prompt"));
    assert.ok(FORBIDDEN_BEHAVIOR_KEYS.includes("promptRedacted"));
    assert.ok(FORBIDDEN_BEHAVIOR_KEYS.includes("rawPrompt"));
  });

  it("fingerprint64 returns 16-hex-char SHA-256 prefix, whitespace-stable", () => {
    const a = fingerprint64("audit my repo for security issues");
    const b = fingerprint64("audit   my  repo\nfor security\tissues");
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(a, b, "fingerprint must collapse whitespace before hashing");
    assert.notEqual(a, fingerprint64("audit my repo for performance issues"));
  });

  it("createBehaviorRecord stamps timestamp server-side and omits rejectReason when absent", () => {
    const r = createBehaviorRecord({
      fingerprint: fingerprint64("ping"),
      workerId: "mike",
      accept: true,
    });
    assert.equal(r.workerId, "mike");
    assert.equal(r.accept, true);
    assert.match(r.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(r.rejectReason, undefined);
    assert.equal("rejectReason" in r, false);
  });

  it("validateBehaviorRecord rejects forbidden keys (prompt / promptRedacted / rawPrompt)", () => {
    const base = createBehaviorRecord({
      fingerprint: fingerprint64("x"),
      workerId: "mike",
      accept: true,
    });
    for (const key of ["prompt", "promptRedacted", "rawPrompt"]) {
      assert.throws(
        () => validateBehaviorRecord({ ...base, [key]: "leaked" }),
        new RegExp(`forbidden key "${key}"`),
        `forbidden key ${key} must be rejected`,
      );
    }
  });

  it("validateBehaviorRecord rejects a malformed fingerprint or missing workerId", () => {
    const good = createBehaviorRecord({
      fingerprint: fingerprint64("x"),
      workerId: "mike",
      accept: true,
    });
    assert.throws(
      () => validateBehaviorRecord({ ...good, fingerprint64: "tooshort" }),
      /16 lowercase hex chars/,
    );
    assert.throws(
      () => validateBehaviorRecord({ ...good, workerId: "" }),
      /workerId must be a non-empty string/,
    );
    assert.throws(
      () => validateBehaviorRecord({ ...good, accept: "yes" }),
      /accept must be a boolean/,
    );
  });

  it("createInMemoryBehaviorCapture appends + lists + sizes", () => {
    const cap = createInMemoryBehaviorCapture();
    assert.equal(cap.size(), 0);
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("a"), workerId: "mike", accept: true }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("b"), workerId: "linda", accept: false, rejectReason: "wrong worker" }));
    assert.equal(cap.size(), 2);
    const rows = cap.list();
    assert.equal(rows[0].workerId, "mike");
    assert.equal(rows[1].rejectReason, "wrong worker");
  });

  it("createFileBehaviorCapture round-trips through the JSONL file with 0o700 dir", () => {
    const path = join(tmp, "deep", "nested", "behavior.jsonl");
    const cap = createFileBehaviorCapture({ filePath: path });
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("a"), workerId: "mike", accept: true }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("b"), workerId: "linda", accept: false, rejectReason: "wrong worker" }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("c"), workerId: "todd", accept: true }));

    const dir = join(tmp, "deep", "nested");
    assert.equal(existsSync(path), true);
    assert.equal(statSync(dir).mode & 0o777, 0o700);

    const raw = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(raw.length, 3);
    for (const line of raw) {
      const obj = JSON.parse(line);
      assert.equal("prompt" in obj, false, "no prompt field in any row");
      assert.equal("promptRedacted" in obj, false, "no promptRedacted field in any row");
      assert.equal("rawPrompt" in obj, false, "no rawPrompt field in any row");
    }

    const cap2 = createFileBehaviorCapture({ filePath: path });
    assert.equal(cap2.size(), 3);
    assert.equal(cap2.list()[1].workerId, "linda");
  });

  it("createFileBehaviorCapture tightens pre-existing dirs to 0o700", () => {
    const dir = join(tmp, "loose");
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    assert.equal(statSync(dir).mode & 0o777, 0o755);
    const cap = createFileBehaviorCapture({ filePath: join(dir, "behavior.jsonl") });
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("a"), workerId: "mike", accept: true }));
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it("summarizeBehavior aggregates accept/reject counts per workerId", () => {
    const cap = createInMemoryBehaviorCapture();
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("a"), workerId: "mike", accept: true }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("b"), workerId: "mike", accept: true }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("c"), workerId: "mike", accept: false, rejectReason: "wrong tier" }));
    cap.append(createBehaviorRecord({ fingerprint: fingerprint64("d"), workerId: "linda", accept: false, rejectReason: "not auditor" }));
    const summary = summarizeBehavior(cap.list());
    assert.deepEqual(summary, {
      mike: { accept: 2, reject: 1, lastRejectReason: "wrong tier" },
      linda: { accept: 0, reject: 1, lastRejectReason: "not auditor" },
    });
  });
});
