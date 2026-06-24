/**
 * plugins/bizar/tests/tools/opencode-runner.test.ts
 *
 * Unit tests for `buildOpencodeRunArgs` — the pure helper extracted
 * from `plugins/bizar/src/opencode-runner.ts` so the argv passed to
 * `Bun.spawn(["opencode", "run", ...])` can be asserted without
 * spawning a real process.
 *
 * These tests pin the two regressions that motivated the extraction:
 *
 *   1. Bug 1 (HIGH): the `--agent` flag was missing from the args list,
 *      so `opencode run` silently fell back to the opencode default
 *      agent and broke session attribution.
 *
 *   2. Bug 2 (HIGH): the OpenRouter model IDs were renamed. Tests assert
 *      the new `minimax/minimax-m3` / `minimax/minimax-m2.7` format so
 *      a stale `openrouter/minimax-m3` reference is caught immediately.
 */

import { describe, it, expect } from "bun:test";
import {
  buildOpencodeRunArgs,
  type SpawnAgentOptions,
} from "../../src/opencode-runner";

function baseOpts(overrides: Partial<SpawnAgentOptions> = {}): SpawnAgentOptions {
  return {
    agent: "thor",
    prompt: "Investigate the auth module",
    worktree: "/tmp/worktree",
    logPath: "/tmp/worktree/.bgr/log.log",
    ...overrides,
  };
}

describe("buildOpencodeRunArgs — Bug 1 regression: --agent flag", () => {
  it("argv contains the --agent flag followed by the agent name", () => {
    const args = buildOpencodeRunArgs(baseOpts({ agent: "thor" }));
    const i = args.indexOf("--agent");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("thor");
  });

  it("--agent value matches opts.agent exactly (no default fallback)", () => {
    for (const agent of ["mimir", "thor", "tyr", "heimdall", "hermod"]) {
      const args = buildOpencodeRunArgs(baseOpts({ agent }));
      expect(args[args.indexOf("--agent") + 1]).toBe(agent);
    }
  });

  it("throws a clear error when opts.agent is empty", () => {
    expect(() => buildOpencodeRunArgs(baseOpts({ agent: "" }))).toThrow(
      /agent is required/,
    );
  });
});

describe("buildOpencodeRunArgs — Bug 2 regression: migrated model ID", () => {
  it("emits --model with the migrated 'minimax/minimax-m3' ID", () => {
    const args = buildOpencodeRunArgs(
      baseOpts({
        model: { providerID: "minimax", modelID: "minimax-m3" },
      }),
    );
    const i = args.indexOf("--model");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("minimax/minimax-m3");
    // The full flag pair proves the migration target — the OLD ID would
    // be 'openrouter/minimax-m3'; the NEW ID is 'minimax/minimax-m3'.
    expect(args[i + 1]).not.toBe("openrouter/minimax-m3");
  });

  it("emits --model with the migrated 'minimax/minimax-m2.7' ID", () => {
    const args = buildOpencodeRunArgs(
      baseOpts({
        model: { providerID: "minimax", modelID: "minimax-m2.7" },
      }),
    );
    expect(args[args.indexOf("--model") + 1]).toBe("minimax/minimax-m2.7");
  });

  it("omits --model entirely when opts.model is not provided", () => {
    const args = buildOpencodeRunArgs(baseOpts({ model: undefined }));
    expect(args).not.toContain("--model");
  });
});

describe("buildOpencodeRunArgs — arg layout", () => {
  it("starts with 'opencode' 'run'", () => {
    const args = buildOpencodeRunArgs(baseOpts());
    expect(args[0]).toBe("opencode");
    expect(args[1]).toBe("run");
  });

  it("appends prompt after the -- separator", () => {
    const args = buildOpencodeRunArgs(baseOpts({ prompt: "do the thing" }));
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(args[sep + 1]).toBe("do the thing");
  });

  it("uses opts.title when provided, else defaults to bgr:<agent>:<ts>", () => {
    const a = buildOpencodeRunArgs(baseOpts({ title: "custom title" }));
    expect(a[a.indexOf("--title") + 1]).toBe("custom title");

    const b = buildOpencodeRunArgs(baseOpts({ agent: "mimir" }));
    expect(b[b.indexOf("--title") + 1]).toMatch(/^bgr:mimir:\d+$/);
  });

  it("wires --dir to opts.worktree and --log-level to INFO", () => {
    const args = buildOpencodeRunArgs(baseOpts({ worktree: "/srv/repo" }));
    expect(args[args.indexOf("--dir") + 1]).toBe("/srv/repo");
    expect(args[args.indexOf("--log-level") + 1]).toBe("INFO");
  });
});