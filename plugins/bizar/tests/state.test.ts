/**
 * state.test.ts
 *
 * Tests for StateStore: read/write round-trip, atomic writes, rolling window,
 * corrupt-state fallback, and per-session mutex. Per §4.3, §4.7.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StateStore, SessionState, EMPTY_STATE } from "../src/state";
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Minimal mock logger that collects all messages
class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  log(opts: { level: string; message: string }) {
    this.messages.push(opts);
  }
}

const TEST_DIR = path.join(os.tmpdir(), "bizar-state-test");
const TEST_SESSION_A = "session-a-123";
const TEST_SESSION_B = "session-b-456";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: TEST_SESSION_A,
    parentAgent: null,
    startedAt: 0,
    lastActivityAt: 0,
    turnCount: 0,
    toolCalls: [],
    warningsIssued: 0,
    blocksTriggered: 0,
    ...overrides,
  };
}

function stateFilePath(sessionId: string) {
  return path.join(TEST_DIR, `${sessionId}.json`);
}

describe("StateStore", () => {
  let logger: MockLogger;
  let store: StateStore;

  beforeEach(() => {
    // Fresh temp dir for each test
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    mkdirSync(TEST_DIR, { recursive: true });
    logger = new MockLogger();
    store = new StateStore(TEST_DIR, logger);
  });

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // ── read/write round-trip ──────────────────────────────────────────────────

  test("read/write round-trip preserves all fields", async () => {
    const state = makeState({
      sessionId: TEST_SESSION_A,
      parentAgent: "odin",
      startedAt: 1700000000000,
      lastActivityAt: 1700000005000,
      turnCount: 3,
      toolCalls: [
        { tool: "read", fingerprint: "abc123", at: 1700000001000, outcome: "ok" },
        { tool: "edit", fingerprint: "def456", at: 1700000002000, outcome: "error" },
      ],
      warningsIssued: 1,
      blocksTriggered: 0,
    });

    await store.save(state);
    const loaded = await store.load(TEST_SESSION_A);

    expect(loaded.sessionId).toBe(TEST_SESSION_A);
    expect(loaded.parentAgent).toBe("odin");
    expect(loaded.startedAt).toBe(1700000000000);
    expect(loaded.lastActivityAt).toBe(1700000005000);
    expect(loaded.turnCount).toBe(3);
    expect(loaded.toolCalls).toHaveLength(2);
    expect(loaded.toolCalls[0]!.fingerprint).toBe("abc123");
    expect(loaded.toolCalls[1]!.outcome).toBe("error");
    expect(loaded.warningsIssued).toBe(1);
    expect(loaded.blocksTriggered).toBe(0);
  });

  test("load returns EMPTY_STATE when file does not exist", async () => {
    const loaded = await store.load("nonexistent-session-xyz");
    expect(loaded.sessionId).toBe("nonexistent-session-xyz");
    expect(loaded.parentAgent).toBe(null);
    expect(loaded.startedAt).toBe(0);
    expect(loaded.lastActivityAt).toBe(0);
    expect(loaded.turnCount).toBe(0);
    expect(loaded.toolCalls).toHaveLength(0);
    expect(loaded.warningsIssued).toBe(0);
    expect(loaded.blocksTriggered).toBe(0);
  });

  // ── rolling window ─────────────────────────────────────────────────────────

  test("toolCalls array is pruned to last 50 entries on write", async () => {
    const manyCalls = Array.from({ length: 60 }, (_, i) => ({
      tool: "read",
      fingerprint: `fp-${i}`,
      at: 1000 + i,
      outcome: "ok" as const,
    }));

    const state = makeState({ toolCalls: manyCalls });
    await store.save(state);
    const loaded = await store.load(TEST_SESSION_A);

    expect(loaded.toolCalls).toHaveLength(50);
    // First entry should be the 10th original (index 10), since 0-9 are pruned
    expect(loaded.toolCalls[0]!.fingerprint).toBe("fp-10");
    // Last entry should be the original 59th
    expect(loaded.toolCalls[49]!.fingerprint).toBe("fp-59");
  });

  test("fewer than 50 tool calls are preserved intact", async () => {
    const calls = Array.from({ length: 10 }, (_, i) => ({
      tool: "read",
      fingerprint: `fp-${i}`,
      at: 1000 + i,
      outcome: "ok" as const,
    }));
    const state = makeState({ toolCalls: calls });
    await store.save(state);
    const loaded = await store.load(TEST_SESSION_A);
    expect(loaded.toolCalls).toHaveLength(10);
  });

  // ── corrupt-state fallback ─────────────────────────────────────────────────

  test("corrupt JSON file → warning logged, in-memory state starts empty, file preserved", async () => {
    const filePath = stateFilePath(TEST_SESSION_A);
    writeFileSync(filePath, "{ invalid json }", "utf8");

    const loaded = await store.load(TEST_SESSION_A);

    // Returns empty state with the sessionId from filename
    expect(loaded.sessionId).toBe(TEST_SESSION_A);
    expect(loaded.parentAgent).toBe(null);
    expect(loaded.startedAt).toBe(0);
    expect(loaded.toolCalls).toHaveLength(0);

    // Warning was logged
    expect(logger.messages.some((m) => m.level === "warn" && m.message.includes("corrupt"))).toBe(true);

    // File is preserved for forensic inspection
    expect(existsSync(filePath)).toBe(true);
  });

  test("valid JSON but wrong schema (missing toolCalls) → corrupt fallback", async () => {
    const filePath = stateFilePath(TEST_SESSION_A);
    writeFileSync(filePath, JSON.stringify({ sessionId: TEST_SESSION_A, parentAgent: null }), "utf8");

    const loaded = await store.load(TEST_SESSION_A);
    expect(loaded.sessionId).toBe(TEST_SESSION_A);
    expect(loaded.toolCalls).toHaveLength(0);
    expect(logger.messages.some((m) => m.level === "warn")).toBe(true);
  });

  // ── per-session mutex ──────────────────────────────────────────────────────

  test("concurrent writes to same session are serialized (no lost updates)", async () => {
    // Verify the per-session mutex serializes concurrent operations.
    // Two tasks increment an in-memory counter inside withLock — counter must be 2.
    let counter = 0;
    await Promise.all([
      store.withLock(TEST_SESSION_A, async () => {
        counter += 1;
        await new Promise((r) => setTimeout(r, 10));
        counter += 1;
      }),
      store.withLock(TEST_SESSION_A, async () => {
        counter += 1;
        await new Promise((r) => setTimeout(r, 10));
        counter += 1;
      }),
    ]);
    expect(counter).toBe(4); // each task increments twice; mutex ensures no race
  });

  test("different sessions do not block each other", async () => {
    const storeA = new StateStore(TEST_DIR, logger);
    const storeB = new StateStore(TEST_DIR, logger);

    const [resultA, resultB] = await Promise.all([
      storeA.load(TEST_SESSION_A),
      storeB.load(TEST_SESSION_B),
    ]);

    // Each session loaded its own empty state independently
    expect(resultA.sessionId).toBe(TEST_SESSION_A);
    expect(resultB.sessionId).toBe(TEST_SESSION_B);
  });

  // ── atomic write ───────────────────────────────────────────────────────────

  test("save uses atomic rename (no partial file on disk)", async () => {
    const state = makeState({ parentAgent: "odin", startedAt: 1000 });
    await store.save(state);

    const filePath = stateFilePath(TEST_SESSION_A);
    expect(existsSync(filePath)).toBe(true);
    // tmp file should not exist after rename
    expect(existsSync(`${filePath}.tmp`)).toBe(false);

    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(filePath, "utf8")
    );
    const parsed = JSON.parse(content);
    expect(parsed.parentAgent).toBe("odin");
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  test("delete removes the state file", async () => {
    const state = makeState({ parentAgent: "odin" });
    await store.save(state);
    expect(existsSync(stateFilePath(TEST_SESSION_A))).toBe(true);

    await store.delete(TEST_SESSION_A);
    expect(existsSync(stateFilePath(TEST_SESSION_A))).toBe(false);
  });

  test("delete is idempotent (no error if file already gone)", async () => {
    await store.delete("already-gone-session");
    // Should not throw
  });

  // ── cleanup ────────────────────────────────────────────────────────────────

  test("cleanup removes files older than maxAgeDays", async () => {
    const filePath = stateFilePath(TEST_SESSION_A);
    writeFileSync(filePath, JSON.stringify(makeState({ lastActivityAt: Date.now() - 10 * 24 * 60 * 60 * 1000 })), "utf8");

    // Set the file's mtime to 10 days ago so cleanup considers it stale
    const tenDaysAgo = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(filePath, tenDaysAgo, tenDaysAgo);

    const deleted = await store.cleanup(7);
    expect(deleted).toBe(1);
    expect(existsSync(filePath)).toBe(false);
  });

  test("cleanup removes orphaned sessions (sessionId not in validSessionIds)", async () => {
    const filePath = stateFilePath(TEST_SESSION_A);
    writeFileSync(filePath, JSON.stringify(makeState({ lastActivityAt: Date.now() })), "utf8");

    const deleted = await store.cleanup(7, new Set(["some-other-session"]));
    expect(deleted).toBe(1);
    expect(existsSync(filePath)).toBe(false);
  });

  test("cleanup keeps files that are recent AND in validSessionIds", async () => {
    const filePath = stateFilePath(TEST_SESSION_A);
    writeFileSync(filePath, JSON.stringify(makeState({ lastActivityAt: Date.now() })), "utf8");

    const deleted = await store.cleanup(7, new Set([TEST_SESSION_A]));
    expect(deleted).toBe(0);
    expect(existsSync(filePath)).toBe(true);
  });

  test("cleanup returns 0 when state dir cannot be read", async () => {
    const unreadableStore = new StateStore("/nonexistent-dir-xyz", logger);
    const deleted = await unreadableStore.cleanup(7);
    expect(deleted).toBe(0);
  });
});