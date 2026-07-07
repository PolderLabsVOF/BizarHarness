/**
 * bg-report-progress.test.ts — `bizar_report_progress` tool tests.
 */

import { describe, it, expect } from "bun:test";
import type { Logger } from "../../src/logger";
import { createBgReportProgressTool } from "../../src/tools/bg-report-progress";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  log() {},
};

function decode(result: unknown): any { const r = result as any; if (r && typeof r === "object" && "output" in r) { return typeof r.output === "string" ? JSON.parse(r.output) : r.output; } if (typeof result === "string") return JSON.parse(result); return result; }

describe("bg-report-progress tool", () => {
  it("computes progress percent", async () => {
    const mgr = {
      updateProgress: async (_id: string, step: number, total: number) => ({
        ok: true,
        progress: Math.round((step / total) * 100),
      }),
    } as any;
    const tool = createBgReportProgressTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_x", step: 3, total: 10, message: "step 3 of 10" } as any,
      { metadata: { parentAgent: "mimir" } } as any,
    );
    expect(decode(r)).toEqual({ ok: true, instanceId: "bgr_x", progress: 30 });
  });

  it("caps at 100", async () => {
    const mgr = {
      updateProgress: async (_id: string, _step: number, total: number) => {
        const step = 200;
        const pct = Math.max(0, Math.min(100, Math.round((step / total) * 100)));
        return { ok: true, progress: pct };
      },
    } as any;
    const tool = createBgReportProgressTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_x", step: 200, total: 100 } as any,
      { metadata: { parentAgent: "mimir" } } as any,
    );
    expect(decode(r)).toMatchObject({ progress: 100 });
  });

  it("returns -1 for indeterminate", async () => {
    let captured = 999;
    const mgr = {
      updateProgress: async (_id: string, _step: number, _total: number, _m: unknown, indet: boolean) => {
        captured = indet ? -1 : 50;
        return { ok: true, progress: captured };
      },
    } as any;
    const tool = createBgReportProgressTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_x", step: 1, total: 10, indeterminate: true } as any,
      { metadata: { parentAgent: "mimir" } } as any,
    );
    expect(decode(r)).toMatchObject({ progress: -1 });
    expect(captured).toBe(-1);
  });

  it("propagates errors", async () => {
    const mgr = {
      updateProgress: async () => ({ ok: false, error: "instance_not_found" }),
    } as any;
    const tool = createBgReportProgressTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_x", step: 1, total: 10 } as any,
      { metadata: { parentAgent: "mimir" } } as any,
    );
    expect(decode(r)).toMatchObject({ error: "instance_not_found" });
  });
});
