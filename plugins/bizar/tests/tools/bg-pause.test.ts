/**
 * bg-pause.test.ts — `bizar_pause` tool tests.
 */

import { describe, it, expect } from "bun:test";

import type { Logger } from "../../src/logger";
import { createBgPauseTool } from "../../src/tools/bg-pause";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  log() {},
};

/** Extract a JSON-decoded payload from `ToolResult = string | { output: string }`. */
function decode(result: unknown): any { const r = result as any; if (r && typeof r === "object" && "output" in r) { return typeof r.output === "string" ? JSON.parse(r.output) : r.output; } if (typeof result === "string") return JSON.parse(result); return result; }

describe("bg-pause tool", () => {
  it("rejects non-Odin callers", async () => {
    const mgr = {
      isBgOnly: false,
      pause: async () => ({ ok: true }),
    } as any;
    const tool = createBgPauseTool({
      instanceManager: mgr,
      logger: silentLogger,
    });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { metadata: { parentAgent: "frigg" } } as any);
    const payload = decode(r);
    expect(payload.error).toContain("Only Odin");
  });

  it("returns paused status on success", async () => {
    const mgr = {
      isBgOnly: false,
      pause: async () => ({ ok: true }),
    } as any;
    const tool = createBgPauseTool({
      instanceManager: mgr,
      logger: silentLogger,
    });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { metadata: { parentAgent: "odin" } } as any);
    expect(decode(r)).toEqual({ ok: true, instanceId: "bgr_x", status: "paused" });
  });

  it("propagates errors", async () => {
    const mgr = {
      isBgOnly: false,
      pause: async () => ({ ok: false, error: "no_subprocess" }),
    } as any;
    const tool = createBgPauseTool({
      instanceManager: mgr,
      logger: silentLogger,
    });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { metadata: { parentAgent: "odin" } } as any);
    expect(decode(r)).toMatchObject({ error: "no_subprocess" });
  });
});
