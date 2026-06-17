/**
 * Loop decision-tree tests.
 *
 * Spec contract (tests/loop.test.ts per §12.1):
 *   - Threshold-3 band returns `warn` (caller will log only — no injection).
 *   - Threshold-5 band returns `warn` with the inject-warn handoff message.
 *   - Threshold-8 band returns `escalate` with the inject-escalate message.
 *   - Threshold-12 band returns `block` with the throw message.
 *   - The throw message contains the tool name and the substring `loop`
 *     (case-insensitive) or `escalate` (spec §12.1, last bullet).
 *   - Window rolling: with `loopWindowSize = 4` and a window of
 *     `[bash X, bash X, read, bash X]`, the fingerprint for X reports
 *     3 repetitions (spec §5.5).
 *   - Out-of-window entries do not count.
 */

import { describe, test, expect } from "bun:test";

import { decide, isLogOnlyWarn, type Decision } from "../src/loop.js";
import {
  DEFAULT_OPTIONS,
  normalizeOptions,
  type NormalizedOptions,
} from "../src/options.js";
import {
  warnMessage,
  escalateMessage,
  blockMessage,
  CANONICAL_TEMPLATES,
} from "../src/handoff.js";

// --- Local re-declaration of SessionState -----------------------------------
// The `SessionState` type lives in `src/state.ts` (Thor's module). We
// re-declare the structural shape here so these tests are self-contained
// and do not require Thor's module to be present. The integration test
// pins the real interface.
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
    sessionId: "sess-1",
    parentAgent: "odin",
    startedAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_000_000,
    turnCount: 0,
    toolCalls: [],
    warningsIssued: 0,
    blocksTriggered: 0,
  };
}

function call(tool: string, fingerprint: string, at: number): ToolCall {
  return { tool, fingerprint, at };
}

function pushFingerprint(
  state: SessionState,
  tool: string,
  fingerprint: string,
  count: number,
  atStart = 1_700_000_000_000,
): void {
  for (let i = 0; i < count; i++) {
    state.toolCalls.push(call(tool, fingerprint, atStart + i));
  }
}

const FP = "fp:read:same";
const TOOL = "read";
const NOW = 1_700_000_001_000;

describe("decide() — canonical threshold table (spec §5.4)", () => {
  test("count < 3 (default warn-2) returns allow", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 2); // count = 2
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d).toEqual({ action: "allow" });
  });

  test("count = 3 (log-only band) returns warn with canonical warn message", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 3);
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(d.count).toBe(3);
      expect(d.fingerprint).toBe(FP);
      expect(d.reason).toBe(warnMessage(TOOL));
      expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(true);
    }
  });

  test("count = 4 (still log-only band) returns warn with log-only flag", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 4);
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(d.count).toBe(4);
      expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(true);
    }
  });

  test("count = 5 (inject-warn band) returns warn with inject flag", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 5);
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(d.count).toBe(5);
      expect(d.reason).toBe(warnMessage(TOOL));
      expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(false);
    }
  });

  test("count = 7 (still warn band) returns warn", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 7);
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(d.count).toBe(7);
    }
  });

  test("count = 8 (escalate band) returns escalate with canonical escalate message", () => {
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 8);
    const d = decide(state, FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("escalate");
    if (d.action === "escalate") {
      expect(d.count).toBe(8);
      expect(d.fingerprint).toBe(FP);
      expect(d.reason).toBe(escalateMessage(TOOL));
    }
  });

  test("count = 11 (still escalate band) returns escalate", () => {
    // Use a window wide enough that 11 entries can all fit; with the
    // default window of 10, the count is bounded by the window size.
    const opts: NormalizedOptions = { ...DEFAULT_OPTIONS, loopWindowSize: 15 };
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 11);
    const d = decide(state, FP, NOW, opts);
    expect(d.action).toBe("escalate");
    if (d.action === "escalate") {
      expect(d.count).toBe(11);
    }
  });

  test("count = 12 (block band) returns block with canonical block message", () => {
    // Use a window wide enough that 12 entries can all fit; with the
    // default window of 10, the count is bounded by the window size
    // and the block band becomes unreachable. This is a known spec
    // limitation (see README "Limitations" §13 #11).
    const opts: NormalizedOptions = { ...DEFAULT_OPTIONS, loopWindowSize: 15 };
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 12);
    const d = decide(state, FP, NOW, opts);
    expect(d.action).toBe("block");
    if (d.action === "block") {
      expect(d.count).toBe(12);
      expect(d.fingerprint).toBe(FP);
      expect(d.reason).toBe(blockMessage(TOOL));
      // Spec §12.1: the throw message contains the tool name and the
      // substring `loop` (case-insensitive) OR `escalate`.
      expect(d.reason).toContain(TOOL);
      expect(/loop/i.test(d.reason) || /escalate/i.test(d.reason)).toBe(true);
    }
  });

  test("count > 12 still returns block (no upper clamp)", () => {
    const opts: NormalizedOptions = { ...DEFAULT_OPTIONS, loopWindowSize: 25 };
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 20);
    const d = decide(state, FP, NOW, opts);
    expect(d.action).toBe("block");
  });
});

describe("decide() — window rolling (spec §5.5)", () => {
  test("window [bash X, bash X, read, bash X] with windowSize=4 reports 3 repetitions of X", () => {
    // Spec example. We construct a state whose toolCalls contain exactly
    // this window, with the LAST entry being the current call we are
    // deciding on.
    const state = emptyState();
    const fpX = "fp:bash:X";
    const fpRead = "fp:read:other";
    state.toolCalls.push(call("bash", fpX, 1));
    state.toolCalls.push(call("bash", fpX, 2));
    state.toolCalls.push(call("read", fpRead, 3));
    state.toolCalls.push(call("bash", fpX, 4));

    const d = decide(state, fpX, 5, {
      ...DEFAULT_OPTIONS,
      loopWindowSize: 4,
    });
    // The 4th entry in the window is the current call; the other 3
    // X-entries are previous calls. The count returned is the number
    // of entries in the last `loopWindowSize` calls that share the
    // fingerprint, which is 3 (the 3 bash X entries in the window).
    expect(d.action).not.toBe("allow");
    if (d.action !== "allow") {
      expect(d.count).toBe(3);
    }
  });

  test("out-of-window entries do not count", () => {
    const state = emptyState();
    const fpX = "fp:bash:X";
    // 10 older X calls that fall OUTSIDE the window of size 10.
    for (let i = 0; i < 10; i++) {
      state.toolCalls.push(call("bash", fpX, 1_000 + i));
    }
    // 10 non-matching calls inside the window.
    for (let i = 0; i < 10; i++) {
      state.toolCalls.push(call("read", `fp:read:${i}`, 2_000 + i));
    }
    const d = decide(state, fpX, 9_000, {
      ...DEFAULT_OPTIONS,
      loopWindowSize: 10,
    });
    // The last 10 entries are all `read` calls — fpX count is 0.
    expect(d.action).toBe("allow");
  });

  test("intermediate non-matching calls do NOT reset the count", () => {
    const state = emptyState();
    const fpX = "fp:bash:X";
    // [X, X, read, X, X] — count of X in the window of 5 is 4.
    state.toolCalls.push(call("bash", fpX, 1));
    state.toolCalls.push(call("bash", fpX, 2));
    state.toolCalls.push(call("read", "fp:read:1", 3));
    state.toolCalls.push(call("bash", fpX, 4));
    state.toolCalls.push(call("bash", fpX, 5));

    const d = decide(state, fpX, 6, {
      ...DEFAULT_OPTIONS,
      loopWindowSize: 5,
    });
    expect(d.action).not.toBe("allow");
    if (d.action !== "allow") {
      expect(d.count).toBe(4);
    }
  });
});

describe("decide() — edge cases", () => {
  test("empty state returns allow", () => {
    const d = decide(emptyState(), FP, NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("allow");
  });

  test("fingerprint not present in state returns allow", () => {
    const state = emptyState();
    pushFingerprint(state, "bash", "fp:bash:something", 5);
    const d = decide(state, "fp:read:different", NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("allow");
  });

  test("reason includes the tool name recovered from the window", () => {
    const state = emptyState();
    pushFingerprint(state, "edit", "fp:edit:foo", 5);
    const d = decide(state, "fp:edit:foo", NOW, DEFAULT_OPTIONS);
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(d.reason).toContain("edit");
    }
  });
});

describe("decide() — custom options", () => {
  test("user-configured warn=3 collapses the log-only band", () => {
    // With warn=3, the log-only threshold becomes max(1, 3-2)=1, so the
    // very first repetition already lands in the warn band (log-only
    // sub-band). This is expected behavior; the log-only band exists
    // to give a heads-up BEFORE the inject threshold, and a user who
    // lowers warn shrinks or eliminates that gap.
    const opts: NormalizedOptions = {
      ...DEFAULT_OPTIONS,
      loopThresholdWarn: 3,
      loopThresholdEscalate: 4,
      loopThresholdBlock: 5,
    };
    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 1);
    const d = decide(state, FP, NOW, opts);
    // count=1 is now >= logOnly (1), so the result is "warn" in the
    // log-only sub-band. The caller would log only (no injection)
    // because count (1) is still below the inject-warn threshold (3).
    expect(d.action).toBe("warn");
    if (d.action === "warn") {
      expect(isLogOnlyWarn(d, opts)).toBe(true);
    }

    pushFingerprint(state, TOOL, FP, 2); // total count = 3
    const d2 = decide(state, FP, NOW, opts);
    expect(d2.action).toBe("warn");
    if (d2.action === "warn") {
      // count=3 is now >= the inject-warn threshold (3), so it is
      // NOT a log-only warn.
      expect(isLogOnlyWarn(d2, opts)).toBe(false);
    }
  });

  test("custom window size limits how far back we scan", () => {
    const state = emptyState();
    const fpX = "fp:bash:X";
    for (let i = 0; i < 5; i++) state.toolCalls.push(call("bash", fpX, 1 + i));
    for (let i = 0; i < 5; i++) state.toolCalls.push(call("read", `fp:r:${i}`, 100 + i));
    // Now the last 5 entries are all read; the 5 bash X entries are
    // outside the window of size 5.
    const d = decide(state, fpX, 1_000, {
      ...DEFAULT_OPTIONS,
      loopWindowSize: 5,
    });
    expect(d.action).toBe("allow");
  });
});

describe("isLogOnlyWarn()", () => {
  test("returns false for allow decisions", () => {
    expect(isLogOnlyWarn({ action: "allow" }, DEFAULT_OPTIONS)).toBe(false);
  });

  test("returns false for escalate decisions", () => {
    const d: Decision = { action: "escalate", reason: "x", fingerprint: "f", count: 8 };
    expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(false);
  });

  test("returns false for block decisions", () => {
    const d: Decision = { action: "block", reason: "x", fingerprint: "f", count: 12 };
    expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(false);
  });

  test("returns true for warn with count below warn threshold", () => {
    const d: Decision = { action: "warn", reason: "x", fingerprint: "f", count: 3 };
    expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(true);
  });

  test("returns false for warn with count at or above warn threshold", () => {
    const d: Decision = { action: "warn", reason: "x", fingerprint: "f", count: 5 };
    expect(isLogOnlyWarn(d, DEFAULT_OPTIONS)).toBe(false);
  });
});

describe("canonical handoff templates (spec §11.2)", () => {
  test("warn template matches the canonical text", () => {
    expect(CANONICAL_TEMPLATES.warn).toBe(
      "[loop guard: 5 identical calls to %TOOL%]. Consider using the task tool to report back to your parent with what you've learned and what you need.",
    );
  });

  test("escalate template matches the canonical text", () => {
    expect(CANONICAL_TEMPLATES.escalate).toBe(
      "[loop guard: 8 identical calls to %TOOL%]. Consider using the task tool to report back to your parent with what you've learned and what you need.",
    );
  });

  test("block template matches the canonical text", () => {
    expect(CANONICAL_TEMPLATES.block).toBe(
      "Loop protection: 12 identical calls to %TOOL%. Use task to escalate.",
    );
  });
});

describe("normalizeOptions() integration with decide()", () => {
  test("clamped options feed into decide() correctly", () => {
    const { options } = normalizeOptions({
      loopThresholdWarn: -5,
      loopWindowSize: 100,
    });
    expect(options.loopThresholdWarn).toBe(1);
    expect(options.loopWindowSize).toBe(50);

    const state = emptyState();
    pushFingerprint(state, TOOL, FP, 1);
    // With warn=1, the warn band starts at count >= 1.
    const d = decide(state, FP, NOW, options);
    expect(d.action).toBe("warn");
  });
});
