/**
 * bg-resume.test.ts — `bizar_resume` tool tests.
 */

import { describe, it, expect } from "bun:test";
import type { Logger } from "../../src/logger";
import { createBgResumeTool } from "../../src/tools/bg-resume";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  log() {},
};

function decode(result: unknown): any {
  if (typeof result === "string") return JSON.parse(result);
  return JSON.parse((result as { output: string }).output);
}

describe("bg-resume tool", () => {
  it("rejects non-Odin callers", async () => {
    const mgr = { resume: async () => ({ ok: true }) } as any;
    const tool = createBgResumeTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { agent: "frigg" } as any);
    expect(decode(r).error).toContain("Only Odin");
  });

  it("returns running status on success", async () => {
    const mgr = { resume: async () => ({ ok: true }) } as any;
    const tool = createBgResumeTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { agent: "odin" } as any);
    expect(decode(r)).toEqual({ instanceId: "bgr_x", status: "running" });
  });

  it("propagates errors", async () => {
    const mgr = { resume: async () => ({ ok: false, error: "unsupported_on_win32" }) } as any;
    const tool = createBgResumeTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute({ instanceId: "bgr_x" } as any, { agent: "odin" } as any);
    expect(decode(r)).toMatchObject({ error: "unsupported_on_win32" });
  });
});
