/**
 * tests/tool-discipline.test.ts
 *
 * v6.0.1 — Unit tests for `tool-discipline.ts`.
 *
 * Verifies the directive body covers the right ground (tool schema,
 * built-in preference, bash-size caps) and the marker helper is
 * idempotent. The harness's `beforeModel` hook uses these to decide
 * whether to inject the directive on a given system prompt.
 */

import { describe, expect, test } from "bun:test";
import {
  TOOL_DISCIPLINE_DIRECTIVE,
  TOOL_DISCIPLINE_MARKER,
  TOOL_DISCIPLINE_VERSION,
  hasToolDiscipline,
} from "../src/tool-discipline";

describe("TOOL_DISCIPLINE_DIRECTIVE", () => {
  test("contains the version marker", () => {
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain(TOOL_DISCIPLINE_MARKER);
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain(`v${TOOL_DISCIPLINE_VERSION}`);
  });

  test("has two distinct sections: tool-call discipline + preference", () => {
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("Tool-call discipline");
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("Prefer built-in tools over bash");
  });

  test("explicitly handles each failing tool name with concrete guidance", () => {
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("editor.new_text");
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("ask_question.options");
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("run_commands.commands");
  });

  test("mapping table covers read / search / edit / list / fetch / build", () => {
    const expectedMapping: Array<[string, string]> = [
      ["read a file", "read_file"],
      ["search a workspace", "search"],
      ["edit a file", "editor"],
      ["create a new file", "editor"],
      ["list a directory", "list_files"],
      ["fetch a URL", "web_fetch"],
      ["run a build", "run_commands"],
    ];
    for (const [intent, builtin] of expectedMapping) {
      expect(TOOL_DISCIPLINE_DIRECTIVE).toContain(intent);
      expect(TOOL_DISCIPLINE_DIRECTIVE).toContain(builtin);
    }
  });

  test("imposes a soft cap on bash commands (~600 chars)", () => {
    expect(TOOL_DISCIPLINE_DIRECTIVE).toMatch(/600\s*chars?/i);
  });

  test("forbids shell-quoting-bait patterns", () => {
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("`for i in $(seq 1 100)`");
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("`xargs`");
    expect(TOOL_DISCIPLINE_DIRECTIVE).toContain("`sed -i`");
  });
});

describe("hasToolDiscipline", () => {
  test("returns true when system prompt contains the marker", () => {
    expect(hasToolDiscipline(`prefix\n${TOOL_DISCIPLINE_MARKER}\nsuffix`)).toBe(true);
  });

  test("returns false on empty prompt", () => {
    expect(hasToolDiscipline(undefined)).toBe(false);
    expect(hasToolDiscipline("")).toBe(false);
  });

  test("returns false when only a previous version marker is present", () => {
    expect(hasToolDiscipline("loaded from cache: BIZAR_TOOL_DISCIPLINE_v0.6.0 old")).toBe(false);
  });
});
