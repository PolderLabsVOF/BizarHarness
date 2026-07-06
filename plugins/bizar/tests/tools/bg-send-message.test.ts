/**
 * bg-send-message.test.ts — `bizar_send_message` tool tests.
 */

import { describe, it, expect } from "bun:test";
import type { Logger } from "../../src/logger";
import { createBgSendMessageTool } from "../../src/tools/bg-send-message";

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

describe("bg-send-message tool", () => {
  it("returns unavailable_in_subprocess_mode for valid instance", async () => {
    const mgr = {
      get: async () => ({ instanceId: "bgr_x", status: "running" }),
    } as any;
    const tool = createBgSendMessageTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_x", message: "go faster" } as any,
      { agent: "odin" } as any,
    );
    const out = decode(r);
    expect(out.error).toBe("unavailable_in_subprocess_mode");
    expect(out.dashboardHint).toBe("POST /api/background/bgr_x/steer");
  });

  it("returns instance_not_found for missing", async () => {
    const mgr = { get: async () => null } as any;
    const tool = createBgSendMessageTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_missing", message: "hi" } as any,
      { agent: "odin" } as any,
    );
    expect(decode(r)).toMatchObject({ error: "instance_not_found" });
  });
});
