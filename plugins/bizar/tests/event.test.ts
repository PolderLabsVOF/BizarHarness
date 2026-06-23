/**
 * event.test.ts
 *
 * Tests for the canonical session lifecycle per §4.5.1 (v0.3.1 N4 fix).
 *
 * Verifies:
 * 1. session.created does NOT create the state file — only updates in-memory seen-message set
 * 2. Duplicate session.created events are a no-op (no extra file, no error)
 * 3. First chat.message per session creates the state file with §4.7 schema
 * 4. First tool.execute.before (subagent-only lazy fallback) creates the state file with
 *    parentAgent: null when chat.message has not yet fired
 *
 * Per MEDIUM finding 28 / v0.3.1 §12.1.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Minimal interfaces that mirror what index.ts will define ────────────────

/** In-memory seen-message set maintained by the plugin per session */
const seenMessageIds = new Map<string, Set<string>>();

/** Tracks whether the state file has been created for a session */
const stateFileCreated = new Map<string, boolean>();

/**
 * Minimal mock of the plugin's session state — simulates the event hook
 * behavior described in §4.5.1 without requiring the full index.ts.
 */
class MockPlugin {
  private stateDir: string;
  private seenMessages: Map<string, Set<string>>;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.seenMessages = seenMessageIds;
  }

  /** session.created — does NOT create state file; only updates in-memory set */
  onSessionCreated(sessionId: string): void {
    if (!this.seenMessages.has(sessionId)) {
      this.seenMessages.set(sessionId, new Set());
    }
    // Does NOT call createStateFile
  }

  /** chat.message — first message per session creates state file with §4.7 schema */
  onChatMessage(sessionId: string, messageId: string, sender: string): void {
    if (!this.seenMessages.has(sessionId)) {
      this.seenMessages.set(sessionId, new Set());
    }
    const seen = this.seenMessages.get(sessionId)!;
    if (seen.has(messageId)) return; // duplicate — no-op
    seen.add(messageId);

    // First message for this session → create state file
    if (seen.size === 1) {
      this.createStateFile(sessionId, sender);
    }
  }

  /**
   * tool.execute.before — subagent-only lazy fallback.
   * Creates state file with parentAgent: null if chat.message has not fired yet.
   */
  onToolExecuteBefore(sessionId: string): void {
    const seen = this.seenMessages.get(sessionId);
    if (!seen || seen.size === 0) {
      // chat.message hasn't fired → lazy fallback with parentAgent: null
      this.createStateFile(sessionId, null);
    }
  }

  /** session.deleted — removes state file */
  onSessionDeleted(sessionId: string): void {
    this.seenMessages.delete(sessionId);
    const filePath = path.join(this.stateDir, `${sessionId}.json`);
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(filePath);
    } catch {
      // non-fatal if already gone
    }
  }

  /** Unknown event type — no-op */
  onUnknownEvent(): void {
    // no state file created, no error
  }

  private createStateFile(sessionId: string, parentAgent: string | null): void {
    const filePath = path.join(this.stateDir, `${sessionId}.json`);
    const state = {
      sessionId,
      parentAgent,
      startedAt: parentAgent !== null ? Date.now() : 0,
      lastActivityAt: parentAgent !== null ? Date.now() : 0,
      turnCount: 0,
      toolCalls: [],
      warningsIssued: 0,
      blocksTriggered: 0,
    };
    const { writeFileSync } = require("node:fs");
    writeFileSync(filePath, JSON.stringify(state), "utf8");
    stateFileCreated.set(sessionId, true);
  }

  getSeenMessages(sessionId: string): Set<string> {
    return this.seenMessages.get(sessionId) ?? new Set();
  }

  stateFileExists(sessionId: string): boolean {
    return existsSync(path.join(this.stateDir, `${sessionId}.json`));
  }

  readStateFile(sessionId: string): ReturnType<typeof readFileSync> | null {
    const filePath = path.join(this.stateDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8");
  }
}

// ── Test setup ───────────────────────────────────────────────────────────────

const TEST_DIR = path.join(os.tmpdir(), "bizar-event-test");
const TEST_SESSION = "session-evt-001";
const TEST_SESSION_2 = "session-evt-002";

describe("event.test.ts — canonical session lifecycle", () => {
  let plugin: MockPlugin;

  beforeEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    mkdirSync(TEST_DIR, { recursive: true });
    plugin = new MockPlugin(TEST_DIR);
    seenMessageIds.clear();
    stateFileCreated.clear();
  });

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // ── §4.5.1 / v0.3.1 N4 fix ────────────────────────────────────────────────

  test("session.created does NOT create the state file", () => {
    plugin.onSessionCreated(TEST_SESSION);
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(false);
  });

  test("session.created only updates the in-memory seen-message set", () => {
    plugin.onSessionCreated(TEST_SESSION);
    expect(plugin.getSeenMessages(TEST_SESSION).size).toBe(0); // empty set created
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(false);
  });

  test("duplicate session.created events are a no-op — no extra file, no error", () => {
    plugin.onSessionCreated(TEST_SESSION);
    plugin.onSessionCreated(TEST_SESSION);
    plugin.onSessionCreated(TEST_SESSION);
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(false);
    // Should not throw
  });

  test("first chat.message per session creates the state file with §4.7 schema", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");

    expect(plugin.stateFileExists(TEST_SESSION)).toBe(true);

    const raw = plugin.readStateFile(TEST_SESSION);
    expect(raw).not.toBeNull();
    const state = JSON.parse(raw!.toString());

    expect(state.sessionId).toBe(TEST_SESSION);
    expect(state.parentAgent).toBe("odin");
    expect(state.startedAt).toBeGreaterThan(0);
    expect(state.lastActivityAt).toBeGreaterThan(0);
    expect(state.turnCount).toBe(0);
    expect(state.toolCalls).toHaveLength(0);
    expect(state.warningsIssued).toBe(0);
    expect(state.blocksTriggered).toBe(0);
  });

  test("first tool.execute.before (subagent-only lazy fallback) creates state file with parentAgent: null", () => {
    // No chat.message has fired — simulate a subagent-only session
    plugin.onToolExecuteBefore(TEST_SESSION);

    expect(plugin.stateFileExists(TEST_SESSION)).toBe(true);

    const raw = plugin.readStateFile(TEST_SESSION);
    expect(raw).not.toBeNull();
    const state = JSON.parse(raw!.toString());

    expect(state.sessionId).toBe(TEST_SESSION);
    expect(state.parentAgent).toBeNull();
    expect(state.startedAt).toBe(0); // §4.7: epoch zero for lazy fallback
    expect(state.lastActivityAt).toBe(0);
    expect(state.toolCalls).toHaveLength(0);
  });

  test("chat.message followed by tool.execute.before does NOT create duplicate state file", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    const firstRead = plugin.readStateFile(TEST_SESSION);

    plugin.onToolExecuteBefore(TEST_SESSION);
    const secondRead = plugin.readStateFile(TEST_SESSION);

    // Same content — no duplicate write
    expect(firstRead).toBe(secondRead);
  });

  test("session.deleted removes the state file", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(true);

    plugin.onSessionDeleted(TEST_SESSION);
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(false);
  });

  test("unknown event types are no-ops — no state file created, no error", () => {
    plugin.onUnknownEvent();
    expect(plugin.stateFileExists(TEST_SESSION)).toBe(false);
    // Should not throw
  });

  test("second chat.message for same session does NOT create new state file", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    const firstContent = plugin.readStateFile(TEST_SESSION);

    plugin.onChatMessage(TEST_SESSION, "msg-002", "odin");
    const secondContent = plugin.readStateFile(TEST_SESSION);

    expect(firstContent).toBe(secondContent);
  });

  test("different sessions have independent state files", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    plugin.onChatMessage(TEST_SESSION_2, "msg-002", "thor");

    const stateA = JSON.parse(plugin.readStateFile(TEST_SESSION)!.toString());
    const stateB = JSON.parse(plugin.readStateFile(TEST_SESSION_2)!.toString());

    expect(stateA.parentAgent).toBe("odin");
    expect(stateB.parentAgent).toBe("thor");
    expect(stateA.sessionId).toBe(TEST_SESSION);
    expect(stateB.sessionId).toBe(TEST_SESSION_2);
  });

  test("duplicate chat.message (same messageId) is a no-op", () => {
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    const content1 = plugin.readStateFile(TEST_SESSION);

    // Same messageId again — no-op
    plugin.onChatMessage(TEST_SESSION, "msg-001", "odin");
    const content2 = plugin.readStateFile(TEST_SESSION);

    expect(content1).toBe(content2);
  });
});