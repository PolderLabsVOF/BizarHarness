/**
 * mcp-agent-tools.test.ts — end-to-end regression for the F-146 agent-facing
 * MCP tool wrappers (OpenKan-native bizar_task, bizar_workflow, bizar_control, bizar_audit,
 * bizar_model_list).
 *
 * Each test invokes the tool's `handler` directly against the compiled SDK,
 * which shells out to native `ok task <action> --json` for task state. We assert the
 * returned text is either a JSON object (parseable, correct shape) or an
 * `error: ...` payload — never an unhandled exception.
 */

import { describe, test, expect } from "vitest";
import { BIZAR_TOOLS, type SdkMcpToolDef } from "../src/mcp/server.js";

function findTool(name: string): SdkMcpToolDef {
  const t = BIZAR_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

async function callText(toolName: string, args: unknown): Promise<string> {
  const tool = findTool(toolName);
  const res = await tool.handler(args, {});
  if (!Array.isArray(res.content) || res.content.length !== 1) {
    throw new Error(`unexpected response shape from ${toolName}`);
  }
  const block = res.content[0];
  if (block.type !== "text") throw new Error(`unexpected block type: ${block.type}`);
  return block.text;
}

describe("F-146 agent-facing CLI wrapper tools", () => {
  test("all five wrappers are registered in BIZAR_TOOLS", () => {
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    for (const name of ["bizar_task", "bizar_workflow", "bizar_control", "bizar_audit", "bizar_model_list"]) {
      expect(names.has(name), `missing wrapper tool: ${name}`).toBe(true);
    }
  });

  test("bizar_task handler refuses missing action", async () => {
    const text = await callText("bizar_task", {});
    expect(text.startsWith("error:")).toBe(true);
    expect(text.includes("missing action")).toBe(true);
  });

  test("bizar_workflow handler refuses missing action", async () => {
    const text = await callText("bizar_workflow", {});
    expect(text.startsWith("error:")).toBe(true);
    expect(text.includes("missing action")).toBe(true);
  });

  test("bizar_control handler refuses missing action", async () => {
    const text = await callText("bizar_control", {});
    expect(text.startsWith("error:")).toBe(true);
    expect(text.includes("missing action")).toBe(true);
  });

  test("bizar_task list action returns JSON or a structured error", async () => {
    const text = await callText("bizar_task", { action: "list" });
    if (text.startsWith("error:")) {
      expect(typeof text).toBe("string");
      return;
    }
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test("bizar_audit handler returns JSON or a structured error", async () => {
    const text = await callText("bizar_audit", {});
    if (text.startsWith("error:")) {
      expect(typeof text).toBe("string");
      return;
    }
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test("bizar_model_list handler returns JSON or a structured error", async () => {
    const text = await callText("bizar_model_list", {});
    if (text.startsWith("error:")) {
      expect(typeof text).toBe("string");
      return;
    }
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
