/**
 * bg-send-message.test.ts — `bizar_send_message` tool tests.
 *
 * v5.5.1: the tool now performs TRUE mid-flight steer via the dashboard
 * SDK. Tests mock the dashboard POST so we don't need a real server.
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

function decode(result: unknown): any { const r = result as any; if (r && typeof r === "object" && "output" in r) { return typeof r.output === "string" ? JSON.parse(r.output) : r.output; } if (typeof result === "string") return JSON.parse(result); return result; }

describe("bg-send-message tool", () => {
  it("returns instance_not_found for missing", async () => {
    const mgr = { get: async () => null } as any;
    const tool = createBgSendMessageTool({ instanceManager: mgr, logger: silentLogger });
    const r = await tool.execute(
      { instanceId: "bgr_missing", message: "hi" } as any,
      { metadata: { parentAgent: "odin" } } as any,
    );
    expect(decode(r)).toMatchObject({ error: "instance_not_found" });
  });

  it("delegates to dashboard POST /api/background/:id/steer (mid-flight)", async () => {
    const mgr = {
      get: async () => ({ instanceId: "bgr_x", status: "running", sessionId: "ses_x" }),
    } as any;
    let capturedUrl = "";
    let capturedBody = "";
    const mockPost = async (
      url: string,
      init: { headers: Record<string, string>; body: string },
    ) => {
      capturedUrl = url;
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          mode: "true_midflight",
          instanceId: "bgr_x",
          steerCount: 1,
        }),
      };
    };
    const tool = createBgSendMessageTool({
      instanceManager: mgr,
      logger: silentLogger,
      _dashboardPost: mockPost,
    } as any);
    const r = await tool.execute(
      { instanceId: "bgr_x", message: "go faster" } as any,
      { metadata: { parentAgent: "odin" } } as any,
    );
    // Verify the dashboard was hit with the right URL + body.
    expect(capturedUrl).toContain("/api/background/bgr_x/steer");
    expect(JSON.parse(capturedBody).message).toBe("go faster");
    const out = decode(r);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("true_midflight");
    expect(out.instanceId).toBe("bgr_x");
    expect(out.steerCount).toBe(1);
  });

  it("propagates dashboard errors", async () => {
    const mgr = {
      get: async () => ({ instanceId: "bgr_y", status: "running" }),
    } as any;
    const mockPost = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: "dashboard_down" }),
    });
    const tool = createBgSendMessageTool({
      instanceManager: mgr,
      logger: silentLogger,
      _dashboardPost: mockPost,
    } as any);
    const r = await tool.execute(
      { instanceId: "bgr_y", message: "halt" } as any,
      { metadata: { parentAgent: "odin" } } as any,
    );
    const out = decode(r);
    expect(out.error).toContain("dashboard_down");
  });

  it("propagates network errors", async () => {
    const mgr = {
      get: async () => ({ instanceId: "bgr_z", status: "running" }),
    } as any;
    const mockPost = async () => {
      throw new Error("ECONNREFUSED");
    };
    const tool = createBgSendMessageTool({
      instanceManager: mgr,
      logger: silentLogger,
      _dashboardPost: mockPost,
    } as any);
    const r = await tool.execute(
      { instanceId: "bgr_z", message: "halt" } as any,
      { metadata: { parentAgent: "odin" } } as any,
    );
    const out = decode(r);
    expect(out.error).toContain("ECONNREFUSED");
  });
});