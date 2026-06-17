/**
 * Block (threshold-12) tests.
 *
 * Spec contract (tests/block.test.ts per §12.1):
 *   - Pre-populate state with 11 entries sharing fingerprint F.
 *   - The 12th identical call triggers the block action.
 *   - The block action's `reason` contains the tool name.
 *   - The block action's `reason` contains the substring `loop`
 *     (case-insensitive) OR the substring `escalate`.
 *
 * We test the `decide()` function directly. The `tool.execute.before`
 * hook in `index.ts` throws `new Error(decision.reason)` whenever
 * `decide()` returns `{ action: "block", … }`, so the block-message
 * contract is fully owned by `decide()` + `handoff.ts`. Testing
 * `decide()` keeps this file self-contained and independent of
 * Thor's `state.ts` and `fingerprint.ts` modules.
 */

import { describe, test, expect } from "bun:test";

import { decide } from "../src/loop.js";
import {
  DEFAULT_OPTIONS,
  type NormalizedOptions,
} from "../src/options.js";
import { blockMessage } from "../src/handoff.js";

// Local re-declaration of SessionState (see tests/loop.test.ts for rationale).
interface ToolCall {
  tool: string;
  fingerprint: string;
  at: number;
  outcome?: "ok" | "error";
}
interface SessionState {
  sessionId: string;
  parentAgent: string | null;
  startedAt: number;
  lastActivityAt: number;
  turnCount: number;
  toolCalls: ToolCall[];
  warningsIssued: number;
  blocksTriggered: number;
}

function emptyState(): SessionState {
  return {
    sessionId: "sess-block",
    parentAgent: "odin",
    startedAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_000_000,
    turnCount: 0,
    toolCalls: [],
    warningsIssued: 0,
    blocksTriggered: 0,
  };
}

const FP = "fp:read:loop";
const TOOL = "read";
const ARGS = { path: "/tmp/example.txt" };
const NOW = 1_700_000_500_000;

// For the block tests we need a window size that is at least as large as
// the block threshold, so the count can actually reach 12. The default
// `loopWindowSize` is 10 (spec §6.1), and the spec's `loopThresholdBlock
// <= loopWindowSize + 2` constraint allows block=12 with window=10 — but
// in that configuration the count is bounded by the window and can never
// reach 12. We use a wider window here so the block band is reachable;
// the spec's default config is a known limitation (see README "Limitations"
// §13 #11 and handoff.ts header).
const BLOCK_TEST_OPTS: NormalizedOptions = {
  ...DEFAULT_OPTIONS,
  loopWindowSize: 15,
};

describe("block — threshold 12 throw (spec §12.1)", () => {
  test("11 prior identical calls + 12th identical call triggers block", () => {
    const state = emptyState();

    // Pre-populate with 11 entries sharing fingerprint F.
    for (let i = 0; i < 11; i++) {
      state.toolCalls.push({
        tool: TOOL,
        fingerprint: FP,
        at: 1_700_000_000_000 + i,
      });
    }
    expect(state.toolCalls).toHaveLength(11);

    // The hook appends the current call to the state before calling
    // decide(). We model that here: the 12th call is in the state.
    state.toolCalls.push({
      tool: TOOL,
      fingerprint: FP,
      at: NOW,
    });
    expect(state.toolCalls).toHaveLength(12);

    const d = decide(state, FP, NOW, BLOCK_TEST_OPTS);

    expect(d.action).toBe("block");
    if (d.action !== "block") return;

    // Assert the rejection message properties (spec §12.1).
    // 1. Contains the tool name.
    expect(d.reason).toContain(TOOL);
    // 2. Contains "loop" (case-insensitive) OR "escalate".
    const matches = /loop/i.test(d.reason) || /escalate/i.test(d.reason);
    expect(matches).toBe(true);
  });

  test("block reason matches the canonical block template", () => {
    const state = emptyState();
    for (let i = 0; i < 12; i++) {
      state.toolCalls.push({ tool: TOOL, fingerprint: FP, at: NOW + i });
    }
    const d = decide(state, FP, NOW, BLOCK_TEST_OPTS);
    expect(d.action).toBe("block");
    if (d.action !== "block") return;
    expect(d.reason).toBe(blockMessage(TOOL));
  });

  test("block fires regardless of which tool name, as long as fingerprint matches", () => {
    const state = emptyState();
    for (let i = 0; i < 12; i++) {
      state.toolCalls.push({ tool: "bash", fingerprint: FP, at: NOW + i });
    }
    const d = decide(state, FP, NOW, BLOCK_TEST_OPTS);
    expect(d.action).toBe("block");
    if (d.action !== "block") return;
    // The tool name in the message is recovered from the matching
    // window entries — here, "bash".
    expect(d.reason).toContain("bash");
    expect(/loop/i.test(d.reason) || /escalate/i.test(d.reason)).toBe(true);
  });

  test("block fires with custom-configured block threshold", () => {
    const state = emptyState();
    for (let i = 0; i < 8; i++) {
      state.toolCalls.push({ tool: TOOL, fingerprint: FP, at: NOW + i });
    }
    // Custom block threshold of 8. Window is widened so the count can
    // reach 8.
    const opts: NormalizedOptions = {
      ...DEFAULT_OPTIONS,
      loopThresholdBlock: 8,
      loopThresholdEscalate: 6,
      loopThresholdWarn: 4,
      loopWindowSize: 12,
    };
    const d = decide(state, FP, NOW, opts);
    expect(d.action).toBe("block");
    if (d.action !== "block") return;
    // The canonical template still says "12" regardless of the
    // configured threshold (this is a known limitation, see README
    // "Limitations" §13 and handoff.ts header).
    expect(d.reason).toBe(blockMessage(TOOL));
  });

  test("the hook path would throw — simulate by checking decide() shape", () => {
    // This test pins the contract that `index.ts` depends on:
    // when `decide()` returns `{ action: "block", reason }`, the hook
    // throws `new Error(reason)`. The shape is what matters; the
    // throw itself is wired in index.ts.
    const state = emptyState();
    for (let i = 0; i < 12; i++) {
      state.toolCalls.push({ tool: TOOL, fingerprint: FP, at: NOW + i });
    }
    const d = decide(state, FP, NOW, BLOCK_TEST_OPTS);
    expect(d.action).toBe("block");
    if (d.action !== "block") return;

    // Simulate the hook's throw: `throw new Error(d.reason)`. The
    // thrown Error's message must be the decision's reason.
    const thrown = new Error(d.reason);
    expect(thrown.message).toBe(d.reason);
    expect(thrown.message).toContain(TOOL);
    expect(/loop/i.test(thrown.message) || /escalate/i.test(thrown.message)).toBe(true);
  });

  test("11 prior calls (no 12th) does NOT block", () => {
    const state = emptyState();
    for (let i = 0; i < 11; i++) {
      state.toolCalls.push({ tool: TOOL, fingerprint: FP, at: NOW + i });
    }
    // 11 calls total — below the block threshold of 12.
    const d = decide(state, FP, NOW, BLOCK_TEST_OPTS);
    expect(d.action).not.toBe("block");
    // It should be escalate (count=11 >= escalate threshold of 8).
    expect(d.action).toBe("escalate");
  });
});
