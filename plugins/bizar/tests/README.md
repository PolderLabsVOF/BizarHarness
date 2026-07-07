# Plugin Tests

> `bun test plugins/bizar/tests/` — 658 tests across 45 files
> (as of v6.0.0-beta.4).

## Test categories

| File | What it tests | Tests |
| --- | --- | --- |
| `safety.test.ts` (v6.0.0) | DANGEROUS_PATTERNS, skill curator, memory flush, graph tools | 19 |
| `init-helpers.test.ts` | `withTimeout` + `readValidSessionIds` (legacy) | 11 |
| `settings.test.ts` | Settings store IO | ~30 |
| `commands.test.ts` | Slash command parser (pure) | ~20 |
| `commands-impl.test.ts` | Slash command executor | ~30 |
| `tools/plan-action.test.ts` | Plan add element / add comment / get canvas | ~20 |
| `tools/wait-for-feedback.test.ts` | Wait for feedback | ~15 |
| `tools/read-glyph-feedback.test.ts` | Read glyph feedback | ~10 |
| `tools/bg-spawn-delegation.test.ts` | BG spawn delegation | ~25 |
| `tools/cline-runner.test.ts` | Cline runner | ~20 |
| `tools/bg-get-comments.test.ts` | BG get comments | ~10 |
| `reasoning-clean.test.ts` | <think> block stripper | ~15 |
| `key-rotation.test.ts` | API key rotation | ~10 |
| `loop.test.ts` | Loop guard (loopThresholdWarn) | ~10 |
| `block.test.ts` | State-store locking | ~15 |
| `stall-think.test.ts` | Stall detection | ~10 |
| `background/*` | BG agent state machine | ~50 |
| `hooks/*` | Hook integration | ~30 |
| `state/*` | State machine | ~20 |

## Running

```bash
# All plugin tests
bun test plugins/bizar

# Single file
bun test plugins/bizar/tests/safety.test.ts

# Single test (by name)
bun test plugins/bizar/tests/safety.test.ts --test-name-pattern 'skill-curator'

# E2E (real plugin load + 27 tool/hook checks)
bun run /tmp/bh-full-e2e.mjs
```

## Test isolation

Tests are isolated via `mkdtempSync` for any file I/O. The skill
curator uses `BIZAR_SKILL_USAGE_FILE` env var to redirect writes
to a temp location. The memory flush uses `vaultRoot` constructor
option for the same purpose.

## Adding a new test

1. Create `plugins/bizar/tests/<name>.test.ts` (or
   `plugins/bizar/tests/tools/<name>.test.ts` for tool tests).
2. Use `bun:test` (not vitest).
3. Use `mkdtempSync` for any file I/O so the test is isolated.
4. Add the test to the table above.
5. Run `bun test plugins/bizar` to confirm green.

## Test patterns

### Unit test for a tool

```ts
import { describe, it, expect } from "bun:test";
import { createMyTool } from "../src/tools/my-tool.js";

describe("my-tool", () => {
  it("returns ok on success", async () => {
    const tool = createMyTool({ worktree: "/tmp", logger: silentLogger });
    const r = await tool.execute({ foo: "bar" }, { sessionId: "s" });
    expect(r.ok).toBe(true);
  });
});
```

### Integration test for a hook

```ts
import { createSkillCurator } from "../src/hooks/skill-curator.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("skill-curator", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "bh-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("records and reports", () => {
    const c = createSkillCurator({ worktree: tmp, logger: silentLogger });
    c.record("foo", "success");
    const r = c.report();
    expect(r.totalSkills).toBe(1);
  });
});
```
