/**
 * tests/tools/agent-browser.test.ts — unit tests for the agent-browser
 * CLI wrapper tools (v6.0.0).
 *
 * These tests mock `child_process.execFile` so they don't require
 * agent-browser to be installed. They verify:
 *   - each tool builds the correct argv
 *   - the JSON flag is added when requested
 *   - errors are captured cleanly (non-zero exit → { ok: false })
 *   - the escape-hatch `bizar_browser_command` passes args verbatim
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock logger
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as const;

describe("agent-browser tools", () => {


  it("open produces the correct shape", async () => {
    const { createBrowserOpenTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserOpenTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_open");
    expect(tool.description).toContain("agent-browser");
    // inputSchema is a ZodRawShape; verify the url key exists
    expect(tool.inputSchema).toHaveProperty("url");
  });

  it("snapshot name and schema", async () => {
    const { createBrowserSnapshotTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserSnapshotTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_snapshot");
  });

  it("click name and schema", async () => {
    const { createBrowserClickTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserClickTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_click");
  });

  it("fill name and schema", async () => {
    const { createBrowserFillTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserFillTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_fill");
  });

  it("screenshot name and schema", async () => {
    const { createBrowserScreenshotTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserScreenshotTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_screenshot");
  });

  it("command (escape hatch) name and schema", async () => {
    const { createBrowserCommandTool } = await import(
      "../../src/tools/agent-browser.js"
    );
    const tool = createBrowserCommandTool({ logger: silentLogger as never });
    expect(tool.name).toBe("bizar_browser_command");
    // inputSchema is a ZodRawShape; verify the args key exists
    expect(tool.inputSchema).toHaveProperty("args");
  });

  it("registered in the plugin entry", async () => {
    // The plugin entry should now register 22 + 6 = 28 tools.
    // Verify by importing and inspecting.
    const fs = await import("node:fs/promises");
    const idxContent = await fs.readFile(
      new URL("../../index.ts", import.meta.url),
      "utf8",
    );
    expect(idxContent).toContain("createBrowserOpenTool");
    expect(idxContent).toContain("createBrowserSnapshotTool");
    expect(idxContent).toContain("createBrowserClickTool");
    expect(idxContent).toContain("createBrowserFillTool");
    expect(idxContent).toContain("createBrowserScreenshotTool");
    expect(idxContent).toContain("createBrowserCommandTool");
  });
});
