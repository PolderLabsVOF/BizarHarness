<div align="center">

# BizarHarness ᛟ

**Claude Code-native multi-agent coding harness with a closed learning loop.**

14 agents across 5 cost tiers. Odin routes, subagents execute, Forseti audits.
Claude Code Agent SDK in-process — no subprocess, no port, no serve-info file.

[![npm](https://img.shields.io/npm/v/@polderlabs/bizar?color=cb3837)](https://www.npmjs.com/package/@polderlabs/bizar)
[![v6.3.0](https://img.shields.io/badge/v6.3.0-Claude%20Code-6366f1)](https://github.com/DrB0rk/BizarHarness)
[![Claude Code](https://img.shields.io/badge/claude--code-%E2%9C%93-6366f1)](https://docs.claude.com/claude-code)
[![Audit 73/73](https://img.shields.io/badge/audit-73%2F73-10b981)](https://github.com/DrB0rk/BizarHarness)
[![Harness](https://img.shields.io/badge/harness-L01--L12-8A2BE2)](docs/INDEX.md)
[![Safety](https://img.shields.io/badge/safety-36%20patterns-ff6b6b)](docs/safety.md)
[![Mimir](https://img.shields.io/badge/mimir-deep--research-0ea5e9)](plugins/bizar/skills)
[![Skills](https://img.shields.io/badge/skills.sh-integrated-f59e0b)](https://www.skills.sh)
[![Headroom](https://img.shields.io/badge/headroom-integrated-8A2BE2)](https://github.com/headroomlabs-ai/headroom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`npm install @polderlabs/bizar` · `npx bizar`

</div>

---

## Table of Contents

- [What's new in v6.3.0](#-whats-new-in-v630)
- [Quick start](#-quick-start)
- [The Pantheon](#-the-pantheon)
- [Architecture](#-architecture)
- [Tools (22 total)](#-tools-22-total)
- [Hooks (4 + 2 safety)](#-hooks-4--2-safety)
- [Safety — DANGEROUS_PATTERNS](#-safety--dangerous-patterns)
- [Skill Curator — closed learning loop](#-skill-curator--closed-learning-loop)
- [Knowledge Graph Tools](#-knowledge-graph-tools)
- [Harness engineering audit (73/73)](#-harness-engineering-audit-7373)
- [Documentation](#-documentation)
- [Migration from v6.2.x (Cline era)](#-migration-from-v62x-cline-era)
- [Historical: OpenCode → Cline (v5.6/v6.0)](#-historical-opencode--cline-v56v60)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ What's new in v6.3.0

v6.3.0 is a **complete migration** from Cline to Claude Code. The plugin
framework that previously lived as a Cline `AgentPlugin` is now expressed
as Claude Code skills + MCP servers + `.claude/agents/` definitions.
Claude Code's Agent SDK (`@anthropic-ai/claude-agent-sdk`) is embedded
in-process — no subprocess spawn, no port, no password, no serve-info
file. Hooks execute in Claude Code's event loop; mistake recovery uses
the Agent SDK's `onConsecutiveMistakeLimitReached`; subagent dispatch
uses the Claude Code `Agent` tool.

| Feature | Description |
| --- | --- |
| **Claude Code-native hooks** | `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` — typed payloads, idiomatic Claude Code shape. |
| **22 tools, 4 hooks** | All use Claude Code `MCP tool registration`. 0 compat shims. |
| **Skills + MCP** | `.claude/skills/<name>/SKILL.md` (auto-loaded) + `.claude/mcp.json` (Semble, Bizar memory, CubeSandbox). Replaces the previous "plugin" surface. |
| **Agent dispatch** | Subagents dispatched via the Claude Code `Agent` tool with `run_in_background: true`. The previous `bizar_spawn_team` tool is now `Agent` with `agent_team: "<name>"`. |
| **Knowledge graph tools** | `bizar_graph_query/path/explain` over `.bizar/graph/graph.json` (still file-based; unchanged). |
| **DANGEROUS_PATTERNS gate** | 36 patterns (25 deny + 11 require-approval) checked in `PreToolUse`. |
| **Skill curator** | Per-skill use/failure tracking. The differentiator (1/106 projects). |
| **Pre-compaction memory flush** | Durable snapshot before summarizer. Closes the durability gap. |
| **In-process memory vault** | Tools read/write `~/.bizar_memory/` directly. No dashboard needed. |
| **Harness audit 73/73** | Full L01–L12 compliance. `make check-arch` enforces 7 rules. |
| **Removed: plugin layer** | The `plugins/bizar/` plugin entry is now a Claude Code MCP server — skills do the rest. v6.0.0–v6.2.5. |

See the full [CHANGELOG.md](CHANGELOG.md) for v6.0.0 → v6.3.0 history.

---

## 🚀 Quick start

Prerequisites: **Claude Code CLI** (`claude` on `PATH`; install via
`npm install -g @anthropic-ai/claude-code` or follow
[the Claude Code install docs](https://docs.claude.com/claude-code/getting-started)).

```bash
# Install (stable v6.3.0)
npm install @polderlabs/bizar

# Or try the latest beta
npm install @polderlabs/bizar@beta

# Run
npx bizar
```

The installer handles:

- Cloning the dashboard repo
- Installing Bizar skills + agents + commands to `.claude/`
  (`skills/`, `agents/`, `commands/`, `hooks/`)
- Configuring Semble (code search MCP) and Skills CLI
- Headroom (token-saving proxy)

If you'd rather install manually, see
[docs/migration-guide.md](docs/migration-guide.md).

---

## ᛉ The Pantheon

```
               ┌─────────────┐
               │ᛟ ODIN       │
               ├─────────────┤
               │Router (M3)  │
               └─────────────┘
 ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
 │ᛢ VÖR    │ │ᛗ MIMIR  │ │ᚹ HEIMDALL│ │ᚱ HERMOD │ │ᚦ THOR   │ │ᛒ BALDR  │ │ᛏ TYR    │ │ᛉ VIDARR  │
 ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├──────────┤
 │Clarifier│ │Research │ │Simple   │ │Git ops  │ │Mid impl │ │Design   │ │High impl│ │Reasoning │
 │(M2.7)   │ │(M2.7)   │ │(M2.7)   │ │(M2.7)   │ │(M2.7)   │ │(M2.7)   │ │(M3)     │ │(M3-Reason)│
 └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └──────────┘
                                              ↑                        ↑
                                          Forseti audits          Forseti audits
                                          all Tier 4/5 work
```

Odin is the only primary agent. Every request hits him first. He
**never executes work** — he decomposes into parallel streams and
dispatches to subagents via the Claude Code `Agent` tool. The Forseti
gate audits all Tier 4/5 work (Tyr, Vidarr) before execution.

See [plugins/bizar/ARCHITECTURE.md](plugins/bizar/ARCHITECTURE.md) for
the full agent roster and routing rules.

---

## ⚙ Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Layer 1: UI (bizar-dash/)                                          │
│   - React + TypeScript dashboard (17 tabs)                        │
│   - Express server (HTTP + WS)                                     │
│   - In-process Claude Code Agent SDK (no daemon / no subprocess)   │
│   - Harness engineering dashboard view                             │
│   - Kanban board (5 columns + backlog)                             │
└────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP REST + WebSocket
┌────────────────────────────────────────────────────────────────────┐
│ Layer 0: Core (.claude/skills + .claude/agents + plugins/bizar/)   │
│   - Skills (SKILL.md + bundled scripts)                             │
│   - Agents (Odin, Frigg, Vör, Mimir, Heimdall, ...)                 │
│   - Bizar MCP server (plugins/bizar/, 19 tools)                     │
│   - 4 hooks (PreToolUse, PostToolUse, ...)                         │
│   - In-process memory vault                                         │
│   - DANGEROUS_PATTERNS approval gate                                │
│   - Skill curator (closed learning loop)                            │
│   - Pre-compaction memory flush                                     │
└────────────────────────────────────────────────────────────────────┘
                              ↕ Claude Code Agent SDK
┌────────────────────────────────────────────────────────────────────┐
│ Substrate: Claude Code (@anthropic-ai/claude-code + Agent SDK)     │
│   - In-process runtime via Agent SDK, no subprocess                │
│   - Skills auto-loaded from .claude/skills/                        │
│   - MCP servers spawned from .claude/mcp.json                      │
│   - Agent dispatch via Agent tool                                  │
│   - Hooks executed in session event loop                           │
└────────────────────────────────────────────────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full layer
model, module map, and inter-component contracts.

---

## 🛠 Tools (22 total)

Bizar's 22 tools are exposed as a Claude Code MCP server (replacing
Cline's `createTool` shape with the Claude Code MCP `tool`
registration shape):

| Category | Count | Tools |
| --- | --- | --- |
| **Background agents** | 9 | `bizar_spawn_background`, `bizar_status`, `bizar_collect`, `bizar_kill`, `bizar_pause`, `bizar_resume`, `bizar_send_message`, `bizar_get_comments`, `bizar_report_progress` |
| **Memory** | 4 | `bizar_memory_list`, `bizar_memory_read`, `bizar_memory_write`, `bizar_memory_search` |
| **Plan / Glyphs** | 4 | `bizar_plan_action`, `bizar_open_kb`, `bizar_wait_for_feedback`, `bizar_read_glyph_feedback` |
| **Agent teams** | 2 | `bizar_spawn_team`, `bizar_team_status` |
| **Knowledge graph** | 3 | `bizar_graph_query`, `bizar_graph_path`, `bizar_graph_explain` |
| **Total** | **22** | All registered as MCP tools via the Claude Code MCP SDK |

---

## 🪝 Hooks (4 + 2 safety)

Claude Code-native hooks (typed event payloads, idiomatic shape):

| Hook | Purpose |
| --- | --- |
| `PreToolUse` | Loop guard + **DANGEROUS_PATTERNS gate** |
| `PostToolUse` | Per-tool-call log to `LogWriter` |
| `UserPromptSubmit` | **Pre-compaction memory flush** (writes snapshot to vault) |
| `SessionStart` / `SessionEnd` | `message-added` (slash commands) + `run-finished`/`run-failed` (memory write) |

| Safety component | Purpose |
| --- | --- |
| `skill-curator` (manual) | Reports skill usage + flags revisions |
| `memory-flush-on-compact` (auto) | Writes snapshot to vault when `shouldCompact()` returns true |

---

## 🛡 Safety — DANGEROUS_PATTERNS

**36 patterns** checked on every tool call. 25 deny + 11 require-approval.

| Category | Examples |
| --- | --- |
| **Filesystem destruction** | `rm -rf /`, `rm -rf /etc`, `mkfs`, `dd of=/dev/sda`, fork bomb |
| **Privilege escalation** | `sudo`, `su - root`, `chmod 777`, `chown root` |
| **SSRF** | `http://169.254.169.254/*` (AWS metadata), `metadata.google.internal`, `metadata.azure.com` |
| **Process control** | `kill -9 1`, `shutdown`, `reboot`, `init 0` |
| **Sensitive file reads** | `~/.ssh/`, `~/.aws/credentials`, `~/.config/gcloud`, `/proc/<pid>/environ` |
| **Network exfiltration** | `wget ... \| sh`, `curl ... \| sh` |
| **Dangerous git** | `git push --force origin main`, `git reset --hard`, `git clean -fd` |
| **Prompt injection** | `ignore previous instructions`, `reveal your system prompt` |

**Always-on.** No env var to disable. Source patterns from
[Hermes](https://github.com/walkinglabs/awesome-harness-engineering) +
[OpenFang](https://github.com/RightNow-AI/openfang) +
[OpenClaw](https://github.com/openclaw/openclaw).

See [docs/safety.md](docs/safety.md) for the full reference.

---

## 🧠 Skill Curator — closed learning loop

**The differentiator.** Of 106 cataloged agent-harness projects, exactly
one (Hermes Agent) has this. Bizar is now the second.

Tracks per-skill use/failure in `~/.bizar/skills/usage.jsonl`:

```ts
import { recordSkillUse, generateCuratorReport } from "bizar/hooks/skill-curator";

recordSkillUse("pump-then-test", "failure");
recordSkillUse("pump-then-test", "failure");
const report = generateCuratorReport({ worktree, logger });
// { totalSkills: 14, needsRevision: 1, stale: 0, ... }
```

The closed loop:

```
Tasks run → recordSkillUse(skill, success|failure)
          → usage.jsonl accumulates
          → generateCuratorReport() identifies:
             - skills with 5+ failures (needs-revision)
             - skills with 0 uses in 30 days (stale)
             - new skills (proposals)
          → next sprint addresses the report
```

See [docs/curator.md](docs/curator.md) for the full reference.

---

## 🕸 Knowledge Graph Tools

Three tools expose the existing `.bizar/graph/graph.json` (built by
`graphify`) to agents:

| Tool | Use case |
| --- | --- |
| `bizar_graph_query` | Substring search across node id, label, source file |
| `bizar_graph_path` | BFS shortest path between two nodes |
| `bizar_graph_explain` | Natural-language node summary with neighbors |

The BizarHarness project graph has **814 nodes** (mostly code
symbols + docs). Path queries work once `graphify` adds edges.

See [docs/graph-tools.md](docs/graph-tools.md) for the full reference.

---

## 🛡 Harness engineering audit (73/73)

v6.3.0 passes the full L01–L12 audit at **73/73 = 100%**:

| Subsystem | Score |
| --- | --- |
| 1. Instructions | 11/11 (entry + hard constraints + state files + clock-in/out) |
| 2. Tools | 2/2 (`.claude/settings.json` + MCP integrations) |
| 3. Environment | 5/5 (lockfile + `.nvmrc` + Makefile + setup + dev) |
| 4. State | 4/4 (`PROGRESS.md` + `DECISIONS.md` + `feature_list.json`) |
| 5. Feedback | 7/7 (`make check/test/e2e/clean-check/arch/vcr/session-*`) |
| 6. L05 Cross-session | 6/6 (Current State + clock-in/out + context anxiety) |
| 7. L03 System of record | 4/4 (ACID: Durability, Consistency, Atomicity, Proximity) |
| 8. L07 WIP=1 + VCR | 3/3 (WIP=1 + `make vcr` + VCR 31/31 = 1.0) |
| 9. L08 Feature list | 6/6 (evidence + verify-feature + granularity + state machine) |
| 10. L09 DoD | 5/5 (3-layer verification + runtime signals + repair instructions) |
| 11. L10 E2E + Arch | 8/8 (`make e2e` + `make check-arch` + 7 arch rules + E2E requirement) |
| 12. L11 Observability | 7/7 (sprint contract + rubric + session-trace + make session-*) |
| 13. L12 Clean State | 5/5 (5-dimension checklist + clean-check + quality doc + dual-mode) |

```bash
bash tools/audit-harness.sh .
# Total:       73 / 73 harness components present
# Critical:    7 / 7
# Recommended: 66 / 66
```

See [PROGRESS.md](PROGRESS.md) § Current State and the
[Harness tab](bizar-dash/src/web/views/Harness.tsx) in the dashboard.

---

## 📚 Documentation

| What | Where |
| --- | --- |
| **Documentation index** | [docs/INDEX.md](docs/INDEX.md) |
| Entry point (agents) | [AGENTS.md](AGENTS.md) |
| Current state | [PROGRESS.md](PROGRESS.md) |
| Decisions (ADRs) | [DECISIONS.md](DECISIONS.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| Safety | [docs/safety.md](docs/safety.md) |
| Skill curator | [docs/curator.md](docs/curator.md) |
| Graph tools | [docs/graph-tools.md](docs/graph-tools.md) |
| Quality scores | [docs/quality-document.md](docs/quality-document.md) |
| Migration guide | [docs/migration-guide.md](docs/migration-guide.md) |
| Plugin module | [plugins/bizar/ARCHITECTURE.md](plugins/bizar/ARCHITECTURE.md) |
| Plugin constraints | [plugins/bizar/CONSTRAINTS.md](plugins/bizar/CONSTRAINTS.md) |
| Dashboard module | [bizar-dash/ARCHITECTURE.md](bizar-dash/ARCHITECTURE.md) |
| SDK module | [packages/sdk/ARCHITECTURE.md](packages/sdk/ARCHITECTURE.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

---

## 🔄 Migration from v6.2.x (Cline era)

Upgrading from a Cline-era BizarHarness (v6.0.0 → v6.2.x)? See
[docs/migration-guide.md](docs/migration-guide.md) for:

- Breaking changes (hook shape: `beforeTool` → `PreToolUse`)
- New tools (Claude Code MCP server shape; Agent SDK dispatch)
- Removed tools (the `bizar_spawn_background` tool family is now
  Claude Code `run_in_background`)
- Verification commands

TL;DR: `npm install @polderlabs/bizar@latest` and update any custom
hooks that consumed the old `beforeTool` hook payload shape.

## 📜 Historical: OpenCode → Cline (v5.6/v6.0)

The OpenCode-era Bizar (≤ v5.5.x) was rebuilt on Cline across
**v5.6.0-beta.x → v6.0.0** (the "Cline rewrite"). That migration is
preserved as historical context only — see [docs/migration-guide.md](docs/migration-guide.md)
§ Historical for the archived OpenCode → Cline guide. No current
release of Bizar supports OpenCode.

---

## 🤝 Contributing

PRs welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

The harness engineering protocol:

1. **Before:** Fill [templates/sprint-contract.md](templates/sprint-contract.md)
   (scope, DoD, exclusions).
2. **During:** Run `make session-start` to record session start.
3. **After:** Score against [templates/evaluator-rubric.md](templates/evaluator-rubric.md)
   (every dim B+).
4. **End of session:** Run `make clean-check` and `make check`. Commit
   with a WHY-focused message.

### Development

Development of BizarHarness uses a separate sandbox repo for Docker/dev
tooling. See [DrB0rk/BizarHarness-dev](https://github.com/DrB0rk/BizarHarness-dev)
(private) for the local dev environment, including the Docker-based
Claude Code sandbox used to test config and plugin changes without
touching the system Claude Code install.

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgments

Inspired by the [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering)
course and the [awesome-harness-engineering](https://github.com/walkinglabs/awesome-harness-engineering)
curated list. Built on [Claude Code](https://docs.claude.com/claude-code)
and [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

---

<div align="center">
<small>
ᚱᚨᛞᛖ ᚹᛖᛚ · ᛟᚲ ᛈᚱᛟᛋᛈᛖᚱ<br>
<em>Ráðe vel · ok prosper</em>
</small>
</div>
