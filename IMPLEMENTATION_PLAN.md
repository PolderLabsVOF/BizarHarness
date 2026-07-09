# BizarHarness — Implementation Plan

> The tactical roadmap. Where Phase 1 of
> [MILESTONES.md](MILESTONES.md) ended, and what Phase 2 looks like as
> a sequence of sprints with concrete deliverables, test gates, and
> commit points. Updated whenever the next sprint changes.

> **Currently active sprint:** **MS-2026-05 — Agent-Browser Integration
> + Phase 2 Foundations**

## Current state (snapshot 2026-07-07)

### Phase 1 (Foundation) — ✅ complete

- v5.6.0-beta.1 through beta.6 published
- 22 tools, 4 + 2 safety hooks, 73/73 audit
- `ClineCore` in-process via `ClineRuntime`
- Closed learning loop primitives (curator + memory vault + snapshot flush)
- 10 ADRs

### Phase 2 (Capability expansion) — ⏳ ~30% complete

| Item | Status |
| --- | --- |
| Provider profile + fallback chain (DEC-004 P1) | Not started |
| Subagent RPC (DEC-006 P1) | Not started |
| Trajectory capture + evaluation (DEC-007 P1) | Not started |
| Self-healing browser automation (agent-browser) | **Not started — this sprint** |
| Cline agent team progress on kanban | Not started |
| Knowledge graph query surface | ✅ v6.0.0 (DEC-010) |
| DANGEROUS_PATTERNS approval gate | ✅ v6.0.0 (DEC-007) |

## Active sprint: **MS-2026-05 — Agent-Browser Integration**

### Goal

Replace the `browser-harness` (Python CDP wrapper) with **agent-browser**
(native Rust CLI from vercel-labs, 38K★) across the entire Bizar toolchain:

- Bash setup script (`cli/browser-harness-up.sh` → `cli/agent-browser-up.sh`)
- Agent definition (`config/agents/browser-harness.md` → `config/agents/agent-browser.md`)
- Skill SKILL.md (`bizar-dash/skills/browser-harness/` → `bizar-dash/skills/agent-browser/`)
- Bizar tools (a new `bizar_browser_*` family)
- Installer (`install.sh`/`install.ps1` — install agent-browser)
- Tests (replace `no-agent-browser` regression test direction)

### Why agent-browser over browser-harness

| Dimension | browser-harness (old) | agent-browser (new) |
| --- | --- | --- |
| Language | Python (uv-installed) | Native Rust |
| Startup | ~2s (Python + imports) | <100ms |
| Browser | Puppeteer Chrome | Chrome for Testing (official Google automation channel) |
| Stability | Daemon-based, fragile | Daemon-based, mature (~38K★) |
| LLM integration | None | Built-in `chat` command (browser-agent LLM via Vercel AI SDK + AI Gateway) |
| MCP integration | None | **Native MCP stdio server** (`agent-browser mcp`) |
| Commands | 14 Python helpers | 100+ typed CLI commands + MCP tools |
| Plugins | None | Plugin system (e.g. `agent-browser-plugin-vault`) |
| Profile management | Manual via Chrome dir | First-class (`profile` config + `--profile` flag) |
| Config | None | Layered config (`~/.agent-browser/config.json` + `./agent-browser.json` + env vars) |
| Ecosystem | Single tool | vercel-labs integration + skills.sh |

### Sub-deliverables (sequence)

#### MS-2026-05-A — Install script + agent def + tools (this commit)

1. ✅ MILESTONES.md + IMPLEMENTATION_PLAN.md (top-level)
2. ⏳ **`cli/agent-browser-up.sh`** — Bash idempotent starter (background
   daemon via `setsid + nohup`, env overrides).
3. ⏳ **`config/agents/agent-browser.md`** — Cline primary agent with
   no-edit permissions, drives agent-browser via Bash heredocs.
4. ~~⏳ `config/opencode.json` + new cline.json~~ — **REMOVED in v6.1.0**. Bizar is Cline-only; the OpenCode agent-browser registration path has been dropped. agent-browser is now wired through the Cline `bizar_browser_*` tool family.
5. ⏳ **Reusable installer hooks in `install.sh`/`install.ps1`** — install
   agent-browser via npm (`npm install -g agent-browser`) + run
   `agent-browser install`.
6. ⏳ **`bizar-dash/skills/agent-browser/SKILL.md`** — concise skill
   document (matches the existing skill shape).
7. ⏳ **`bizar-dash/skills/browser-harness/SKILL.md`** — deleted.
8. ⏳ **Update `no-agent-browser` regression test** — flip direction
   to `no-browser-harness`.
9. ⏳ **Update `bizar-dash/src/server/mods-loader.mjs`** if browser-harness
   is registered as a mod.
10. ⏳ **`bizar-dash/src/server/browser.mjs`** stays (it's the OS
    "open URL in user browser" launcher — different concern).

#### MS-2026-05-B — Cline MCP integration (next commit)

1. **Configure Cline to register `agent-browser mcp` as a tool server.**
   Cline reads `.cline/mcp.json` (or the equivalent per-version) and
   spawns MCP servers at session start. The config is a single JSON
   fragment:
   ```json
   {
     "mcpServers": {
       "agent-browser": {
         "command": "agent-browser",
         "args": ["mcp", "--tools", "core"],
         "env": {}
       }
     }
   }
   ```
2. **Test the round trip in `e2e.mjs`** — spawn a Cline session, ask
   it to navigate to a URL via the MCP server, verify the response.
3. **Document in `docs/mcp-integration.md`** — how to swap tool
   profiles (core, network, react, mobile), how to add plugins,
   how to use the chat endpoint.

#### MS-2026-05-C — Plugin tools (this commit + followup)

1. **`bizar_browser_open`** — wraps `agent-browser open <url>`
2. **`bizar_browser_snapshot`** — calls `agent-browser snapshot` and
   returns the accessibility tree as JSON
3. **`bizar_browser_click`** — accepts a ref (`@e2`) or a selector
4. **`bizar_browser_fill`** — accepts ref + text
5. **`bizar_browser_screenshot`** — returns the screenshot path
6. **`bizar_browser_close`** — terminates the session
7. **`bizar_browser_command`** — escape-hatch for any of the 100+
   typed CLI commands
8. **`bizar_browser_chat`** — natural-language browser-driven
   tasks (requires `AI_GATEWAY_API_KEY`)

These are thin wrappers around the agent-browser CLI. The plugin's
Cline runtime invokes them via `execFile`.

#### MS-2026-05-D — Kanban integration (followup)

- Tasks tagged `browser:*` show a small "browser" badge
- `bizar_spawn_team` with a browser mission spawns a team whose
  lead agent dispatches work to the browser-primary agent
- Live "snapshot events" from agent-browser stream to the WS bus

### Test gates

```sh
# Verify after each commit
make check                                       # tsc + tests
make e2e                                         # 22+ E2E checks pass
bash tools/audit-harness.sh .                    # 73/73
make vcr                                         # 1.0
```

Specifically for this sprint:

```sh
# Verify agent-browser is installed and the CLI works
agent-browser doctor
agent-browser --help
agent-browser open example.com && agent-browser close

# Verify the plugin tools route to agent-browser
bun test plugins/bizar/tests/tools/browser.test.ts
bun test plugins/bizar/tests/no-browser-harness.node.test.mjs

# Verify full E2E
bun run /tmp/bh-full-e2e.mjs
```

### Commit points (incremental)

```
MS-2026-05-A.1: docs + plans (this commit)
MS-2026-05-A.2: install script + agent def + skill
MS-2026-05-A.3: plugin tools (8 new tools)
MS-2026-05-B.1: Cline MCP integration
MS-2026-05-C.1: kanban + team integration
```

### Definition of Done

A feature is `passing` in `feature_list.json` only when ALL THREE LAYERS verify:

- **Layer 1 — Compile/typecheck:** `make check` is green.
- **Layer 2 — Unit tests:** `bun test` passes for the touched module.
- **Layer 3 — E2E:** `make e2e` exercises real plugin load + tools + hooks.

## Upcoming sprints (after this)

### MS-2026-06 — Provider profile + fallback chain

**Goal:** Survive provider outages automatically.

- New file: `config/providers.yaml`
- Per-agent default with `fallbacks: [...]`
- Per-task retry: 429/5xx → next fallback
- Cost tracking: log tokens + estimated cost
- Tests: kill primary mid-task, verify fallback

### MS-2026-07 — Trajectory capture + eval

**Goal:** Bizar can replay any task and evaluate model quality.

- Trajectory format: JSONL with turn-by-turn data
- Compression: 6-step (protect head/tail, summarize middle)
- Auto-capture: every Bizar run writes a trajectory
- Eval harness: `bun eval <scenario.jsonl>`
- Regression detection: `bun eval --baseline v0.1`

### MS-2026-08 — Subagent RPC

**Goal:** Subagent dispatching with zero context cost.

- UDS or TCP JSON-RPC server
- Tool whitelist for subagents
- Per-call auth token
- Env scrubbing before child process spawn
- One-turn pipelined execution

### MS-2026-09 — Cline agent team kanban visualization

**Goal:** Teams work visible in real time on the kanban.

- Subscribe to `team_progress_projection` events
- Map projection → column
- Tasks tagged `team:*` show team badge
- Live progress bars in Tasks.tsx

## Anti-patterns (from `06-bizar-improvement-plan.md`)

1. Don't grow to 1M LOC — Hermes is 1.3M LOC and the cognitive overhead is
   brutal. Use libraries.
2. Don't write 20K-line single files. Split early.
3. Don't go Rust-only. Stay multi-language-friendly.
4. Don't make security prompt-enforced only. Use a real policy DSL.
5. Don't add a multi-platform gateway unless there's a real user need.
6. Don't ship without a closed learning loop.
7. Don't hard-code model choices. Provider abstraction is table stakes.
8. Don't skip the audit log. Long-horizon work without audit is a liability.
9. Don't drift into personal-assistant territory. Bizar is a coding harness.

## Update policy

- This file is updated at every sprint boundary (start + end).
- New sprints are appended (chronological).
- Delivered items move to `Phase X — ⏳ ~30% complete` or `Phase X — ✅
  complete` in [MILESTONES.md](MILESTONES.md).
- Cancelled sprints are marked `[CANCELLED: reason]` rather than deleted.

## See also

- [MILESTONES.md](MILESTONES.md) — strategic roadmap
- [PROGRESS.md](PROGRESS.md) — live cross-session state
- [feature_list.json](feature_list.json) — features + state
- [research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md](research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md) —
  12-item improvement plan
