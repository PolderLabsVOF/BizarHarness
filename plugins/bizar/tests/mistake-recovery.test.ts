/**
 * tests/mistake-recovery.test.ts
 *
 * v6.0.1 — Unit tests for `mistake-recovery.ts`.
 *
 * Verifies the recovery callback distinguishes recoverable mistakes
 * (`invalid_tool_call`, `tool_execution_failed`) from infra failures
 * (`api_error`). The harness relies on this contract to keep sessions
 * alive after a single bad model turn.
 */

import { describe, expect, test } from "bun:test";
import {
  buildMistakeRecovery,
  BUILTIN_RECOVERY_GUIDANCE,
  BUILTIN_STOP_REASON,
} from "../src/mistake-recovery";
import type {
  ConsecutiveMistakeLimitContext,
  ConsecutiveMistakeLimitDecision,
} from "@cline/shared";

function ctx(reason: ConsecutiveMistakeLimitContext["reason"], details = "boom"): ConsecutiveMistakeLimitContext {
  return {
    iteration: 7,
    consecutiveMistakes: 3,
    maxConsecutiveMistakes: 6,
    reason,
    details,
  };
}

describe("buildMistakeRecovery", () => {
  test("returns continue-with-guidance for invalid_tool_call", async () => {
    const cb = buildMistakeRecovery();
    const decision = await cb(ctx("invalid_tool_call"));
    expect(decision.action).toBe("continue");
    if (decision.action === "continue") {
      expect(decision.guidance).toBe(BUILTIN_RECOVERY_GUIDANCE);
      expect(decision.guidance).toContain("`new_text`");
      expect(decision.guidance).toContain("`options`");
      expect(decision.guidance).toContain("`commands`");
    }
  });

  test("returns continue-with-guidance for tool_execution_failed", async () => {
    const cb = buildMistakeRecovery();
    const decision = await cb(ctx("tool_execution_failed"));
    expect(decision.action).toBe("continue");
  });

  test("returns stop for api_error", async () => {
    const cb = buildMistakeRecovery();
    const decision = await cb(ctx("api_error"));
    expect(decision.action).toBe("stop");
    if (decision.action === "stop") {
      expect(decision.reason).toBe(BUILTIN_STOP_REASON);
    }
  });

  test("calls onRecovery observer for recoverable mistakes only", async () => {
    let calls = 0;
    const reasons: Array<ConsecutiveMistakeLimitContext["reason"]> = [];
    const cb = buildMistakeRecovery({
      onRecovery: (c) => {
        calls += 1;
        reasons.push(c.reason);
      },
    });
    await cb(ctx("invalid_tool_call"));
    expect(calls).toBe(1);
    expect(reasons).toContain("invalid_tool_call");
    await cb(ctx("api_error"));
    expect(calls).toBe(1); // unchanged — api_error does not invoke observer
    await cb(ctx("tool_execution_failed"));
    expect(calls).toBe(2);
    expect(reasons[reasons.length - 1]).toBe("tool_execution_failed");
  });

  test("uses custom guidance text when provided", async () => {
    const custom = "stay calm and re-check the schema";
    const cb = buildMistakeRecovery({ guidance: custom });
    const decision = await cb(ctx("invalid_tool_call"));
    expect(decision.action).toBe("continue");
    if (decision.action === "continue") {
      expect(decision.guidance).toBe(custom);
    }
  });

  test("is safe to reuse across many invocations", async () => {
    const cb = buildMistakeRecovery();
    const decisions: ConsecutiveMistakeLimitDecision[] = [];
    for (let i = 0; i < 50; i += 1) {
      decisions.push(await cb(ctx(i % 2 === 0 ? "invalid_tool_call" : "tool_execution_failed")));
    }
    expect(decisions.every((d) => d.action === "continue")).toBe(true);
  });
});

describe("recovery guidance body", () => {
  test("mentions every tool name that has tripped the schema in production", () => {
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("editor");
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("ask_question");
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("run_commands");
  });

  test("explicitly suggests applyPatch / delete_file as an alternative to empty editor.new_text", () => {
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("applyPatch");
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("delete_file");
  });

  test("tells the model to stop retrying after two identical mistakes", () => {
    expect(BUILTIN_RECOVERY_GUIDANCE).toMatch(/two mistakes|two failures/i);
    expect(BUILTIN_RECOVERY_GUIDANCE).toContain("switch tools");
  });
});
