/**
 * sandbox.ts — v6.3.0 CubeSandbox (E2B-compatible KVM microVM) tool.
 *
 * Adds two plugin tools:
 *   - bizar_sandbox_run   Run a script in a fresh CubeSandbox (or the
 *                         user's `base` template). Each call boots a new
 *                         microVM in <60ms with <5MB overhead, runs the
 *                         script, captures stdout/stderr/exit code, and
 *                         tears down. Hardware-isolated from the host.
 *   - bizar_sandbox_exec  Same, but reuses an existing sandbox id (avoids
 *                         cold start cost for chained calls).
 *
 * Why this exists:
 *   - The host shell is a shared resource that the loop-guard can't
 *     fully constrain; CubeSandbox gives us KVM-level isolation.
 *   - The dangerous-patterns hook can route risky `bash` calls here
 *     instead of asking the user to approve each one.
 *   - E2B SDK is Python, so we shell out to the existing
 *     `bizar sandbox run` CLI (which wraps the SDK).
 *
 * Requires:
 *   - `pip install cubesandbox`
 *   - CUBESANDBOX_API_KEY + CUBESANDBOX_URL set via `bizar sandbox config`
 *
 * Refs:
 *   - https://github.com/TencentCloud/CubeSandbox
 *   - ~/config/skills/cubesandbox/SKILL.md
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { execFile as cpExecFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import type { Logger } from "../logger.js";
import { checkDangerous } from "../dangerous-patterns.js";

const execFile = promisify(cpExecFile);

export const BIZAR_SANDBOX_RUN_TOOL_NAME = "bizar_sandbox_run";
export const BIZAR_SANDBOX_EXEC_TOOL_NAME = "bizar_sandbox_exec";

export interface SandboxDeps {
  /** Override the path to the `bizar` CLI (defaults to `bizar` on PATH). */
  bizarBin?: string;
  logger: Logger;
}

function resolveBizarBin(deps: SandboxDeps): string {
  return deps.bizarBin ?? process.env.BIZAR_BIN ?? "bizar";
}

// ─── tool: bizar_sandbox_run ──────────────────────────────────────────────
const sandboxRunSchema = z.object({
  language: z
    .enum(["bash", "python", "node"])
    .default("bash")
    .describe("The script language. Defaults to bash."),
  script: z
    .string()
    .min(1)
    .max(64_000)
    .describe("The script body. Multi-line scripts are fine."),
  template: z
    .string()
    .optional()
    .describe(
      "CubeSandbox template name. Defaults to env CUBESANDBOX_TEMPLATE or `base`.",
    ),
  proxy_credentials: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Map of credential name → value to inject at the egress proxy. Optional; keys never enter the sandbox.",
    ),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(600)
    .default(120)
    .describe("Sandbox boot + script execution timeout."),
});

export type SandboxRunInput = z.infer<typeof sandboxRunSchema>;
export type SandboxRunOutput = {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
  sandbox_id?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  duration_ms?: number;
  error?: string;
};

export function createSandboxRunTool(deps: SandboxDeps): AgentTool<
  SandboxRunInput,
  SandboxRunOutput
> {
  const bizarBin = resolveBizarBin(deps);
  return createTool({
    name: BIZAR_SANDBOX_RUN_TOOL_NAME,
    description:
      "Run a script in a fresh CubeSandbox (KVM-isolated microVM, E2B-compatible). Use for any `bash`/`python`/`node` call whose side effects should not escape the sandbox (file writes under ~/.config, package installs, network probes, third-party scripts, eval code). Boots in <60ms with <5MB overhead. Each call is one-shot. For chained commands, use `bizar_sandbox_exec` with the returned `sandbox_id`.",
    inputSchema: sandboxRunSchema.shape,
    execute: async (input) => {
      const t0 = Date.now();

      const verdict = checkDangerous({
        script: input.script,
        language: input.language,
      });
      if (verdict && verdict.decision === "deny") {
        return {
          ok: false,
          blocked: true,
          reason: verdict.reason,
        };
      }

      const args = ["sandbox", "run", input.language, input.script];
      if (input.template) args.push("--template", input.template);
      if (input.timeout_seconds)
        args.push("--timeout", String(input.timeout_seconds));
      if (input.proxy_credentials) {
        for (const [k, v] of Object.entries(input.proxy_credentials)) {
          args.push("--proxy-credential", `${k}=${v}`);
        }
      }

      try {
        const { stdout, stderr } = await execFile(bizarBin, args, {
          timeout: (input.timeout_seconds + 5) * 1000,
          maxBuffer: 16 * 1024 * 1024,
        });
        // `bizar sandbox run` returns JSON {"sandbox_id":..., "stdout":..., "stderr":..., "exit_code":...}
        let parsed: {
          sandbox_id?: string;
          stdout?: string;
          stderr?: string;
          exit_code?: number;
        } | null = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // raw text — fall through
        }
        if (parsed && typeof parsed.exit_code === "number") {
          return {
            ok: parsed.exit_code === 0,
            sandbox_id: parsed.sandbox_id,
            stdout: parsed.stdout ?? "",
            stderr: parsed.stderr ?? "",
            exit_code: parsed.exit_code,
            duration_ms: Date.now() - t0,
          };
        }
        return {
          ok: true,
          stdout,
          stderr,
          exit_code: 0,
          duration_ms: Date.now() - t0,
        };
      } catch (err) {
        const e = err as {
          stdout?: string;
          stderr?: string;
          code?: number;
        };
        return {
          ok: false,
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? String(err),
          exit_code: typeof e.code === "number" ? e.code : 1,
          duration_ms: Date.now() - t0,
        };
      }
    },
  });
}

// ─── tool: bizar_sandbox_exec ─────────────────────────────────────────────
const sandboxExecSchema = z.object({
  sandbox_id: z
    .string()
    .min(1)
    .describe("The CubeSandbox id returned by `bizar_sandbox_run`."),
  script: z.string().min(1).max(64_000).describe("Script body to run."),
});

export type SandboxExecInput = z.infer<typeof sandboxExecSchema>;
export type SandboxExecOutput = {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export function createSandboxExecTool(deps: SandboxDeps): AgentTool<
  SandboxExecInput,
  SandboxExecOutput
> {
  const bizarBin = resolveBizarBin(deps);
  return createTool({
    name: BIZAR_SANDBOX_EXEC_TOOL_NAME,
    description:
      "Run a script in an existing CubeSandbox (avoids cold-start cost for chained calls). Pass the `sandbox_id` returned by a previous `bizar_sandbox_run`. Same scripts, same isolation, no boot.",
    inputSchema: sandboxExecSchema.shape,
    execute: async (input) => {
      const verdict = checkDangerous({ script: input.script });
      if (verdict && verdict.decision === "deny") {
        return { ok: false, blocked: true, reason: verdict.reason };
      }

      try {
        const { stdout } = await execFile(
          bizarBin,
          ["sandbox", "exec", input.sandbox_id, input.script],
          { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
        );
        return { ok: true, stdout };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  });
}
