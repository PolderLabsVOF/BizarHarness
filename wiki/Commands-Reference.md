# Commands Reference

BizarHarness exposes three layers of slash commands inside cline. They are all invoked by typing `/<name>` in the cline prompt.

| Layer | Lives in | Scope | How it's discovered |
|---|---|---|---|
| **Bizar plugin** | bundled with the Bizar plugin (`plugins/bizar/src/commands.ts`) | Per cline session — the plugin parses your message in its `chat.message` hook | Always available when the plugin is loaded |
| **User-level** | `~/.config/cline/commands/*.md` | Every cline session, any project | Read at cline startup |
| **Project-level** | `<project>/.cline/commands/*.md` | Only when cline runs in that project | Read at cline startup |

This page documents all three. New commands ship as plain markdown files with optional frontmatter — see [Contributing](Contributing) for the format.

---

## Bizar plugin commands

These are the highest-leverage commands because they hit the plan canvas and the loop guard — the two core surfaces of the Bizar plugin. See [Bizar Plugin](Bizar-Plugin) for the underlying mechanism.

### `/plan` — visual plan canvas

The plan canvas is the most distinctive BizarHarness feature. It creates a local `.json` plan with elements and connections, edits it via the plugin's `bizar_plan_action` tool, and lets the user comment on individual elements. Everything is local; no network.

| Subcommand | What it does |
|---|---|
| `/plan new <slug> [template]` | Create a new plan. `<template>` defaults to `feature-design`; other options are `decision-record`. Refuses to clobber an existing plan. |
| `/plan open <slug>` | Open an existing plan; updates `lastUsedSlug` in settings. |
| `/plan list` (alias: `/plan ls`) | List all plans in the project, with status and last-edited timestamps. |
| `/plan get <slug>` | Dump the full plan canvas as JSON. |
| `/plan add <slug> --title X --type task [--x 50 --y 50]` | Add an element to the plan. |
| `/plan update <slug> <el_id> [--x 50 --y 50 --title ...]` | Patch an existing element. |
| `/plan delete <slug> <el_id>` | Remove an element and its connections/comments. |
| `/plan comment <slug> [el_id] "text"` | Add a comment. Pinned to `<el_id>` if given, otherwise canvas-pinned. |
| `/plan comments <slug> [el_id]` | List comments (optionally filtered to one element). |
| `/plan status <slug> <status>` | Set the plan status (`draft`, `approved`, `rejected`, `in-progress`, `done`). |
| `/plan wait <slug>` | Defer — agent pauses for human feedback on the plan. The plugin tool returns a "deferred" response, the agent does NOT block. |
| `/plan` (no arg) | Print usage. |

The plan files live at `plans/<slug>/plan.json` (data) and `plans/<slug>/meta.json` (status). The HTML viewer/editor is generated from a template. See [Plans Command](Plans-Command) for the original (pre-plugin) implementation.

### `/visual-plan` — toggle the visual plan mode

```
/visual-plan              # show current state
/visual-plan on | off     # toggle the mode
/visual-plan status       # show current state (alias)
/visual-plan true | false # also accepted
```

When **on**, the agent will create a plan and wait for feedback on complex tasks. When **off**, the agent works without surfacing intermediate plans. State is persisted in `.bizar/settings.json` (per-project).

### `/help` (alias: `/commands`)

List all available slash commands. The plugin's `/help` returns its own command list; the cline-built-in `/help` returns the broader set including user-level and project-level commands.

---

## Loop guard thresholds

The Bizar plugin's loop guard is what keeps subagents from calling the same tool 30 times in a row. It runs on every `tool.execute.after` hook and tracks the recent window of identical calls. The canonical threshold table:

| Count of identical calls in window | Decision | Action |
|---|---|---|
| 0..2 | `allow` | pass through |
| 3..4 | `warn` (log-only) | log to plugin log file; no agent-visible effect |
| 5..7 | `warn` (inject) | inject a handoff prompt suggesting Mimir / task / bash |
| 8..11 | `escalate` | inject an explicit handoff to Odin |
| 12+ | `block` | **throw** — the agent must recover (e.g. switch tools) |

The defaults are `warn=5, escalate=8, block=12` with `windowSize=10`. They are configurable per project via `cline.json`:

```json
"plugin": [
  ["./plugins/bizar/index.ts", {
    "loopThresholdWarn": 5,
    "loopThresholdEscalate": 8,
    "loopThresholdBlock": 12,
    "loopWindowSize": 10
  }]
]
```

If a 12-threshold block fires and the agent tries again, the plugin's `EventStream` captures the loop-guard tool and marks the instance as failed in `bg-state/`. The error appears in `bizar_collect` output so the parent knows what happened.

---

## User-level commands (ship with BizarHarness)

These are deployed by `install.sh` to `~/.config/cline/commands/`. All BizarHarness users get them.

### Project setup and inspection

| Command | What it does | Agent |
|---|---|---|
| `/init` | Run `bizar init` to detect the project stack, install relevant skills, and create `.bizar/PROJECT.md`. | build |
| `/audit` | Run `bizar audit` to scan agent config for security issues. | security |
| `/security-scan` | Run AgentShield against agent, hook, MCP, permission, and secret surfaces. | security |
| `/harness-audit` | Deterministic repository harness audit with a prioritized scorecard. | general |
| `/projects` | List registered projects and their instinct counts. | general |
| `/setup-pm` | Configure the package-manager preference (npm/pnpm/yarn/bun). | general |
| `/learn` | Extract patterns from the current session and append to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. | heimdall |

### Planning and orchestration

| Command | What it does | Agent |
|---|---|---|
| `/plan` | Create an implementation plan with risk assessment. | planner |
| `/orchestrate` | Orchestrate multiple agents for complex tasks — generates a per-step agent chain. | general |
| `/model-route` | Show the current model routing table and per-agent model override. | general |
| `/loop-start` | Start a continuous agent loop with quality gates. | loop-operator |
| `/loop-status` | Show the status of the most recent loop. | loop-operator |

### Code work

| Command | What it does | Agent |
|---|---|---|
| `/build-fix` | Fix build and TypeScript errors with minimal changes. | build-error-resolver |
| `/code-review` | Review code for quality, security, and maintainability. | code-reviewer |
| `/refactor-clean` | Remove dead code and consolidate duplicates. | refactor-cleaner |
| `/tdd` | Enforce TDD workflow with 80%+ coverage. | tdd-guide |
| `/test-coverage` | Analyze and improve test coverage. | general |
| `/verify` | Run the verification loop (build, typecheck, lint, test, security). | general |
| `/quality-gate` | Run the full quality gate suite and report pass/fail. | general |
| `/checkpoint` | Save verification state and progress checkpoint. | build |
| `/eval` | Run evaluation against acceptance criteria. | general |
| `/e2e` | Generate and run E2E tests with Playwright. | e2e-runner |
| `/evolve` | Analyze instincts and suggest or generate evolved structures. | general |

### Domain specialists

| Command | What it does | Agent |
|---|---|---|
| `/go-build` | Fix Go build and vet errors. | go-build-resolver |
| `/go-review` | Go code review for idiomatic patterns. | go-reviewer |
| `/go-test` | Go TDD workflow with table-driven tests. | tdd-guide (go-flavored) |
| `/rust-build` | Fix Rust build and borrow-checker issues. | rust-build-resolver |
| `/rust-review` | Rust code review for ownership, safety, idiomatic patterns. | rust-reviewer |
| `/rust-test` | Rust TDD workflow with unit and property tests. | tdd-guide (rust-flavored) |

### Memory and instincts

| Command | What it does | Agent |
|---|---|---|
| `/instinct-status` | Show learned instincts (project + global) with confidence scores. | general |
| `/instinct-export` | Export instincts for sharing. | general |
| `/instinct-import` | Import instincts from external sources. | general |
| `/promote` | Promote project instincts to global scope. | general |

### Security and audit

| Command | What it does | Agent |
|---|---|---|
| `/security` | Run a comprehensive security review. | security-reviewer |
| `/security-scan` | Run AgentShield against surfaces (agent, hook, MCP, permission, secrets). | general |

### Documentation

| Command | What it does | Agent |
|---|---|---|
| `/update-docs` | Update documentation for recent changes. | doc-updater |
| `/update-codemaps` | Update codemaps for codebase navigation. | doc-updater |
| `/skill-create` | Generate skills from git-history analysis. | general |

### Read-only / dispatch

| Command | What it does | Agent |
|---|---|---|
| `/explain` | Route to @frigg for read-only Q&A — no changes, just an answer. | frigg |
| `/pr-review` | Route to @hermod for PR review mode (Mimir + Forseti in parallel, post as PR comment). | hermod |

---

## Project-level commands (per-project)

Project commands are scoped to a single repo. They are loaded from `<project>/.cline/commands/*.md` and only work when cline is started in that project.

### `/tailscale-serve` — MagicDNS hosting

**File:** `config/commands/tailscale-serve.md` (deployed by `install.sh`)

Authenticate and configure Tailscale Serve to expose a local port on your tailnet. Surfaces the admin-enable URL when Serve is not yet enabled on the tailnet.

```
/tailscale-serve                 # expose port 8765 (BizarHarness dashboard default)
/tailscale-serve 3000            # expose port 3000
/tailscale-serve --status        # show current serve config, no changes
/tailscale-serve --reset         # remove the current serve config
```

The command:

1. Verifies the upstream port is actually listening (no proxy without a service).
2. Reads the MagicDNS name and Tailscale IP from `tailscale status --json`.
3. Shows the current `tailscale serve status`.
4. If already configured → prints the current config and stops (does not re-configure).
5. If not configured → runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>` with a 5-second timeout. On success, prints the new `https://<magicdns>/` endpoint.
6. If the output contains "Serve is not enabled" → parses the admin-enable URL and surfaces it prominently. **Stops there** — does not silently fall back to plain HTTP. The user asked for authentication, not a workaround.

The HTTP fallback (binding to the Tailscale IP) lives in `scripts/host-magicdns.sh` of the demo project and is invoked with `npm run host:start`. It's safe inside the tailnet because all traffic is WireGuard-encrypted.

### How to add a project command

Drop a markdown file in `<project>/.cline/commands/<name>.md` with this frontmatter:

```markdown
---
description: One-line description shown in /help
agent: <agent-name>     # optional; defaults to the model default
subtask: true           # optional; runs as a subagent
---

# Command Name

Body of the command — the prompt that the model sees when the user
types `/<name>`.
```

Restart cline to pick up new commands.

---

## Customizing the command set

- **Disable a command**: rename the `.md` file with a leading dot (`.audit.md`) or move it out of the commands directory.
- **Override a default**: drop a same-named file in `~/.config/cline/commands/` (user-level wins) or `<project>/.cline/commands/` (project-level wins).
- **Per-project skill scoping**: see [Self-Improvement](Self-Improvement) for how `.bizar/PROJECT.md` records which skills are available where.

---

## Memory Commands

The `bizar memory <sub>` command family manages the local-first Memory Service vault. The default mode is `local-only` (per-project vault at `<project>/.obsidian/`); opt into `managed` mode to share memory across projects via a Git repo at `~/.local/share/bizar/memory/<repoName>/`.

| Subcommand | Purpose | Example |
|---|---|---|
| `init` | Create `.bizar/memory.json` and the project's vault | `bizar memory init --memory-mode local-only` |
| `status` | Show mode, link target, dirty files, last sync time | `bizar memory status` |
| `link` | Bind the project to a managed memory repo | `bizar memory link ~/.local/share/bizar/memory/work/` |
| `unlink` | Detach from managed mode (vault stays on disk) | `bizar memory unlink` |
| `pull` | `git pull` the linked memory repo | `bizar memory pull` |
| `commit` | Stage dirty notes, run secret scan, `git commit` | `bizar memory commit -m "add auth ADR"` |
| `push` | `git push` the linked memory repo | `bizar memory push` |
| `sync` | pull → reindex → commit → push (the common path) | `bizar memory sync` |
| `reindex` | Rebuild the derived LightRAG index (Phase 2 stub) | `bizar memory reindex` |
| `conflicts` | List notes with merge conflicts awaiting resolution | `bizar memory conflicts` |
| `doctor` | Run schema + secrets + Git health checks | `bizar memory doctor` |

All write operations run the secret scanner (12 patterns, HIGH/MEDIUM). HIGH-severity matches block the commit; MEDIUM matches warn but allow. Required frontmatter is 8 fields (`memory_id`, `type`, `project_id`, `status`, `confidence`, `created`, `updated`, `tags`); 11 memory types are recognized.

### Dashboard REST endpoints

The Bizar dashboard exposes 18 REST endpoints under `/api/memory/*` for programmatic note CRUD, search, schema validation, secret scanning, Git sync, and health checks. The legacy `/api/obsidian/*` routes are preserved with back-compat response shapes.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/memory/status` | GET | Mode, link target, dirty count, last sync |
| `/api/memory/notes` | GET | List notes (filter by namespace, type, status) |
| `/api/memory/notes` | POST | Create a new note (validates frontmatter, scans secrets) |
| `/api/memory/notes/:id` | GET | Read a single note by `memory_id` |
| `/api/memory/notes/:id` | PUT | Update a note (validates, scans, increments `updated`) |
| `/api/memory/notes/:id` | DELETE | Archive a note (sets `status: archived`) |
| `/api/memory/search` | GET | Search notes by tag, type, status, full-text body |
| `/api/memory/schema/validate` | POST | Validate a note against the schema; return errors |
| `/api/memory/secrets/scan` | POST | Scan a note body for HIGH/MEDIUM secrets; return matches |
| `/api/memory/git/pull` | POST | `git pull` the linked memory repo |
| `/api/memory/git/commit` | POST | Stage + secret scan + `git commit` |
| `/api/memory/git/push` | POST | `git push` the linked memory repo |
| `/api/memory/git/sync` | POST | Full sync: pull → commit → push |
| `/api/memory/git/conflicts` | GET | List notes with unresolved merge conflicts |
| `/api/memory/reindex` | POST | Rebuild the derived LightRAG index (Phase 2 stub) |
| `/api/memory/link` | POST | Bind the project to a managed repo path |
| `/api/memory/unlink` | POST | Detach from managed mode |
| `/api/memory/doctor` | GET | Run all health checks; return pass/fail per check |

Legacy back-compat routes (`/api/obsidian/*`) accept the same payloads but return response shapes matching the pre-v3.24.0 Obsidian API. New integrations should target `/api/memory/*` directly.

---

## See also

- [Plans Command](Plans-Command) — the original (pre-plugin) plan CLI
- [Bizar Plugin](Bizar-Plugin) — the underlying tool surface
- [Background Agents](Background-Agents) — the `bizar_*` tools
- [Self-Improvement](Self-Improvement) — the `.bizar/AGENTS_SELF_IMPROVEMENT.md` log
- [Quick Start](Quick-Start) — your first 10 minutes
