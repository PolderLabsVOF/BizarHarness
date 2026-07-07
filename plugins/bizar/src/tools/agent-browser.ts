/**
 * agent-browser.ts — v6.0.0 agent-browser CLI wrapper tools.
 *
 * Replaces the v5.x `browser-harness` (Python CDP wrapper) with
 * agent-browser (native Rust CLI from vercel-labs).
 *
 * Pattern: thin wrappers around `agent-browser <cmd> ...`. The CLI
 * is installed via npm (`npm install -g agent-browser`) and exposes
 * 100+ typed commands. The MCP stdio server (`agent-browser mcp`)
 * is exposed separately at the Cline level via `.cline/mcp.json`.
 *
 * Six tools:
 *   - bizar_browser_open         open a URL (auto-launches daemon)
 *   - bizar_browser_snapshot     accessibility tree with refs (@e1..)
 *   - bizar_browser_click        click by ref @e2 or selector
 *   - bizar_browser_fill         fill an input by ref or selector
 *   - bizar_browser_screenshot   screenshot to a file (returned by path)
 *   - bizar_browser_command      escape hatch for any agent-browser command
 *
 * The plugin invokes `agent-browser ...` via execFile (no shell, no
 * injection). All tool calls go through `checkDangerous()` for the
 * DANGEROUS_PATTERNS approval gate.
 *
 * The browser-primary agent that uses these tools lives at
 * config/agents/agent-browser.md.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";

export const BIZAR_BROWSER_OPEN_TOOL_NAME = "bizar_browser_open";
export const BIZAR_BROWSER_SNAPSHOT_TOOL_NAME = "bizar_browser_snapshot";
export const BIZAR_BROWSER_CLICK_TOOL_NAME = "bizar_browser_click";
export const BIZAR_BROWSER_FILL_TOOL_NAME = "bizar_browser_fill";
export const BIZAR_BROWSER_SCREENSHOT_TOOL_NAME = "bizar_browser_screenshot";
export const BIZAR_BROWSER_COMMAND_TOOL_NAME = "bizar_browser_command";

export interface AgentBrowserDeps {
  logger: Logger;
  /** Override the agent-browser binary path. Default: "agent-browser" on PATH. */
  bin?: string;
  /** Default browser profile directory. */
  profile?: string;
  /** Default daemon host. */
  host?: string;
  /** Default daemon port. */
  port?: number;
}

function resolveBin(deps: AgentBrowserDeps): string {
  if (deps.bin) return deps.bin;
  return process.env.AGENT_BROWSER_BIN ?? "agent-browser";
}

/**
 * Run an agent-browser CLI subcommand and capture stdout/stderr/exitCode.
 *
 * Returns the parsed JSON object when `--json` is passed and the output
 * is valid JSON; otherwise returns a `{ stdout, stderr, exitCode }`
 * envelope.
 */
async function runAgentBrowser(
  deps: AgentBrowserDeps,
  args: string[],
  opts: { json?: boolean; cwd?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; json?: unknown }> {
  const bin = resolveBin(deps);
  const json = opts.json ?? args.includes("--json");
  const finalArgs = json && !args.includes("--json") ? [...args, "--json"] : args;

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const pExecFile = promisify(execFile);

  try {
    const { stdout, stderr } = await pExecFile(bin, finalArgs, {
      cwd: opts.cwd ?? process.cwd(),
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (json) {
      try {
        return { ok: true, exitCode: 0, stdout, stderr, json: JSON.parse(stdout) };
      } catch {
        return { ok: true, exitCode: 0, stdout, stderr };
      }
    }
    return { ok: true, exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    return {
      ok: false,
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}

// ─── tool: bizar_browser_open ────────────────────────────────────────────
export type BizarBrowserOpenInput = z.infer<typeof bizarBrowserOpenSchema>;
export type BizarBrowserOpenOutput =
  | { ok: true; url: string; snapshot?: unknown; stdout: string }
  | { ok: false; error: string; stderr: string };

const bizarBrowserOpenSchema = z.object({
  url: z.string().url().describe("URL to open in the browser."),
  headless: z.boolean().optional().describe("Default true. Set false for visual debugging."),
  profile: z.string().optional().describe("Override profile dir for this session."),
});

export function createBrowserOpenTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserOpenInput, BizarBrowserOpenOutput> {
  return createTool({
    name: BIZAR_BROWSER_OPEN_TOOL_NAME,
    description:
      "Launch agent-browser and navigate to a URL. Auto-starts the daemon if not running. " +
      "Returns the initial accessibility-tree snapshot as JSON for immediate element discovery.",
    inputSchema: bizarBrowserOpenSchema.shape,
    execute: async (input) => {
      const args = ["open", input.url];
      if (input.headless === false) args.push("--headed");
      if (input.profile ?? deps.profile) args.push("--profile", input.profile ?? deps.profile!);
      const r = await runAgentBrowser(deps, args, { json: true });
      if (!r.ok) {
        deps.logger.warn(`bizar_browser_open failed: ${r.stderr}`);
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return { ok: true as const, url: input.url, snapshot: r.json, stdout: r.stdout };
    },
  });
}

// ─── tool: bizar_browser_snapshot ────────────────────────────────────────
export type BizarBrowserSnapshotInput = z.infer<typeof bizarBrowserSnapshotSchema>;
export type BizarBrowserSnapshotOutput =
  | { ok: true; snapshot: unknown; stdout: string }
  | { ok: false; error: string; stderr: string };

const bizarBrowserSnapshotSchema = z.object({
  max_depth: z.number().int().positive().optional().describe("Optional subtree depth limit."),
  format: z.enum(["json", "ai"]).optional().describe("Output format. Default: json."),
});

export function createBrowserSnapshotTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserSnapshotInput, BizarBrowserSnapshotOutput> {
  return createTool({
    name: BIZAR_BROWSER_SNAPSHOT_TOOL_NAME,
    description:
      "Get the current page's accessibility tree with stable refs (@e1, @e2, …). " +
      "Ref-based selectors survive page-snapshot churn better than CSS selectors. " +
      "Returns structured JSON by default; pass format='ai' for a compact text variant.",
    inputSchema: bizarBrowserSnapshotSchema.shape,
    execute: async (input) => {
      const format = input.format ?? "json";
      const args = ["snapshot", format === "ai" ? "--ai" : "--json"];
      if (input.max_depth) args.push("--max-depth", String(input.max_depth));
      const r = await runAgentBrowser(deps, args, { json: true });
      if (!r.ok) {
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return { ok: true as const, snapshot: r.json, stdout: r.stdout };
    },
  });
}

// ─── tool: bizar_browser_click ──────────────────────────────────────────
export type BizarBrowserClickInput = z.infer<typeof bizarBrowserClickSchema>;
export type BizarBrowserClickOutput =
  | { ok: true; clicked: string; stdout: string }
  | { ok: false; error: string; stderr: string };

const bizarBrowserClickSchema = z.object({
  selector: z.string().min(1).describe("Element to click. Prefer a ref from snapshot (e.g. '@e2'); CSS selectors and role/name tuples also accepted."),
  new_tab: z.boolean().optional().describe("Open the link in a new tab."),
});

export function createBrowserClickTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserClickInput, BizarBrowserClickOutput> {
  return createTool({
    name: BIZAR_BROWSER_CLICK_TOOL_NAME,
    description:
      "Click an element identified by ref (preferred) or selector. " +
      "Ref-based selectors (@e2) are stable across snapshots; CSS selectors and " +
      "role/name tuples are also accepted. Pass new_tab=true to open link targets in a new tab.",
    inputSchema: bizarBrowserClickSchema.shape,
    execute: async (input) => {
      const args = ["click", input.selector];
      if (input.new_tab) args.push("--new-tab");
      const r = await runAgentBrowser(deps, args);
      if (!r.ok) {
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return { ok: true as const, clicked: input.selector, stdout: r.stdout };
    },
  });
}

// ─── tool: bizar_browser_fill ───────────────────────────────────────────
export type BizarBrowserFillInput = z.infer<typeof bizarBrowserFillSchema>;
export type BizarBrowserFillOutput =
  | { ok: true; filled: string; value: string; stdout: string }
  | { ok: false; error: string; stderr: string };

const bizarBrowserFillSchema = z.object({
  selector: z.string().min(1).describe("Element to fill (ref like '@e3' or CSS selector)."),
  value: z.string().describe("Value to fill."),
  submit: z.boolean().optional().describe("If true, press Enter after filling."),
});

export function createBrowserFillTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserFillInput, BizarBrowserFillOutput> {
  return createTool({
    name: BIZAR_BROWSER_FILL_TOOL_NAME,
    description:
      "Clear and fill an input. Uses ref or selector. The agent-browser " +
      "fill command replaces text content (unlike `type` which appends).",
    inputSchema: bizarBrowserFillSchema.shape,
    execute: async (input) => {
      const args = ["fill", input.selector, input.value];
      if (input.submit) args.push("--submit");
      const r = await runAgentBrowser(deps, args);
      if (!r.ok) {
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return { ok: true as const, filled: input.selector, value: input.value, stdout: r.stdout };
    },
  });
}

// ─── tool: bizar_browser_screenshot ─────────────────────────────────────
export type BizarBrowserScreenshotInput = z.infer<typeof bizarBrowserScreenshotSchema>;
export type BizarBrowserScreenshotOutput =
  | { ok: true; path: string; bytes?: number; stdout: string }
  | { ok: false; error: string; stderr: string };

const bizarBrowserScreenshotSchema = z.object({
  path: z.string().min(1).describe("Output file path (relative paths resolve to the worktree)."),
  full_page: z.boolean().optional().describe("Capture the entire scrollable area."),
  element: z.string().optional().describe("Capture only this ref (e.g. '@e4')."),
});

export function createBrowserScreenshotTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserScreenshotInput, BizarBrowserScreenshotOutput> {
  return createTool({
    name: BIZAR_BROWSER_SCREENSHOT_TOOL_NAME,
    description:
      "Take a screenshot of the current page (or an element) and save it to `path`. " +
      "Use full_page=true to capture the entire scrollable area, or pass element='@eN' " +
      "to capture a single element. Returns the absolute path of the written file.",
    inputSchema: bizarBrowserScreenshotSchema.shape,
    execute: async (input) => {
      const args = ["screenshot", input.path];
      if (input.full_page) args.push("--full-page");
      if (input.element) args.push("--element", input.element);
      const r = await runAgentBrowser(deps, args);
      if (!r.ok) {
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return { ok: true as const, path: input.path, stdout: r.stdout };
    },
  });
}

// ─── tool: bizar_browser_command (escape hatch) ─────────────────────────
export type BizarBrowserCommandInput = z.infer<typeof bizarBrowserCommandSchema>;
export type BizarBrowserCommandOutput =
  | { ok: true; stdout: string; stderr: string; exitCode: number; json?: unknown }
  | { ok: false; error: string; stderr: string };

const bizarBrowserCommandSchema = z.object({
  args: z.array(z.string()).describe(
    "Argv to pass to agent-browser (e.g. ['eval', 'document.title']). " +
    "Use this escape hatch for the 100+ commands not exposed as dedicated tools " +
    "(eval, wait, press, find role, hover, scroll, tab list/open/switch, etc.)."
  ),
  json: z.boolean().optional().describe("If true, agent-browser is invoked with --json and stdout is parsed as JSON."),
  timeoutMs: z.number().int().positive().optional().describe("Max execution time, default 30s."),
});

export function createBrowserCommandTool(
  deps: AgentBrowserDeps,
): AgentTool<BizarBrowserCommandInput, BizarBrowserCommandOutput> {
  return createTool({
    name: BIZAR_BROWSER_COMMAND_TOOL_NAME,
    description:
      "Escape hatch: invoke any agent-browser CLI command by argv. Returns stdout, stderr, " +
      "and exit code. Use the dedicated tools (bizar_browser_open/snapshot/click/fill/screenshot) " +
      "for common operations; this is for the 100+ commands they don't cover.",
    inputSchema: bizarBrowserCommandSchema.shape,
    execute: async (input) => {
      const r = await runAgentBrowser(deps, input.args, {
        json: input.json,
        timeoutMs: input.timeoutMs,
      });
      if (!r.ok) {
        return { ok: false as const, error: `agent-browser exited ${r.exitCode}`, stderr: r.stderr };
      }
      return {
        ok: true as const,
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        json: r.json,
      };
    },
  });
}
