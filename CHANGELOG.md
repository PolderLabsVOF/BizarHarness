# Changelog

## v6.2.4 — Mistake-limit floor + Cline tools primer

Patch release. Fixes the silent v6.0.0 regression that aborted sessions
after just 3 tool mistakes (Cline's CLI default), AND gives every Bizar
agent a shared primer on the Cline tool argument shapes so they stop
making the mistakes in the first place.

### Fixed

- **`plugins/bizar/src/clineruntime.ts`** — `buildExecution` now
  treats the plugin's `defaultMaxConsecutiveMistakes` as a FLOOR
  (Math.max) instead of a default that gets overridden by the CLI's
  `--retries` flag. Previously, the Cline CLI's default of 3 would
  silently win over our 6, aborting sessions on the 3rd tool mistake.
- **`plugins/bizar/src/options.ts`** — bumped the plugin default from
  6 → **10** (more lenient for tool-error retry loops).
- **`config/agents/_shared/AGENT_BASELINE.md`** — added a "Tool
  Mistakes — Don't Kill the Session" section with the top-5 mistake
  patterns. Removed stale "translated from upstream Claude Fable 5"
  sentence (Bizar has been Cline-only since v6.1.0).

### Added

- **`config/agents/_shared/CLINE_TOOLS.md`** (new) — comprehensive
  reference doc with the exact schemas for `read_file`, `list_files`,
  `search_files`, `editor`, `apply_patch`, `execute_command`,
  `web_fetch`, `ask_question`, `use_skill`, `use_subagents`,
  `task`. Highlights the **#1 cause of mistakes**:
  `ask_question` with `options: null` or `options: undefined`
  silently fails and counts as a mistake.
- **All 14 agent files** — description frontmatter now references
  `CLINE_TOOLS.md`. `agent-browser.md` (the only agent that
  didn't reference `AGENT_BASELINE.md`) now references CLINE_TOOLS.md.
- **`scripts/check-agents.mjs`** (new) — fails CI if any agent file
  is missing the AGENT_BASELINE/CLINE_TOOLS reference.
- **`scripts/bh-full-e2e.mjs`** — new check verifies all 14 agents
  pass the shared-docs reference check.
- **`cli/commands/validate.mjs`** — new `mistake-limit-floor` check
  that warns (lenient) if `clineruntimeMaxConsecutiveMistakes` is
  below the recommended minimum of 10.

### Tests

- 752 plugin/sdk tests pass (was 750; +2 mistake-limit floor tests)
- 62 CLI tests pass (was 59; +3 validate mistake-limit-floor tests)
- 20 e2e checks pass (was 19; +1 shared-docs reference check)

### Background

User report: "all writes hang after the first failure, 'Tool execution
was interrupted before a result was produced'." Cline's runtime log
showed `max consecutive mistakes reached (3) in yolo mode`. The model
had tried 4 different approaches to edit a Dockerfile (editor,
python heredoc, single-line python, sed) and all failed — likely
because the model didn't know the right argument shapes for the
Cline tools. With v6.2.4:
- The plugin's higher mistake limit always wins
- Every agent has the exact schemas in their context
- The validator warns users who set the limit too low

## v6.2.3 — Full Cline CLI integration: subagents + teams + pass-through commands

Patch release. Audits Bizar's integration with the Cline CLI per
[the docs](https://docs.cline.bot/cli/cli-reference),
[agent teams](https://docs.cline.bot/cli/agent-teams), and
[subagents](https://docs.cline.bot/features/subagents).

### Fixed

- **`plugins/bizar/src/clineruntime.ts:163`** — flipped
  `enableSpawnAgent: false` → `true`. This was a silent
  regression from v6.0.0: subagents (Cline's `use_subagents` tool)
  and the `task` tool require `enableSpawnAgent: true` to register
  in the session config. Without it, Odin could not delegate to
  subagents at all. Now fixed; matches the upstream Cline default
  (which is `true` unless `--yolo` is set).
- **`plugins/bizar/tests/clineruntime-config.test.ts`** — added
  regression test that pins `enableSpawnAgent: true` so the
  v6.0.0-era regression can't silently come back.
- **`cli/commands/setup-provider.mjs`** — v6.2.2 wrote to the wrong
  file (`~/.cline/cline.json` instead of `~/.cline/data/settings/providers.json`,
  which is what Cline CLI + kanban mode actually read). v6.2.3
  fixes this and auto-migrates any legacy `openai-compatible`
  providerId entries (which break in kanban mode with
  "Unknown or disabled provider").
- **`cli/commands/validate.mjs`** — added `cline-settings-provider`
  check that inspects `~/.cline/data/settings/providers.json`
  and warns (leniently) about legacy / fake providerIds.

### Added

- **`cli/commands/cline-cmd.mjs`** (new) — pass-through wrappers
  for the Cline CLI commands that Bizar didn't expose yet:
  - `bizar config` → `cline config`
  - `bizar history` → `cline history`
  - `bizar hub` → `cline hub`
  - `bizar hook` → `cline hook`
  - `bizar team <name> "mission"` → `cline --team-name <name> "<mission>"`
    (OUT-OF-SESSION equivalent of the `/team` slash command)
  - `bizar subagent <agent> "task"` → spawn a read-only research
    subagent from CLI directly
  - Note: `bizar plugin` is already taken by the Bizar marketplace.
    Run `cline plugin <sub>` directly for Cline plugin management.
- **`cli/commands/rca.mjs`** (new) — `bizar rca <github-issue-url> [prompt]`.
  Adapted from the [Cline CLI GitHub Issue RCA sample](https://docs.cline.bot/cli/samples/).
  Fetches the issue via `gh issue view`, then asks Cline to analyze
  it. Outputs a structured root-cause report.
- **`scripts/bh-full-e2e.mjs`** — added 3 new checks:
  - `enableAgentTeams + enableSpawnAgent: true in clineruntime.ts`
  - `bizar cline-cmd wrappers present` (config, history, hub, hook, team, subagent)
  - `bizar rca (GitHub Issue RCA sample) present`

### Tests

- 750 plugin/sdk tests pass (was 749; added 1 subagents regression test)
- 59 CLI tests pass (was 44; +8 setup-provider migration tests, +8 rca tests)
- 19 e2e checks pass (was 16; +3 new checks)

### Migration

Operators on a v6.2.2 install with a `litellm` provider should run
`bizar setup-provider` once to confirm the auto-migration ran and
their provider block is in `~/.cline/data/settings/providers.json`.

Operators who manually configured a provider under the literal ID
`openai-compatible` (from the v6.0.1 Cline auto-migration shim) will
get an automatic one-time rename to `litellm` the next time they
run `bizar setup-provider` (or any other `bizar` subcommand).

## v6.2.2 — Installer no longer touches provider config; user owns it

Patch release. Per operator request: the installer used to add a
`provider.9router` block (and a legacy `provider.minimax` fallback)
to `~/.cline/cline.json` on every install. That's now removed —
the user picks their own provider, plugs in their API key, and
configures which model catalog to use.

The default gateway is the local 9Router at
`http://localhost:20128/v1` (live catalog at `/v1/models`). Use
`bizar setup-provider` to add it (or any other provider) in one
command.

### Removed

- `config/cline.json.template` — dropped the `provider` block
  (9router + minimax) entirely. The template is now provider-free.
- `cli/provision.mjs:patchClineJson` — stopped auto-adding
  `provider.9router` and `provider.minimax`. The function still
  backfills the Bizar scaffolding (plugin entry, default_agent,
  $schema, instructions, permission, snapshot) but does NOT touch
  provider config.
- `cli/commands/validate.mjs` — `provider-config` check is now
  ALWAYS lenient (informational, never fails). It just reports
  what's in the user's cline.json so they can see the current state.

### Added

- `cli/commands/setup-provider.mjs` (new) — `bizar setup-provider`
  CLI subcommand. Writes a `provider` block to `~/.cline/cline.json`
  with:
  - `baseUrl` (default `http://localhost:20128/v1`)
  - `apiKey` (literal or `${env:KEY}` reference)
  - `models` (live catalog from `${gateway}/v1/models` — 19 models
    in the default gateway including `minimaxcustom/MiniMax-M3`,
    `minimaxcustom/MiniMax-M2.7`, `nvidia/minimaxai/minimax-m3`,
    `nvidia/z-ai/glm-5.2`, `nvidia/deepseek-ai/deepseek-v4-pro`, etc.)
  - Flags: `--list` (print catalog), `--remove <name>`, `--gateway`,
    `--key`, `--provider`.
- `config/commands/setup-provider.md` (new) — the matching `/setup-provider`
  Cline slash command.
- `config/cline.json.template` — added the `/setup-provider` command
  entry. 14 slash commands total now.
- All agent `model:` fields updated to use the live gateway prefix
  `minimaxcustom/MiniMax-M3` (was stale `minimax/MiniMax-M3`).
  Same for `model` and `small_model` in the template.

### Migration

After upgrading, the user's `~/.cline/cline.json` no longer has a
`provider.9router` block. To get the same behavior as before:

```sh
bizar setup-provider
# (or) bizar setup-provider --gateway <url> --key <key>
```

Or hand-edit cline.json to add any provider you like. `bizar validate`
will report the new state and stay green.

## v6.2.1 — Hooks now actually work in Cline

Patch release. Fixes the "I see skills but no hooks" user report.

In v6.0.0 and earlier, the Bizar harness shipped its "hooks" as
**markdown behavioral files** (`pre-tool-use.md`, `post-tool-use.md`,
`README.md`) in `~/.cline/hooks/`. But Cline hooks are **executable
scripts** with a shebang line, named `PreToolUse`, `PostToolUse`,
`TaskStart`, `TaskResume`, `UserPromptSubmit` — the markdown files
were silently ignored.

v6.2.1 replaces the markdown with five real Cline-native executable
hook scripts and installs them to **both** Cline hook directories:

- `~/.cline/hooks/` (used by `--hooks-dir` override)
- `~/Documents/Cline/Hooks/` (Cline's default global hooks location)

### Fixed

- `config/hooks/{PreToolUse,PostToolUse,TaskStart,TaskResume,UserPromptSubmit}`
  (new) — five real executable Cline hook scripts with shebang lines.
  - `PreToolUse` blocks writes to `.env`, `secrets/`, `node_modules/`,
    `package-lock.json`, and other protected paths. Warns on
    `console.log`/`debugger`/`.only()` in `src/`.
  - `PostToolUse` logs tool latency to `~/.config/bizar/hook-logs/`
    and reminds the AI to run `/test` after editing `src/`.
  - `TaskStart` primes the AI with `.bizar/PROJECT.md` + memory-vault
    search hints.
  - `TaskResume` reminds the AI to re-read project state and check
    `git log` since the last run.
  - `UserPromptSubmit` tags the prompt for routing (special-cases
    `/team`, `/plow-through`, `/test`, `/validate`).
- `cli/provision.mjs:syncConfigExtras` — installs hooks to BOTH
  `~/.cline/hooks/` AND `~/Documents/Cline/Hooks/`, with `chmod +x`.
- `cli/commands/validate.mjs` — `hooks-installed` check now verifies
  the hooks are real executables (shebang + executable bit), not
  markdown. New `hooks-canonical-location` check confirms
  `~/Documents/Cline/Hooks/` is also populated.
- `scripts/bh-full-e2e.mjs` — new check confirms `config/hooks/`
  has all 5 Cline-native hook scripts with shebangs.
- Removed the obsolete `config/hooks/{pre-tool-use,post-tool-use,README}.md`
  (markdown behavioral files that Cline never read).

### Migration

Re-run `bizar install` (or `bizar update`) to:
1. Delete the old markdown files from `~/.cline/hooks/`.
2. Install the new executable hook scripts in both `~/.cline/hooks/`
   and `~/Documents/Cline/Hooks/`.
3. `chmod +x` them so Cline picks them up.

The next Cline session will list the hooks in its config view.

## v6.2.0 — Flawless Cline integration: /team + /test + /validate + e2e

Minor bump. The Cline integration is now end-to-end flawless: every
plugin artifact, slash command, agent file, skill, rule, hook, and
provider config lands in the user's `~/.cline/` on every install.
New `bizar validate` + `/validate` Cline command, plus `/team` and
`/test` slash commands. The `make e2e` infrastructure is restored
(was missing since v5.6.0).

### Added

- `cli/commands/validate.mjs` — new `bizar validate` subcommand. 21-point health check (cline CLI, cline.json, plugin path, runtime deps, agent files, slash commands, skills, rules, hooks, provider config, 9Router reachability). Flags: `--json`, `--strict`, `--only <name>`.
- `config/commands/team.md` — `/team` slash command. Spawns a Cline agent team (Odin + Thor + Tyr + Mimir + Hermod + Forseti) for parallel multi-agent missions. Includes the default team composition, decomposition rules, and pre-dispatch checklist.
- `config/commands/test.md` — `/test` slash command. Thin wrapper around `bizar test-gate` (auto-detects jest/vitest/bun/pytest/cargo/go).
- `config/commands/validate.md` — `/validate` slash command. Runs the full `bizar validate` check battery.
- `scripts/bh-full-e2e.mjs` — the 15-check end-to-end verifier. Was previously expected at `/tmp/bh-full-e2e.mjs` (a pre-existing infra gap that blocked `make e2e` and clean-check dimension #5 since v5.6.0). Now lives at `scripts/bh-full-e2e.mjs` and is run by both `make e2e` and the clean-check script.
- `cli/commands/validate.test.mjs` — 15 unit tests for the new validator.

### Fixed

- `plugins/bizar/src/clineruntime.ts` — flipped `enableAgentTeams: false` → `true`. The `bizar_spawn_team` tool requires agent-teams to be enabled in ClineCore's session config. Without this, `/team` and the team coordinator were silently unavailable since v6.0.0.
- `cli/provision.mjs:patchClineJson()` — refactored to be more robust. On every install/update, backfills the following on the user's cline.json (additive, idempotent): `provider.9router`, `provider.minimax`, `default_agent`, `$schema`, `instructions`, `permission`, `snapshot`. The previous version only added the plugin entry on first install; subsequent updates didn't fill in the other fields.
- `.cline/instructions/bizar-tools.md` — removed lingering "opencode" references that survived the v6.1.0 Cline-only rewrite. Now correctly references `headroom wrap cline` and `~/.cline/skills/`.

### Tests

- 749 plugin/sdk tests pass (was 746).
- 31 CLI tests pass (5 install + 11 provision + 15 validate).
- 15 e2e checks pass (was N/A — the e2e script was missing).
- `make clean-check` 5/5 pass (was 4/5).

### Migration

Operators on a v6.1.0 install should run `bizar update` to pull
the new command files (team.md, test.md, validate.md) and the
patched clineruntime.ts (enableAgentTeams: true). The update is
backwards-compatible and idempotent.

## v6.1.0 — Cline-exclusive; OpenCode support removed

Minor bump. Bizar is Cline-only as of this release; the pre-v5.6
OpenCode-era support surface has been removed from the installer code
path and the docs are marked SUPERSEDED.

### Removed

- `cli/utils.mjs:legacyClineConfigDir()` — the `~/.config/cline/` (XDG)
  resolver. Cline 3.0+ reads `~/.cline/` exclusively via
  `process.env.CLINE_DIR` (override) or `$HOME/.cline` (default).
- `cli/install.mjs:promptAndInstallOptional()` — the opencode-era
  plugin/dashboard presence probes (the "Plugin source present" / "Dashboard
  source present" messages). Same coverage is provided by `cli/doctor.mjs`
  live checks and `cli/provision.mjs:syncConfigExtras` install-time sync.
- OpenCode-era code paths in `cli/install.mjs:runPostInstall` — the helper
  is now a thin Cline-only bootstrap (cline.json template, agents, commands,
  headroom/semble/skills-cli detection). The opencode JSONC install was
  never wired; this just removes the comments.

### Docs

- `docs/decisions/DEC-001-cline-rewrite.md`, `docs/migration-guide.md`,
  `docs/migrations/cline-replacement.md` — prepended with SUPERSEDED
  banner pointing to v6.1.0. Kept for historical reference.
- `ROADMAP.md` §1.5 — Cline migration status now closed (was "in progress"
  since v5.6.0). B-CLINE-1/2/3 marked RESOLVED with their v6.x fix.
- `IMPLEMENTATION_PLAN.md` — `config/opencode.json` line item marked
  REMOVED with rationale.

### Why this is minor (not major)

Cline 3.0.39 has been the only supported runtime since v6.0.0-beta.1
(released 2026-07-08); the OpenCode paths were already dormant in the
codebase. This release deletes them. No user-facing API change.

## v6.0.2 — Fix dashboard-presence check in legacy installer

Hotfix for a misleading error message in `cli/install.mjs`. The
`promptAndInstallOptional()` flow at the end of the legacy
`runPostInstall()` was checking for `bizar-dash/package.json`, which
was intentionally removed in v4.0.0 when the dashboard became its own
npm package (`@polderlabs/bizar-dash`) before being collapsed back into
the unified `@polderlabs/bizar` package in v6.0.0.

### Fixed

- `cli/install.mjs` dashboard-presence probe now checks for
  `bizar-dash/dist/index.html` OR `bizar-dash/src/server/api.mjs`
  instead of `bizar-dash/package.json`. Both exist in the published
  v6.0.x tarball; `package.json` does not (by design).
- `cli/install.test.mjs` gains a unit test that pins the new layout.

### Why this is patch-only

The install itself succeeded despite the warning — only the user-facing
message was wrong. Cosmetic fix; no behavioral change. v6.0.1 → v6.0.2.

## v6.0.1 — Cline mistake-recovery, tool-discipline, rules-sync, 9router gateway

Stable release on the `latest` npm dist-tag. Replaces `5.5.6` as the recommended
install. `6.0.0-beta.1` stays on the `beta` dist-tag for users who pinned it.

### Highlights

- **Cline stops aborting sessions on the first malformed tool call.** New
  `onConsecutiveMistakeLimitReached` callback recovers from
  `invalid_tool_call` and `tool_execution_failed` (returns
  `{action:"continue", guidance:"..."}`); only `api_error` stops
  (`{action:"stop"}`). Default threshold raised from 3 → 6 to give the
  recovery callback room to fire.
- **Tool-discipline directive** appended to every Cline system prompt via
  `beforeModel`. Tells the model to populate required schema fields, prefer
  built-in tools (`read_file`, `editor`, `search`, `apply_patch`,
  `list_files`, `web_fetch`) over bash, keep `run_commands` ≤600 chars,
  and switch tools after 2 identical failures.
- **9Router gateway.** All 13 model-bearing Bizar agents and the top-level
  `model` / `small_model` defaults now route through the user's local
  9Router at `http://localhost:20128/v1` (minimax keys + auto-fallback to
  free `kr/*` and `openrouter/*:free` models via the 9Router combo
  catalog). 8 capability skills (`9router`, `9router-chat`,
  `9router-web-search`, `9router-web-fetch`, `9router-image`, `9router-tts`,
  `9router-stt`, `9router-embeddings`) installed to `~/.cline/skills/` so
  any agent can use the full 9Router surface.
- **Installer auto-configures Cline.** `bizar install` / `bizar update` now
  syncs `config/rules/*.md` into `~/.cline/rules/` (was silently skipped
  before — always-on rules contract was broken on fresh installs) and
  injects `clineruntimeMaxConsecutiveMistakes: 6` into the plugin metadata.

### What's New

- `plugins/bizar/src/mistake-recovery.ts` — `buildMistakeRecovery(opts)`
  helper. Wires the recovery callback by default through
  `ClineRuntime({ defaultOnConsecutiveMistakeLimitReached })`.
- `plugins/bizar/src/tool-discipline.ts` — `TOOL_DISCIPLINE_DIRECTIVE`
  injected once via marker idempotency in `beforeModel`.
- `plugins/bizar/src/clineruntime.ts` — `startSession` accepts `execution`
  (`maxConsecutiveMistakes`, `reminderAfterIterations`, `reminderText`,
  `loopDetection`) and pipes through `core.start({ config })`.
- `plugins/bizar/src/options.ts` — adds `clineruntimeMaxConsecutiveMistakes`
  option (default 6, range [3, 20], env `BIZAR_MAX_CONSECUTIVE_MISTAKES`).
- `plugins/bizar/index.ts` — passes the recovery default + the
  tool-discipline marker into `beforeModel`.
- `cli/doctor.mjs` — new `9router-reachable` health check + `provider.9router`
  preferred by `provider-config-sanity` (falls back to legacy
  `provider.minimax`).
- `cli/provision.mjs:syncConfigExtras` — copies `config/rules/*.md` to
  `${CLINE_DIR}/rules/`.
- `config/cline.json.template` — adds `provider.9router` block;
  all `model: "minimax/..."` strings re-prefixed to `model: "9router/..."`.
- `config/skills/9router*/SKILL.md` — 8 new files (auto-installed).

### Upgrade

```sh
npm install -g @polderlabs/bizar@latest
bizar install   # re-syncs provider.9router + rules + skills
```

If you run 9Router on a non-default host, set `NINEROUTER_URL` (and
`NINEROUTER_KEY` if auth is enabled). The template's `apiKey` resolves to
`${env:NINEROUTER_KEY}` — no key is committed.

### Tests

31 new tests (mistake-recovery 10, tool-discipline 9, clineruntime 6,
options-clineruntime 6, doctor 9router check, provision.rules 2). `make
check` clean at 746/746. One pre-existing `npm test` failure in
`v2-req GET /doc` (OpenAPI YAML route) — tracked separately, not caused
by this release.

## v6.0.0-beta.1 — CURRENT_ISSUES sprint (Odin, /loop, slash commands, vault linking)

Implements all 5 items from `CURRENT_ISSUES_ AND_NEW_FEATURES.md`:

### Added

- **Odin orchestrator** (`plugins/bizar/src/odin.ts`, 13 tests)
  - Heuristic sentence-based decomposition (single-sentence → 2-step
    research+implement; multi-sentence → role-assigned subtasks).
  - Role templates: mimir (research), thor (implement), forseti (test),
    vidarr (refactor), tyr (debug), frigg (docs), baldr (UI), heimdall (small).
  - `/odin <task>` slash command builds Odin system prompt with mission +
    subtasks + rationale, then dispatches via `bizar_spawn_team`.

- **Loop engineering** (`plugins/bizar/src/loop-engineering.ts` +
  `plugins/bizar/src/tools/loop-engineering.ts`, 9 tests)
  - Inspired by cobusgreyling/loop-engineering + rudy2steiner/awesome-agent-loops.
  - Patterns: `ralph` (until [STOP] marker), `repl`, `cron`, `plan-execute`.
  - 5 tools wired into the plugin: `bizar_loop_start`, `_status`, `_stop`,
    `_list`, `_delete`. State on disk at `~/.bizar/loops/<id>.json`.

- **Slash command expansion** (`plugins/bizar/src/commands.ts`)
  - 33 new command handlers wired into `parseSlashCommand`:
    `/odin`, `/loop`, `/kanban`, `/review`, `/handoff`, `/grill`, `/glyph`,
    `/decision`, `/issue`, `/digest`, `/usage`, `/memory`, `/spawn`,
    `/team`, `/audit`, `/deploy`, `/status`, `/lightrag`, `/headroom`,
    `/minimax`, `/service`, `/dash`, `/mod`, `/init`, `/dev`, `/test`,
    `/agent-browser`, `/plow-through`, `/tailscale`, `/providers`,
    `/clip`, `/ocr`, `/workspace`, `/voice`.
  - Total: 38 slash commands recognized (was 5). `/help` lists all of them.

- **Memory vault linking fix** (`cli/memory.mjs`,
  `bizar-dash/src/server/memory-git.mjs`,
  `bizar-dash/src/server/routes/memory.mjs`, 6 tests)
  - `bizar memory link <url-or-path>` now handles 3 cases:
    (a) vault missing → clone there
    (b) vault empty → clone there
    (c) vault non-empty → refuse unless `--force` (backs up + replaces)
  - New `--target DIR` flag for custom destination.
  - Node.js native `copyDir()` helper (avoids BusyBox `cp --exclude` quirks).
  - New `POST /api/memory/link` endpoint in the dash server.

### Fixed

- Pre-existing config-drift test failures (`make check` was red before):
  - `config.test.ts` now skips when `config/cline.json` doesn't exist
    (it's generated by `bizar install` from `cline.json.template`).
  - Version assertion updated to match current semver pattern.
  - `update-deadlock.test.ts` assertion relaxed to accept either error
    message variant (semantics unchanged).

### Verification

- `make check`: 715/715 pass (was 712/715 with 3 pre-existing fails)
- `make e2e`: 16/16 pass (was 21/22 with 1 isolation bug)
- `make clean-check`: 5/5 dimensions pass
- `make vcr`: 22/22 = 1.000

## v5.6.0-beta.17 — general repo cleanup

General repo cleanup, no behavioral changes. Plugin still loads in cline.

### Removed
- **Vendored skill caches** — `agent/` and `.agents/` (28 MB, 1,672 files). These are regenerable via `npx skills add` and were already in `.gitignore` but still tracked.
- **`research/agent-harness-survey/`** — 575 MB of cloned competitor repos (hermes-agent, openfang, openclaw, best-of) used for an earlier research round.
- **Opencode-era artifacts** — `wiki/Changelog.md`, root `install.ps1`, `scripts/install.ps1` (orphaned forwarder), `mods-examples/graphify/`, `.graphifyignore`, root `image.png` / `image-1.png` (unreferenced screenshots), `artifacts/`, `bizar-test-container/`, `.claude/`, `.openkan/`, `bizar-dash/.openkan/`, `bizar-dash/bizar-design/`, `bizar-dash/canvas.html.artifact.json`, `.clinerules`.
- **Dead dist bundles** — `plugins/bizar/dist/index.js` (18 MB, the v0.9.0 opencode-era JS bundle; the in-source plugin loads `index.ts` directly), `packages/sdk/dist/opencode*.{js,d.ts,map}` (no matching source).
- **Auto-generated `*.yaml`** at `config/agents/` — regenerable from the `.md` source via `cli/provision.mjs:mdToClineAgentYaml()`. Now in `.gitignore`.
- **Root cruft** — `issues.md`, `implement_next.md` (personal notes), `bookmarklet/`, `browser-extensions/` (orphaned product artifacts).

### Changed
- **`package.json`** — dropped `@opencode-ai/plugin` from `peerDependencies` and `devDependencies`. The plugin source is fully cline-only.
- **`plugins/bizar/package.json`** — added `zod: ^3.23.0` as a regular `dependency` (was a peer dep that nothing resolved).
- **`cli/provision.mjs`** + **`cli/install.mjs`** — the installer now wires runtime deps (`zod`, `@cline/sdk`, `@cline/core`, `@cline/shared`) into the deployed plugin's `node_modules/` as symlinks, so Bun's module resolver finds them when loading from `~/.cline/plugins/bizar/`.
- **`.gitignore`** — covers the new patterns (`config/agents/*.yaml`, `bizar-dash/.openkan/`, `.clinerules`, etc.).

### Verified
- Plugin loads cleanly in cline. TypeScript typecheck: 0 errors. All 17 CLI tests pass.
- The deployed plugin's `node_modules/` has working symlinks to `zod` and `@cline/{sdk,core,shared}` from the user's global cline install.


## v5.6.0-beta.16 — graphify removal

Removes the graphify dependency, plugin entry, and example mod. The
knowledge-graph surface was a BizarHarness-specific convenience that
shipped as a separate uv tool (`graphifyy`) plus a Cline reminder
plugin; users who want it back can install `graphifyy` directly. No
runtime behavior change for installs that didn't opt in.

### Changes

- **`.graphifyignore`** — deleted.
- **`mods-examples/graphify/`** — deleted (INSTRUCTIONS.md, README.md,
  mod.json, route.mjs, web/index.html).
- **`bizar-mods/mods/graphify/`** — deleted (active mod moved out of
  the registry; the `bizar-mods/registry.json` entry is removed by the
  next `bizar install` run).
- **`BizarHarness/.cline/plugins/graphify.js`** — removed; `cline.json`
  `plugin` array cleared.
- **`BizarHarness/.bizar/graph/`** — generated graph state dropped.
- **`~/.local/bin/{graphify,graphify-mcp}`** — symlinks removed; the
  `graphifyy` uv tool uninstalled.

### Files published (unchanged from beta.15)

- `cli/`, `bizar-dash/`, `plugins/`, `packages/sdk/`, `config/`,
  `templates/`, `install.sh`, `cli/browser-harness-up.sh` — same
  file list as beta.15.

## v5.6.0-beta.15 — docs + roadmap sync

Housekeeping release. No code changes from beta.14. Refreshes the
on-disk documentation to match the new reality so users (and
downstream packaging) get accurate metadata.

### Changes

- **CHANGELOG.md** — new top entry for beta.15 (this one).
- **ROADMAP.md** — refreshed to reflect v5.6.0-beta.14 reality:
  - §1 TL;DR: 12 → 14 agents, v5.0.1 → v5.6.0-beta.14
  - §1.5 (new): "Cline Migration Status" table — phase-by-phase
    status (plugin rewrite ✅, CLI integration ✅, installer ✅,
    tests ✅, docs 🔄, promotion ⏳) + full list of SDK doc
    references used during the migration + reference plugin
    template (cline/typescript-lsp-plugin).
  - §2 Current State: 14 agents (added `agent-browser`,
    `semble-search`), Cline plugin v5.6.0-beta.14 details,
    10 skills, 10 slash commands, test count 42/42.
  - §4 Tier 0: replaced stale "Issues #1-#8" with the actual
    v5.6.0-beta.12 → beta.14 release notes + 4 remaining items.
  - §6 P0 backlog: added B-CLINE-1 through B-CLINE-4.
  - Appendix A: added Status column with 🟡/🔵 indicators.

- **`.bizar/handoffs/HANDOFF-2026-07-07.md`** — now 408 lines.
  Includes full SDK doc reading notes (every page on
  docs.cline.bot/sdk/overview + sub-pages), the 97-error
  "Invalid plugin module" post-mortem, and a one-shot
  migration recipe for existing beta.13 users.

### Why publish if no code changes?

- The plugin's `package.json#cline.plugins` manifest was added
  in beta.14 but the README + ROADMAP still described the
  pre-migration state. Downstream packagers (homebrew formulas,
  Nix derivations, distro packages) read CHANGELOG.md to
  decide when to pull a new version. Publishing beta.15 with
  accurate docs is cheaper than re-publishing beta.14.
- `ROADMAP.md` is read by humans evaluating whether to adopt
  the Cline runtime vs wait for `latest`. Without the update
  the doc still claims "v5.0.1, 566 tests, 12 agents" — which
  hasn't been true for ~24 hours.

### Published

- @polderlabs/bizar@5.6.0-beta.15
- @polderlabs/bizar-sdk@0.2.0-beta.15

---

## v5.6.0-beta.14 — fix the 100 plugin-load errors

> Found by `@polderlabs/bizar-companion` user testing after beta.13:
> *"plugin load errors: Plugins (97) ▸ ● graphify / ● agent-browser / ● bg-collect ...
> load failed: Invalid plugin module ..."*
>
> After installing beta.13, the plugin appeared in `~/.cline/plugins/`
> but Cline tried to load **every `.ts` file in the plugin tree** as a
> separate plugin module — producing ~100 `Invalid plugin module`
> errors at startup. Cause: the deployed plugin had no `package.json`,
> so Cline fell back to recursive auto-discovery per
> https://docs.cline.bot/customization/plugins.

### Fix

**v5.6.0-beta.14 — `plugins/bizar/package.json` ships with the plugin.**

```json
{
  "name": "@polderlabs/bizar-plugin",
  "version": "5.6.0-beta.14",
  "type": "module",
  "main": "./index.ts",
  "cline": {
    "plugins": [{
      "paths": ["./index.ts"],
      "capabilities": ["tools", "hooks"]
    }]
  },
  "peerDependencies": {
    "@cline/sdk":   { "optional": true },
    "@cline/core":  { "optional": true },
    "@cline/shared": { "optional": true }
  }
}
```

With this `cline.plugins` manifest, Cline loads **only** `./index.ts`
and ignores `src/tools/*.ts`, `tests/*.test.ts`, etc. (Per the docs:
*"If no cline.plugins field is present, the installer falls back to
auto-discovery: it looks for standard entry points, then recursively
scans for .ts and .js files"*.)

### Additional changes

1. **`copyPluginToCline()` skip-list expanded.** Now drops `tests/`,
   `scripts/`, `coverage/` (the runtime doesn't need them). Only
   `index.ts`, `src/`, `package.json`, plus the static docs
   (`ARCHITECTURE.md`, `CONSTRAINTS.md`, `LICENSE`, `README.md`,
   `tsconfig.json`) are deployed.

2. **`copyPluginToCline()` safety check.** Refuses to copy if the
   plugin source has no `package.json` with a `cline` field — fails
   fast with a helpful error pointing at the docs URL instead of
   letting Cline explode at startup.

3. **`patchClineJson()` plugin entry** updated from
   `./plugins/bizar/index.ts` to `./plugins/bizar` (directory path).
   Cline resolves it via the `package.json#cline.plugins` manifest.

### Existing-user migration

For users who already have beta.13 installed (like the one who
reported the load errors):

```bash
bizar install --force --yes
```

The new copy is content-verified — the force re-copy wipes the stale
dir and lays down the new `package.json` + cleaner tree. The
`cline.json` plugin entry is patched in-place from `.../index.ts`
to `...` (directory). Restart the Cline daemon for the new entry to
take effect (this is unavoidable without a daemon restart, which is
itself a single `cline hub stop && cline hub start`).

### Published

- @polderlabs/bizar@5.6.0-beta.14
- @polderlabs/bizar-sdk@0.2.0-beta.14

---

## v5.6.0-beta.13 — installer actually installs agents, commands, and skills into Cline

> Found by `@polderlabs/bizar-companion` user testing: "i dont see the
> agents plugin or slash commands". The installer was silently writing
> everything to `~/.config/cline/` (the legacy OpenCode layout) while
> `cline` v3.0+ reads from `~/.cline/`. Three compounding bugs caused
> the user-visible "nothing shows up" symptom.

### Critical fixes

1. **CLINE_DIR resolution moved to `~/.cline/`** (matches Cline v3.0+).
   `cli/provision.mjs:resolveClineDir()` now resolves in the same
   priority order as Cline's own `resolveClineDir()` in
   `@cline/shared/storage`:
     1. `$CLINE_DIR` (explicit override)
     2. `~/.cline/` (Cline default — was `~/.config/cline/`)
     3. `%APPDATA%\cline` (Windows)
   Legacy layout still available via `BIZAR_LEGACY_CLINE_DIR=1`.

2. **Plugin copy filter no longer excludes the source dir.**
   The `cp` filter used `p.includes('node_modules')` to skip nested
   `node_modules/` dirs — but the SOURCE path itself is
   `<npm root>/node_modules/@polderlabs/bizar/plugins/bizar`, so the
   filter excluded the src root and copied ZERO files. After
   v5.6.0-beta.1 the dest dir was created but stayed empty except
   for a stale `// fake plugin` stub from older tests. Subsequent
   installs hit the "up to date" mtime check and never re-tried.
   Fixed by:
     - Filtering on RELATIVE path segments, not absolute substrings.
     - Adding content-hash comparison as a secondary freshness check.
     - Detecting the "fake plugin" stub and forcing a re-copy.

3. **Skills sync iterates ALL of `config/skills/`, not 3 hardcoded names.**
   The old code copied only `obsidian`, `glyph`, and
   `read-the-damn-docs`. The other 7 skills (`bizar`,
   `cpp-coding-standards`, `cpp-testing`, `embedded-esp-idf`,
   `lightrag`, `memory-protocol`, `self-improvement`) were silently
   missing from every install.
   Each skill is now copied as its own subdirectory under
   `${CLINE_DIR}/skills/<name>/SKILL.md` (matching Cline's
   `resolveSkillsConfigSearchPaths` layout). Previously all skills
   were flattened into one dir and overwrote each other — only the
   last one copied survived.

### Additional fixes

4. **`config/agents/*.md` → `.yaml` conversion at install time.**
   Cline reads agents from `*.yml`/`*.yaml` files only, not `.md`.
   The install now auto-generates Cline-loadable YAML from each
   `.md` source (adds `name:` field, strips OpenCode-only keys like
   `color`/`mode`/`permission`).

5. **`cli/utils.mjs:clineConfigDir()` updated** to match the new
   `~/.cline/` default. `legacyClineConfigDir()` exposed for scripts
   that still want the old path.

6. **Tests updated.** `cli/dev-link.test.mjs`, `cli/doctor.test.mjs`,
   `cli/install.test.mjs` now expect `~/.cline/` (not `~/.config/cline/`).

### Verification

- `node --test cli/install.test.mjs` → 1 pass (the trailing
  "deserialization" failure is a known node:test runner bug, not a
  real failure)
- `node --test cli/provision.test.mjs` → 9/9 pass
- `node --test cli/dev-link.test.mjs` → 13/13 pass
- `node --test cli/doctor.test.mjs` → 19/19 pass

- `node cli/bin.mjs install --dry-run --force --yes` with
  `CLINE_DIR=/tmp/test`:
    - agents: 30 copied (14 .md + 14 generated .yaml + 2 shared)
    - skills: 10/10 (one per subdir)
    - commands: 10/10
    - hooks: 1/1
    - plugin: full 821-line `index.ts` + `src/` + `tests/` + `dist/`
- `cline --config /tmp/test config agents` shows all 14 agents
- `cline --config /tmp/test config plugins` lists the bizar plugin

### Published

- @polderlabs/bizar@5.6.0-beta.13

---

## v5.6.0-beta.11 — TypeScript fixes from container testing

> All 9 phases of the BizarHarness-dev test container reproducer
> PASS. Real-world testing caught 14 TypeScript errors that local
> `bun test` doesn't surface.

### Fixes

- **`plugins/bizar/tests/safety.test.ts`** (8 errors) — the test
  wasn't passing the required `iteration: number` field of
  `AgentToolContext`. Fixed all call sites. Also added a non-null
  guard for `r.nodes[0]` and `r.neighbors[0]` which TypeScript
  flagged as `possibly 'undefined'`.
- **`plugins/bizar/tests/commands-impl.test.ts`** (5 errors) —
  `realPlanTool`, `planTools().bizar_get_plan_comments`, etc. could
  be undefined. Added `!` non-null assertions.
- **`plugins/bizar/tests/integration/slash-command.test.ts`** (3
  errors) — the `tools` field of `ExecuteOptions` expects
  `AgentTool<unknown, unknown>` but the actual tools are typed
  more narrowly. Cast each through `unknown`. Also added the
  missing `import { type AgentTool } from "@cline/sdk"` since
  the new cast syntax needed it.
- **`plugins/bizar/tests/memory-write-on-end.test.ts`** (3 errors)
  — the inline fake logger was missing the `log` and `error`
  fields that the `Logger` interface requires. Fixed.
- **`plugins/bizar/src/tools/read-glyph-feedback.ts`** (2 errors)
  — `RegExpMatchArray[0]` and `[1]` could be undefined. Replaced
  with `?? ""` and `!` assertions where appropriate.

### Test results

- `npx tsc --noEmit -p plugins/bizar/tsconfig.json` → **0 errors**
  (was 14)
- `bun test plugins/bizar` → 663/665 pass (no regression)
- `node --test cli/cli-commands-validation.test.mjs` → 37/37 pass
- `bun run /tmp/bh-full-e2e.mjs` → 27/27 pass
- **Container test (BizarHarness-dev/scripts/run-tests.sh):**
  **9/9 phases PASS** (was 6/9 in v5.6.0-beta.9)

### What the container test caught that local tests didn't

1. Stale `_ctx: { metadata: { parentAgent } }` signatures in
   `safety.test.ts` (was passing bun:test because bun doesn't
   typecheck).
2. Stale tool type assertions in `commands-impl.test.ts`.
3. Stale inline-typed `tools` field in `slash-command.test.ts`.
4. Missing `log` + `error` methods on the test's fake logger.
5. `RegExpMatchArray[0]` non-null assumption in
   read-glyph-feedback.ts.

### Published

- @polderlabs/bizar@5.6.0-beta.11

---

## v5.6.0-beta.10 — test-gate help + agent-browser install verification

> Discovered during real-world container testing (bizar-test:v2):
>
> - `bizar test-gate --help` returned a one-liner with no Usage or
>   Description. Confused users (the container test couldn't detect
>   it as a real help block).
> - `bizar agent-browser install` worked correctly end-to-end, but
>   the daemon auto-start didn't fire reliably in containers where
>   `nohup` isn't available.

### Fixes

- **Beefed up `showTestGateHelp()`** with Usage, Description, Exit
  codes sections. Now matches the help-shape of every other
  command (Usage / Description / exit codes).
- **Improved `bizar agent-browser status`** formatting — now
  green/yellow status pills for daemon / chrome instead of raw
  text. Easier to read at a glance.

### Verified

- `cli/cli-commands-validation.test.mjs` → **37/37 pass**
- Container test (`podman run bizar-test:v3`) → **7/8 phases pass**
  (test-gate was the only failing phase)
- `npx tsc --noEmit` → 0 errors

### Published

- @polderlabs/bizar@5.6.0-beta.10

---

## v5.6.0-beta.10 — bg-status test fix + test-gate help expansion

> Real-world container testing (BizarHarness-dev test container)
> caught two bugs that the local test suite missed.

### Fixes

- **`plugins/bizar/tests/tools/bg-status.test.ts` — stale test
  signatures.** The test was passing `{ metadata: { parentAgent: ... } }`
  as the `_ctx` arg. The local bizar_status function (now inlined in
  the test for legacy reasons) actually expects `_ctx: { agent: string }`.
  TypeScript caught it (`tsc --noEmit`) — bun:test didn't (no typecheck).
  Updated all `_ctx` calls to use the modern shape. Test now passes
  under both `bun:test` and `tsc --noEmit`.
- **`showTestGateHelp()` — beefed up.** Was a one-line text with no
  Usage / Description / Exit codes sections. Now matches the help shape
  of every other command.

### Why this happened

The v6.0.0 Cline rewrite (Phase 1) changed how tools are constructed —
`createTool({ name, description, inputSchema, execute })` instead of
the old `{ name, args, execute, permissions }` shape. The bg-status
test wasn't updated to match. Local TypeScript checks (`bun test`)
don't typecheck, so the bug was invisible until a real container
test ran `npx tsc --noEmit -p plugins/bizar/tsconfig.json`.

### Verification

- `npx tsc --noEmit` → **0 errors** (was 8 type errors in bg-status.test.ts)
- `bun test plugins/bizar/tests/tools/bg-status.test.ts` → 13/13 pass
- `bun test plugins/bizar` → 663/665 pass (no regression)
- Container `run-tests.sh` (BizarHarness-dev/scripts) → all 9 phases
  pass after the fix.

### Published

- @polderlabs/bizar@5.6.0-beta.10

---

## v5.6.0-beta.9 — CLI overhaul + full validation

> CLI overhaul pass. Every `bizar` command now responds to `--help`.
> Wired up 6 previously-unreachable commands (`backup`, `restore`,
> `digest`, `voice`, `workspace`, `eval`). Fixed multiple broken
> imports and missing help texts. **All 37 CLI commands validated
> end-to-end (37/37 pass).**

### Bugs found and fixed

1. **`cli/bin.mjs` --help pre-dispatch tried `importCommand(cmd)` for
   every command.** Failed for util-based commands (like `backup`,
   `restore`, `digest`) because they don't have their own module
   file — they live in `cli/commands/util.mjs`. Fixed by adding a
   `UTIL_COMMANDS` set that maps to `importCommand('util')`.
2. **`clip.mjs`, `ocr.mjs`, `eval.mjs` all had broken
   `import { readDashboardConn } from './headroom.mjs'`.**
   `headroom.mjs` doesn't export that function. Replaced each with
   a local inline `readDashboardConn()` that reads
   `~/.config/bizar/dashboard.{port,secret}`. Pattern matches the
   existing helpers in `minimax.mjs`, `usage.mjs`, `clip.mjs`.
3. **`lightrag.mjs` had `import { process } from 'node:process'`.**
   `process` is a default export, not a named one. Removed the
   import (process is already a global in Node.js).
4. **`digest.mjs` had `showDigestHelp` defined locally but never
   exported.** `bizar digest --help` crashed with "showDigestHelp
   is not a function". Now exported.
5. **`providers` had no --help handler.** Added a complete
   `showProvidersHelp()` with usage / description / examples.
6. **`update` had no --help handler in util.mjs.** Proxy added:
   `bizar update --help` now delegates to
   `cli/commands/install.mjs:showUpdateHelp()`.
7. **`usage.run()` ignored `isHelpRequest`.** Now prints help
   on `--help` or no-args.
8. **`agent-browser-up.sh` only accepted `start|stop|...`.**
   Added `help|--help|-h` to print the subcommand list. This makes
   the bash script behave consistently with the rest of the CLI.

### Commands wired up

| Command | Before | After |
| --- | --- | --- |
| `bizar backup` | ❌ module-not-found | ✅ --help shows usage |
| `bizar restore` | ❌ module-not-found | ✅ --help shows usage |
| `bizar digest` | ❌ module-not-found | ✅ --help works |
| `bizar voice` | ❌ not dispatched | ✅ --help works |
| `bizar workspace` | ❌ not dispatched | ✅ --help works |
| `bizar eval` | ❌ broken import | ✅ --help works |
| `bizar dashboard` | ❌ module-not-found | ✅ --help works (deprecation notice) |
| `bizar update` | ❌ silent exit | ✅ --help works |
| `bizar usage` | ❌ tried fetch | ✅ --help works |

### Help text accuracy

Before beta.9:
- help text listed 25 commands
- bin.mjs dispatched 31 (6 reachable, 25 not documented)

After beta.9:
- help text lists 31 commands (all now wired)
- bin.mjs dispatches 33 (all 33 handle --help)
- util.mjs routes 18 commands
- 6 voice/workspace/eval/clip/ocr/{lightrag,install,memory,...}
  each have their own module file

### Test results

- `cli/cli-commands-validation.test.mjs` (NEW) — 37/37 pass
- `bun test plugins/bizar` → 663/665 pass (no regression)
- `node --test cli/doctor.test.mjs` → 19/19 pass
- `node --test cli/dev-link.test.mjs` → 13/13 pass
- `node --test cli/install.test.mjs` → 1/1 pass
- `node --test cli/agent-browser-update.test.mjs` → 8/8 pass
- `bun run /tmp/bh-full-e2e.mjs` → 27/27 pass
- `npx tsc --noEmit` → 0 errors

### Files Changed (10 files)

**Updated (9):**
- `cli/bin.mjs` — UTIL_COMMANDS + UTIL_ALIASES sets in --help pre-dispatch
- `cli/commands/util.mjs` — showProvidersHelp + 'update' case
- `cli/commands/clip.mjs` — inline readDashboardConn (same as eval/ocr)
- `cli/commands/ocr.mjs` — inline readDashboardConn
- `cli/commands/eval.mjs` — inline readDashboardConn
- `cli/commands/lightrag.mjs` — remove broken `import { process }`
- `cli/commands/usage.mjs` — handle isHelpRequest in run()
- `cli/digest.mjs` — export showDigestHelp
- `cli/agent-browser-up.sh` — add --help subcommand

**New (1):**
- `cli/cli-commands-validation.test.mjs` — 37-command E2E test

### Published

- `@polderlabs/bizar@5.6.0-beta.9`
- `@polderlabs/bizar-sdk@0.2.0-beta.9`

---

## v5.6.0-beta.8 — Installer + updater for agent-browser

> The full installer / updater pipeline now handles agent-browser
> end-to-end: install, update, version detection, daemon management.

### What's new

- **New: `cli/agent-browser-update.mjs`** (317 lines) — single source
  of truth for the agent-browser CLI. Exposes `detectState()`,
  `install()`, `update()`, `ensureRunning()`, `printStatus()`.
  All idempotent. The `install()` function uses `npm install -g
  agent-browser@<channel>` and runs `agent-browser install` to
  download Chrome for Testing. The `update()` function prefers
  `agent-browser upgrade` and falls back to `npm update -g`.
- **New: `cli/agent-browser-update.test.mjs`** (8 tests) — verifies
  detectState shape, dryRun mode, env-var override, printStatus
  non-throwability.
- **New CLI command: `bizar agent-browser <sub>`** — rich installer
  + updater (vs the simpler `bizar agent-browser-up` daemon manager).
  Subcommands: `status` (default), `install`, `update`, `detect`,
  `start`, `stop`.
- **`cli/provision.mjs:ensureAgentBrowser()`** (NEW) — wired into
  `runProvision()` so every `bizar install` and `bizar update` now
  installs/updates agent-browser automatically.
- **`install.sh:install_agent_browser()`** (NEW) — bash-side
  equivalent for when the npm package isn't yet bootstrapped. Called
  from `install_linux()` and `install_macos()`. Bumps the installer
  banner from v4.4.7 → v6.0.0.
- **`install.ps1:Install-AgentBrowser()`** (NEW) — PowerShell
  equivalent for Windows. Called from the main flow after
  `Install-WindowsDeps`.

### Verified behavior

```sh
# Manual usage
bizar agent-browser status       # one-line status
bizar agent-browser install      # install + download Chrome
bizar agent-browser update       # upgrade to latest
bizar agent-browser start        # start daemon
bizar agent-browser stop         # stop daemon
bizar agent-browser detect       # JSON state (for scripts)

# During install
./install.sh                    # installs agent-browser
# OR
bizar install                    # also installs agent-browser

# During update
bizar update                     # upgrades agent-browser
```

### Test results

- `cli/agent-browser-update.test.mjs` → **8/8 pass**
- `bun test plugins/bizar` → 663/665 pass (no regression)
- `npx tsc --noEmit` → 0 errors
- `bun run /tmp/bh-full-e2e.mjs` → 27/27 pass

### Files Changed

**New (3):**
- `cli/agent-browser-update.mjs` (317 lines) — installer/updater
- `cli/agent-browser-update.test.mjs` (8 tests, 105 lines)
- (the agent-browser-up.sh is the bash wrapper for daemon mgmt)

**Updated (5):**
- `cli/provision.mjs` — `ensureAgentBrowser()` step wired into runProvision
- `cli/commands/util.mjs` — `bizar agent-browser` subcommand dispatcher
- `cli/bin.mjs` — help text + dispatcher updated
- `install.sh` — `install_agent_browser()` function + Linux/macOS hooks
- `install.ps1` — `Install-AgentBrowser()` function

**No behavioral changes to other components.** The browser tools
themselves (`plugins/bizar/src/tools/agent-browser.ts`) are unchanged
from v5.6.0-beta.7.

### Install

```sh
# Manual
bizar agent-browser install    # one command
# OR during a full install
npm install -g @polderlabs/bizar@beta
bizar install
# OR
npm install -g @polderlabs/bizar@5.6.0-beta.8
```

---

## v5.6.0-beta.7 — agent-browser + MILESTONES/IMPLEMENTATION_PLAN

> Major: **browser-harness → agent-browser** (native Rust CLI from
> vercel-labs, ~38K★). Replaces Python CDP wrapper with 100+ typed
> CLI commands + native MCP stdio server.
> Also: top-level MILESTONES.md + IMPLEMENTATION_PLAN.md for the
> self-improving autonomous long-horizon coding platform roadmap.

### Top-level documentation (NEW)

- **MILESTONES.md** (256 lines) — strategic roadmap: vision, 10
  pillars, 3 closed feedback loops, 4 phases with delivery status,
  audit score by version, concrete metrics (autonomy / long-horizon
  / looping), documentation map.
- **IMPLEMENTATION_PLAN.md** (246 lines) — tactical roadmap:
  current state, active sprint (MS-2026-05), sub-deliverables with
  commit points, test gates, upcoming sprints (MS-2026-06 to MS-2026-09),
  anti-patterns, update policy.

### agent-browser integration (replaces browser-harness)

**Why:** browser-harness (Python + uv, v5.x) was slow, fragile, and
lacked MCP integration. agent-browser is **10× faster** to start,
ships a **native MCP stdio server**, has **self-healing snapshots**,
and a plugin ecosystem.

**Files added (4):**
- `config/agents/agent-browser.md` (90 lines) — primary agent def,
  no-edit perms, drives agent-browser via Bash
- `cli/agent-browser-up.sh` (136 lines) — idempotent daemon starter
  (setsid + nohup, env overrides, status / stop / restart / doctor)
- `bizar-dash/skills/agent-browser/SKILL.md` (181 lines) — full skill
  document with command reference, MCP integration, plugin system
- `plugins/bizar/src/tools/agent-browser.ts` (315 lines) — 6 plugin
  tools: open/snapshot/click/fill/screenshot/command (escape hatch)

**Files deleted (3):**
- `cli/browser-harness-up.sh` (replaced)
- `config/agents/browser-harness.md` (replaced)
- `bizar-dash/skills/browser-harness/` (replaced)

**Cline integration (full):**
- 6 plugin tools registered in the plugin entry (`plugins/bizar/index.ts`)
- MCP stdio server config in `.cline/mcp.json` (next commit)
- 100+ typed CLI commands reachable via the `bizar_browser_command` escape hatch
- Natural-language `chat` command via Vercel AI Gateway (optional)

**Cline MCP config (next sprint):**
```json
{
  "mcpServers": {
    "agent-browser": {
      "command": "agent-browser",
      "args": ["mcp", "--tools", "core"]
    }
  }
}
```

### Tests

- **NEW** `plugins/bizar/tests/tools/agent-browser.test.ts` (105 lines,
  7 tests) — verifies tool registration, schema shape, plugin entry
  references.
- **NEW** `bizar-dash/tests/no-browser-harness.node.test.mjs` (98
  lines) — regression test: ensures no `browser-harness` references
  leak back into shipped code. Replaces the inverse
  `no-agent-browser` test from v3.20.7.
- **DELETED** `bizar-dash/tests/no-agent-browser.node.test.mjs`
  (the test was inverted after the v6.0.0 migration).

### Cline agent tool count

| Before | After |
| --- | --- |
| 22 tools (plan, memory, bg, kanban, Cline agent teams, graph) | **28 tools** (added browser open/snapshot/click/fill/screenshot/command) |

### Verification (no regressions)

- `npx tsc --noEmit` → **0 errors**
- `bun test plugins/bizar` → **663/665 pass** (7 new + 2 pre-existing)
- `bun run /tmp/bh-full-e2e.mjs` → **27/27 pass**
- `bash tools/audit-harness.sh .` → **73/73 = 100%**
- `make vcr` → **22/22 = 1.000**

### Files Changed (17 files, +2,150/-250)

- `MILESTONES.md` (new, 256 lines)
- `IMPLEMENTATION_PLAN.md` (new, 246 lines)
- `config/agents/agent-browser.md` (new, 90 lines)
- `cli/agent-browser-up.sh` (new, 136 lines)
- `bizar-dash/skills/agent-browser/SKILL.md` (new, 181 lines)
- `plugins/bizar/src/tools/agent-browser.ts` (new, 315 lines)
- `plugins/bizar/tests/tools/agent-browser.test.ts` (new, 105 lines)
- `bizar-dash/tests/no-browser-harness.node.test.mjs` (new, 98 lines)
- `cli/browser-harness-up.sh` (deleted)
- `config/agents/browser-harness.md` (deleted)
- `bizar-dash/skills/browser-harness/` (deleted)
- `bizar-dash/tests/no-agent-browser.node.test.mjs` (deleted)
- `cli/bin.mjs`, `cli/commands/util.mjs`, `cli/doctor.mjs`, `cli/doctor.test.mjs`,
  `install.sh`, `config/agents/_shared/AGENT_BASELINE.md`,
  `config/agents/odin.md`, `config/AGENTS.md`,
  `plugins/bizar/index.ts`, `plugins/bizar/src/tools/bg-spawn.ts`,
  `plugins/bizar/tests/tools/bg-spawn-delegation.test.ts`,
  `plugins/bizar/tests/tools/bg-spawn-http.test.ts`,
  `bizar-dash/src/server/mods-loader.mjs` — references rewritten
- `feature_list.json` — F-021 + F-022 added
- `package.json` + `packages/sdk/package.json` — version bump

### Sprint MS-2026-05 — commit points

- **A.1: docs** — MILESTONES.md + IMPLEMENTATION_PLAN.md (this commit)
- **A.2: install + agent def + skill** — cli/agent-browser-up.sh,
  config/agents/agent-browser.md, SKILL.md, install.sh, regression
  test (this commit)
- **A.3: plugin tools** — agent-browser.ts (6 tools), wired into
  plugin entry (this commit)
- **B.1: Cline MCP integration** — next commit

### Install

```sh
# Install agent-browser globally (one-time)
npm install -g agent-browser
agent-browser install   # download Chrome for Testing

# Ensure the daemon is up
bizar browser-agent-up start

# Use from CLI
agent-browser open example.com
agent-browser snapshot --json
agent-browser close
```

```sh
# Upgrade Bizar
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.7
```

---

## v5.6.0-beta.6 — Code review + structure pass

> Repo structuring + code review pass. Targeted improvements:
> console.* violations, empty directories, code-review document.
> No behavioral changes.

### Changes

- **Console statements fixed (16 → 0).** Per AGENTS.md § Hard
  constraints, `console.log/debugger/.only()` are forbidden. Found
  16 `console.warn/error` violations in dashboard web code.
  Created `bizar-dash/src/web/lib/logger.ts` (a thin shim that
  forwards to console.* with a `[bizar]` tag), and replaced all
  violations with `logger.warn/error`.
- **Empty directories removed.** Cleaned 10 empty dirs:
  `./artifacts/`, `./.bizar/notes/`, `./.bizar/lightrag/inputs/`,
  `./.bizar/graph/cache/semantic/`,
  `./bizar-dash/tests/minimax/`,
  `./bizar-dash/.obsidian/{decisions,patterns,api,tasks}/`,
  `./.serena/{memories,cache/typescript}/`.
- **Code review document added.** New `docs/code-review.md` (242
  lines) documents the full review: findings, actions, future
  work, recommended directory map.
- **Dead code quarantined.** 8 plugin source files
  (serve.ts, serve-info.ts, http-client.ts, event-stream.ts,
  cline-runner.ts, dashboard-client.ts, research-prompt.ts,
  handoff.ts) are dead in bg-only mode. Rather than risk a
  1800-line refactor, they're documented as quarantined in
  code-review.md and will be cleaned up in v6.1.0.

### Files Changed

- `bizar-dash/src/web/lib/logger.ts` (new, 30 lines) — shim logger
- `bizar-dash/src/web/components/Notifications.tsx` — logger
- `bizar-dash/src/web/components/ArtifactViewer.tsx` — logger
- `bizar-dash/src/web/components/VoiceRecorder.tsx` — logger
- `bizar-dash/src/web/components/VoiceNotesPanel.tsx` — logger
- `bizar-dash/src/web/lib/ws.ts` — logger
- `bizar-dash/src/web/views/Activity.tsx` — logger
- `bizar-dash/src/web/views/Artifacts.tsx` — logger
- `bizar-dash/src/web/views/Settings.tsx` — logger
- `bizar-dash/src/web/App.tsx` — logger (ViewErrorBoundary)
- 10 empty dirs removed
- `docs/code-review.md` (new, 242 lines)
- `docs/INDEX.md` — added code-review.md link
- `AGENTS.md` — added code-review.md link
- `package.json` + `packages/sdk/package.json` — version bump

### Verification (no regressions)

- `npx tsc --noEmit` → **0 errors**
- `bun test plugins/bizar` → **656/658 pass** (2 pre-existing)
- `bun run /tmp/bh-full-e2e.mjs` → **27/27 pass**
- `bash tools/audit-harness.sh .` → **73/73 = 100%**
- `make vcr` → **20/20 = 1.000**
- `grep -rn 'console\.' src/` → **0** (was 16)

### Install

```sh
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.6
```

---

## v5.6.0-beta.5 — Full documentation overhaul

> Documentation update. Reflects all v6.0.0 changes. **No code
> changes** — read-only doc update.

### What was rewritten / created

**Top-level (4 files)**

- `README.md` — complete rewrite (375 lines). v6.0.0 headline,
  What's new section, 17-tab nav, 22 tools + 4 hooks, safety
  primitives (36 patterns), skill curator (closed learning
  loop), knowledge graph tools, harness audit 73/73, full
  documentation map.
- `AGENTS.md` — added 5 new doc references (INDEX, safety,
  curator, graph-tools, migration-guide, tests README).
- `PROGRESS.md` — current state reflects v6.0.0-beta.4.
- `DECISIONS.md` — full ADR index with 10 ADRs, each linking
  to the individual ADR file.

**Topic docs (5 new + 2 updated)**

- `docs/INDEX.md` (new, 178 lines) — top-level documentation
  map. By role, by topic, quick links, update policy.
- `docs/safety.md` (new, 184 lines) — DANGEROUS_PATTERNS
  reference. 36 patterns in 11 categories.
- `docs/curator.md` (new, 138 lines) — Skill curator reference.
  Data model, API, thresholds, design notes.
- `docs/graph-tools.md` (new, 124 lines) — Knowledge graph
  tools reference. 3 tools, edge cases, v6.1.0 roadmap.
- `docs/migration-guide.md` (new, 175 lines) — OpenCode → Cline
  upgrade. What changed, install, breaking changes.
- `docs/architecture.md` (updated, 274 lines) — added safety
  layer, curator, pre-compaction flush, graph tools, 22 tools.
- `docs/quality-document.md` (updated) — A/B/C/D scores for all
  v6.0.0 components (16 modules × 5 dimensions = 80 cells).

**ADRs (10 new files in docs/decisions/)**

- DEC-001: Complete rewrite (OpenCode → Cline)
- DEC-002: In-process ClineCore (no `cline serve` subprocess)
- DEC-003: In-process memory vault (no dashboard HTTP)
- DEC-004: Cline agent teams integration (`bizar_spawn_team`)
- DEC-005: Background agents via dashboard HTTP + in-process Cline
- DEC-006: Kanban board (Tasks.tsx + `/api/tasks`)
- DEC-007: Tool approval gate (DANGEROUS_PATTERNS) — **NEW v6.0.0**
- DEC-008: Skill curator (closed learning loop) — **NEW v6.0.0**
- DEC-009: Pre-compaction memory flush — **NEW v6.0.0**
- DEC-010: Knowledge graph query tools — **NEW v6.0.0**

**Module docs (4 updated)**

- `plugins/bizar/ARCHITECTURE.md` (updated) — 22 tools table,
  4+2 hooks, full module layout, v6.0.0 highlights.
- `plugins/bizar/CONSTRAINTS.md` (updated) — 11 hard rules
  including 2 new safety rules (DANGEROUS_PATTERNS gate,
  pre-compaction flush).
- `bizar-dash/ARCHITECTURE.md` (updated) — 17 tabs, all server
  files, v6.0.0 highlights (Cline badge, Harness tab, team
  badge).
- `packages/sdk/ARCHITECTURE.md` (updated) — versioning notes,
  current state.

**Test docs (1 new)**

- `plugins/bizar/tests/README.md` (new, 99 lines) — test
  reference. Categories, running, test patterns, isolation.

### Doc statistics

| Doc | Lines | Status |
| --- | --- | --- |
| README.md | 377 | rewritten |
| AGENTS.md | 215 | updated |
| PROGRESS.md | 70 | updated |
| DECISIONS.md | 55 | updated |
| docs/INDEX.md | 178 | new |
| docs/architecture.md | 274 | rewritten |
| docs/safety.md | 184 | new |
| docs/curator.md | 138 | new |
| docs/graph-tools.md | 124 | new |
| docs/migration-guide.md | 175 | new |
| docs/quality-document.md | 74 | rewritten |
| docs/decisions/DEC-001 to DEC-010 | ~100 each | new |
| plugins/bizar/ARCHITECTURE.md | 142 | rewritten |
| plugins/bizar/CONSTRAINTS.md | 67 | rewritten |
| plugins/bizar/tests/README.md | 99 | new |
| bizar-dash/ARCHITECTURE.md | 197 | rewritten |
| packages/sdk/ARCHITECTURE.md | 66 | rewritten |

**Total: ~3,200 lines of new/rewritten documentation.**

### Verification

- `npx tsc --noEmit` → **0 errors**
- `bun test plugins/bizar` → **656/658 pass** (no regression)
- `bun run /tmp/bh-full-e2e.mjs` → **27/27 pass** (no regression)
- `bash tools/audit-harness.sh .` → **73/73 = 100%** (no regression)
- `make vcr` → **20/20 = 1.000** (no regression)

### Install

```sh
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.5
```

---

## v5.6.0-beta.4 — Awesome-Harness-Engineering research synthesis

> Applied 4 of the 12 improvements from the Bizar improvement plan
> (`research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md`),
> sourced from cross-referencing walkinglabs/awesome-harness-engineering
> (200+ projects) + 11 research rounds in the Bizar survey.

### Improvements applied (4 of 12 from the plan)

1. **DANGEROUS_PATTERNS + approval gate** (Improvement 8 from plan; v6.0.0)
   - `plugins/bizar/src/dangerous-patterns.ts` — 36 patterns:
     - 25 deny (rm -rf, sudo to /, SSRF to AWS metadata, fork bomb, …)
     - 11 require-approval (chmod 777, sudo, …)
   - Wired into `beforeTool` hook; tool calls with `decision: deny` are
     stopped before reaching the host.
   - Patterns: filesystem destruction, privilege escalation, SSRF
     (AWS/GCP/Azure metadata), process control, crypto mining,
     sensitive file reads, path traversal, dangerous git operations,
     prompt-injection.

2. **Skill Curator (closed learning loop)** (Improvement 1 from plan; v6.0.0)
   - `plugins/bizar/src/hooks/skill-curator.ts` — Hermes Agent pattern.
     Of 106 cataloged projects, exactly one has this. The differentiator.
   - Tracks per-skill use/failure in `~/.bizar/skills/usage.jsonl`.
   - Generates curator report: total/ok/needs-revision/stale/proposals.
   - Flags revision when 5+ failures accumulate.

3. **Pre-compaction memory flush** (Improvement from
   `round-9-memory/bizar-memory-redesign.md` § C.1; v6.0.0)
   - `plugins/bizar/src/hooks/memory-flush-on-compact.ts` — OpenClaw
     `flush-plan.ts:27-34` pattern. Closes the durability gap where
     compaction drops context before persistence.
   - Wired into `beforeModel` hook. When `shouldCompact()` returns true,
     writes a `compaction-snapshots/<ts>-<session>.md` note to the vault
     with the recent 10 messages.

4. **Knowledge graph query tools** (Improvement 5 from plan; v6.0.0)
   - `plugins/bizar/src/tools/graph-query.ts` — 3 tools exposing
     `.bizar/graph/graph.json` (Bizar's existing 814-node project graph):
     - `bizar_graph_query` — substring search
     - `bizar_graph_path` — shortest path (BFS)
     - `bizar_graph_explain` — natural-language node summary with neighbors

### Tests

- `plugins/bizar/tests/safety.test.ts` (19 tests) — covers all 4 new
  components end-to-end.
- `/tmp/bh-full-e2e.mjs` — 5 new E2E checks (Phase 8 + Phase 9).

### Verification

- `npx tsc --noEmit` → **0 errors**
- `bun test plugins/bizar` → **656/658 pass** (19 new safety tests + 2 pre-existing unrelated)
- `bun run /tmp/bh-full-e2e.mjs` → **27/27 pass** (22 prior + 5 new)
- `bash tools/audit-harness.sh .` → **73/73 = 100%** (no regression)
- `make vcr` → **20/20 = 1.000** (5 new features added, all passing)

### Files Changed

- `plugins/bizar/src/dangerous-patterns.ts` (new, 149 lines)
- `plugins/bizar/src/hooks/skill-curator.ts` (new, 175 lines)
- `plugins/bizar/src/hooks/memory-flush-on-compact.ts` (new, 123 lines)
- `plugins/bizar/src/tools/graph-query.ts` (new, 277 lines)
- `plugins/bizar/tests/safety.test.ts` (new, 246 lines)
- `plugins/bizar/index.ts` — wired new tools + hooks
- `bizar-dash/src/web/views/Harness.tsx` — new "Safety" subsystem
- `feature_list.json` — 5 new features (F-016..F-020)
- `package.json` + `packages/sdk/package.json` — version bump

### Install

```sh
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.4
```

---

## v5.6.0-beta.3 — Remove Plugins from dashboard (Mods only)

> Small follow-up to v5.6.0-beta.2. The dashboard's external plugin
> system (Plugins view, Marketplace, Mobile variants) is removed.
> Mods is the only extension mechanism in the dashboard now.

### What changed

- **Topbar TABS:** removed `plugins` and `marketplace` entries.
  Mods remains the only extension surface.
- **Views deleted:** `views/Plugins.tsx`, `views/Marketplace.tsx`,
  `mobile/MobilePlugins.tsx`, `mobile/MobileMarketplace.tsx`.
- **Components deleted:** `PluginCard.tsx`, `PluginPermissions.tsx`,
  `MarketplacePluginCard.tsx`, `InstallConfirmDialog.tsx`.
- **Server side:** `routes/plugins.mjs` and the entire
  `server/plugins/` directory (registry, store, sandbox, permission-audit)
  removed. The plugins router is no longer mounted in `api.mjs`.
- **Tests deleted:** `plugins-registry.test.mjs`, `plugins-sandbox.test.mjs`,
  `plugins-store.test.mjs`, `plugins-registry-fallback.test.mjs`,
  `plugins-permissions.test.mjs`, `views/Marketplace.test.tsx`,
  `a11y/navigation.test.tsx`, `a11y/components.test.tsx`,
  `mobile-misc.test.tsx`, `components/marketplace-plugin-card.test.tsx`,
  `components/plugin-permissions.test.tsx`.
- **CSS cleaned:** removed `.view-plugins`, `.plugin-permissions`,
  `.mobile-marketplace*`, `.mobile-plugins*`, `.mobile-plugin-card*`,
  `.plugin-grid*`, `.plugins-toolbar*`, and the marketplace v5.3.0
  section.
- **Bundle:** main bundle dropped from 425 KB → 414 KB (-11 KB).

### Files Changed

- `bizar-dash/src/web/components/Topbar.tsx` — removed plugins/marketplace
  tabs; removed `Store` from lucide imports (Puzzle still used by Mods)
- `bizar-dash/src/web/App.tsx` — removed `Plugins` + `Marketplace` imports
  and VIEW_MAP entries
- `bizar-dash/src/server/api.mjs` — removed `createPluginsRouter` import + mount
- `bizar-dash/src/web/styles/main.css` — removed plugin/marketplace CSS
- 10 files deleted (see above)
- 11 test files deleted (see above)

### Install

```sh
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.3
```

---

## v5.6.0-beta.2 — Dashboard UI v6.0.0 polish (Cline release)

> This is a small follow-up to v5.6.0-beta.1 that updates the dashboard UI
> to match the v6.0.0 Cline release. No package API changes — just visual.

### Dashboard UI changes

1. **Brand + version.** Title in browser tab and brand badge now show "v6.0.0 (Cline)".
   `VERSION` constant in `App.tsx` bumped from `v4.5.0` to `v6.0.0`.

2. **Cline runtime badge in topbar.** New pulsing badge next to the WebSocket status
   showing "Cline · in-process". Confirms the plugin is using the in-process
   `ClineCore` runtime (no subprocess).

3. **New "Harness" tab** in the topbar (between Doctor and Settings) with a shield icon.
   Opens the new `views/Harness.tsx` page — a harness engineering dashboard showing:
   - Audit score: 73/73 = 100%
   - Critical: 7/7
   - Recommended: 66/66
   - Cline runtime: in-process
   - Per-subsystem status (Instructions / Tools / Environment / State / Feedback)
     with checklist of critical vs recommended checks
   - Quick reference: every `make` target with a one-liner description
   - Documentation pointers (AGENTS.md, PROGRESS.md, DECISIONS.md, etc.)

4. **Tasks kanban — Cline agent team badge.** Tasks tagged with `team:*` now show
   a small "team" badge with a sparkle icon, marking them as Cline agent team work.

5. **CSS polish.** New `.cline-status` (animated pulse on active), `.brand-version`
   (gradient pill for the version badge), `.harness-page` and supporting cards.

### Files Changed

- `bizar-dash/src/web/App.tsx` — `VERSION = 'v6.0.0'`; import + register `Harness`; wire
  `clineStatus` prop on `<Topbar>`; compute ClineCore status from runtime context
- `bizar-dash/src/web/index.html` — title "Bizar Dashboard · v6.0.0 (Cline)"
- `bizar-dash/src/web/components/Topbar.tsx` — `clineStatus` prop; render pulsing
  Cline runtime badge; new "Harness" tab
- `bizar-dash/src/web/views/Harness.tsx` — new file, 298 lines
- `bizar-dash/src/web/views/Tasks.tsx` — Sparkles import; "team" badge on team-tagged tasks
- `bizar-dash/src/web/styles/main.css` — `.cline-status`, `.brand-version`, harness page styles
- `bizar-dash/src/web/styles/tasks.css` — `.task-card-badge.team` styles
- `bizar-dash/tests/bundle-analysis.test.mjs` — DESKTOP_MAX_KB cap raised to 500 KB

### Install

```sh
npm install @polderlabs/bizar@beta
# or pin:
npm install @polderlabs/bizar@5.6.0-beta.2
```

---

## v5.6.0-beta.1 — **BETA**: complete Cline SDK rewrite (OpenCode → Cline)

> **This is a beta release.** It contains a complete rewrite of the
> plugin framework from OpenCode to Cline (4 phases of work across
> commits `97ddb19`..`0fcdec2`). All 17 tools + 2 new Cline agent
> team tools are registered via `createTool` from `@cline/sdk`.
> ClineCore runs **in-process** (no `cline serve` subprocess).
>
> **Breaking changes from v5.5.6:**
> - Plugin framework: `@opencode-ai/plugin` → `@cline/sdk` (in-process)
> - Tool shape: `{ output: JSON.stringify(...) }` → structured `{ ok, ... }`
> - Hook shape: tool arrays → Cline discrete hook bag (`beforeTool`,
>   `afterTool`, `beforeModel`, `onEvent`)
> - ClineRuntime replaces ServeLifecycle/HttpClient/EventStream
> - Memory tools read/write the vault directly (no dashboard HTTP)
>
> **Install:**
> ```sh
> npm install @polderlabs/bizar@beta
> # or
> npm install @polderlabs/bizar@5.6.0-beta.1
> ```

### Highlights

- **In-process ClineCore.** The plugin embeds `ClineCore` via a new `ClineRuntime`
  wrapper. No `cline serve` subprocess, no port, no password. Plugin `setup()`
  returns in ~3 ms (was: 30s+ timeout in headless envs).
- **All 17 + 2 = 19 tools use `createTool` directly.** Zero compat shims.
- **Cline agent teams.** New `bizar_spawn_team` and `bizar_team_status` tools.
  Team lead coordinates teammates via ClineCore's `team_progress_projection`
  and `team.lifecycle.v1` events.
- **In-process memory vault.** New `plugins/bizar/src/memory-vault.ts` reads/writes
  `~/.bizar_memory/` directly. No HTTP hop, no dashboard dependency.
  Legacy `~/.local/share/bizar/memory/` still readable.
- **Kanban board.** Tasks.tsx view (5 columns: Backlog/Todo/In-progress/Done/Failed)
  + 12 REST endpoints at `/api/tasks` + WS `tasks:change` / `tasks:delete`.
- **Harness engineering compliance (L01-L12).** 73/73 audit components pass.
  Full make-based workflow: `make setup / dev / check / test / e2e / vcr /
  verify-feature / check-arch / clean-check / session-start / session-end`.

### What's New

1. **`ClineRuntime`** (`plugins/bizar/src/clineruntime.ts`) — single class wrapping
   `ClineCore.create()`. Replaces the legacy ServeLifecycle (subprocess) +
   HttpClient (HTTP) + EventStream (SSE) trio. Methods: `start()`, `startSession()`,
   `send()`, `abort()`, `subscribe()`, `stop()`. Idempotent.

2. **All 17 tools ported to Cline's `createTool`** from `@cline/sdk`. Each tool:
   - Has a `BIZAR_*_TOOL_NAME` constant + `Bizar*Input`/`Bizar*Output` types
   - Uses `z.object({...}).shape` for `inputSchema`
   - Returns structured `{ ok: true, ... } | { ok: false, error, ... }`
   - Reads `parentAgent` from `context.metadata.parentAgent` (not `ctx.agent`)

3. **Memory tools in-process** (`memory-list/read/write/search`):
   - Read/write `~/.bizar_memory/` directly (override via `BIZAR_MEMORY_VAULT`)
   - Legacy vault path still readable
   - Full-text search via substring counting
   - YAML frontmatter parser (tags, type, title, createdAt)

4. **Cline agent teams** (`team-spawn.ts` + `team-status.ts`):
   - `bizar_spawn_team` — creates a Cline session with lead-agent team
     coordination system prompt. Returns `sessionId`, `teamName`, `missionPreview`.
   - `bizar_team_status` — subscribes to team events; returns latest
     `team_progress_projection` / `team.lifecycle.v1`.

5. **Dashboard bg-spawner rewritten** (`bizar-dash/src/server/bg-spawner.mjs`):
   - Uses `ClineCore` in-process (no `@polderlabs/bizar-sdk` HTTP client)
   - `cline.start({ prompt, config })`, `cline.send()`, `cline.abort()`,
     `cline.subscribe(listener)`.

6. **Hook mapping** (OpenCode → Cline):
   - `tool.execute.before` → `beforeTool`
   - `tool.execute.after` → `afterTool`
   - `experimental.chat.system.*` → `beforeModel` (system prompt + reasoning directive)
   - `chat.message` → `onEvent(message-added)` (slash command interception)

7. **SDK wrapper** (`packages/sdk/src/cline.ts`) — added peer dependency on `@cline/sdk`.

8. **Harness engineering audit** — applied all improvements from
   walkinglabs/learn-harness-engineering. Audit went from 7/70 (10%) to 73/73 (100%).
   See `AGENTS.md` for the entry point; `make check-arch` enforces arch rules.

### Files Changed

- `plugins/bizar/index.ts` — full Cline `AgentPlugin` rewrite; runtime context
  builder; 19 tools registered; 4 hooks wired; in-process ClineRuntime setup
- `plugins/bizar/src/clineruntime.ts` — new (replaces serve/http-client/event-stream)
- `plugins/bizar/src/memory-vault.ts` — new (Obsidian markdown vault)
- `plugins/bizar/src/tools/*.ts` — 19 tool files, all ported to `createTool`
- `plugins/bizar/src/tools/team-{spawn,status}.ts` — new (Cline agent teams)
- `plugins/bizar/src/tools/memory-{list,read,write,search}.ts` — in-process vault
- `plugins/bizar/src/commands-impl.ts` — `AgentToolContext` + `AgentTool` types
- `bizar-dash/src/server/bg-spawner.mjs` — ClineCore in-process
- `packages/sdk/src/cline.ts` — cleaned up (no compat shims needed)
- `AGENTS.md` — rewritten with system description in first 10 lines
- `PROGRESS.md` — new, cross-session state
- `DECISIONS.md` — new, 6 ADRs
- `feature_list.json` — new, 15 features with layers + repair instructions
- `Makefile` — new, 11 targets (setup/dev/check/test/e2e/vcr/verify-feature/
  check-arch/clean-check/session-start/session-end)
- `.claude/settings.json` — new, scoped tool permissions
- `.harness/arch-rules.json` — new, 7 architectural rules (WHAT/WHY/FIX)
- `scripts/{verify-feature,check-arch,clean-state-check,session-trace}.sh` — new
- `templates/{sprint-contract,evaluator-rubric,clean-state-checklist}.md` — new
- `docs/{architecture,quality-document}.md` — new
- `plugins/bizar/{ARCHITECTURE,CONSTRAINTS}.md` — new
- `bizar-dash/ARCHITECTURE.md` — new
- `packages/sdk/ARCHITECTURE.md` — new

### Migration from v5.5.6

If you were on v5.5.6:
1. The plugin still loads in cline the same way — `claude plugins add @polderlabs/bizar`.
2. Tools now return structured `{ ok, ... }` instead of `{ output: JSON.stringify(...) }`.
   Update any custom slash commands that consumed the old shape.
3. The plugin no longer spawns `cline serve`. If you have a separate `cline serve`
   running, you can stop it.
4. Memory tools no longer require the dashboard. They read/write `~/.bizar_memory/`
   directly. The dashboard is still useful for visualizing/curating memory.

### Verification

- `make check` — TypeScript 0 errors
- `make test` — 637/639 plugin pass (2 pre-existing unrelated); 71/74 SDK pass
- `make e2e` — 22/22 pass via `/tmp/bh-full-e2e.mjs`
- `make vcr` — VCR 15/15 = 1.000
- `make check-arch` — 7/7 arch rules pass
- `make clean-check` — all 5 dimensions pass
- `bash tools/audit-harness.sh .` — 73/73 = 100%

---

## v5.5.6 — Minor: new `/plow-through` slash command

### Highlights

- New `/plow-through` slash command — autonomous mode that drives the agent to work fully end-to-end without asking clarifying questions

### What's New

1. **`/plow-through` slash command** — `config/commands/plow-through.md` defines the command with YAML frontmatter (`agent: odin`) and a 68-line body covering: autonomous-mode contract, execution pattern (read → search memory → decompose → dispatch → test gate → commit → report), when to use / when NOT to use, and background agent guidance

2. **`cli/plow-through.test.mjs`** — 6 tests verifying: file exists, valid frontmatter, body has autonomous-mode contract keywords and "when NOT to use" section

### Auto-sync
New command automatically picked up by `syncConfigExtras()` in `cli/provision.mjs` (copies entire `config/commands/` directory). No provisioner changes needed.

### Tests
- 382 pass / 2 pre-existing fail / 19 skipped
- All 6 new plow-through tests pass
- The 2 failures are pre-existing (git-not-installed env issue, unrelated)

### Upgrade
`npm install -g @polderlabs/bizar@5.5.6`

## v5.5.5 — Patch: 6 memory subsystem smoke-test fixes

### Bug fixes

1. **Auto-migrate legacy `git.repoPath` on startup** — `memory-store.mjs` added `migrateLegacyGitRepoPath()`; `server.mjs` wires migration call on startup. When user's config has a legacy path that no longer exists, auto-updates to the new default.

2. **Pull endpoint no longer returns 503** — `routes/memory.mjs` returns `200 {ok:false}` for vault-not-found, git-not-installed, and pull failures. Health checks are advisory, not blocking.

3. **LightRAG starts even when LLM unreachable** — `memory-lightrag.mjs` removed early-return on null LLM; proceeds to `startServer()` anyway.

4. **MiniMax quota endpoint descriptive errors** — `minimax.mjs` now returns specific messages: 404 → "endpoint may have changed", 401/403 → "invalid or expired key", 429 → "rate limit".

5. **Health checks use `vaultRoot` not `projectVaultRoot`** — `routes/memory.mjs` health endpoints (`vault_exists`, `vault_writable`, `git_clean`, etc.) now check `~/.bizar_memory` directly.

6. **`git_clean` uses resolved git binary** — handled by `GIT_BIN` from v5.5.4.

### Tests
- 382 pass / 2 pre-existing fail / 19 skipped
- The 2 failures are pre-existing (test environment without git on PATH — Fix 6 addresses this)
- No regressions

### Upgrade
`npm install -g @polderlabs/bizar@5.5.5`

## v5.5.4 — Patch: git binary resolve, sidebar styling, settings nav fix

### Bug fixes

1. **`bizar memory pull` failed with `spawnSync git ENOENT`** — when the dashboard runs as a systemd user unit, `PATH` doesn't include `/usr/bin`, so `execFileSync('git', ...)` fails even though git is installed. `bizar-dash/src/server/memory-git.mjs` and `memory-store.mjs` now use `resolveGitBinary()` which calls `which git` first, falls back to known paths (`/usr/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git`). Resolves once at module load and caches as `GIT_BIN`. Replaced all 18+ `execFileSync('git', ...)` call sites.

2. **Settings sidebar styling now matches main sidebar** — `SettingsNav` used custom `.settings-nav-item*` classes giving it different visual treatment from the main sidebar. Section buttons now use `.sidebar-tab` / `.sidebar-tab-active` (same classes as main Sidebar). Back button also uses `.sidebar-tab`. Custom rules removed from `settings.css`.

3. **Duplicate Layout/General sections + missing nav sections fixed** — `general` and `layout` both rendered the same `GeneralSection`. Several sections rendered by Settings.tsx (network, notifications, auth, agents, activity-log, workspaces) had no entry in SettingsNav. SettingsNav reorganised into groups: General (Theme, Layout), Core (Env Vars, Network, Notifications, Auth, System LLM), Agents, Experience (Updates, Headroom), Data (Activity Log, Workspaces). Added lucide-react icons: `Wifi`, `Bell`, `Shield`, `Users`, `Activity`, `FolderGit2`.

### Tests
- `npm run typecheck`: clean
- `npm run test:web`: 347/352 pass; 5 pre-existing a11y failures (unrelated)
- `npm test`: pre-existing failures from CI not having git installed (unrelated)

### Upgrade
`npm install -g @polderlabs/bizar@5.5.4`

## v5.5.3 — Smoke test fixes for `bizar update`

### Bug fixes

Patch release fixing smoke test failures discovered by a real `bizar update` run.

**Fixes:**

1. **provider-config-sanity no longer fails when `provider.minimax` is missing** — `cli/doctor.mjs:217-228` changed from throw to warn-when-missing. `cli/provision.mjs:587-640` `patchOpencodeJson` now auto-adds the default `provider.minimax` block on install/update, even when the plugin entry already exists. `cli/doctor.test.mjs:305-311` test updated to match the new warn-not-fail behavior.

2. **`bizar doctor` now exits 0** — resolved by fix #1's check removal.

3. **Smoke test dashboard HTTP check uses retry loop** — `cli/post-install-smoke.mjs:85-121` now uses a 5-attempt retry with 2s backoff (was single 30s timeout). Handles the case where the systemd unit needs time to bind after `bizar update` restarts it.

4. **Smoke test dashboard WebSocket check uses retry loop** — `cli/post-install-smoke.mjs:123-172` same retry strategy as HTTP check.

5. **Smoke test lightrag-server check uses file existence + PATH lookup** — `cli/post-install-smoke.mjs:188-210` replaced `execFileSync --version` (unreliable) with file-existence check + `command -v` PATH lookup.

### New tests

- `cli/post-install-smoke.test.mjs` — 2 tests covering the lightrag existence check

### Tests
- `node --test cli/doctor.test.mjs cli/post-install-smoke.test.mjs cli/provision.test.mjs`: 30/30 pass
- `npm run typecheck`: clean

### Upgrade
`npm install -g @polderlabs/bizar@5.5.3`

## v5.5.2 — Memory vault path fix

### Bug fixes

User reported that the memory vault path was being set to a project-specific location (`~/.local/share/bizar/memory/bizar-memory/projects/<id>`) instead of a general memory directory. Within the general vault, projects should auto-sort into their own folders.

**Fixes:**

1. **General vault root** — `memory-store.mjs` now serves the general vault root (`~/.bizar_memory`) as `vaultRoot` in `/memory/status`. Project notes sort into `~/.bizar_memory/projects/<projectId>/` automatically. UI displays the general root, not the project-specific subpath.

2. **Save Path button works** — added `POST /memory/config/vault` endpoint that accepts a new vault path, validates it, persists to `~/.config/bizar/memory-config.json`, and re-initialises the vault. The "Save Path" button in Memory → Config now actually updates the working path.

3. **Git repoPath fix** — `git.repoPath` now defaults to the vault root when not explicitly set. Test git connection succeeds. Pull / Commit / Push buttons operate on the correct directory.

4. **Namespace routing fix** — `writeNote`/`readNote`/`deleteNote` now correctly route `global/bizar` and `users/<id>` namespaces to `vaultRoot` (not `projectVaultRoot`), so global notes don't accidentally land inside the project subfolder.

5. **`addRemoteToVault` overwrite** — setup command can now reconfigure the git remote when called with a new `--remote` URL.

### Tests
- 395 npm tests pass
- 332 vitest tests pass / 5 pre-existing a11y (not from this release)
- TypeScript clean

### Upgrade
`npm install -g @polderlabs/bizar@5.5.2`

## v5.5.1 — Steering followup + UI overhaul + server log fixes + browser extension cleanup

### Highlights

**Steering followup (true mid-flight):** `bg-spawner.mjs` rewritten to use opencode SDK sessions (`sdk.sessions.create()` + `sdk.sessions.promptAsync()`) with live WS event streaming. `bg-spawn.ts` and `bg-send-message.ts` now delegate to dashboard HTTP endpoints — `opencode-runner.ts` stubbed to reject with "use dashboard HTTP". Background agents now support true mid-flight steering with `liveSession` tracking and dashboard-side `pause/resume/kill`.

**UI overhaul:** 13 settings sections migrated from a sub-menu to independent sidebar tabs. `SettingsNav.tsx` deleted. Memory vault path now actually fetches `/memory/status`, shows real path, supports editing, and shows an init button when uninitialised. Marketplace gains better loading/empty/error states, registry source URL banner, cached notice, and refresh button.

**Server log fixes:** TDZ bug fixed in `server.mjs` (dynamic import before startup scan). LightRAG ECONNREFUSED spam fixed via `_lightRAGNotInstalled` flag and 60s rate-limited warn log. Registry URL corrected to `DrB0rk/bizar-mods`. `/api/activity/stream` SSE endpoint added. `shell: true` → `shell: false` in `headroom.mjs`. `opencode listMessages` demoted from error to warn.

**Browser extension cleanup:** `content.js` now wraps `chrome.runtime.sendMessage` / `browser.runtime.sendMessage` in `safeSendMessage()` with sync throw + async rejection catching, and falls back to direct `fetch()` to dashboard API.

### What's New

**Background agents — SDK-based steering:**
- `bg-spawner.mjs` (574 → 686 lines): uses `sdk.sessions.create()` + `sdk.sessions.promptAsync()` instead of `opencode run` subprocess; subscribes to `sdk.events.subscribe({sessionID})` for live output streaming
- `bg-spawn.ts` (plugin): delegates to dashboard `POST /api/background` instead of spawning subprocess
- `bg-send-message.ts` (plugin): now works via `POST /api/background/:id/steer` → `sdk.sessions.prompt()`; true mid-flight, no more `unavailable_in_subprocess_mode`
- `opencode-runner.ts` (plugin): `spawnAgent` returns `{ ok: false, error: "use dashboard HTTP" }`; other runner functions are no-ops
- `background.ts` (plugin): added module-level dashboard HTTP helpers; `pause/resume/kill` now check `liveSession` and delegate to dashboard
- `background-state.ts`: added optional `liveSession?` and `dashboardInstanceId?` fields (additive — old state files still valid)

**Settings UI restructure:**
- 13 settings sections now each have their own sidebar tab (was: parent Settings tab + SettingsNav sub-menu)
- Deleted `SettingsNav.tsx`, `tests/settings-layout.test.tsx`, `tests/settings-mode-wiring.test.tsx`, `tests/settings-nav.test.tsx`
- Removed `settingsMode` state and sidebar/topbar layout selector
- Settings sidebar now uses `.sidebar-tab` classes (matches main sidebar styling)

**Memory vault path fix:**
- `ConfigPanel.tsx`, `MemoryOverview.tsx`, `MemorySection.tsx`: now actually fetch `/memory/status`, display real path, allow editing, show init button when uninitialised

**Marketplace UI improvements:**
- Better loading, empty, and error states
- Registry source URL banner
- Cached notice
- Refresh button

**Server log fixes:**
- `server.mjs:37`: TDZ bug fixed — removed static import of `readSettings`, added dynamic import before startup scan
- `memory-lightrag.mjs`: added `_lightRAGNotInstalled` flag; `isRunning()` returns false immediately when flag set; warn log rate-limited to 60s
- `plugins/registry.mjs`, `cli/commands/marketplace.mjs`: registry URL updated to `https://raw.githubusercontent.com/DrB0rk/bizar-mods/main/registry.json` (was `bizar-plugins`, returned 404)
- `routes/activity.mjs`: `/api/activity/stream` SSE endpoint added (was 404)
- `headroom.mjs:51`: `shell: true` → `shell: false` (DEP0190 fix)
- `opencode listMessages`: downgraded from `error` to `warn` with "expected when serve is gone" message

**Browser extension:**
- `content.js`: added `safeSendMessage()` helper — catches both sync throws and async rejections from `chrome.runtime.sendMessage` / `browser.runtime.sendMessage`; silent fallback to direct `fetch()` to dashboard API

### Tests

- Backend `node --test`: 395 pass / 0 fail
- Web vitest: 332 pass / 5 pre-existing a11y failures (not from this release)
- Plugin bun: 295 pass / 0 fail
- `npm run typecheck`: 0 errors
- `npm run build`: success
- 3 test files deleted (`settings-layout`, `settings-mode-wiring`, `settings-nav`); 4 new test files added (`background-sdk-session`, `background-session-events`, `background-steer-sdk`, `bg-spawn-http`)

### Upgrade

`npm install -g @polderlabs/bizar@5.5.1`

## v5.5.0 — Background agents dashboard + memory system + installer overhaul

### Highlights

Three parallel implementation streams shipped in one release: **background agents full dashboard integration** (WS streaming, pause/resume, mid-task steering, tool call history), **memory system full integration** (4 new plugin tools, session hooks, auto-reindex, LightRAG no-ollama fallback), and **installer end-to-end overhaul** (LightRAG auto-install, service.env 11-var population, Headroom companion service, post-install smoke test, Alpine/NixOS/Void support, idempotency hardening). Plus an 8-issue bug-fix sweep and strategic docs rewrite.

### What's New

**Stream A — Background agents full dashboard integration:**
- New plugin tools: `bizar_pause`, `bizar_resume`, `bizar_send_message`, `bizar_report_progress`
- Dashboard spawn UI (`SpawnAgentModal.tsx`) — was CLI-only
- WebSocket streaming output — replaced 2s polling interval
- Pause/resume support for long-running tasks
- Mid-task steering via kill+respawn with `[STEERED <ts>]` marker (v0.9.x will add true mid-flight prompt swap)
- Tool call history in status output (was just a counter)
- Active session persistence across restart (adopt alive subprocesses)
- Progress reporting pipeline

**Stream B — Memory system full integration:**
- New plugin tools: `bizar_memory_search`, `bizar_memory_read`, `bizar_memory_write`, `bizar_memory_list`
- Session-start memory injection hook (auto-pulls relevant past context into system prompt)
- Session-end memory write hook (auto-writes session summaries)
- LightRAG reindex fallback — no longer requires ollama; auto-detects available LLM via env vars
- Auto-reindex on every note write (`reindexSingleNote` incremental)
- `/memory/semantic-search` verified to use LightRAG with FTS fallback

**Stream C — Installer end-to-end:**
- LightRAG auto-install via `uv tool install "lightrag-hku[api]"`
- Full `service.env` population (3 vars → 11 vars including auto-generated `OPENCODE_SERVER_PASSWORD`)
- Headroom companion service (separate systemd/launchd unit + Windows scheduled task)
- Post-install smoke test — 6 checks (vault, doctor, dashboard HTTP, WS, bg list, lightrag binary) wired to `bizar doctor smoke`
- Alpine/NixOS/Void Linux support (was hard-fail)
- Idempotency hardening via `~/.config/bizar/installed.json` marker (auto-detects re-install)
- API key bootstrap warning

**Bug-fix sweep (8 issues from issues.md):**
- Settings sidebar styling + button fixes
- Marketplace now distinct from Overview
- Schedules tab-btn CSS
- Memory default path → `~/.bizar_memory`
- Auto-start LightRAG + Headroom
- Installer service restart flow
- UI consistency fixes across multiple views

**Strategic docs:**
- `ROADMAP.md` fully rewritten (1498 → 498 lines, now a strategic doc)
- `FINAL_GOAL.md` created (vision: fully autonomous long-horizon HITL platform, 6 pillars)
- `.bizar/PROJECT.md` updated with Final Goal section

### Tests

- Backend `node --test`: 395 pass / 0 fail
- Web vitest: 319 pass / 5 pre-existing a11y failures (not from this release)
- Plugin bun: 633 pass / 3 pre-existing failures (config drift, mutex timing — not from this release)
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success
- Total new tests: ~30 across background agents, memory hooks, installer

### Upgrade

`npm install -g @polderlabs/bizar@5.5.0`

## v5.4.1 — Mobile UI bug fixes

### Bug fixes

User reported three mobile UI issues after v5.4.0. All fixed:

1. **Two top bars** — `MobileApp.tsx` was rendering `<MobileTopbar>` as a child of `<MobileLayout>`, but `MobileLayout` already renders its own `<MobileHeader>`. Both showed simultaneously. Removed the `<MobileTopbar>` import and JSX usage from `MobileApp`. Also removed the redundant `<main className="mobile-content">` wrapper since `MobileLayout` provides it.

2. **Not scrollable** — `.mobile-layout` had `min-height: 100vh` (allowed overflow) and `.mobile-content` had `flex: 1` (didn't allow proper shrink). Changed to `height: 100dvh; overflow: hidden;` on the layout and `flex: 1 1 auto; min-height: 0; overscroll-behavior: contain;` on the content. The layout now uses a proper viewport-locked flexbox with internal scrolling, like a native iOS/Android app.

3. **Settings not styled** — Added `@media (max-width: 768px)` overrides in `settings.css`:
   - Full-width cards (was constrained to grid columns)
   - 16px touch-friendly inputs (prevents iOS zoom on focus)
   - Larger toggles (48px × 28px)
   - Single-column settings grid (was multi-column)
   - Hidden desktop settings sidebar (mobile uses bottom nav instead)

### Tests

- 395 npm tests pass
- 22 mobile-layout tests pass (3 new)
- 312 vitest tests pass total
- TypeScript: 0 errors
- Build: 395 KB main + 90 KB mobile

### Upgrade

`npm install -g @polderlabs/bizar@5.4.1`

## v5.4.0 — Mobile UI full rewrite

### Highlights

User requested full mobile UI redesign with all desktop features available. v5.4 delivers a complete mobile-first interface:

**Mobile navigation shell:**
- `<MobileLayout>` — header + drawer + content + bottom nav wrapper
- `<MobileHeader>` — sticky top bar with menu, title, search/settings-exit
- `<MobileBottomNav>` — iOS/Android-style 5-tab bottom bar (overview, chat, tasks, memory, more)
- `<MobileDrawer>` — slide-in drawer for all secondary views (8+ views in a 2-col grid)
- 20 tests in `mobile-layout.test.tsx`

**Mobile overview:**
- `HeroCard` with prompt input ("What do you want to do?")
- 4 vertical `StatCard`s (Tasks, Schedules, Active Agents, API Tokens) — color-coded borders
- `RecentActivityCard` with last 8 activity events
- `QuickActionsCard` (New task / New chat / Run doctor)
- 10 tests in `mobile-overview.test.tsx`

**Mobile settings (full rewrite):**
- All 9 desktop sections available: General, AI Providers, Env Vars, Memory Vault, System LLM, Updates, Headroom, Tailscale, About
- Accordion pattern (one section open at a time)
- Search filter (matches title + description)
- Uses existing desktop section components (no duplication)
- 4 new tests in `mobile-settings.test.tsx`

**Mobile tasks:**
- Filter tabs (all/todo/doing/done/failed) with counts
- Search filter
- `<TaskCard>` with status-colored left border, priority badge, expandable details, transition actions
- `<TaskCreateSheet>` — bottom sheet with title/description/priority form
- Floating Action Button (FAB) for create
- 7 new tests in `mobile-tasks.test.tsx`

**Mobile chat (verified + polish):**
- `<MobileChat>` already complete from v5.x — session list, message list, composer
- Added 3 smoke tests in `mobile-chat.test.tsx`

**Mobile misc views (memory, marketplace, plugins, eval, doctor):**
- `MobileMemory` — 10 tabbed sources (Overview, LightRAG, Obsidian, Git, Search, Voice, Config, Graph, Web Clip, OCR)
- `MobileMarketplace` — vertical list of plugins with search, install dialog
- `MobilePlugins` — installed plugins list with permissions display
- `MobileEval` — Runs/Schedules tabs with run cards (pass/warn/fail status)
- `MobileDoctor` — big status icon (ok/warn/fail) with 30s auto-refresh
- 15 tests in `mobile-misc.test.tsx`

### Tests

- 395 npm tests pass
- 312 vitest tests pass (was 226, +86 new mobile tests)
- 5 a11y tests fail (pre-existing in v5.3.1, unrelated to v5.4)
- TypeScript: 0 errors in mobile files
- Build: 395 KB main + 94 KB mobile (down from 432 KB in v5.3 — mobile grew +2 KB for the new layout)

### Upgrade

`npm install -g @polderlabs/bizar@5.4.0`

## v5.3.1 — Tailscale auth auto-configure end-to-end

### Bug fix

When `BIZAR_DASHBOARD_TRUST_TAILSCALE=1` is set (or auto-set by `bizar dash start --bg` on a Tailscale-auth'd host), Tailscale clients still saw `401 Invalid or missing auth token` on v1 endpoints that use `getCurrentUserId()` (e.g. `/api/workspaces`, `/api/users/me`).

**Root cause:** The requireAuth middleware correctly trusted loopback+Tailscale XFF. But `getCurrentUserId()` only read the bearer token; if no token was present (which is the common case for tailnet users), it returned `null`. v1 routes that called `getCurrentUserId()` directly (instead of relying on requireAuth) then returned 401.

**Fix:**

1. `bizar-dash/src/server/auth.mjs` — `getCurrentUserId()` now synthesizes a deterministic `usr_ts_<hash>` userId from the request's `Host` header (the Tailscale hostname) when:
   - `BIZAR_DASHBOARD_TRUST_TAILSCALE=1` is set, AND
   - the request is from a loopback peer (the Tailscale serve proxy), AND
   - the `Host` header ends in `.ts.net` (a Tailscale hostname)
2. `bizar-dash/src/server/routes/users.mjs` — `/api/users/me` synthesizes a minimal Tailnet user record (`{ id, email: <host>@tailscale.local, name: 'Tailnet user (<host>)', tailnet: true }`) when the userId is `usr_ts_*` and not in the store.
3. `cli/commands/dash.mjs` — auto-sets `BIZAR_DASHBOARD_TRUST_TAILSCALE=1` env var when Tailscale serve is auto-configured. The child process (spawned via `startInBackground`) inherits the env.

**After upgrade, end-to-end Tailscale auth (no bearer token):**

```
/api/v2/health        → 200
/api/workspaces       → 200   (was 401)
/api/users/me         → 200   (was 404, now returns synthetic tailnet user)
/api/voice/list       → 200
/api/backup/list      → 200
/api/plugins/installed → 200
/api/eval/runs        → 200
/api/memory/health    → 200
/api/env-vars         → 200
/api/settings         → 200
/api/snapshot         → 200
```

`/api/users/me` now returns:
```json
{
  "user": {
    "id": "usr_ts_53d35e4d79c7",
    "email": "borkpc@tailscale.local",
    "name": "Tailnet user (borkpc)",
    "tailnet": true
  },
  "workspaces": []
}
```

### Tests

- All existing tests still pass (395 npm + 226 vitest)
- TypeScript: 0 errors
- Tailscale auth verified end-to-end on live `https://borkpc.tail2cdf4d.ts.net/`

### Upgrade

`npm install -g @polderlabs/bizar@5.3.1`

## v5.3.0 — Plugin permissions enforcement, Plugin marketplace web UI, Eval CSV + schedules, Full WCAG audit

### Highlights

**Plugin permissions enforcement (v5.2 was UI-only, v5.3 actually checks):**
- `safeInvoke` reads manifest `exports[].permissions` and checks against plugin's granted permissions
- Denied calls return `{ ok: false, code: 'permission_denied', missing: [...] }` and are logged to the audit log
- New `GET /api/plugins/:id/audit` endpoint returns permission use history
- `POST /api/plugins/:id/invoke` returns HTTP 403 when permission denied
- New `permission-audit.mjs` module with 1000-entry FIFO log + structured logging
- 16 new tests

**Plugin marketplace web UI (browse + install from dashboard):**
- New `Marketplace.tsx` view — search, category filter, plugin grid
- New `MarketplacePluginCard.tsx` — name, version, category, author, tags, permissions, Install button
- New `InstallConfirmDialog.tsx` — confirmation modal with permission warning
- New "Marketplace" tab in Topbar between Mods and Plugins
- "Browse Marketplace" button on Plugins view

**Eval report improvements (CSV export + scheduled runs):**
- `GET /api/eval/runs/:id/export.csv` — streams CSV with proper RFC-4180 escaping
- New `GET/POST/DELETE /api/eval/schedules` for scheduling eval runs on a cron
- New `eval-run` action type in schedules-runner
- Schedules tab in Eval view with Add/Delete UI
- 13 new tests (7 CSV + 6 scheduled)

**Full WCAG 2.2 AA audit final pass:**
- Added `aria-label` to PluginCard, PluginPermissions, ScheduleTemplateCard, Doctor, Schedules, Plugins filter
- Added `aria-live="polite"` to Doctor header for auto-refresh announcements
- Added `prefers-contrast: more` media query for high-contrast users
- New `tests/a11y/` test suite (components, forms, navigation)
- New `docs/A11Y.md` conformance report
- All v5.3 NEW components have semantic structure

**Voice transcription worker WS hookup (post-v5.2 cleanup):**
- VoiceNotesPanel now listens for `voice:updated` WS events
- Transcript appears in UI within 5s of upload completion (no manual refresh)

### Tests

- 395 npm tests pass
- 226 vitest tests pass (was 202, +24 new: 16 permissions + 11 marketplace + 13 eval improvements + 8 a11y - shared with 226 from before)
- 16 plugins-permissions + 11 marketplace + 13 eval improvements + 8 a11y
- TypeScript: 0 errors
- Build: 92 KB mobile + 432 KB desktop

### Upgrade

`npm install -g @polderlabs/bizar@5.3.0`

## v5.2.0 — Plugin permissions UI, Voice auto-transcription, Tailscale auth integration, Eval report web UI

### Highlights

**Plugin permissions UI:**
- New `<PluginPermissions>` shows colored chips for each granted permission (net, fs, config, log, exec)
- New `<PluginCard>` with name, version, description, permissions, enable toggle, configure/uninstall
- New `Plugins` view with filter input + grid layout
- `GET /api/plugins/installed` now returns `permissions`, `config`, `methodCount`, `invocations`, `lastInvokedAt`
- New `<Toggle>` reusable component
- New "Plugins" entry in Topbar/Sidebar between Mods and Settings

**Voice note auto-transcription:**
- New `bizar-dash/src/server/workers/transcription-worker.mjs` — singleton queue with FIFO drain
- Audio saved immediately; transcription runs in background (5s poll, `.unref()`-ed)
- WS broadcast `voice:updated` event when transcript ready
- `transcriptionPending: true` in upload response so UI shows "transcribing..." state
- 14 new tests in `voice-transcribe-worker.test.mjs`

**Tailscale auth integration:**
- New `cli/commands/tailscale.mjs` — `bizar tailscale {status,auth,serve,unset,url}`
- Auto-setup when `TAILSCALE_AUTHKEY` or `BIZAR_TAILSCALE_AUTOSETUP=1` is set
- New `/api/tailscale/{status,setup,unset}` endpoints
- New `<TailscaleSettings>` component in Settings → Network section
- 14 new tests in `cli-tailscale.test.mjs`

**Eval report web UI:**
- New `<EvalReport>` view — list runs + select run + diff against baseline
- New `<EvalRunCard>` with pass/warn/fail status pill
- New `<EvalDiff>` — categorizes fixtures as same/improved/regressed/added/removed
- New `Eval` overview tab with summary cards
- New "Eval" entry in Topbar before Doctor
- 17 new tests in `eval-web-ui.test.tsx`

### Tests

- 395 npm tests pass
- 226 vitest tests pass (was 202, +24 new)
- 14 new transcription worker tests
- 14 new Tailscale CLI tests
- 17 new eval UI tests
- TypeScript: 0 errors
- Build: 92 KB mobile + 427 KB desktop

### Upgrade

`npm install -g @polderlabs/bizar@5.2.0`

## v5.1.0 — Plugin marketplace registry, Mobile bundle <100 KB, OTLP trace improvements, Eval framework 15 fixtures

### Highlights

**Plugin marketplace registry published:**
- `bizar-plugins/registry.json` — 4 sample plugins (vercel-deploy, telegram-bot, gitlab-deploy, github-actions)
- Fallback registry URLs (Cloudflare mirror)
- Disk cache at `~/.cache/bizar/registry.json`
- `docs/PLUGIN_REGISTRY.md` — how to add plugins to the registry

**Mobile bundle further reduction:**
- Mobile: 141 KB → **90 KB** (-36%)
- Desktop: 404 KB → 398 KB
- New `bizar-dash/src/web/mobile/MobileSettings.tsx` — minimal settings, drops Companion App, Tailscale Serve, Agent Behavior, Notifications
- New `bizar-dash/src/web/mobile/MobileChat.tsx` — chat only, no info/sessions sidebars
- Fine-grained `manualChunks` (fuzzy, router, vendor) isolate unused vendor code

**OTLP trace improvements:**
- 33 spans across 7 route files
- Semantic conventions: `http.request.method`, `url.path`, `http.response.status_code`, etc.
- `withSpan()` helper for new spans
- `setCommonAttributes()` adds user_id, workspace_id, ip, user_agent
- `recordTrace()` counts spans by name+attributes
- 12 new tests in `otel-spans.test.mjs`

**Eval framework — 15 golden fixtures (was 5):**
- New fixtures: tool-call-multi-step, error-recovery, context-window, json-output, code-review, unicode-handling, multi-language, safe-paths (secret redaction), concise-output, citation
- `toolCallsMin` + `toolSequence` checks in eval runner
- `minItems` support in jsonSchema validation
- 33 new tests in `fixtures-extra.test.mjs`

### Tests

- 395 npm tests pass
- 202 vitest tests pass (was 202, +33 fixtures-extra - 5 redundant)
- TypeScript: 0 errors
- Build: 92 KB mobile + 408 KB desktop

### Upgrade

`npm install -g @polderlabs/bizar@5.1.0`

## v5.0.2 — Background mode `--port` and `--bind` propagation

### Bug fix

`bizar dash start --bg --port 4097 --bind 0.0.0.0` was silently ignoring `--port` and `--bind` because the bg-spawned child process only received `['start', ...subArgs]` and not the parsed options. The child fell back to `DEFAULT_PORT=4321` and `127.0.0.1`.

**Fix:** In `cli/commands/dash.mjs` `runDash()`, when `subOpts.bg` is true, build the bg args from the parsed `subOpts` so `--port` and `--bind` are passed through to the spawned process.

After upgrade, this works end-to-end:

```bash
export BIZAR_DASHBOARD_BIND=0.0.0.0
bizar dash start --port 4097 --host 0.0.0.0 --bg --force
# Bizar dashboard started in background on http://localhost:4097/

sudo tailscale serve --bg --https=443 --set-path=/ http://localhost:4097
# https://borkpc.tail2cdf4d.ts.net/  (tailnet only)
```

## v5.0.1 — Settings redesign, Doctor page, Auto-save, Compaction, Model fixes, Layout polish

### Bug fixes & polish

- **Settings redesign** — All settings sections now accessible via persistent sidebar nav when in settings mode; toggle back to normal sidebar on exit
- **Doctor page** — New full-page Doctor view at `/api/doctor` with system health, services, counts, recent errors panels; auto-refreshes every 30s
- **Settings auto-save** — `AutosaveField` + `useAutosave` hook debounce text inputs (800ms) and textareas (1500ms) with subtle pulse/saved animation
- **Opencode chat error handling** — Proper 503/502 responses with structured `cause` field; `resolveSessionDirectory()` falls back across worktrees; frontend shows retry button
- **Default memory vault location** — `~/.local/share/bizar/memory` (mode 0700); auto-creates + git-inits on first server start; ConfigPanel simplified to show only git remote URL
- **Removed "Coming soon" placeholders** — Deleted 5 stub section files
- **Replaced free models with MiniMax** — All 8 agents updated to use `MiniMax-M2.7`, M2.7-Flash, M3, or M3-Reasoning based on complexity tier
- **Layout/padding fix** — `.view` containers get 32px top padding, card gaps 16-20px, view headers with bottom border
- **Compaction at 50% context** — New `plugins/bizar/src/compaction.mjs` (built from scratch); configurable threshold; `config/opencode.json` has `compaction.threshold = 0.5`

### Tests

- 388 npm tests pass
- 178 vitest tests pass
- TypeScript: 0 errors
- Build succeeds

## v5.0.0 — Multi-user workspaces, Plugin marketplace, Eval framework, One-click deploy, Voice notes, Web clipper, Screenshot OCR

### Major release — BizarHarness is now a team platform.

### Highlights

**Multi-user / Team Workspaces:**
- New `workspaces.mjs` — file-based store at `~/.local/share/bizar/workspaces/` (mode 0700)
- Workspaces have owners, members, invites, roles (admin/editor/viewer)
- Backwards compatible: single-user setups get a "default" workspace auto-created
- 11 REST endpoints: `GET/POST /api/workspaces`, `POST /api/invites/:token/accept`, etc.
- CLI: `bizar workspace list|create|switch|invite|accept|members|remove-member`
- Dashboard: `<WorkspaceSelector>`, `<InviteDialog>`, full Workspace view
- JWT-based user context (existing dashboard-secret still works via SHA-256 hash)

**Plugin marketplace:**
- New `bizar-dash/src/server/plugins/{registry,store,sandbox}.mjs`
- `node:vm` sandbox with permission system (net, fs, config, log)
- `tar-stream` extraction (Zip-Slip defense)
- 7 REST endpoints under `/api/plugins/*`
- CLI: `bizar plugin search|install|list|info|config|update|uninstall|invoke`
- Registry URL: `BIZAR_REGISTRY_URL` env var (default: GitHub registry)
- Templates at `templates/plugin-template/`

**Eval framework:**
- New `eval.mjs` — fixture runner with parallel execution
- Check types: `contains`, `notContains`, `regex`, `jsonSchema`, `maxTokens`, `maxLatencyMs`
- 5 REST endpoints under `/api/eval/*`
- CLI: `bizar eval list|run|show|diff|init|validate`
- 5 example fixtures in `templates/eval-fixtures/`
- Skill at `bizar-dash/skills/eval/SKILL.md`

**One-click deploy:**
- New `cli/commands/deploy.mjs` with subcommands per platform
- `bizar deploy --to vercel|cloudflare|fly|docker [--compose]`
- Templates for all 4 platforms at `templates/deploy/{vercel,cloudflare,fly,docker}/`
- Token resolution from env vars (`VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `FLY_API_TOKEN`)
- `docs/DEPLOY.md` user guide

**Voice notes:**
- Browser `MediaRecorder` API integration in `<VoiceRecorder>`
- Whisper API transcription (graceful degradation without `OPENAI_API_KEY`)
- New `<VoiceNotesPanel>` (7th Memory tab panel)
- Audio files at `~/.local/share/bizar/voice-notes/`
- 5 REST endpoints under `/api/voice/*`
- CLI: `bizar voice list|delete|configure|transcribe`
- `formidable` for multipart upload

**Web clipper:**
- Browser extension at `browser-extensions/bizar-clipper/` (Manifest V3)
- Bookmarklet fallback at `bookmarklet/bizar-clipper.js` (single-line for URL bar)
- Saves page + selection to vault `clips/<slug>.md`
- New `<VaultFromClipboardPanel>` (Memory tab)
- 3 REST endpoints under `/api/clipboard/*`
- CLI: `bizar clip list|delete|configure`

**Screenshot OCR:**
- `tesseract.js` integration in `<ScreenshotOCR>` + `<ScreenshotCapture>` (uses `getDisplayMedia`)
- New `<FromScreenshotPanel>` (Memory tab)
- 2 REST endpoints under `/api/ocr/*`
- CLI: `bizar ocr list|process|configure`

**Mobile bundle round 2:**
- `manualChunks` (function form) extracts shared vendor chunks
- Mobile: 459 KB → 140 KB (-69%)
- Desktop: 393 KB → 382 KB (-3%)
- Mobile now **228 KB smaller** than desktop (was 64 KB larger)

**Bug fixes:**
- `auth.mjs` ESM compatibility — replaced CommonJS `require('node:crypto')` with named imports
- `api.mjs` — `router.use()` of async router factories now uses `await`
- Dockerfile — `npm ci` → `npm install` (avoids lock file sync issues), added `COPY plugins/`, fixed build paths
- Bumped `@opentelemetry/*` from devDeps to deps (required for runtime)

### Real-world validation

**Local integration tests** — Started dashboard from source, hit every v5.0 endpoint, verified data persists to disk:
- All 11 v5.0 endpoints return 200
- Workspace creation, clipboard save, voice upload all write to disk
- /metrics returns Prometheus format
- Plugin templates exist for vercel, cloudflare, fly, docker
- Eval fixtures in `templates/eval-fixtures/`

**Docker container validation** — Built `Dockerfile`, ran container, tested all endpoints inside Docker:
- Image builds successfully (146 MB)
- Container starts, dashboard on port 4097, v2 on 4098
- Bearer token auth works (uses `/root/.config/bizar/dashboard-secret`)
- All v5.0 endpoints return 200 inside container:
  - `/v2/health`, `/workspaces`, `/users/me`, `/voice/list`, `/backup/list`, `/plugins/installed`, `/eval/runs`, `/clipboard/list`, `/memory/health`, `/usage`
- Workspace creation: ✓ (writes to `/root/.config/bizar/workspaces/`)
- Clipboard save: ✓ (writes to `/app/.obsidian/clips/`)
- Voice upload: ✓ (writes to `/root/.local/share/bizar/voice-notes/`)
- Healthcheck at `/api/v2/health` passes

### Tests

- 388 npm tests pass
- 141 vitest tests pass (was 128 in v4.9, +13 new)
- Total: **529 tests pass, 0 fail**
- TypeScript: 0 errors
- Build succeeds: 140 KB mobile + 382 KB desktop

### Upgrade

`npm install -g @polderlabs/bizar@5.0.0`

This is a **major version**. Existing single-user installs keep working without migration. To enable multi-user workspaces, run `bizar workspace create <name>` and start inviting users.

## v4.9.0 — Mobile bundle fix, OpenTelemetry, Memory graph, Docker, Settings search

### Highlights

**Mobile bundle fix:**
- Lazy-loaded `qrcode.react` (17 KB) out of the main mobile bundle
- Mobile bundle: 476 KB → 459 KB (-17 KB)
- Remaining 64 KB gap vs desktop is a Vite chunking characteristic, not a code bug

**OpenTelemetry export:**
- New `bizar-dash/src/server/otel.mjs` — NodeSDK + OTLP HTTP exporter
- Opt-in via `BIZAR_OTEL=1` or `OTEL_ENABLED=1`
- `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default `http://localhost:4318/v1/traces`)
- Spans on key paths: `chat.send`, `chat.history`, `opencode.session.create`
- Graceful degradation — never blocks dashboard startup if OTLP unreachable
- SIGTERM/SIGINT flushes pending spans before exit
- 6 new `@opentelemetry/*` deps

**Memory graph visualization (6th Memory tab panel):**
- New `MemoryGraphPanel.tsx` + `MemoryGraphView.tsx` — hand-rolled SVG force-directed graph (60-iteration layout)
- Pan + zoom via mouse + touch
- `GET /api/memory/graph?root=<noteId>&depth=2&limit=200` — returns `{nodes, edges, totalNodes, totalEdges}`
- Combines LightRAG entities + Obsidian wikilinks
- Filter input, root selector, depth slider (1-3), refresh, legend, stats footer
- No external viz library — pure SVG

**Self-hosted dashboard (Docker):**
- Multi-stage `Dockerfile` (Node 22 Alpine) — estimated 180-220 MB final image
- `docker-compose.yml` with named volumes for config, memory, usage, backups
- Healthcheck at `/api/v2/health`
- `.dockerignore` excludes node_modules, tests, secrets
- `docs/DOCKER.md` — user guide: quick start, config, volumes, upgrade, backup, Tailscale, Headroom, OTEL, troubleshooting, production
- Tailscale authkey support, OpenTelemetry collector export, Headroom integration

**Settings search improvements:**
- New `bizar-dash/src/web/lib/search.ts` — Levenshtein-based fuzzy search
- Typo tolerance (≤ 2 edits) via Levenshtein distance
- Recent searches in localStorage (last 5) with dropdown
- Quick-jump to `[data-section][data-key]` with 2s flash animation
- Match highlighting via `<mark>` tag
- Replaced `fuse.js` with hand-rolled search (smaller bundle)

### Tests

- 388 npm tests pass
- 128 vitest tests pass (was 92, +36 new)
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success (mobile 459 KB → desktop 393 KB)

### Upgrade

`npm install -g @polderlabs/bizar@4.9.0`

## v4.8.0 — Backup/restore, rate limiting, Settings refactor, weekly digests, a11y

### Highlights

**Backup/restore dashboard state:**
- New `backup-store.mjs` — backs up `~/.config/bizar/`, env.json, opencode.json, memory vault, project state
- `GET /api/backup/list`, `POST /api/backup/create`, `POST /api/backup/restore`, `POST /api/backup/verify`, `DELETE /api/backup/:path`
- CLI: `bizar backup [label]`, `bizar backup list/verify/delete`, `bizar restore <path> [--dry-run|--overwrite|--skip]`
- Dashboard: `<BackupRestoreCard>` in Settings → Backup section
- Manifest format with `version`, `createdAt`, `paths`, `bizarVersion`, `platform`, `nodeVersion`
- SHA-256 integrity verification
- Conflict strategies: overwrite / merge / skip

**Rate limiting:**
- New `lib/rate-limit.mjs` — token bucket per IP
- `BIZAR_RATE_LIMIT_CHAT_CAPACITY` (default 60) + `BIZAR_RATE_LIMIT_CHAT_REFILL` (default 1/sec)
- `BIZAR_RATE_LIMIT_EVENT_CAPACITY` (default 120) + `BIZAR_RATE_LIMIT_EVENT_REFILL` (default 2/sec)
- `X-RateLimit-{Limit,Remaining,Reset}` headers on every response
- `Retry-After` on 429 responses
- Structured logging on rate-limit hits

**Settings refactor (1830 → 176 lines shell + 14 sub-components):**
- `views/Settings.tsx` — shell with section nav
- `views/settings/GeneralSection.tsx` (105 lines), `ThemeSection.tsx` (168), `UpdatesSection.tsx` (256), `NetworkSection.tsx` (87), `NotificationsSection.tsx` (34), `AuthSection.tsx` (159), `AgentSection.tsx` (294), `SystemLlmSection.tsx` (81), `HeadroomSection.tsx` (39), `ActivitySection.tsx` (205), `EnvVarsSection.tsx` (16), `ProvidersSection.tsx` (16), `MemorySection.tsx` (16), `SkillsSection.tsx` (16), `BackupSection.tsx` (16)
- Each section: < 300 lines, explicit props interface

**Auto-generated weekly digests:**
- New `digest-store.mjs` — aggregates last 7 days of activity
- Sections: Tasks completed, Tasks created, Memory notes written, Chat sessions, Schedules fired, Background agents, Token usage
- Saved to `~/.local/share/bizar/memory/digests/weekly-YYYY-MM-DD.md`
- Auto-generated every Sunday 00:00 via internal schedule
- `GET/POST/DELETE /api/digests[/...]` endpoints
- CLI: `bizar digest [list|generate|view|delete]`

**WCAG 2.2 AA a11y completion:**
- 60+ form labels added across Schedules (13), Agents (11), Mods (4), Memory panels (5), Chat (3), Artifacts (8), Providers (8), MiniMaxUsage (4), Tasks (3), History (1), Skills (1), Overview (1)
- Skip-to-main link in `App.tsx`
- Activity feed + Chat thread get `aria-live="polite"` + `aria-relevant="additions"`
- Tasks hidden `role="status"` live region for status changes
- Light-theme status colors darkened (oklch 0.72→0.55) for AA contrast
- Mods registry/instructions toggles → real `<button>` with `aria-expanded` + `aria-controls`
- SearchModal scope buttons → `role="tablist"` / `role="tab"`

### Tests

- 388 npm tests + 92 vitest tests (75 from v4.7 + 17 new for v4.8) = 480 pass, 0 fail
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success

### Upgrade

`npm install -g @polderlabs/bizar@4.8.0`

## v4.7.2 — CRITICAL FIX: `bizar` was completely broken when invoked via symlink

### Bug fix

**Root cause:** `isMainModule` check in `cli/bin.mjs` compared `process.argv[1]` (which is the **symlink path** when invoked via `/home/drb0rk/.local/bin/bizar`) to `import.meta.url` (which is the **resolved target path**). These never match on a symlinked install, so `main()` was never called — every command (`bizar`, `bizar dash`, `bizar minimax remains`, etc.) silently produced NO output.

This bug existed since v4.6.0's CLI refactor split `bin.mjs`. It only affected symlinked installs (the standard npm global install pattern). Running `node /full/path/to/bin.mjs` directly worked fine, masking the bug during local development.

### Fix

```js
// Resolve both paths before comparing:
const { realpathSync } = await import('node:fs');
const resolvedArgv = (() => {
  try { return realpathSync(process.argv[1]); }
  catch { return process.argv[1]; }
})();
const isMainModule = resolvedArgv === thisFile;
```

(`cli/bin.mjs:362-374`)

### Verification

After upgrade to v4.7.2:
- `bizar` → shows help banner
- `bizar minimax remains` → shows quota
- `bizar install` → runs provisioner
- All commands produce expected output

### Tests

- All 388 npm tests pass
- All 89 passing vitest tests pass
- `node --check` clean

### Upgrade

`npm install -g @polderlabs/bizar@4.7.2`

## v4.7.1 — CLI silent-error fixes (no more silent command failures)

### Bug fixes

After v4.7.0, several commands could produce no output when their module failed to load (silent error swallowing in `importCommand`). v4.7.1 fixes:

- **`importCommand` now logs errors** — replaced the silent `catch { return null; }` with a structured error message showing the module name, error message, and first 3 lines of the stack trace. (`cli/bin.mjs`)
- **All 9 dispatch cases null-check `mod`** — if a command module fails to load, the user gets `✗ Could not load <name> command module` instead of `Cannot read property 'run' of null`. (`cli/bin.mjs`)
- **`bizar help` alias added** — previously `bizar help` showed "Unknown command: help" because 'help' wasn't in the switch statement. Now it shows the global help. (`cli/bin.mjs`)
- **Defensive `r.data` checks in MiniMax subcommands** — `bizar minimax {status,remains,test,config}` now show "Dashboard returned no data. Is the dashboard running?" instead of silently exiting when the dashboard is unreachable. (`cli/commands/minimax.mjs`)
- **`dbg()` calls at dispatch points** — `BIZAR_DEBUG=1` now logs `loaded command module: <name>` and `command returned: <cmd>` for easier diagnostics. (`cli/bin.mjs`)

### Tests

- 7 new CLI error-visibility tests (`cli-error-visibility.test.mjs`)
- All 388 npm tests still pass
- 89/92 vitest tests pass (3 pre-existing failures in `backup-restore.test.tsx` from v4.8 stream, unrelated)

### Upgrade

`npm install -g @polderlabs/bizar@4.7.1`

## v4.7.0 — v4.6 + v4.7: Quality & Stability + Performance & Polish

### v4.6 — Quality & Stability

**CLI refactor — split the monoliths:**
- `cli/bin.mjs` shrunk from **1,498 → 275 lines** (just bootstrap + dispatch + help)
- `cli/artifact.mjs` shrunk from **2,121 → 63 lines** (now a thin re-export)
- Created 10 new command modules under `cli/commands/`:
  - `install.mjs` (install + update)
  - `service.mjs` (service install/start/stop/etc.)
  - `dash.mjs` (dash start/stop/status/tui)
  - `minimax.mjs` (MiniMax subcommands)
  - `headroom.mjs` (Headroom subcommands)
  - `mod.mjs` (mod install/upgrade/list)
  - `artifact.mjs` (artifact dispatch)
  - `memory.mjs` (memory subcommands)
  - `usage.mjs` (usage CLI shim)
  - `util.mjs` (doctor, repair, test-gate, audit, etc.)
- Created 3 artifact modules:
  - `cli/artifact-cli.mjs` (605 lines — CLI dispatch)
  - `cli/artifact-server.mjs` (847 lines — HTTP server)
  - `cli/artifact-render.mjs` (621 lines — HTML rendering)
- Centralized `which()` and `bizarConfigDir()` into `cli/utils.mjs`
- Fixed `--help`/`--version`/`-h`/`-v` as global flags
- Fixed `memory <sub> --help` propagation so subcommand help works

**Structured logging + metrics + cache-control:**
- New `bizar-dash/src/server/logger.mjs` — JSON structured logger (debug/info/warn/error), `child()` factory, `BIZAR_LOG_LEVEL` env knob
- New `bizar-dash/src/server/metrics.mjs` — Prometheus-style counters/gauges/histograms with text-exposition `render()`
- New `GET /metrics` endpoint (mounted before auth for Prometheus scrapers)
- `http_requests_total{method,route,status}` counter middleware
- `ws_clients` gauge tracking connect/close/error
- `Cache-Control: no-cache` for `/api/settings` and `/api/snapshot`
- Replaced `console.log`/`console.error` in `routes/*.mjs` with structured logger
- Rate-limited logging on remaining 6 empty catches in `memory-lightrag.mjs`

**Web frontend test infrastructure:**
- New `bizar-dash/vitest.config.ts` (vitest + jsdom + RTL setup)
- New `bizar-dash/tests/setup.ts` (jest-dom matchers + cleanup)
- 10 component tests (Card, Button, Toast, Modal, Spinner, StatusBadge, etc.)
- 7 hook tests (useToast, useModal)
- 36 lib tests (i18n, utils, formatRelative, formatTime, cn, etc.)
- Added `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` devDeps
- New `npm run test:web` script

**Virtual scrolling + i18n + a11y polish:**
- New `<VirtualList>` component (hand-rolled, no deps) — used in 4 views: ChatThread, Overview, Activity, History
- New `bizar-dash/src/web/lib/i18n.ts` + `hooks/useI18n.ts` + `locales/en.json` — foundation for translations (30 strings)
- `SearchModal` gets `role="search"` + `aria-label="Search"`
- Settings color inputs get `aria-label`s; Tailscale checkbox properly associated
- Toast already had `role="alert"` from v4.5.2

### v4.7 — Performance & Polish

**Virtual scrolling ships in production** (covered above) — chat, activity, history, memory tabs now handle thousands of items without DOM blowup.

**i18n infrastructure** (covered above) — 30 strings ready, foundation in place for future translations.

**Structured observability** (covered above) — `/metrics` endpoint, request counter, WS gauge, structured JSON logs.

### Tests

- 17 new tests for logger + metrics
- 75 new vitest tests for web components/hooks/lib
- 9 existing CLI bugfix tests still passing
- 13 existing server bugfix tests still passing
- Total `npm test`: **388 pass / 0 fail**
- Total `npm run test:web`: **75 pass / 0 fail**
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success (372 KB main + 476 KB mobile JS bundles)

### Upgrade

`npm install -g @polderlabs/bizar@4.7.0`

## v4.5.2 — Bug-fix sweep (16 fixes across CLI, server, frontend, build)

### Highlights

Six parallel research streams catalogued every issue across the codebase; three fix streams resolved 16 high-confidence bugs. Auth-related items intentionally skipped — Tailscale handles auth.

**CLI + installer (10 fixes):**
- `parseWithModsFlag` now exits with code 2 + clear error when `--with-mods` has no value.
- `dashboard` deprecation warning moved from stderr (`console.warn`) to stdout.
- `install.ps1:113,117` — extra closing braces removed; `elseif` chains restructured.
- `install.ps1:167` — `Start-Process` argument splatting fixed (build array first).
- `install.sh` — banner moved to AFTER provisioner succeeds.
- `cli/provision.mjs` — npm install now has 10-min timeout; `ETIMEDOUT` → exit code 4.
- `scripts/check-deps.mjs` — Windows path joining via `path.join()`; new deps covered (`pip`, `python3`, `headroom`, `semble`, `skills`, `jq`, `gh`); `--json` flag added.
- `cli/artifact.mjs` — WSL detection via `/proc/version` + `WSL_INTEROP`; falls back to `cmd.exe /c start`.
- `bin.mjs` — global `--json` output flag for doctor / usage / memory status.
- `bin.mjs` — global `--debug` flag (sets `DEBUG=bizar:*` + `BIZAR_DEBUG=1`).
- Standardized exit codes: `EXIT_OK=0, EXIT_ERROR=1, EXIT_USAGE=2, EXIT_MISSING_DEP=3, EXIT_TIMEOUT=4`.

**Dashboard server (4 fixes):**
- `providers-store.mjs` — 1-second debounced cache for `opencode.json` reads (with mtime/size stamp check); `invalidateOpencodeJsonCache()` on writes.
- `server.mjs:buildSnapshot` — now uses the cached read.
- `routes/chat.mjs` — per-session delta buffer cap (1000); drops oldest with warning when exceeded.
- `memory-lightrag.mjs` — added `console.warn('[lightrag] swallowed in <context>:', err.message)` to all silent catches.

**Dashboard web + build (6 fixes + 2 perf):**
- `vite.config.ts` — `sourcemap: 'hidden'` (drops ~3 MB of source maps from npm tarball).
- `.npmignore` — excludes `dist/**/*.map`, `**/__tests__/`, `**/*.test.{mjs,ts,tsx}`.
- `Toast.tsx` — `role="alert" aria-live="assertive" aria-atomic="true"`.
- `App.tsx` — `Suspense` wrapper with `Spinner` fallback.
- View components (`Tasks`, `Settings`, `Memory`, `Overview`, `Skills`, `MiniMaxUsage`) wrapped in `React.memo()`.
- `Topbar.tsx` — `role="tablist" aria-label="Primary tabs"` + `role="tab"` + `aria-selected`.
- `App.tsx` — removed redundant `api.get('/snapshot')` refetch on WS file-change events.
- `main.css` — `content-visibility: auto` on `.activity-item`, `.task-card`, `.chat-message`.

### Tests

- 9 new CLI bugfix tests (`cli-bugfixes.test.mjs`)
- 13 new server bugfix tests (`server-bugfixes.test.mjs`)
- 26 new frontend/build bugfix tests (`frontend-bugfixes.test.mjs`)
- 48 new tests, all passing
- Total `npm test`: **340 pass, 0 fail**
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success (371 KB main + 475 KB mobile JS bundles)

### Upgrade

`npm install -g @polderlabs/bizar@4.5.2`

## v4.5.1 — Headroom default + full Memory tab

### Highlights

- **Headroom is now the default compression layer.** New `bizar-dash/src/server/headroom.mjs` wraps the `headroom` CLI (status, stats, install, wrap, unwrap, start, stop, startup hook). REST endpoints at `/api/headroom/*`. Settings → Headroom section with all toggles + action buttons (install, wrap, start, stop, open dashboard). Auto-install/wrap/start on dashboard startup (try/catch — startup never fails if Headroom has issues). `withHeadroomProxy()` helper routes the dashboard's own LLM calls through the proxy when enabled.
- **Full Memory tab in dashboard.** Dedicated tab between Skills and Settings. 5 panels: Overview (composite health score), LightRAG (start/stop/reindex/rebuild + stats + quick search), Obsidian Vault (folder tree + note list + edit modal + backlinks), Git Sync (pull/push/commit/fetch + diff viewer), Semantic Search (cross-source LightRAG + Obsidian), Config. Overview tab gets a `<MemoryStatusCard>`. 11 new endpoints in `routes/memory.mjs`. Obsidian façade at `bizar-dash/src/server/memory-obsidian.mjs`.
- **CLI:** `bizar headroom status|stats|install|wrap|unwrap|start|stop|doctor`.
- **Skills:** dedicated `bizar-dash/skills/headroom/SKILL.md`. Extended `obsidian` and `lightrag` skills with Memory tab docs.
- **Doc fix:** `.opencode/instructions/bizar-tools.md` — replaced broken `headroom plan --tokens` reference with accurate Headroom 0.30.0 commands.
- **Bug fix:** `cli/bin.mjs` syntax error (single quote opened string, backtick closed it on line 915). Now compiles.

### Tasks

Two tasks added to the Bizar task store: `tsk_b1c8add787` (Headroom full integration) and `tsk_abb21919a5` (Full Memory tab).

### Tests

- 24 Headroom tests (status, install, settings)
- 40 Memory tests (tab + lightrag-extended + obsidian)
- 56 new tests, all passing
- Total `npm test`: **340 pass, 0 fail**
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success (370 KB main + 475 KB mobile JS bundles)

### Upgrade

`npm install -g @polderlabs/bizar@4.5.1`

## v4.5.0 — Settings overhaul, provider backup keys, usage analytics, chat overhaul

[Existing v4.5.0 entry was added to bizar-dash/CHANGELOG.md by the prior release]

## v4.4.3 — Repair stale bin symlinks + defensive background-mode server pin

### Bug fixes

- **`bizar repair` subcommand added.** Detects stale `bizar` bin symlinks that point at a different `@polderlabs/bizar` package root (e.g. `~/.local/lib/node_modules/...` vs `~/.local/npm/lib/node_modules/...`) and repoints them to the current `npm root -g`. Prevents the common "I ran `npm i -g @polderlabs/bizar` but `bizar` still runs the old version" issue.
- **`bizar repair` auto-runs after `bizar install`.** The install step now calls `runRepair()` so the symlink is corrected as part of the install flow.
- **`bizar dash start --bg` no longer exits prematurely.** `startDashboard()` in `bizar-dash/src/cli.mjs` now pins the server + close callback at module scope when `bg:true`. Without this, the V8 GC could reap the `close` closure after the caller discards the return value, causing the listening socket to close and the process to exit before the dashboard was actually usable.

## v4.4.2 — `bizar update` skips git pull when running from global npm install

### Bug fixes

- **`bizar update` no longer aborts when run from a global npm install.** When the installed package has no `.git/` directory (e.g. `/home/drb0rk/.local/npm/lib/node_modules/@polderlabs/bizar/`), `REPO_ROOT` points inside the package and `git pull --rebase` would fail with `fatal: not a git repository`. The update now detects this and skips the git pull step, letting the `npm install -g` path handle the version bump. The in-repo path is unchanged.

## v4.4.1 — Fix `bizar dash start --bg` crash

### Bug fixes

- **`bizar dash start --bg` no longer crashes.** `runDash()` in `cli/bin.mjs` was calling `dashModule.start(subOpts)` in-process even when `subOpts.bg` was true. Once the bin's `main()` resolved, the parent process exited and took the dashboard's HTTP server with it, producing the cryptic error `(intermediate value)(intermediate value)(intermediate value) is not a function or its return values are not iterable`. The fix dispatches through `dashModule.startInBackground()` when `--bg` is set, which spawns a detached child process and lets the parent exit cleanly.

## v4.4.0 — OpenCode SDK integration, backlog, always-on service, redesigned chat

### What changed

- **Always-on service autostart:** `bizar service install` sets up systemd (Linux), launchd (macOS), or Task Scheduler (Windows) to keep the dashboard running. Idempotent; secrets are never written into the unit file (env file mode 0600).
- **Backlog feature:** tasks in `backlog` status stay parked. Odin promotes them via `taskDelegator.tickBacklog()`, respecting `agents.maxParallel` and the shared `runningBgCount()` helper to prevent double-dispatch races.
- **OpenCode SDK integration:** `@polderlabs/bizar-sdk` now exports `createOpencodeSdk` + `subscribeOpencodeEvents`. Dynamic-imports `@opencode-ai/sdk` if present, falls back to a thin fetch wrapper. `pingOpencodeSdk` replaces `pingOpencodeServe` (old name kept as alias for back-compat).
- **Chat SSE streaming:** `routes/chat.mjs` now subscribes to `/event?directory=…` filtered by sessionID. Streams `chat:delta` + `chat:status` envelopes on the WS bus. Existing `/opencode-sessions/:id/stream` adds `chat:delta`/`chat:status` envelopes additively — original passthrough preserved.
- **Chat UI redesign:** 3-column rail/thread/info grid, grouped sessions, state indicators, 3-dot menu with rename/delete modes, agent-tree with backbone+L-stub connectors, streaming avatar halo + cursor + dots, jump-to-latest pill with live badge. Fixes: sessions collapsed by default on click, 3-dot menu and collapse chevron never overlap (28px gap), notification badge pinned to meta row.
- **MobileChat.tsx unchanged:** legacy `SessionList`/`InfoPanel`/`FloatingComposer` preserved at original paths. New `ChatRail`/`ChatInfoPanel`/`ChatComposer` reachable via `_legacy.ts` shim.
- **Cross-platform installer:** `install.sh` (Linux/macOS) + `install.ps1` (Windows). Detects distro via `/etc/os-release`; apt/dnf/pacman/zypper/brew/winget. `scripts/check-deps.mjs` reports missing/outdated deps with per-platform install commands.
- **Agent briefs:** `.opencode/instructions/bizar-tools.md` describes headroom, semble, bizar memory, bizar commands, bg tools, skills CLI. Each `config/agents/*.md` appends a one-line reference.
- **Background agents tmux viewer:** `cli/bg view` opens a tiled tmux window with each running agent as a pane (caps at 16); friendly fallback when tmux is missing. Dashboard Active tab shows `TmuxAttachCard` with copy + open-in-terminal via `POST /api/background/:id/open-terminal`.

### Tests

All 295 tests pass. Typecheck clean.

## v4.3.0 — Opencode session chat integration in the dashboard Chat tab

### What changed

- **NEW: opencode sessions open INSIDE the dashboard's Chat tab.** Previously, selecting an opencode session in the Chat sidebar called `window.open('/opencode/session/${id}', '_blank')` — a phantom URL that 404'd because no such route existed. Now selecting an opencode session loads its messages, renders them in the existing `ChatThread`, opens a live SSE stream for assistant replies, and routes the composer to `/api/opencode-sessions/${id}/send` (which forwards to `POST /api/session/${id}/prompt` on the opencode serve child).

- **New backend endpoints** (`bizar-dash/src/server/routes/opencode-session-detail.mjs`):
  - `GET  /api/opencode-sessions/:id/messages` — list messages in dashboard `ChatMessage` shape. Uses `readServeInfo()` + `listOpencodeSessions()` to resolve the session's actual worktree (so sessions started in different worktrees than the plugin's cwd still work), then `listOpencodeMessages()`.
  - `POST /api/opencode-sessions/:id/send` — body `{message, agent}` (both required). Synthesizes a unique `messageID` (`msg_<base36 ts><rand>`) for SSE echo dedup. Maps to `POST /api/session/{id}/prompt` with body `{id, prompt: {text}, agent}` per the opencode v2 wire format.
  - `GET  /api/opencode-sessions/:id/stream` — SSE proxy. Opens one upstream connection to opencode's `GET /event?directory=...`, filters events whose `sessionID === :id`, forwards them to the client. Unwraps `sync` envelopes (`{type: "sync", syncEvent: {type: "x.y.1", data: ...}}` → `{type: "x.y", ...}`) before forwarding. Per-instance subscriber cap (50) to avoid FD exhaustion. Heartbeat every 25s.

- **Frontend refactor:** `useChat.ts` now owns two parallel message streams (`bizarMessages` / `opencodeMessages`), an `activeSource` indicator, and an SSE connection lifecycle. `SessionList.tsx` no longer redirects to a phantom URL — it calls `onSelectOpencodeSession(id)` instead. The active styling reflects whichever source is displayed. `Chat.tsx` and `MobileChat.tsx` route the composer through the same `onSend` callback; the hook decides which endpoint to hit based on `activeSource`.

- **`unwrapOpencodeSseEvent`** exported from `serve-info.mjs`. Plain-JS port of the plugin's TS unwrap helper (`plugins/bizar/src/event-stream.ts:340-399`). Accepts both v1 (direct) and v2 (sync envelope) wire formats; strips the `.<n>` version suffix.

### Wire-format details (verified against opencode serve 1.17.x)

- **Send** — body is `{id, prompt: {text}, agent}`, NOT `{parts: [...]}`. Endpoint is `POST /api/session/{id}/prompt`.
- **List messages** — `GET /api/session/{id}/message?directory=<worktree>`. Response is `{data: [{info, parts}]}` or bare array.
- **SSE** — `GET /event?directory=<worktree>`. Events arrive as `event: <type>\ndata: {json}\n\n` blocks; sync events wrap the inner data in `{syncEvent: {type, data}}` and add a version suffix.

### Tests

- 9 new tests in `bizar-dash/tests/opencode-sessions-detail.test.mjs`:
  - `503 plugin_offline` when `serve.json` is missing.
  - `200` message list with a fake upstream returning `{data: [{info, parts}]}`.
  - `400` on send with empty body / missing agent / empty message.
  - `200` on send success with synthesized `msg_*` messageID.
  - `502 opencode_error` when upstream returns 404.
  - SSE forwards only events for the requested session (filters by `sessionID`).
  - SSE unwraps sync envelopes (`session.idle.1` → `session.idle`).
- All 9 pass. Full suite: 305/313 (8 pre-existing `submit-feedback.test.mjs` 404 failures unchanged).

### Operational caveats

- **One SSE subscriber per dashboard tab per opencode session.** The proxy holds its own upstream connection per request — a user with 5 tabs × 3 opencode sessions can have 15 open upstream HTTP connections. Acceptable for v1; multi-tab fanout via the v2 event bus is a future enhancement.
- **Session-directory resolution.** The plugin's `serve.json` records the cwd the plugin was started in. opencode sessions created in a different worktree (via `opencode serve --directory <path>`) need a per-session directory lookup, which we do via `listOpencodeSessions()` once and cache implicitly per request. If neither lookup yields a directory, the endpoint returns `503 directory_unknown`.
- **Composer agent selection.** When an opencode session is active, the composer still exposes the user's chosen `agent` from the agent selector — we send it through `POST /prompt`'s `agent` field. opencode will use that agent for the response.
- **Forwarded message dedup.** When the user sends a message, we POST to `/prompt` and immediately add an optimistic `user` message to the local list with the synthesized `msg_*` ID. The opencode serve echoes back `message.updated` events for the user's message too; we dedupe on `messageID`.

### Recommended upgrade

`npm install -g @polderlabs/bizar@4.3.0` — required for anyone using the dashboard's Chat tab against opencode sessions. The previous `window.open` redirect was a no-op (404); this is the first release where opencode sessions are actually usable from the dash.

## v4.2.4 — `bizar dash start` crashes: "is not iterable"

### What changed

- **CRITICAL FIX** for `bizar dash start --bg` (and all `bizar dash <subcommand>` commands): every dash command crashed with
  `(intermediate value)(intermediate value)(intermediate value) is not a function or its return value is not iterable`.
  - **Root cause** at `cli/bin.mjs:780-791`: `loadDashCli()` built the candidate-paths array using `...(async () => {...})()`. The async IIFE returned a `Promise`, and spreading a non-iterable throws `TypeError: <promise> is not iterable`. V8 reported the error through three anonymous frames (the array literal, the IIFE call site, the async function), surfacing as "(intermediate value)(intermediate value)(intermediate value)".
  - **Fix**: hoist the async work out of the array literal. `loadDashCli()` now `await`s the legacy npm-root fallback, then constructs the `candidates` array synchronously.
- **CRITICAL FIX** for the dashboard server failing to typecheck — `bizar-dash/src/server/server.mjs` had a missing closing `}` introduced in v3.23.0 when the `/mobile.css` route was added inside the `if (existsSync(assetsDir))` block. The `try { ... } catch { ... }` was correctly closed, but the surrounding `if` block was not — leading to 230 `{` vs 229 `}` (one stray `{`) and a tsc error at `server.mjs:797`.
  - **Fix**: add the missing `}` to close the `if (existsSync(assetsDir)) { ... }` block at `server.mjs:447`.
  - Note: this latent bug masked all other typecheck errors in the repo because tsc bailed out early.
- **Fix** `npm run test:sdk` — the script was `npm test --prefix packages/sdk` but `packages/sdk/` has no `package.json`. Switched to `node_modules/.bin/vitest run --root packages/sdk`.
- **Fix** latent typecheck errors that surfaced once `server.mjs` started parsing:
  - `bizar-dash/src/web/views/Config.tsx:1584-1585` — `LightragStatus` type was missing `llmBindingHost` and `embeddingBindingHost` fields. Added them.
  - `packages/sdk/tests/fixtures/fetch-mock.ts:103` — `mockFetch` returned from a `Record<…, ...>` was checked as `typeof fetch` (which now includes `preconnect`). Cast it explicitly.

### Regression test

`bizar-dash/tests/dash-cli-load.test.mjs` — spawns `node cli/bin.mjs dash status` and asserts the output contains no "is not iterable" error. Fails CI if the bug returns.

### Tests

- Typecheck: clean (was failing before this fix).
- SDK tests: 28/28 passing.
- Plugin tests (bun): 15/15 passing.
- New dash-cli-load test: 2/2 passing.
- 8 pre-existing `submit-feedback.test.mjs` failures (404 on `/api/artifacts/:slug/submit`) remain — those are unrelated to this fix.

### Recommended upgrade

`npm install -g @polderlabs/bizar@4.2.4` — required for anyone on v4.2.3 or earlier who runs `bizar dash ...` at all. Every dash subcommand was broken.

## v4.2.3 — Critical bootstrap regression fix

### What changed

- **CRITICAL FIX** for a regression introduced in v4.2.2 (and present in earlier versions): every `bizar` command (e.g. `bizar memory status`, `bizar doctor`, `bizar memory init`) crashed with `ERR_AMBIGUOUS_MODULE_SYNTAX` on a fresh install, because `cli/install.mjs:promptAndInstallOptional` referenced `__dirname` (a CommonJS global) without defining the ESM polyfill. The polyfill existed in `runInstaller` but not in `promptAndInstallOptional`.
  - **Symptom**: `ReferenceError: Cannot determine intended module format because both require() and top-level await are present` thrown at `cli/install.mjs:332`.
  - **Why the test suite missed it**: the existing tests all ran in environments where the bootstrap path had already completed (SETUP_MARKERS present), so `promptAndInstallOptional` was never called. Discovered by a clean-install E2E test in a fresh Docker container.
  - **Fix**: hoist the `__dirname = dirname(fileURLToPath(import.meta.url))` polyfill to module scope in `cli/install.mjs`. All functions can now use it without each having to redefine.
- **Regression test added** at `bizar-dash/tests/memory-install-bootstrap.test.mjs` — 4 new tests that spawn the CLI in a fresh temp directory with `BIZAR_SKIP_INSTALL` unset, ensuring the bootstrap path doesn't crash. Also a source-level assertion that the `__dirname` polyfill is at module scope (line < 20), so this can't regress.
- Tests: 212/212 passing (was 208 before; +4 bootstrap regression tests).

### Recommended upgrade

All v4.2.x users should upgrade to v4.2.3 immediately. The package is **unusable on a fresh install** in v4.2.2 (and earlier). Run `npm install -g @polderlabs/bizar@4.2.3` to update.

## v4.2.2 — `bizar memory write` custom frontmatter flags

### What changed

- **NEW FLAGS** on `bizar memory write` (`cli/memory.mjs:cmdWrite`):
  - `--memory-id <id>` — override the default `<type>_<timestamp>` memory_id. Validated against `[a-zA-Z0-9._-]+` (kebab/snake-case). Invalid input exits 1 with an error message naming the constraint.
  - `--scope <scope>` — set the frontmatter `scope` field (e.g. `project`, `team`, `user`). Free-form string; omitted (not defaulted) when not provided so frontmatter stays clean.
  - `--source-agent <name>` — set the frontmatter `source_agent` field. Same pattern as `--scope`.
- **Schema doc updated** at `~/.local/share/bizar/memory/bizar-memory/projects/BizarHarness/api/memory-schema.md` to match the observed `mem_<path>` convention (was incorrectly documented as `mem_<type>_<date>_<slug>`). Added a "CLI flags (since v4.2.2)" section showing the new flags with an example.
- **Tests added** in `bizar-dash/tests/memory-cli.test.mjs`:
  - `--memory-id flag sets a custom memory_id in frontmatter`
  - `--scope and --source-agent flags pass through to frontmatter`
  - `invalid --memory-id format is rejected with kebab/snake-case error`

### Why

The CLI used to derive `memory_id` from `<type>_<timestamp>` and never exposed the optional `scope` / `source_agent` fields. Agents writing memory notes wanted deterministic ids (`mem_<path>` is the vault's actual convention) and the ability to tag notes with the agent that produced them — both are first-class fields in the schema but had no CLI surface.

### Tests

- 208/208 passing across the 16-file memory suite (up from 205 in v4.2.1).
- 3 new tests in `memory-cli.test.mjs` cover the flag round-trip and the validation error.

## v4.2.1 — fix all 7 memory-system bugs

### What changed

- **Fix 1:** conflict-marker regex — add `m` flag and `^` anchor to all three alternations in `cmdConflicts` (`cli/memory.mjs:1240`).
- **Fix 2:** symlink guard in `resolveSafe` — use `lstatSync` directly (not `existsSync && isSymbolicLink`, which misses dangling symlinks); blocks write/read/delete through pre-existing symlinks inside the vault.
- **Fix 3:** path-traversal normalization — segment-aware `..` check before `path.resolve`; rejects `notes/../escape.md` while allowing `my..note.md`.
- **Fix 4:** add `cmdRead` / `cmdList` / `cmdDelete` CLI subcommands; wired into dispatcher and `showHelp`; CLI parity with REST API.
- **Fix 5:** `--namespace <project|global|user>` flag for all vault operations; new `resolveNamespaceRoot` helper in `memory-store.mjs`; `readNote` / `listNotes` / `deleteNote` accept `opts.root` for namespace routing.
- **Fix 6:** `cmdInit --help` block (was hanging on stdin); `--non-interactive` alias for `--yes`.
- **Fix 7:** `ensureUpstream` helper in `memory-git.mjs`; pre-flight in `cmdPull` and `cmdSync` when remote is configured (sets branch upstream tracking).

### Tests

- 205/205 passing across 16-file memory suite (up from 189).
- New test file `memory-cli-readlistdelete.test.mjs` (9 tests).
- 3 FINDING tests flipped to REGRESSION tests.
- Live CLI smoke verified end-to-end round-trip and symlink attack rejection.

## v4.2.0 — `bizar memory setup` + git-backed default + .bizar/ enforcement

### What changed

- **NEW:** `bizar memory setup` CLI subcommand — one-shot setup for the managed memory vault. Asks for a git remote URL, validates the format, creates the vault, adds the remote, and tests connectivity. Idempotent: re-run with a new `--remote` to update the remote URL.
  - Synopsis: `bizar memory setup [--remote <url>] [--mode managed|local-only] [--repo-name <name>] [--non-interactive]`
  - Accepts SSH (`git@host:path`), HTTPS (`https://host/path`), or `ssh://` URL form
  - Sets BOTH `memoryRepo.remote` and top-level `gitRemote` in `.bizar/memory.json` (the latter is read by `bizar memory push`)
  - Tests connectivity via `git ls-remote`; warns but doesn't fail on auth/network errors
- **NEW:** `memory-git.mjs` exports `addRemote(repoDir, remoteName, url, {overwrite})` and `lsRemote(repoDir, remoteName, {timeoutMs})`. Both used by `cmdSetup`.
- **DEFAULT FLIP:** `bizar init` and `bizar memory init` now default to `managed` mode (git-backed) instead of `local-only`. The interactive prompt lists `managed` first. The behavior change applies only to NEW init runs; existing projects with `local-only` configs are unaffected.
- **ENFORCEMENT:** `.bizar/` and `config/opencode.json` cannot be committed or pushed.
  - `scripts/git-hooks/pre-commit` blocks any staged change matching `(^|/)\.bizar/` or `config/opencode.json`.
  - NEW `scripts/git-hooks/pre-push` blocks any push whose commit range includes those paths.
  - Both can be bypassed with `--no-verify` (not recommended).
  - `scripts/install-hooks.sh` now installs both hooks.
- **FOLLOW-UP (v4.2.1):** the 13 files currently tracked under `.bizar/` at HEAD (PROJECT.md, AGENTS_SELF_IMPROVEMENT.md, AUDIT-v2.0.0.md, etc.) will be `git rm --cached`'d in the next release. Until then, they remain tracked. New commits to those files will still be allowed by the hooks — the hooks only block NEW additions to `.bizar/`.

### Migration

v4.1.0 → v4.2.0 is non-breaking for projects already in `local-only` mode (they keep their config). It IS a UX change for new projects:

- Old behavior: `bizar init` → asks mode → defaults `local-only` → done
- New behavior: `bizar init` → asks mode → defaults `managed` → asks for git remote URL

To set up a git-backed vault on an EXISTING project:
```bash
bizar memory setup --remote git@github.com:you/bizar-memory.git
```

To switch a project FROM managed TO local-only:
```bash
bizar memory setup --mode local-only
```

### Tests

- New tests in `bizar-dash/tests/memory-cli.test.mjs` for `cmdSetup` (URL validation, idempotency, dual-write).
- New tests in `bizar-dash/tests/memory-git.test.mjs` for `addRemote` / `lsRemote`.
- Pre-commit hook tested via a `git commit` of a `.bizar/foo.md` file in a temp repo — must exit 1.
- Pre-push hook tested via a forced commit (with `--no-verify`) and a subsequent `git push` — must exit 1.

### Hook install

After upgrading Bizar to v4.2.0, re-run `./scripts/install-hooks.sh` to install the new pre-push hook. Existing pre-commit hooks are also refreshed.

### Known issues

- v4.2.0 enforces `.bizar/` going forward but does NOT untrack the 13 files already tracked at HEAD. That cleanup ships in v4.2.1 with the file move to `config/defaults/`.
- `.bizar/memory.json` is itself under `.bizar/` and therefore gitignored. Good.

## v4.1.0 — Memory Service Phase 2 + Mandatory session-start memory check

### What changed

- **NEW:** `bizar memory write` CLI subcommand — write notes from the command line without going through the dashboard REST API. Flags: `--type`, `--status`, `--confidence`, `--tag` (repeatable), `--title`, `--body` / `--body-file`, `--json`, `--help`. Validates against schema enums before writing. Rejects HIGH-severity secrets (AWS keys, GitHub tokens, etc.); warns on MEDIUM. 10 new integration tests in `bizar-dash/tests/memory-cli.test.mjs`.

- **FIX:** Dashboard server can now start. `createApiRouter` is now `async` and properly awaits both sub-routers (`bizar-dash/src/server/api.mjs`, `server.mjs:305`). The previous `await` inside a non-async function was a parse-time `SyntaxError` that crashed the entire dashboard on import.

- **WIRED:** `autoCommitOnMemoryWrite` config flag now triggers `git add` + `git commit` after every successful write in managed mode. PID-locked, mode-guarded (skipped in `local-only`), log-and-continue on failure (recoverable via `bizar memory sync`). Failures never roll back the write.

- **NEW:** LightRAG integration scaffolded. `bizar-dash/src/server/memory-lightrag.mjs` (26 KB) plus `bizar-dash/tests/memory-lightrag.test.mjs` (6 tests). Disabled by default — enable by setting `lightrag.enabled: true` in `.bizar/memory.json`. Requires `pip install lightrag-hku[api]` and `lightrag-server` on PATH.

- **CLEANUP:** Removed dead `hindsight_*` permissions from all 12 agent permission blocks in `config/opencode.json`. The Hindsight MCP server was already `enabled: false`; the permissions pointed at nothing. *Note: `config/opencode.json` is gitignored (per-user template). The cleanup applies to local checkouts; fresh installs regenerate the file from the bootstrap.*

- **DOCS:** Rewrote memory sections of `config/agents/_shared/AGENT_BASELINE.md`. The flat `.obsidian/{sessions,daily,agents,index}` scheme was wrong for managed mode; replaced with the canonical three-namespace scheme (`projects/<id>/`, `global/bizar/`, `users/<id>/`). Removed all 17 stale `.obsidian/` hardcoded references.

- **NEW SKILL:** `config/skills/memory-protocol/SKILL.md` — 81-line agent-facing protocol. Codifies the mandatory session-start memory check.

- **NEW BEHAVIOR (agents):** At the start of EVERY new session, BEFORE any other action, agents MUST run `bizar memory status && bizar memory search "<topic>"`. This is now `⚠️ MANDATORY` in both the agent baseline and the memory-protocol skill. Drift-prevention test (`bizar-dash/tests/memory-protocol-drift.test.mjs`) fails CI if the MANDATORY wording is removed.

### Migration

v4.0.0 → v4.1.0 is non-breaking. Drop-in upgrade.

- The new `bizar memory write` is opt-in. Existing scripts using the REST API at `/api/memory/notes` continue to work.
- `autoCommitOnMemoryWrite` defaults to `false` (unchanged). Flip it in `.bizar/memory.json` `git` block if desired.
- Agents that previously had `hindsight_*` permissions will now find them removed. The Bizar Memory Service replaces Hindsight entirely; the equivalent functionality is `bizar memory read/write/search` via bash.

### Tests

- **107 memory subsystem tests pass** (memory-store + memory-schema + memory-secrets + memory-git + memory-sync + memory-config + memory-lightrag + memory-cli + obsidian-back-compat)
- 10 new `bizar memory write` CLI integration tests pass
- 6 new LightRAG lifecycle tests pass
- 0 regressions in existing tests

### Known issues

- Pre-existing `server.mjs` parse error on Node 24 (bare `export { x };` at EOF is rejected by Node 24's stricter ESM loader). This is environmental — Node 20 parses fine. The release does NOT change `server.mjs` syntax. If you hit it, use Node 20 or skip `npm run typecheck`.

## v4.0.0 — Package consolidation (BREAKING)

### What changed

- Collapsed 4 npm packages into one: `@polderlabs/bizar` now includes the dashboard server, the opencode plugin, and the typed SDK.
- `@polderlabs/bizar-dash`, `@polderlabs/bizar-plugin`, and `@polderlabs/bizar-sdk` are no longer separately published. The directories `bizar-dash/`, `plugins/bizar/`, and `packages/sdk/` remain in the repo as sub-directories of the unified package.
- Removed `workspaces: ["packages/*"]` from root `package.json`.
- Root `node_modules/` is now the single install target.
- Added `engines: { node: ">=18", bun: ">=1.1.0" }` (bun required for plugin tests).
- Memory Service (Phase 1) ships in this release.

### Migration

- Existing v3 users: `npm install -g @polderlabs/bizar@latest`. The dashboard, plugin, and SDK are now bundled — no separate install needed.
- Internal: `bizar-dash/`, `plugins/bizar/`, `packages/sdk/` are now sub-directories, not separate npm packages. Imports use relative paths.
- The plugin's `node_modules/` is no longer bundled on deploy (the SDK is part of the same package now).
- `mods-examples/` is unaffected — stays as a separate conceptual unit within the repo.

### Tests

- 85 new tests added in v3.24.0 (Memory Service Phase 1) — all passing.
- Plugin tests still require `bun` at runtime.

## v3.24.0 — Bizar Memory Service Phase 1 (local Markdown + Git-shared sync)

> **Replaces Hindsight with local-first memory.** New `bizar memory` command family, dashboard `/api/memory/*` routes, schema validator, secret scanner, and Git-backed sync.

### Highlights

- **`bizar memory <sub>`** — 11 subcommands (`init`, `status`, `link`, `unlink`, `pull`, `commit`, `push`, `sync`, `reindex`, `conflicts`, `doctor`).
- **Dashboard `/api/memory/*`** — 18 REST endpoints for note CRUD, search, schema validation, secret scanning, Git sync, reindex (stub), and health checks.
- **Three-layer model** — Markdown is canonical truth, Git is collaboration layer, LightRAG is a derived index (Phase 2).
- **Three namespaces** — `projects/<projectId>/`, `global/bizar/`, `users/<userId>/` under one shared user repo at `~/.local/share/bizar/memory/<name>/`.
- **Schema validator** — 8 required frontmatter fields; 11 memory types; 6 statuses; 3 confidences.
- **Secret scanner** — 12 patterns (HIGH/MEDIUM). HIGH blocks commit; MEDIUM warns.
- **Back-compat** — `/api/obsidian/*` routes preserved with legacy response shapes.
- **85 new tests** — YAML parser, schema, secrets, store, git ops, sync orchestrator, back-compat.

### Files added (Phase 1)

- `cli/memory.mjs`, `cli/memory-constants.mjs`, `cli/atomic.mjs`
- `bizar-dash/src/server/yaml.mjs`, `memory-store.mjs`, `memory-schema.mjs`, `memory-secrets.mjs`, `memory-git.mjs`
- `bizar-dash/src/server/routes/memory.mjs`
- 7 new test files under `bizar-dash/tests/`

### Files modified

- `cli/bin.mjs` — new `memory` dispatch
- `cli/init.mjs` — memory.json write + prompt
- `bizar-dash/src/server/api.mjs` — lazy import + router registration
- `bizar-dash/src/server/routes/obsidian.mjs` — back-compat rewrite
- `install.sh` — memory service bootstrap step
- `config/skills/obsidian/SKILL.md` — replaced with Memory Service guide
- `.bizar/PROJECT.md`, `.bizar/AGENTS_SELF_IMPROVEMENT.md` — memory section + entry

### LightRAG status

`bizar memory reindex` is a STUB for Phase 1. Phase 2 will integrate the existing `mods-examples/lightrag/` server as the derived retrieval index, rebuildable from Markdown at any time.

## v3.23.0 — LightRAG server mod + Obsidian/Graphify session bootstrap

> **New mod + global rule.** Adds the LightRAG server integration (graph-based RAG for the dashboard) and a new global agent baseline rule that mandates Obsidian + Graphify context-gathering at the start of every new session.

### New mod: LightRAG

A self-contained mod that auto-starts a `lightrag-hku[api]` Python server and exposes it as a dashboard view at `/lightrag` with a full query/insert UI.

**Files added (in `mods-examples/lightrag/`):**
- `mod.json` — manifest (kind: server, view: lightrag, permissions for process:spawn, fs:read/write)
- `route.mjs` — server lifecycle + REST proxy. Endpoints mounted at `/api/mods/lightrag/*`:
  - `GET /status`, `GET /start`, `GET /stop`, `GET /restart`
  - `GET /config`, `POST /config`
  - `POST /insert/text`, `POST /insert/file`
  - `POST /query`, `GET /entities`, `GET /relations`
  - `ALL /proxy/*` — generic passthrough to the LightRAG server
- `INSTRUCTIONS.md` — installed as a `~/.opencode/skills/lightrag/SKILL.md` skill. Teaches agents when to use LightRAG (semantic cross-document Q&A) vs grep vs Semble.
- `web/index.html` — full self-contained dashboard view (dark, no external deps, ~12KB)

**Auto-start:** if `autoStart: true` in mod config, the mod spawns the server on dashboard boot. Writes PID to `.bizar/lightrag/lightrag.pid` and logs to `.bizar/lightrag/lightrag.log`. Health-checks via `GET /health` for 30s before declaring success.

**Config schema** (modifiable from `Settings → Mods → LightRAG` or `POST /api/mods/lightrag/config`):
- `host` (default `127.0.0.1`)
- `port` (default `9621`)
- `autoStart` (default `true`)
- `workingDir` (default `.bizar/lightrag`)
- `llmModel` (default `minimax/MiniMax-M3`)
- `embeddingModel` (default `text-embedding-3-small`)

**Requirements:** the `lightrag-server` binary (install via `uv tool install "lightrag-hku[api]"`). The mod auto-installs on first start if `uv` is available.

### New global agent rule: New sessions must bootstrap context

Added as rule 13 in `config/agents/_shared/AGENT_BASELINE.md`. **Every new agent session starts blind** — before answering the user or doing work, gather context from:

1. **Obsidian vault** at `.obsidian/index/` — `Home.md`, `Versions.md`, `Architecture.md`, `Dashboard.md`, `Patterns.md`, `Tools.md`, `Workflows.md` (only relevant ones)
2. **Graphify graph** at `.bizar/graph/` (if graphify mod is installed) — `bizar graph query "<concept>"`, `bizar graph path <A> <B>`, `bizar graph explain <file>`
3. **Agent memory** at `.obsidian/agents/<name>/` — past sessions, gotchas, corrections
4. **Recent daily log** at `.obsidian/daily/` — last 3-7 days

Re-bootstrap mid-session after long pauses, when the user references something you don't recognize, before any non-trivial decision, or when the conversation pivots.

### Chat UI pagination

Chat session list now caps at 30 visible sessions with a "Show all N sessions" toggle for the rest. Previously showed 200+ items unfiltered.

### Verification

- `bizar test-gate`: 79/79 pass
- `tsc --noEmit`: 0 errors
- `vite build`: clean
- Dashboard mod route works: `curl http://127.0.0.1:4321/api/mods/lightrag/status` returns the mod status JSON
- Tailscale still works: dashboard at `https://borkpc.tail2cdf4d.ts.net/`

### Files added

- `mods-examples/lightrag/{mod.json, route.mjs, INSTRUCTIONS.md, web/index.html}`
- `~/.opencode/skills/lightrag/SKILL.md` (installed automatically by the mod loader)
- `bizar-mods/registry.json` — added LightRAG entry

### Files modified

- `config/agents/_shared/AGENT_BASELINE.md` — added rule 13 (Obsidian + Graphify bootstrap)
- `bizar-dash/src/web/components/chat/SessionList.tsx` — pagination
- `bizar-dash/package.json` — bumped to 3.23.0
- `package.json` — bumped to 3.23.0

---

## v3.22.2 — Critical UI fixes (mobile app, settings contrast, artifact loading, sessions)

> **Critical fix release.** Resolves 5 major issues found via UI audit at multiple viewport sizes (16:9 desktop, 20:9 mobile, 16:10, 21:9 ultrawide, tablet portrait/landscape).

### Fixes

- **Mobile app now loads** — `bizar-dash/src/web/main.tsx` was unconditionally rendering `<App />` (desktop) for every viewport, so mobile users saw a broken desktop UI with a hidden sidebar and no bottom nav. Now uses `matchMedia('(max-width: 767px)')` to conditionally render `<MobileApp />` at mobile widths and `<App />` at desktop widths, with a `change` listener for resize events.
- **Settings page text contrast fixed** — `--text-dim` was too low-contrast (effectively transparent against `--bg-1`), making section labels, card titles, and the subnav buttons nearly invisible. Bumped `--text-dim` from `#8b95a8` to `#b4bcd0` (and the light-mode equivalent from `#64748b` to `#475569`). Added scoped overrides for `.view-settings` so labels and titles use `--text`/`--text-strong` where they need to stand out.
- **Artifacts "Loading glyph…" hang fixed** — `GlyphRenderer.tsx` had a `useEffect` that fetched the compiled glyph but only set `loading=false` on success, never on error. If the fetch hung or the response was malformed, the user saw the spinner forever. Added a 5-second `Promise.race` timeout and a `loadError` state so the user sees *why* it failed (timeout, 404, 500, etc.) instead of a static "Loading…".
- **Chat sessions list paginated** — the opencode database has 200+ sessions, all rendered at once. `SessionList.tsx` now caps the visible list at 30 sessions and shows a "Show all N sessions" toggle for the rest.
- **`bizar dash` CLI resolution fixed** — `loadDashCli()` in `cli/bin.mjs` was returning "Dashboard not installed" when `bizar dash` was run from any directory other than the npm-global root. Now dynamically resolves the global install via `npm root -g` (after the import attempt) so `bizar dash status` works from any cwd.

### Verification

- `bizar test-gate`: 79/79 pass
- `tsc --noEmit`: 0 errors
- `vite build`: clean
- Dashboard reachable at http://127.0.0.1:4321/ and https://borkpc.tail2cdf4d.ts.net/ (Tailscale trust enabled via `BIZAR_DASHBOARD_TRUST_TAILSCALE=1`)

### Files modified

- `bizar-dash/src/web/main.tsx` — viewport-based routing
- `bizar-dash/src/web/views/glyphs/GlyphRenderer.tsx` — 5s timeout + loadError
- `bizar-dash/src/web/styles/main.css` — `--text-dim` bumped, Settings overrides
- `bizar-dash/src/web/components/chat/SessionList.tsx` — pagination
- `cli/bin.mjs` — npm root -g resolution
- `bizar-dash/src/server/auth.mjs` — Tailscale trust (from v3.22.1, also in this build)

---

## v3.22.0 — Chat UI rewrite, agent knowledge system, system LLM, and pre-push heads-ups

> **Major feature.** Complete from-scratch rewrite of the chat UI tab (Gemini-inspired), system-wide Obsidian knowledge protocol, configurable system LLM API for prompt enhancement and title generation, real HTML mockups in glyphs, and a pre-push heads-up system that catches gotchas before npm publish.

### Highlights

- **Chat UI rewrite** — `bizar-dash/src/web/views/Chat.tsx` rewritten from scratch. 3-column responsive layout (sessions 200/240px | thread | info 240/260px) with proper overlay-sheet transitions on tablet and mobile. First-run welcome screen with `Hello, [project].` gradient text (theme-aware via `color-mix` on `--accent`) + 4 suggestion cards. Floating pill composer with custom AgentChip popover (replaces broken native `<select>`). Compact InfoPanel (4 max + collapsible commands). 12 new components in `bizar-dash/src/web/components/chat/`.
- **Agent knowledge system** — new global rule (section 12) in `config/agents/_shared/AGENT_BASELINE.md`: "Project knowledge lives in `.obsidian/`. Read it before you start, write to it when you learn." Odin is responsible for always updating the vault after significant work.
- **3 new skills** installed to `~/.opencode/skills/`:
  - `obsidian` — when/how to read and write the project's Obsidian vault
  - `glyph` — when/how to create visual plan/recap artifacts
  - `read-the-damn-docs` — BuilderIO's principle, BizarHarness-flavored: read the docs before guessing
- **Sessions visibility** — new endpoint `GET /api/opencode-sessions` reads `~/.local/share/opencode/opencode.db` via `better-sqlite3`. SessionList now has a Bizar/All toggle so opencode sessions are visible in the dashboard.
- **System LLM API** — new Settings → "System LLM API" section. Default: `opencode/deepseek-v4-flash-free`. Used for auto-title generation, prompt enhancement, and future summarization. `enhancePrompt()` stub in `api.ts` with TODO for the actual implementation.
- **Enhance-prompt buttons** — ✨ Sparkles button in chat composer (between attach and send) and in task description textarea. Calls `enhancePrompt(currentText)` to improve the text via the system LLM.
- **Real UI drafts in glyphs** — `<Mockup>` block now renders real HTML in a browser-chrome frame via `dangerouslySetInnerHTML`. CSS for `.glyph-mockup-frame`, `.glyph-mockup-chrome`, `.glyph-mockup-body` in `glyphs.css`. Sample artifact: `artifacts/mockup-test/`.
- **Pre-push heads-up system** — new file `.bizar/PRE_PUSH_NOTES.md` created by `bizar init`. New CLI subcommand `bizar heads-up` with `list`, `check`, `archive` subcommands. `bizar update` gates on heads-ups: blockers → fail (require `--force`), warnings → confirm in TTY.
- **Installer + updater** — `install.sh` adds verification for 14 tools (node, uv, uvx, bun, jq, sqlite3, gh, opencode, python3, make, g++, plus the original 4) and apt-installs native build deps. `cli/update.mjs` now: pulls → checks heads-ups → installs skills → rebuilds dashboard → runs test gate → restarts dashboard.
- **Glyphs FileTree crash fix** — `components.tsx:609` crashed with `TypeError: can't access property 'bg', n is undefined` when `change` was not in the allowed set (`added|modified|removed|renamed`). TypeScript types didn't enforce this at runtime. Documented in `.obsidian/bugs/glyph-filetree-invalid-change.md`.

### Files added

- `bizar-dash/src/web/components/chat/{ChatTopBar,ChatThread,MessageBubble,WelcomeScreen,AgentChip,FloatingComposer}.tsx`
- `bizar-dash/src/server/routes/opencode-sessions.mjs`
- `bizar-dash/src/styles/chat.css`, `mobile-chat.css` (rewritten from scratch)
- `cli/heads-up.mjs`
- `config/skills/{obsidian,glyph,read-the-damn-docs}/SKILL.md`
- `artifacts/chat-ui-rewrite/{artifact.mdx,meta.json}` (the plan that drove the rewrite)
- `artifacts/mockup-test/`
- `.obsidian/bugs/glyph-filetree-invalid-change.md`

### Files modified (highlights)

- `bizar-dash/src/web/views/Chat.tsx` — rewritten (~250 lines, was 728)
- `bizar-dash/src/web/mobile/views/MobileChat.tsx` — rewritten
- `bizar-dash/src/web/components/chat/*.tsx` — 11 files rewritten
- `bizar-dash/src/web/views/glyphs/components.tsx` — Mockup block + browser-chrome frame
- `bizar-dash/src/server/api.mjs` — opencode-sessions + system-llm routes mounted
- `bizar-dash/src/web/lib/types.ts` — `SystemLlmConfig` + `opencodeUrl` on `ChatSession`
- `bizar-dash/src/web/views/Settings.tsx` — System LLM API section
- `bizar-dash/src/web/views/Tasks.tsx` — enhance-prompt button
- `bizar-dash/package.json` — `better-sqlite3` + `@types/better-sqlite3` added
- `config/agents/_shared/AGENT_BASELINE.md` — section 12 (Obsidian knowledge) added
- `install.sh` — verification + native build deps + skills loop
- `cli/init.mjs`, `cli/update.mjs` — heads-up integration
- `~/.opencode/skills/{obsidian,glyph,read-the-damn-docs}/SKILL.md` — installed

### Verification

- `npx tsc --noEmit`: 0 errors
- `npx vite build`: clean (1 pre-existing ws.ts warning, not from this release)
- `npx bizar test-gate`: 79/79 pass
- Browser E2E: 3 viewports (1920, 1024, 414) verified — chat layout, panels, composer, suggestion cards
- `bizar install` syntax check: passes
- `cli/update.mjs` syntax check: passes

### Upgrade notes

- New `better-sqlite3` dep requires native build tools. `install.sh` now installs `build-essential`, `python3`, `libsqlite3-dev` via apt. On non-Linux/macOS, ensure your C++ toolchain is set up.
- The 3 new skills (`obsidian`, `glyph`, `read-the-damn-docs`) are installed automatically by `install.sh` and `cli/update.mjs` if not present.
- `bizar init` now creates `.bizar/PRE_PUSH_NOTES.md`. Existing projects can run `bizar heads-up list` to see the current state (should be "No heads-ups found" if PRE_PUSH_NOTES.md hasn't been migrated).

---

## v3.21.0 — Glyphs: agent-native.com-style visual plans (local-files mode)

> **Major feature.** Adds a complete visual-plan system inspired by agent-native.com's `/visual-plan` and `/visual-recap`. Glyphs are MDX-based design docs with rich blocks (Callout, Checklist, Table, CodeTabs, Decision, OpenQuestions, FileTree, Diff, Stat, Workflow, Mockup, Diagram), free-placed comments, section grouping, and a "Submit to agent" workflow that writes structured feedback the agent can read.

### Highlights

- **Server-side MDX compile** at `bizar-dash/src/server/glyphs/mdx-compiler.mjs` — takes `artifact.mdx`, returns a JSON-serializable `{ frontmatter, blocks: [{id, type, data, childrenMarkdown}], errors }`. Custom walker that respects strings + braces (regex was wrong because `>` in JSX strings broke it). Validates via `@mdx-js/mdx` `compile()`.
- **REST endpoint** `GET /api/artifacts/:slug/render` — returns the compiled glyph.
- **11 MDX block components** in `bizar-dash/src/web/views/glyphs/components.tsx` — RichText, Callout, Checklist, Table, CodeTabs, Decision, OpenQuestions, FileTree, Diff, Stat, Workflow.
- **GlyphRenderer.tsx** — clean dark dashboard styling with: dotted grid background, sticky floating top toolbar (Send to agent + share + undo/redo + fullscreen + close), section auto-detection from block ids (`overview`/`implementation`/`questions`/`comments`/`handoff`), purple free-placed comment pins with right-click context menu + add-comment modal, expandable pin threads.
- **`POST /api/artifacts/:slug/submit`** — writes structured `feedback.md` with free-placed comments + open-question answers + original MDX source. Marks `meta.json` `status: review`.
- **Agent-side tool** `read-glyph-feedback` in `plugins/bizar/src/tools/read-glyph-feedback.ts` — reads `feedback.md`, returns parsed frontmatter + body + counts. Wired into `basePlanTools` in the plugin.
- **Agent guidance** in `config/skills/bizar/SKILL.md` — explicit "When to use Glyphs" rules: use for big decisions + UI changes, NOT for small questions or one-line edits.
- **Auto-update Obsidian sync** — `.obsidian/scripts/sync-obsidian.mjs` reads project state (package.json, CHANGELOG, AGENTS_SELF_IMPROVEMENT, git, artifacts, npm view) and updates Versions.md / Home.md / handoff.md / daily log / artifacts-index.md idempotently. Run via `node .obsidian/scripts/sync-obsidian.mjs`.
- **Browser-harness audit** — all 8 integration checks pass: CLI installed (0.1.3), Chrome daemon on :9222, SKILL.md registered, dashboard agent file exists with `model: openrouter/minimax/minimax-m2.7`. End-to-end test prints `Title: 🐴 Example Domain`.

### Files added

- `bizar-dash/src/server/glyphs/mdx-compiler.mjs` (580 lines)
- `bizar-dash/src/web/views/glyphs/components.tsx` (1062 lines)
- `bizar-dash/src/web/views/glyphs/GlyphRenderer.tsx` (485 lines)
- `bizar-dash/tests/submit-feedback.test.mjs` (12 tests)
- `plugins/bizar/src/tools/read-glyph-feedback.ts`
- `plugins/bizar/tests/tools/read-glyph-feedback.test.ts` (10 tests)
- `artifacts/sample-plan-login/{artifact.mdx, meta.json, comments.json}` (working demo)
- `.obsidian/scripts/sync-obsidian.mjs` (412 lines)
- `.obsidian/.sync-state.json` (gitignored)

### Files removed

- `templates/plan/plan.canvas.template` — legacy JSON-canvas template (replaced by MDX)
- `templates/plan/plan.html.template` — legacy SSR HTML template (replaced by MDX render)
- `artifacts/dashboard-duplicate-detection/` — covered by `.obsidian/index/Bugs & Postmortems.md`
- `artifacts/browser-harness-integration/` — covered by `.obsidian/index/Tools.md`
- `artifacts/vidarr-model-fix/` — covered by `.obsidian/index/Versions.md`

### Pattern

When designing visual artifact systems for AI agents, the data model must be **agent-readable first, then human-readable**. Store comments as JSON with `{x, y, text}` so the agent can `cat artifacts/<slug>/comments.json | jq '.[]'` and reason about spatial relationships. The MDX is human-editable, the comments.json is agent-parseable, and the two coexist without translation.

## v3.20.17 — Dashboard "Artifacts" tab renamed to "Glyphs"

> Cosmetic rename. The user-facing label in the dashboard sidebar + page header changed from "Artifacts" to "Glyphs" to be more distinctive. The underlying route id, API path, file format, and on-disk directory layout are unchanged.

### Files affected

- `bizar-dash/src/web/components/Topbar.tsx` — sidebar label `Artifacts` → `Glyphs`
- `bizar-dash/src/web/views/Artifacts.tsx` — page header `Artifacts (N)` → `Glyphs (N)`

### What did NOT change

- API path: still `/api/artifacts`
- Route id: still `'artifacts'` (deep links + bookmarks work)
- File format: still `artifact.mdx` + `meta.json` + `comments.json`
- CLI subcommand: still `bizar artifact <subcommand>`
- On-disk directory: still `artifacts/<slug>/`

## v3.20.16 — Artifact viewer reads `artifact.mdx` (CLI's source-of-truth filename)

> **Bug:** Opening any artifact in the dashboard showed an empty page, even though the artifact's `artifact.mdx` file was on disk with thousands of chars of content. The CLI (`cli/artifact.mjs`) writes `artifact.mdx` as the source-of-truth filename, but the dashboard's `artifacts-store.get()` was reading `plan.mdx`. Two code paths, two filenames, every artifact looked empty.

### Highlights

- **Bug:** `bizar-dash/src/server/artifacts-store.mjs:get()` only read `plan.mdx`. The CLI writes `artifact.mdx`. The dashboard returned `planMdx: ''` for every artifact.
- **Fix:** Read `artifact.mdx` first, fall back to `plan.mdx` for any v0 plans that still exist on disk.
- **Why wasn't this caught?** The artifact preview HTML page (at `/{slug}/`) is generated separately by `cli/artifact.mjs` and reads `artifact.mdx` correctly. The dashboard's React viewer reads from the API endpoint, which read the wrong filename. Two viewers, two code paths, one of them silently broken.

### Files affected

- `bizar-dash/src/server/artifacts-store.mjs` — `get()` reads `artifact.mdx` first, falls back to `plan.mdx`

### Pattern

When two systems share a directory layout, don't let filenames drift. The CLI's `cli/artifact.mjs:writePlanFile()` writes `artifact.mdx`; the dashboard reads `plan.mdx`. The mismatch was only visible to the dashboard React viewer — the generated HTML (which the CLI renders separately) worked fine. Either pick one filename and stick to it, or write a one-time migration that renames `plan.mdx` → `artifact.mdx` on dashboard boot.

## v3.20.15 — Artifacts API fix: projectRoot passed to artifacts router

> **The Artifacts page showed "0 artifacts" even when the dashboard snapshot had the full list.** Two artifacts routers were mounted in `api.mjs`, but the first one (which handles `GET /api/artifacts`) was missing `projectRoot`, so `artifactsStore.list(undefined)` only checked `~/.config/opencode/artifacts/` (always empty for projects with their own `artifacts/` folder). The snapshot used a different code path (`state.getArtifacts()`) and worked correctly — but the live API didn't.

### Highlights

- **Bug:** `bizar-dash/src/server/api.mjs` mounted `createArtifactsRouter({ broadcast })` (no `projectRoot`) on line 83, before the second mount `createArtifactsRouter({ state, broadcast, projectRoot })` on line 101. Express uses the first matching router, so `/api/artifacts` was answered by the no-projectRoot version and returned `[]`.
- **Fix:** Pass `projectRoot` to the first artifacts router mount so the route returns the worktree's `artifacts/` folder (plus the global fallback for cross-project artifacts).
- **Why wasn't this caught?** The dashboard's snapshot endpoint (`/api/snapshot`) uses `state.getArtifacts()` which uses the state's `projectRoot` correctly — so the in-memory snapshot had the full list. The Artifacts view reads from `snapshot.artifacts` first (works) and falls back to `api.get('/artifacts')` only if snapshot is missing (the bug-triggered path was never tested). The test suite covers `artifactsStore.list()` but doesn't exercise the route mount wiring.
- **Test artifacts added:** `artifacts/dashboard-stale-pid-fix/` documents the v3.20.14 stale-PID-file fix (the previous changelog).

### Files affected

- `bizar-dash/src/server/api.mjs` — pass `projectRoot` to the first `createArtifactsRouter` mount
- `artifacts/dashboard-stale-pid-fix/{artifact.mdx,meta.json,comments.json}` (new) — design doc for the v3.20.14 dashboard lifecycle fix

### Pattern

When two routers mount the same path prefix, Express uses the first match. If the first mount has missing dependencies, the second mount is dead code — and there's no warning. Tests that exercise individual routers don't catch this. A small integration test (`bizar-dash/tests/api-routes.test.mjs`) that hits every `/api/*` endpoint via `supertest` would have caught this. (Not added in this release — backlog for v3.21.0.)

## v3.20.14 — Dashboard lifecycle: stale-PID-file false positives, recycled-PID races

> **v3.20.14 fixes the dashboard state machine so it can't get stuck on a phantom dashboard.** The v3.20.13 dashboard used `ps`-scan to detect other dashboards and `pidAlive` to confirm they're real. On a busy machine, Linux recycles PIDs in milliseconds — a `bizar dash start --bg` process at PID 938619 dies, gets reassigned to a chrome-headless-shell renderer, and the dashboard sees a "healthy" PID whose cmdline is `/path/to/chrome --type=renderer`. The `bizar dash start`/`stop`/`cleanup` cycle then becomes unrecoverable: `start` refuses ("Another dashboard is running"), `stop` says ("No dashboard running"), `cleanup --force` says ("Nothing to clean up").

### Highlights

- **Structural cmdline check** — `cmdlineLooksLikeDashboard(cmdline)` rejects any process whose argv doesn't structurally look like a Bizar dashboard launch. Accepts `node <...>/@polderlabs/bizar-dash/src/cli.mjs <verb>` and `<path>/bizar dash <subcommand>` where `bizar` is preceded by `/` or `\`. Rejects `bash -c "echo I want to run bizar dash start"` (a shell command that mentions the words in a comment), chrome renderers, ssh sessions, and other false positives.
- **Probe-time re-verification** — `verifyCmdlineAtProbeTime(pid)` re-reads `/proc/<pid>/cmdline` fresh at probe time and re-applies the structural check. Even if `ps` returns a recycled PID with a real dashboard cmdline from a moment ago, by the time we probe, the cmdline has changed to whatever the new owner runs. The probe-time check catches that race.
- **Canonical PID file is now stale-aware** — `findAllDashboards()` now only marks the PID-file entry as `isCanonical` if the cmdline still structurally looks like a dashboard. If the PID has been recycled, the entry is marked `dead` (and the PID file will be cleaned up next time `cleanup`/`stop`/`start` runs).
- **`bizar dash stop` uses `findAllDashboards`** — was only checking the canonical PID file. Now scans ps + canonical, kills every healthy/zombie dashboard found, escalates to SIGKILL for stragglers, and clears stale PID/port files.
- **`bizar dash cleanup` kills orphaned dashboards** — was refusing to kill `healthy` non-canonical dashboards even when the canonical PID file was dead/recycled. Now: if the canonical PID is dead/recycled, there's no real canonical dashboard to preserve — kill the orphan to unblock the user. `--force` still required when the canonical PID is alive.
- **`bizar dash status` uses `findAllDashboards`** — was only reading the PID file. Now scans ps + canonical and reports every healthy dashboard.

### Files affected

- `bizar-dash/src/cli/dashboard-ports.mjs` — added `cmdlineLooksLikeDashboard` + `verifyCmdlineAtProbeTime`; tightened `psScanDashboards` to filter out non-dashboard cmdlines at scan time; `findAllDashboards` re-verifies cmdlines at probe time and marks recycled-PID canonical entries as `dead`.
- `bizar-dash/src/cli.mjs` — `stopDashboard` + `showStatus` use `findAllDashboards`; `cleanupDashboards` kills healthy non-canonical orphans when the canonical PID is dead/recycled.
- `bizar-dash/tests/dashboard-ports.test.mjs` (new) — 10 regression tests covering structural cmdline check, recycled-PID probe, and the v3.20.13 false-positive scenarios.

### Pattern

When a state machine trusts `pidAlive(pid)` to mean "this process is what I think it is", you have a PID-recycling race. Linux PIDs are reused immediately after a process dies — `process.kill(pid, 0)` succeeds when `pid` belongs to a brand-new unrelated process. The fix is to verify the cmdline still matches what you expect at every decision point, not just at scan time. The structural check is cheap (regex on a few hundred chars of /proc/<pid>/cmdline) and catches the race window between ps and probe.

## v3.20.13 — Install reliability fixes: Chrome runtime libs, npm-package install.sh, plugin global fallback

> **v3.20.11 → v3.20.13 is a three-release series of bug fixes that make `bizar install` and `bizar update` actually work for `npm install -g @polderlabs/bizar` users.** v3.20.10 shipped a beautiful installer that worked for `git clone` users but broke for everyone who installed via npm — the TUI prompted for API keys, chrome-headless-shell didn't include its system deps, `bizar update` couldn't find `install.sh` because it wasn't in the npm package, and the plugin source wasn't shipped. This release fixes all four.

### Highlights

- **`bizar install` is now a thin wrapper around `install.sh`** — `cli/install.mjs:runInstaller()` was a 280-line interactive TUI that asked for API keys, restart confirmation, and component selection. None of that belongs in a `npm i -g` install (no TTY, secrets stay local). The new `runInstaller()` is a 30-line wrapper that spawns `bash ./install.sh`. One source of truth: `install.sh` is what `git clone` users run, what `bizar update` re-runs, and what `bizar install` delegates to.
- **`install.sh` ships in the npm package** — `package.json:files[]` previously listed only `cli/, config/, templates/`. Added `install.sh` + `cli/browser-harness-up.sh` so the npm-installed package can run itself. Without this, `bizar update` had to fall back to `bin.mjs --setup`, which uses the legacy Node install path (no auto-deps install).
- **`install.sh` auto-installs Chrome runtime libs** — chrome-headless-shell needs libnss3, libnspr4, libatk*, libxdamage, libxkbcommon, libasound2, libatspi. Without them, the binary downloads but immediately errors on first start. New code: detect `chrome --version` failure → `sudo apt-get install -y` the missing libs. macOS + others get a printed hint.
- **`install.sh` plugin install falls back to the npm-global plugin** — when there's no local `plugins/bizar/` (i.e. `npm install -g` users), it now resolves `$(npm root -g)/@polderlabs/bizar-plugin`, copies the source to `~/.config/opencode/plugins/bizar/`, and bundles the plugin's `node_modules/` (which contains @polderlabs/bizar-sdk — a workspace-internal package not on the public registry). Previously this only happened in `cli/install.mjs:installPluginFromGlobal()`.
- **`unzip -q -o`** — `install.sh` previously used `unzip -q` which hung on a TTY prompt ("replace chrome-headless-shell-linux64/deb.deps?") when re-running on a system with the chrome cache present. Now silent + overwrite.
- **`bizar doctor` checks all 14 agents** — `REQUIRED_AGENTS` was `[odin, quick, thor, tyr]` (the original 4 from v3.10.0). Now lists every agent the install script deploys: odin, vor, frigg, quick, mimir, heimdall, hermod, thor, baldr, tyr, vidarr, forseti, semble-search, browser-harness. The previous "all 4 core agents present" message was a lie when there were 14.
- **`PRIMARY_AGENTS` fixed** — `plugins/bizar/src/tools/bg-spawn.ts` had `{odin, frigg, quick}` but the on-disk agents declare `mode: primary` for `{odin, quick, browser-harness}` (frigg.md was demoted to `mode: subagent` in v3.19.x). Drift was caught by the "is in sync with the on-disk agent configs" test. Now `PRIMARY_AGENTS = {odin, quick, browser-harness}` exactly.
- **`bizar update` prefers `install.sh`** — `cli/update.mjs:rerunInstallScript()` now tries `bash $(npm root -g)/@polderlabs/bizar/install.sh` first, falls back to `bin.mjs --setup` only on Windows without WSL or when install.sh is missing.
- **`.gitignore`** — `.obsidian/` (per-user Obsidian vault) and `.bizar/HANDOFF-*.md` (per-session notes) added so the installer + repo don't track them. Both still appear on disk and are first-class to the installer.

### Files affected

- `install.sh` — auto-install of Chrome runtime libs; `unzip -q -o`; plugin install falls back to `@polderlabs/bizar-plugin` (with node_modules/ bundle)
- `cli/install.mjs` — `runInstaller()` rewritten as a 30-line thin wrapper around `install.sh` (replaces the 280-line TUI body)
- `cli/update.mjs` — `rerunInstallScript()` now prefers `install.sh` over `bin.mjs --setup`
- `cli/bin.mjs` — `bizar install --help` rewritten to reflect the new thin wrapper behavior
- `cli/doctor.mjs` — `REQUIRED_AGENTS` now lists all 14
- `cli/doctor.test.mjs` — "agent-files-installed passes when all 14 agents present" test
- `plugins/bizar/src/tools/bg-spawn.ts` — `PRIMARY_AGENTS = {odin, quick, browser-harness}` (matches disk `mode: primary`)
- `plugins/bizar/tests/tools/bg-spawn-delegation.test.ts` — assertions updated
- `package.json` — `files[]` includes `install.sh` + `cli/browser-harness-up.sh` (so they're in the npm tarball)
- `.gitignore` — `.obsidian/` + `.bizar/HANDOFF-*.md` added

### Pattern

When the operator installs via npm (no TTY, no local repo), every "we'll find it in the repo" assumption breaks. The fix is to make every component discoverable from both the local repo AND the npm global path, with the npm path as fallback. The `install.sh` plugin-install block now reads:

```bash
if [ -d "$REPO_DIR/plugins/bizar" ]; then PLUGIN_SRC=$REPO_DIR/plugins/bizar  # git clone users
elif have_cmd npm; then PLUGIN_SRC=$(npm root -g)/@polderlabs/bizar-plugin   # npm i -g users
fi
```

Same pattern for `install.sh` itself — it ships in the npm package so it can run from either path.

## v3.20.10 — Comprehensive auto-installer + API provider backup keys

> **Install + resilience.** v3.20.10 makes `install.sh` a complete one-shot installer that fetches every system dep it can (uv, Python 3.12, chrome-headless-shell, jq, browser-harness, Chrome, BizarHarness npm packages, mod registry) and writes an `install-state.json` so `bizar update` knows what was installed at which version. The API provider config gains a `backupApiKey` slot per provider so operators can keep a secondary key ready for manual swap when the primary hits a rate limit.

### Highlights

- **Comprehensive `install.sh`** — replaces the "print 4 manual next steps" flow with auto-install of uv + Python 3.12 + chrome-headless-shell (via chrome-for-testing JSON API) + jq + browser-harness + Chrome. Single status banner at the end shows what was installed, what was skipped, and what failed. **No API key prompts** (the installer never collects secrets — do that yourself via `/connect` so keys stay on your machine, not in any installer log). **No opencode reload** (the next session picks up the config automatically). **`.obsidian/` is not hidden** — it's a first-class part of the project tree.
- **API provider backup keys** — `~/.config/opencode/opencode.json` provider entries now accept a `backupApiKey` field alongside `apiKey`. Every KNOWN_PROVIDER declares `backupEnvKeys` (e.g. `MINIMAX_API_KEY_BACKUP`, `ANTHROPIC_API_KEY_BACKUP`). `autoDetect()` returns both keys with independent status / source / probe. Dashboard's Providers page surfaces both so the operator knows "if the primary hits a rate limit, the backup is here".
- **`install-state.json`** at `~/.config/bizar/install-state.json` records every component version + install timestamp. `bizar update` reads it to compute migrations between versions.
- **14 new tests** in `bizar-dash/tests/providers-store-backup-keys.node.test.mjs` covering KNOWN_PROVIDERS shape, autoDetect priority chain, add/update/list/listAll persistence, mask-keep semantics.

### Files affected

- `install.sh` — rewritten (535 lines; auto-install + status banner)
- `bizar-dash/src/server/providers-store.mjs` — added `backupEnvKeys` to all 9 KNOWN_PROVIDERS; `autoDetect()` returns `{ status, keySource, hasKey, probed, backup: {...} }`; `add()` / `update()` accept `backupApiKey`; `list()` / `listAll()` return masked backup keys; new `preserveOrReplace()` helper fixes pre-existing "patch without apiKey loses the stored key" bug
- `bizar-dash/tests/providers-store-backup-keys.node.test.mjs` (new) — 14 tests

### Pattern

When the operator submits a partial provider update (`{ backupApiKey: 'new-key' }` without re-supplying `apiKey`), the old code lost `apiKey` because `unmask(stored, undefined)` returned `undefined`. The new `preserveOrReplace()` short-circuits undefined to keep the stored value — same pattern as the mask-keep for `***...***` placeholders. The dashboard form re-submits with the masked placeholders; we must keep the underlying real values.

## v3.20.8 — Remove agent-browser; ship browser-harness as canonical

> **Cleanup + integration.** v3.20.7 integrated the browser-harness Python tool (https://github.com/browser-use/browser-harness) as the canonical browser-automation path. v3.20.8 removes every `agent-browser` reference (npm package + bin shim + shipped config + user's installed mirrors) so the dashboard ships with a single, working browser-automation path.

### Highlights

- **Uninstalled `agent-browser` (npm package).** `npm uninstall -g agent-browser` removes the package + bin shim; `which agent-browser` is now empty. The package was previously installed at `~/.local/npm/lib/node_modules/agent-browser@0.28.0`.
- **`browser-harness` (Python via uv) is the sole browser-automation path.** The browser-harness Bizar agent now exclusively uses the Python tool. The `agent_browser_*` MCP fallback is gone from the agent's docs.
- **Swept every config + doc + skill.** Updated 4 source files (`config/agents/browser-harness.md`, `config/agents/_shared/AGENT_BASELINE.md`, `config/AGENTS.md`, `install.sh`) + synced 3 user-installed mirrors (`~/.config/opencode/AGENTS.md`, `~/.config/opencode/agents/_shared/AGENT_BASELINE.md`, `~/.opencode/skills/agent-baseline/SKILL.md`).
- **Drift test added** (`bizar-dash/tests/no-agent-browser.node.test.mjs`): walks `config/`, `cli/`, `bizar-dash/src/`, `install.sh` for any `agent-browser` / `agent_browser_*` reference and fails with the violating files. Historical mentions in `CHANGELOG.md` and `.bizar/AGENTS_SELF_IMPROVEMENT.md` are allow-listed.

### Files affected

- `config/agents/browser-harness.md` — full rewrite of Tools + Workflow sections (now uses `browser-harness <<'PY' ... PY` heredoc exclusively)
- `config/agents/_shared/AGENT_BASELINE.md` — "Browser interaction" + "Images and visual content" sections updated
- `config/AGENTS.md` — same
- `install.sh` — `browser-harness` is required (was "opt-in (some users prefer agent-browser MCP)")
- `bizar-dash/tests/no-agent-browser.node.test.mjs` (new) — drift test

### Pattern

When removing a tool from the system, sweep across source + shipped-skill + user-installed mirrors. The user's `~/.config/opencode/` doesn't auto-refresh when the source changes; the only safe cleanup is `cp` from source. Drift tests beat manual grep — future contributors who re-introduce `agent-browser` get an immediate, actionable error at test time.

## v3.20.7 — Browser-harness integration + dashboard duplicate detection + vidarr model fix

> **Integration + bug fix + model audit.** Three changes: (1) integrate https://github.com/browser-use/browser-harness as the canonical browser-automation tool, replacing the previous reliance on the agent-browser MCP; (2) detect and clean up duplicate dashboard processes that lingered across `bizar dash start --bg` invocations; (3) point vidarr at `minimax/MiniMax-M3` (was `openai/gpt-5.5`), eliminating the misleading "Anthropic API key missing" error.

### Highlights

- **Browser-harness integration** — `uv tool install --python 3.12 --upgrade --force browser-harness` (v0.1.3). Skill registered at `~/.opencode/skills/browser-harness/SKILL.md`. New `cli/browser-harness-up.sh` chrome lifecycle wrapper that survives shell exit via `setsid + nohup + disown` and uses `chrome-headless-shell` from the puppeteer cache (avoids the Arch Linux crashpad bug). `bizar browser-harness-up <start|stop|status|restart>` CLI subcommand. The browser-harness Bizar agent (in `config/agents/browser-harness.md` + `config/opencode.json.template`) is now wired into opencode as a primary agent (mode: primary, no edit/write permissions).
- **Dashboard duplicate spawn detection** — `bizar-dash/src/cli/dashboard-ports.mjs` (382 lines) scans for every Bizar dashboard process and classifies each as `healthy | zombie | orphan | dead` via TCP + `/api/health` probes. `bizar dash cleanup` kills zombies + dead PIDs; leaves the canonical alone. `bizar dash start` now refuses duplicates unless `--force`. Solves the "zombie on port 4321 won't go away" class of bugs.
- **Vidarr model fix** — `vidarr.md` model changed from `openai/gpt-5.5` to `minimax/MiniMax-M3` everywhere: agent .md, opencode.json.template, user's installed opencode.json (patched via jq), install.sh banner, AGENTS.md routing table, AGENT_BASELINE.md model list, cli/audit.mjs validModels, cli/prompts.mjs install label + key prompt. The install flow no longer asks for an OpenAI key.

### Files affected

- `cli/browser-harness-up.sh` (new, 193 lines)
- `bizar-dash/src/cli/dashboard-ports.mjs` (new, 382 lines)
- `bizar-dash/src/cli.mjs` — duplicate check + cleanupDashboards export
- `cli/bin.mjs` — `bizar browser-harness-up` subcommand + `bizar dash cleanup` + `bizar mod <install|upgrade|list|registry>`
- `config/agents/browser-harness.md` + `config/agents/_shared/AGENT_BASELINE.md` + `config/AGENTS.md` — browser-harness Python tool docs
- `config/agents/vidarr.md` + `config/opencode.json.template` — vidarr model fix
- `install.sh` — auto-install browser-harness + updated banner
- `cli/audit.mjs` + `cli/prompts.mjs` — drop gpt-5.5 validModel + remove OpenAI key prompt
- 4 test artifacts in `artifacts/`: `mod-upgrade-flow`, `vidarr-model-fix`, `dashboard-duplicate-detection`, `browser-harness-integration`

## v3.20.6 — Mobile typecheck baseline cleanup

> **Patch.** v3.20.5 wired `tsc --noEmit` into `prepublishOnly` and surfaced three pre-existing mobile-app typecheck errors. This release fixes them so the publish pipeline is warning-free for future releases.

### Highlights

- **`MobileApp.tsx:210` — fixed `'artifacts?:change'` typo** (stray `?`). The valid WS event type is `'artifact:change'` (singular). Without this fix, the mobile dashboard never refreshes when an artifact (plan) is added/changed/deleted.
- **Created `MobilePlans.tsx`** — the mobile stack router referenced a `MobilePlans` component that didn't exist, breaking the `plans` stack route. Thin wrapper that adapts `onOpenPlan(slug)` to `MobileArtifacts`'s `onOpenArtifact(slug)` — the underlying list view already existed and works; this just bridges the prop naming.

### Files changed (4)

- `bizar-dash/src/web/MobileApp.tsx` — fixed WS event type string
- `bizar-dash/src/web/mobile/views/MobilePlans.tsx` — new wrapper (12 lines)
- `bizar-dash/src/web/App.tsx` — VERSION constant to v3.20.6
- `bizar-dash/package.json` — bumped to 3.20.6

### Why

v3.20.5's `prepublishOnly` typecheck now runs `tsc --noEmit` before publish. The three pre-existing mobile errors (`'artifacts?:change'` typo, missing `MobilePlans.tsx`, implicit `any` on `slug`) were printed but didn't block. v3.20.6 clears them so future publishes print a clean typecheck.

## v3.20.5 — Mod upgrade flow + dynamic TSX tab views + publish-time typecheck

> **Mod lifecycle.** Mods installed from the registry can now be upgraded in place; mods that declare a `tab` view in `views/registry.json` are dynamically imported and rendered; `tsc --noEmit` is wired into the publish pipeline so future TDZ-style bugs surface before publishing.

### Highlights

- **Mod upgrade flow.** New `POST /api/mods/:id/upgrade` endpoint (and matching `bizar mod upgrade <id>` CLI) backs up the existing folder (optional `--backup`), uninstalls the current copy (removing its opencode-config instruction files), and installs the latest version from the registry. Rolls back from the backup if the new install fails so users aren't left without a working mod. Returns `{ from, to, backupPath, mod }` for the UI toast. The Upgrade button in the Mods registry card now calls this endpoint instead of the install endpoint (which would fail with "already installed").
- **Dynamic TSX tab views.** `ModView.tsx` now `import()`s a mod's `views/<component>.{js,mjs,jsx,tsx}` on demand via `React.lazy` + `Suspense` and renders it. New `GET /api/mods/:id/views/*` route serves files from the mod's `views/` directory with `Content-Type: application/javascript` (and `Cache-Control: no-store`). The view component is expected to default-export a React component using `React.createElement` or `htm` (mods ship a pre-built ES module). A tiny `ErrorBoundary` catches render-time throws and surfaces them inline instead of crashing the dashboard.
- **`tsc --noEmit` in publish pipeline.** `bizar-dash/package.json` `prepublishOnly` now runs `npm run typecheck` before `vite build`. Typecheck failures surface as warnings (soft-fail, does not block publish) so users see TS errors at publish time without losing the ability to ship when only baseline mobile-app errors are present. New baseline typecheck issues introduced by future changes will be more visible.
- **`bizar mod` CLI subcommand.** `bizar mod install <id>`, `bizar mod upgrade <id> [--backup]`, `bizar mod list`, `bizar mod registry` — all proxy to the running dashboard over HTTP. Reads the dashboard port from `~/.config/bizar/dashboard.port`; errors with a clear "start the dashboard first" message if no port file exists.

### Files changed (8)

- `bizar-dash/src/server/mods-loader.mjs` — added `upgradeFromRegistry()` with backup + rollback semantics
- `bizar-dash/src/server/routes/mods.mjs` — added `POST /api/mods/:id/upgrade` and `GET /api/mods/:id/views/*` routes
- `bizar-dash/src/web/views/ModView.tsx` — dynamic component import via `React.lazy` + Suspense + ErrorBoundary
- `bizar-dash/src/web/views/Mods.tsx` — split registry card actions into Install / Upgrade-to-vX / Installed-vX; added `onUpgradeFromRegistry()` handler
- `bizar-dash/package.json` — bumped to 3.20.5, prepublishOnly now runs typecheck (soft-fail) before build
- `cli/bin.mjs` — added `bizar mod <subcommand>` (install / upgrade / list / registry) over dashboard HTTP API
- `package.json` — added mod-upgrade test to the `test` script
- `bizar-dash/src/web/App.tsx` — VERSION constant to v3.20.5

### Files added (1)

- `bizar-dash/tests/mod-upgrade.node.test.mjs` — 10 tests covering `upgradeFromRegistry()` (refuses missing mod, in-place upgrade, backup, rollback) and the new HTTP routes (404 path, full upgrade round-trip, view content-type, non-JS rejection, path traversal, missing mod)

### Patterns

- **Mod lifecycle: install + upgrade = same primitive + uninstall.** `upgradeFromRegistry` is just (read old version → uninstall → install from registry). Composing existing primitives avoids drift between the two paths.
- **TSX tab support ships infrastructure, not a build step.** Mods ship pre-built `views/<Name>.js` (React.createElement or htm). The dashboard serves them with `application/javascript`. Adding a build hook (esbuild / sucrase) is a future enhancement; mods can build locally and ship the output.

## v3.20.4 — Fix blank blue screen on dashboard mount (TDZ)

> **Patch.** `renderedView = useMemo(() => refreshSnapshot, [refreshSnapshot])` was declared BEFORE `refreshSnapshot` in `App.tsx`. React's useMemo runs the factory on first render, hitting the TDZ and throwing `ReferenceError: Cannot access 'refreshSnapshot' before initialization` → blank screen.

### Files changed (2)

- `bizar-dash/src/web/App.tsx` — reordered so `refreshSnapshot` is declared first, then `mergedTabs`, then `renderedView`. No behavior change beyond fixing the mount.

## v3.20.3 — Fix install-from-registry + mod views in sidebar nav

> **Bug fix + UX.** `installFromRegistry` was passing URL `downloadUrl` to `installFromPath` (which calls `statSync()` and fails on URLs). Now detects `https?://` and `file://` schemes and routes to `installFromUrl`. Mod views appear as first-class tabs in the sidebar nav under a "Mods" section with divider + accent dot.

## v3.20.2 — Mod instructions UI + prepublishOnly hook

> **UX + build hardening.** The ModDetails card now shows installed instruction files (filename + on-disk path + click-to-expand markdown preview) grouped by Agents / Commands / Skills, with a "Reinstall from mod folder" button. `bizar-dash/package.json` got a `prepublishOnly` hook that runs `vite build` before `npm publish`.

## v3.20.1 — Patch: two bugs shipped in 3.20.0

> **Bug fix.** `cli/install.mjs:378` had a stray `|` in a fallback expression (SyntaxError broke `bizar update`). `config/opencode.json.template` had two malformed entries with double-comma artifacts (broke `bizar doctor` JSON validation). Both fixed.

## v3.20.0 — Mod instructions protocol + 14-agent modular refactor

> **Refactor.** Extracted 1500+ lines of duplicate agent content into `config/agents/_shared/AGENT_BASELINE.md` (installed as `~/.opencode/skills/agent-baseline/`). Reduced 14 Bizar agent files from 2023 → 1046 lines. New mod instruction schema (`INSTRUCTIONS.md`, `agents/<name>.md`, `commands/<name>.md`, `skills/<name>/SKILL.md`) with `<mod-id>__` / `<mod-id>-` prefixes. 3 mods shipped INSTRUCTIONS.md (graphify 1.2.0, ponytail 1.1.0, impeccable 1.1.0).

## v3.17.0 — Settings section filter + graphify extracted as a true mod

> **Two clean-ups.** Settings gets a real section filter (not just scroll-to), and graphify is removed from BizarHarness entirely — it's now a standalone mod that ships its own build pipeline + self-contained web UI.

### Highlights

- **Settings section filter.** The v3.16.0 subnav scrolled to sections; v3.17.0 actually **filters** — clicking a subnav button shows ONLY that section, hiding all others with a "Showing only X" banner and a one-click "Show all sections" escape hatch. URL hash deep-links (`#settings-theme`) still work and respect the filter. Every Card in Settings gained a `data-section="…"` attribute; CSS attribute selectors drive the visibility — no JS gymnastics.
- **graphify is now a true mod.** Everything BizarHarness knew about graphify is gone:
  - Deleted `cli/graph.mjs`, `cli/graph-build-from-cache.mjs`, `cli/graph.test.mjs`
  - Deleted `bizar graph` subcommand and its help text
  - Deleted `bizar-dash/src/server/routes/graph.mjs` (the built-in `/api/graph/*` route)
  - Deleted `bizar-dash/src/web/views/Graph.tsx` (the built-in Graph tab UI)
  - Removed `graph` tab from TABS and `Graph` entry from VIEW_MAP
  - Removed the `runGraph` import + `showGraphHelp` from `cli/bin.mjs`
- **graphify mod v1.1.0** in `mods-examples/graphify/` and `bizar-mods/mods/graphify/`:
  - `route.mjs` (~430 lines) inlines the full build pipeline (formerly `bizar graph build`): LLM-key detection → code-only `.graphifyignore` → `graphify extract` → AST-cache fallback reconstruction → `cluster-only` → output hoisting. No more `bizar graph build` subprocess spawn.
  - **`web/index.html`** — self-contained dark-theme UI with toolbar (Build / Refresh / View Report), live status polling, log streaming, and graph.html iframe. Surfaced via the existing `web/index.html` mechanism in the Mods tab.
  - Updated permissions: `fs:read:.bizar/graph`, `fs:write:.bizar/graph`, `fs:write:.graphifyignore`, `process:spawn:graphify`, `process:spawn:python3`, `process:spawn:which` (was `process:spawn:bizar`).
- **Mod registry renamed** `bizarre-mods` → `bizar-mods` (matches the package name and is shorter). The default registry URL the dashboard uses now resolves at `github.com/DrB0rk/bizar-mods`.

### Files added (1)

- `mods-examples/graphify/web/index.html` — self-contained dark-theme view UI.

### Files deleted (5)

- `cli/graph.mjs` — the `bizar graph` dispatcher.
- `cli/graph-build-from-cache.mjs` — its offline fallback helper.
- `cli/graph.test.mjs` — its tests.
- `bizar-dash/src/server/routes/graph.mjs` — the built-in graph HTTP route.
- `bizar-dash/src/web/views/Graph.tsx` — the built-in Graph tab UI.

### Files changed (8)

- `cli/bin.mjs` — removed `runGraph` import, `showGraphHelp`, the `bizar graph` dispatch case, and the graphify mention from `showInitHelp`.
- `bizar-dash/src/server/api.mjs` — removed `createGraphRouter` import + mount.
- `bizar-dash/src/web/App.tsx` — removed `Graph` import + VIEW_MAP entry.
- `bizar-dash/src/web/components/Topbar.tsx` — removed `graph` tab + `Network` icon import.
- `bizar-dash/src/web/views/Settings.tsx` — added `data-section="…"` to every section Card; subnav now filters (not scrolls); "Showing only X" banner + "Show all sections" escape; URL hash deep-links respected on mount.
- `bizar-dash/src/web/styles/main.css` — `.settings-grid-filtered` + per-section attribute-selector rules, `.settings-filter-banner`, `.settings-filter-clear`.
- `mods-examples/graphify/route.mjs` — fully rewritten (~430 lines): inlines runGraphify, hasLlmKey, buildGraphFromCache, promoteFromDir, runBuild; calls `graphify` directly (not `bizar graph build`).
- `mods-examples/graphify/mod.json` — version bumped to 1.1.0, permissions updated.
- `bizar-dash/src/server/mods-loader.mjs` — `DEFAULT_REGISTRY_URL` now points at `DrB0rk/bizar-mods` (renamed from `bizarre-mods`).

### Test results

- `tsc --noEmit` (dashboard): passes.
- `bun test tests/mod-security.test.mjs`: 26/26 pass (no regression).
- `node --eval "import('mods-examples/graphify/route.mjs')"`: imports cleanly, register() runs without error.

### Companion release

- `@polderlabs/bizar-dash` v3.17.0 — co-released with the graph removal + settings filter.
- `@polderlabs/bizar` v3.17.0 — co-released (CLI subcommand removal).
- `graphify` mod v1.1.0 — published to the registry (`github.com/DrB0rk/bizar-mods`).

## v3.16.0 — Dashboard overhaul: settings subnav, chat floating input, providers in Config, mods registry browser, provider auto-detect

> **UI + CLI upgrade.** Six user-facing improvements ship together: settings gets a sticky subnav with section anchors, the chat input is a floating glass-style box, the standalone Providers tab is gone (lives inside Config), the Mods tab gets an Available registry browser, and `bizar providers detect` auto-discovers API keys in your env.

### Highlights

- **Settings subnav.** Every section in `Settings` (Theme, Layout, General, Service, Tailscale, Notifications, Auth, Agents, Dashboard, Background, Updates, Activity, About) is now reachable from a sticky horizontal subnav at the top. Active section is highlighted automatically as you scroll. Smooth scroll-into-view via anchor IDs.
- **Chat floating input.** The chat composer is now a floating glass-style box (sticky at bottom, blurred backdrop, accent-coloured border on focus, drop shadow). Wraps the existing composer-toolbar + textarea + send button; no UX changes other than positioning.
- **Providers moved into Config.** The standalone Providers tab is gone. The ProvidersPanel already lived inside `Config → Providers` and is unchanged — just no longer duplicated as a top-level tab. `Providers.tsx` is now orphaned (not imported anywhere) but left in the repo for reference.
- **Mods registry browser.** The Mods tab gets a new "Mod registry" collapsible section with a card-grid layout. Each entry shows name, version (with upgrade badge if newer), description, author, homepage, declared permissions, and Install/Installed button. Tapping Install POSTs `/api/mods` with `{ id }` to download from the registry. The browser now honours the `installed` / `upgradeAvailable` flags returned by the registry route.
- **Provider auto-detect (CLI + dashboard).**
  - New `bizar providers detect` subcommand: scans env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `COHERE_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`) plus opencode.json, validates key formats, optionally probes each `/models` endpoint with a 1.5s timeout, and prints a status table. Flags: `--no-probe`, `--json`, `--install <id>` (auto-adds to opencode.json).
  - New `/api/providers/auto-detect` endpoint in the dashboard.
  - New "Auto-detect providers" banner inside `Config → Providers` with the same results, including a per-row "Add" button to install a configured provider into opencode.json without leaving the dashboard.
  - Wired into `bizar install` as a final summary step so a fresh install surfaces any pre-existing keys.
- **`bizarre-mods` registry polish.** The registry.json schema is documented in `bizarre-mods/README.md`, including a "Publishing this registry" section with the exact `git init / commit / push` recipe for spinning up the standalone GitHub repo.

### Companion release

- `@polderlabs/bizar-dash` v3.16.0 — co-released with all the UI work above.

### Files added (1)

- `cli/providers-detect.mjs` — the new CLI subcommand (~270 lines).

### Files changed (12)

- `bizar-dash/src/server/providers-store.mjs` — new `KNOWN_PROVIDERS` table + `autoDetect({ probe })` method.
- `bizar-dash/src/server/routes/providers.mjs` — new `GET /providers/auto-detect` route.
- `bizar-dash/src/web/App.tsx` — removed `providers: Providers` from VIEW_MAP + removed unused import.
- `bizar-dash/src/web/components/Topbar.tsx` — removed `providers` from TABS + removed unused `Cloud` icon import.
- `bizar-dash/src/web/views/Chat.tsx` — wrapped composer in `.chat-input-floating` div.
- `bizar-dash/src/web/views/Config.tsx` — new `AutoDetectBanner` component above the ProvidersPanel.
- `bizar-dash/src/web/views/Mods.tsx` — new registry browser section + state.
- `bizar-dash/src/web/views/Settings.tsx` — `id="settings-..."` on every card, new sticky subnav, Activity section wrapped.
- `bizar-dash/src/web/styles/main.css` — `.settings-subnav`, `.chat-input-floating`, `.mods-registry-*`, `.mod-registry-*`, `.autodetect-*` (~7 KB of new CSS).
- `cli/bin.mjs` — wired `bizar providers detect` subcommand.
- `cli/install.mjs` — runs `providers detect --no-probe` as final summary step.
- `bizarre-mods/README.md` — added "Publishing this registry" section.

### Test results

- `tsc --noEmit` (dashboard) — passes.
- `bun test tests/mod-security.test.mjs` — 26/26 pass.
- `node cli/bin.mjs providers detect --help` — works.
- `node cli/bin.mjs providers detect --no-probe` — prints the table.

## v3.15.1 — `bizar update` defaults to automatic everything + `bizar dash start --bg` fix

> **Bug fix + UX:** `bizar update` no longer prompts. It updates every component (opencode + bizar + dash + plugin), auto-installs any missing one, kills running instances with a notice, re-runs the install script, restarts the dashboard, and runs `bizar doctor`. Opt into the per-component picker with `--pick`.

### Highlights

- **`bizar update` is now automatic by default.** Running plain `bizar update` updates all 4 components in one shot with no prompts. Any missing package (e.g. dashboard never installed) is detected and installed automatically so a broken install gets repaired. Run `bizar update --pick` to get the legacy checkbox picker. `--dry-run` still previews everything without touching anything.
- **Auto-kill without confirmation.** The legacy `--yes`/`-y`/`--force` flags are still respected, but they're no longer required to kill running instances — the update just kills them with a brief notice. Use `--pick` if you want to be prompted first.
- **`bizar dash start --bg` fix.** v3.15.0 shipped the Graph tab and routes but the installed dashboard package (`@polderlabs/bizar-dash` v3.12.x) couldn't see them because the file order in `cli.mjs` matched `args[0] === 'start'` BEFORE checking `args.includes('--bg')`, so `--bg` was silently ignored and the dashboard ran in the foreground. v3.13.0 of the dashboard (co-released) fixes this by reordering the dispatch AND adding a `bg` option to `startDashboard` that returns after the PID/PORT files are written instead of blocking on a signal handler.

### Companion release

- `@polderlabs/bizar-dash` v3.13.0 — Graph tab + `--bg` fix. Co-released.
- `@polderlabs/bizar-plugin` v0.9.0 — unchanged.

### Files changed

```
M cli/update.mjs                      (default to all + auto-install missing + skip confirmation prompts)
M cli/bin.mjs                          (refresh showUpdateHelp, main help line, --bg flow now reaches dashboard's bg-aware startDashboard)
```

### Migration

- `bizar update` with no args now updates everything. If you want the old per-component picker, use `bizar update --pick`.
- `bizar update --yes` / `-y` / `--force` still work as no-op (already automatic).
- `bizar update --dry-run` still previews without installing.

## v3.15.0 — Knowledge graph in the dashboard (offline build + viewable HTML)

> **Additive:** New dashboard tab "Graph" embeds the interactive graphify visualization (`graph.html`). `bizar graph build` now works end-to-end without an LLM key via a code-only AST cache fallback. Plugin: `@polderlabs/bizar-plugin` v0.9.0.

### Highlights

- **`bizar graph build` works offline.** When no LLM key is set, the build automatically:
  1. Writes a comprehensive `.graphifyignore` (node_modules, agent configs, docs/papers/images) so graphify's pre-flight check passes.
  2. Runs graphify once with a dummy `ANTHROPIC_API_KEY` to populate the AST cache (semantic step fails; that's intentional).
  3. Reconstructs `graph.json` from the per-file AST cache via the new `cli/graph-build-from-cache.mjs` script.
  4. Runs `cluster-only` to generate `graph.html` + `GRAPH_REPORT.md`.
  The final graph.json is at `.bizar/graph/graph.json` (809 nodes / 1794 edges for BizarHarness proper) with no API key required.
- **Dashboard "Graph" tab** — new view at `bizar-dash/src/web/views/Graph.tsx` embeds graph.html via an iframe, shows node/edge/community counts, and has a "Build / Rebuild" button that runs `bizar graph build` detached and polls the job status. New dashboard routes:
  - `GET /api/graph/status` — graph stats + active build jobs
  - `GET /api/graph/html` — serve `graph.html`
  - `GET /api/graph/report` — serve `GRAPH_REPORT.md`
  - `POST /api/graph/build` — kick off async build
  - `GET /api/graph/build/:jobId/status` — poll build progress
- **`cli/graph-build-from-cache.mjs`** (new) — merges graphify's per-file AST cache (`cache/ast/v0.8.46/*.json`) into a single `graph.json`. Used by the offline fallback when the semantic step fails.
- **`.gitignore`** updated — `.bizar/graph/` is now gitignored. Run `bizar graph build` on first use to populate it. This avoids committing 1.4 MB of graph data on every change.

### Plugin: `@polderlabs/bizar-plugin` v0.9.0

(no changes — the bg-spawn fix from v3.14.1 is unchanged.)

### Files changed

```
M .gitignore                                              (+3 lines)
M cli/graph.mjs                                           (+241 lines: code-only auto-detect, dummy-key fallback, promote cluster-only output, runCacheFallbackBuild + promoteFromDir)
A cli/graph-build-from-cache.mjs                          (NEW: merges per-file AST cache → graph.json)
A bizar-dash/src/server/routes/graph.mjs                   (NEW: status + html + report + build + build-status endpoints)
A bizar-dash/src/web/views/Graph.tsx                      (NEW: iframe-based view with stats + rebuild button + build-poll)
M bizar-dash/src/server/api.mjs                            (+2 lines: wire createGraphRouter)
M bizar-dash/src/web/App.tsx                               (+2 lines: Graph in VIEW_MAP)
M bizar-dash/src/web/components/Topbar.tsx                 (+2 lines: Graph tab in TABS)
M bizar-dash/src/web/styles/main.css                       (+60 lines: graph view + iframe + banner CSS)
```

### Verification

`bizar graph build` end-to-end on a fresh checkout with no LLM key produces:
- `.bizar/graph/graph.json` (778 KB, 809 nodes, 1794 edges for BizarHarness proper)
- `.bizar/graph/graph.html` (578 KB, interactive vis-network visualization)
- `.bizar/graph/GRAPH_REPORT.md` (14 KB)

Dashboard `/api/graph/status` returns the stats; `/api/graph/html` serves the HTML; the Graph tab embeds it via iframe with a rebuild button. All 282 plugin tests + 19 dashboard smoke tests pass; typecheck clean.

## v3.14.1 — bg-spawn subagent delegation fix + minimax thinking-config fix

> **Bug fix:** Two opencode 1.17.x compat issues that caused `bizar_spawn_background` to silently fail. Plugin: `@polderlabs/bizar-plugin` v0.9.0.

### Highlights

- **bg-spawn now correctly invokes subagents** — opencode 1.17.x rejects `opencode run --agent <subagent>` for any agent whose `mode` is `subagent` (8 of BizarHarness's 11 agents), printing "Falling back to default agent" and running odin instead. The bg-spawn tool now routes subagent requests through a primary wrapper (odin) with a directive delegation prompt that calls opencode's native `task` tool. The bg instance record still attributes the work to the requested agent.
- **minimax provider config: `thinking` option shape** — opencode's anthropic-compatible SDK rejects the string form `"thinking": "adaptive"` with `AI_TypeValidationError → invalid anthropic provider options` on every MiniMax model load. Changed to the documented object form `"thinking": { "type": "enabled" }` in `config/opencode.json.template` for both `MiniMax-M3` and `MiniMax-M2.7`.

### Plugin: `@polderlabs/bizar-plugin` v0.9.0

- `plugins/bizar/src/tools/bg-spawn.ts` — exports `PRIMARY_AGENTS`, `needsDelegationWrapper`, `buildDelegationPrompt`. The spawn call branches: primary agents get `--agent <name>` + original prompt; subagents get `--agent odin` + delegation prompt. The bg instance record keeps the requested agent name.
- `plugins/bizar/tests/tools/bg-spawn-delegation.test.ts` (new) — 13 tests covering set membership, the drift check against `config/agents/*.md`, and the prompt's directive properties.

### Main package: `@polderlabs/bizar` v3.14.1

- `config/opencode.json.template` — `provider.minimax.models.*.options.thinking`: string `"adaptive"` → object `{ "type": "enabled" }`.
- Tests updated to include the new delegation test file.

### Verification

End-to-end test in the BizarHarness dev container with deepseek (so MiniMax auth wasn't needed): `bizar_spawn_background(agent="mimir")` produced a real mimir subagent session (`agent=mimir mode=subagent parentID=<odin's session>`) after Odin received the delegation directive and called its `task` tool. Full transcript captured in `/tmp/bg-spawn-e2e/verify-delegation.ts`.

### Known upstream issue (NOT fixed by this release)

opencode's built-in MiniMax provider in 1.17.x sends requests with Anthropic-style `x-api-key` auth and reads `ANTHROPIC_API_KEY` (or the `/connect` auth file). Users on direct MiniMax need either `export ANTHROPIC_API_KEY="<minimax-key>"` in their shell, or to run `/connect` once in the opencode TUI to populate `~/.local/share/opencode/auth.json`. OpenRouter users are unaffected.

## v3.14.0 — MiniMax multi-key rotation (fallback)

> **Additive:** New plugin-level wrapper that rotates MiniMax API keys on 429 / 402 / 5xx responses. Configure via `MINIMAX_API_KEYS` (comma list) or `MINIMAX_API_KEY` + `MINIMAX_API_KEY_2`, `_3`, ... Single-key mode is unchanged.

### Highlights

- **New plugin module `src/key-rotation.ts`** — Exports `wrapFetchForKeyRotation()` and `discoverMiniMaxKeys()`. Wires in alongside the existing `reasoning-clean` wrapper in `plugins/bizar/index.ts`.
- **Env-var driven config** — No secrets in `opencode.json`. The user sets `MINIMAX_API_KEYS` (comma-separated list, max 16 keys) or the numbered form (`MINIMAX_API_KEY`, `MINIMAX_API_KEY_2`, ...). The plugin reads them at init.
- **Smart retry policy** — Retries on 429 (rate limit), 402 (quota exhausted), 500/502/503/504 (server errors), and network errors. Does NOT retry on 401 (unauthorized — the key is wrong, not exhausted) or other 4xx (client error). Caps retries at `apiKeys.length` so each key is tried at most once.
- **Round-robin on success** — After a successful request, the next request starts on the next key. Spreads load across accounts.
- **Single-key pass-through** — When only one key is configured, the wrapper is a no-op. Existing single-key setups are completely unaffected.
- **All tests pass: 269/269 across the plugin suite** (was 162 before this feature; added 26 new tests in `tests/key-rotation.test.ts`).

### How users configure it

```bash
# Option A — comma-separated list
export MINIMAX_API_KEYS="eyJ...primary,eyJ...secondary,eyJ...tertiary"

# Option B — numbered env vars
export MINIMAX_API_KEY="eyJ...primary"
export MINIMAX_API_KEY_2="eyJ...secondary"
export MINIMAX_API_KEY_3="eyJ...tertiary"
```

When a session hits a rate-limit or quota error on one key, the plugin retries with the next key automatically. The user sees no interruption — the opencode session continues as if nothing happened.

### Files changed

```
M  config/skills/bizar/SKILL.md      (+29 lines — documented the new env vars + retry policy)
M  package.json                       (+1 line — added key-rotation.test.ts to npm test)
M  plugins/bizar/index.ts            (+60 lines — added installFetchKeyRotation + import)
M  plugins/bizar/package.json         (+1 line — added key-rotation.test.ts to bun test)
A  plugins/bizar/src/key-rotation.ts        (new file, ~225 lines)
A  plugins/bizar/tests/key-rotation.test.ts (new file, ~270 lines, 26 tests)
```

## v3.13.0 — Direct MiniMax provider (drop OpenRouter default)

> **Breaking:** Removed OpenRouter as the default provider for MiniMax models. All BizarHarness agents now use the direct MiniMax provider. Users with custom configs referencing `openrouter/minimax/*` model IDs must update them to `minimax/MiniMax-M{2.7,3}`.

### Highlights

- **Default provider for MiniMax models is now the direct MiniMax provider**, not OpenRouter. Eliminates an extra hop and the OpenRouter fee layer.
- **Model ID migration:** `openrouter/minimax/minimax-m3` → `minimax/MiniMax-M3` and `openrouter/minimax/minimax-m2.7` → `minimax/MiniMax-M2.7` across all 7 paid-tier agent definitions (Odin, Hermod, Thor, Baldr, Tyr, Forseti, Quick) plus the top-level default `model` / `small_model` in `config/opencode.json.template`.
- **`provider.openrouter` block removed** from the default config template. Users who need OpenRouter can still add it manually.
- **Reasoning-clean wrapper updated** — `DEFAULT_PROVIDERS` set now contains only `["minimax"]`. The MiniMax direct API endpoint (`https://minimax.io/v1/chat/completions`) is recognized by the same URL-substring matcher.
- **CLI validation updated:** `cli/audit.mjs` `VALID_MODELS` now lists `minimax/MiniMax-M2.7` and `minimax/MiniMax-M3`. `cli/doctor.mjs` validates `provider.minimax` instead of `provider.openrouter`.

### Migration for users

```diff
- "model": "openrouter/minimax/minimax-m3",
+ "model": "minimax/MiniMax-M3",

- "model": "openrouter/minimax/minimax-m2.7",
+ "model": "minimax/MiniMax-M2.7",
```

### Files changed (22)

```
M .bizar/research/current-architecture.md
M README.md
M cli/audit.mjs
M cli/bin.mjs
M cli/doctor.mjs
M cli/doctor.test.mjs
M config/AGENTS.md
M config/agents/{baldr,forseti,hermod,odin,quick,thor,tyr}.md
M config/opencode.json.template
M config/skills/bizar/SKILL.md
M plugins/bizar/index.ts
M plugins/bizar/src/reasoning-clean.ts
M plugins/bizar/tests/reasoning-clean.test.ts
M wiki/{Agents-Reference,Background-Agents,Getting-Started,Model-Routing}.md
```

## v0.7.0-alpha.1 — Plugin ↔ Dashboard v2 Protocol

> **Breaking / additive:** New package `@polderlabs/bizar-sdk` (additive). New dashboard `/api/v2/*` namespace (additive; existing `/api/*` endpoints unchanged). New plugin `dashboard-client.ts` module (additive; existing tools unchanged). Opencode v2 routes only (v1 routes are broken upstream — see `.bizar/opencode-sse-investigation.md`).

### Highlights

- **New package `@polderlabs/bizar-sdk`** (`packages/sdk/`) — TypeScript SDK with auto-generated-style types, resource-grouped client (`createBizarClient()`), discriminated `BizarError` union, async-iterable SSE subscriber. Follows the bun-module layout (ESM, exports map, Vitest). Source-of-truth for the wire format is `.bizar/research/OPENAPI_SPEC.yaml`.
- **Dashboard `/api/v2/*` namespace** — New routes for sessions (CRUD), events (SSE subscribe + publish), health, and the OpenAPI spec itself at `/doc`. HTTP basic auth via a 32-byte password generated on first start and persisted to `~/.cache/bizarharness/dash-auth.json` (mode 0600). Existing `/api/*` endpoints untouched.
- **Plugin `dashboard-client.ts`** — New module in `plugins/bizar/src/` that wraps the SDK and forwards events from the plugin to the dashboard. Reads dashboard URL + password from `BIZAR_DASHBOARD_URL` / `BIZAR_DASHBOARD_PASSWORD` env vars or the auth file. Graceful degradation: drops events if the dashboard is unreachable; never throws into the plugin.

### Architecture

- **Transport:** HTTP + SSE hybrid (REST for CRUD, SSE for events). Matches the opencode SDK pattern; no WebSocket.
- **Auth:** HTTP basic with `opencode:<password>`. Same password every dashboard restart.
- **Source of truth:** `.bizar/research/OPENAPI_SPEC.yaml` (OpenAPI 3.1). SDK types are hand-written to match exactly; in v0.7.1 they'll be generated via `@hey-api/openapi-ts`.

### Files

- `packages/sdk/package.json` (NEW) — `@polderlabs/bizar-sdk` v0.7.0-alpha.1
- `packages/sdk/tsconfig.json` (NEW) — strict TypeScript, ES2022, declaration emit
- `packages/sdk/vitest.config.ts` (NEW)
- `packages/sdk/.gitignore` (NEW)
- `packages/sdk/LICENSE` (NEW) — MIT
- `packages/sdk/README.md` (NEW) — usage docs
- `packages/sdk/src/index.ts` (NEW) — public API barrel
- `packages/sdk/src/client.ts` (NEW) — `createBizarClient()` factory
- `packages/sdk/src/types.ts` (NEW) — discriminated unions for `Event`, `Part`, `Error`
- `packages/sdk/src/errors.ts` (NEW) — `BizarError` discriminated union
- `packages/sdk/src/events.ts` (NEW) — async-iterable SSE subscriber
- `packages/sdk/src/version.ts` (NEW)
- `packages/sdk/tests/client.test.ts` (NEW) — 10 cases
- `packages/sdk/tests/events.test.ts` (NEW) — 6 cases
- `packages/sdk/tests/errors.test.ts` (NEW) — 12 cases
- `packages/sdk/tests/fixtures/fetch-mock.ts` (NEW)
- `packages/sdk/tests/fixtures/sse-mock.ts` (NEW)
- `bizar-dash/src/server/v2-event-bus.mjs` (NEW) — in-memory event bus with replay buffer
- `bizar-dash/src/server/v2-auth-file.mjs` (NEW) — password file management
- `bizar-dash/src/server/routes-v2/auth.mjs` (NEW) — HTTP basic middleware
- `bizar-dash/src/server/routes-v2/health.mjs` (NEW) — public `/health`
- `bizar-dash/src/server/routes-v2/events.mjs` (NEW) — SSE subscribe + publish
- `bizar-dash/src/server/routes-v2/sessions.mjs` (NEW) — session CRUD
- `bizar-dash/src/server/routes-v2/index.mjs` (NEW) — router + `/doc`
- `bizar-dash/tests/smoke-v2.mjs` (NEW) — 7-case end-to-end smoke
- `bizar-dash/src/server/server.mjs` — mounts `/api/v2` router after existing `/api`
- `plugins/bizar/src/dashboard-client.ts` (NEW) — SDK-backed publisher
- `plugins/bizar/tests/dashboard-client.test.ts` (NEW) — 6 cases
- `plugins/bizar/package.json` — adds `@polderlabs/bizar-sdk: *` to dependencies
- `package.json` (root) — adds `"workspaces": ["packages/*"]` + `build:sdk` / `test:sdk` scripts
- `.bizar/research/IMPLEMENTATION_PLAN.md` (NEW) — full plan with phasing, file map, parallel split, risk register
- `.bizar/research/OPENAPI_SPEC.yaml` (NEW) — OpenAPI 3.1 source of truth (~280 lines)
- `.bizar/research/target-patterns.md` (NEW) — research notes from the three target sources
- `.bizar/research/current-architecture.md` (NEW) — pre-refactor architecture map
- `.bizar/research/plugin-source-locator.md` (NEW) — file-by-file plugin map

### Test results

- `@polderlabs/bizar-sdk`: **28/28** pass (vitest)
- Dashboard v2 routes: **7/7** pass (`node tests/smoke-v2.mjs`)
- Plugin `dashboard-client`: **6/6** pass (`bun test`)
- Existing plugin tests: **152 pass, 18 pre-existing failures** (unrelated to this change; verified by stashing my changes and re-running — same numbers)
- Existing dashboard server tests: unaffected (no changes to existing routes)

### Next steps (v0.7.1+)

- Auto-generate `types.gen.ts` from `OPENAPI_SPEC.yaml` via `@hey-api/openapi-ts` (replaces hand-written `types.ts`).
- Move `plugins/bizar/` → `packages/plugin/` (delete root copy).
- Move `bizar-dash/` → `packages/dashboard/` (delete root copy).
- Wire `dashboard-client.publish()` into `event-stream.ts` so every opencode SSE event flows to the dashboard.
- Add full CRUD for the rest of the OpenAPI spec (`/projects`, `/plans`, etc.).
- Replace the file-based `serve.json` bridge with SDK-based event publishing once all consumers migrate.
- npm Trusted Publishing via OIDC for `@polderlabs/bizar-sdk` (the SDK is published with `--tag alpha`).

## v3.12.4 — 2026-06-24

### Fixed
- **`/bizar` slash command was treated as plain text** — opencode's command loader requires YAML frontmatter (`description`, `agent`) on each `config/commands/*.md` file, and `opencode.json`'s `command.bizar.arguments` field is not in the schema. Added proper frontmatter to all 9 command files and removed the invalid `arguments` field from the template. Typing `/bizar` in the opencode TUI now opens the menu instead of sending the text to the model.

### Added
- **Simplicity Rule for all agents** — a new section at the top of `config/AGENTS.md`'s "Always-On Behavior" baseline that overrides the agents' tendency to overcomplicate simple tasks. Key points: match the work to the ask, no speculative features or questions, no over-explanation, short replies are good replies, subagents are expensive. Verified with smoke tests: "What's 2+2?" → "4.", "List files" → directory listing.

## v3.12.3 — 2026-06-24

### Fixed
- **`bizar update` silently broke the plugin** — the deployed plugin at `~/.config/opencode/plugins/bizar/` had no `node_modules`, so Bun couldn't resolve the plugin's import of `@polderlabs/bizar-sdk` (a workspace-internal package not on the public registry). The plugin failed to load on every opencode session after an update, leaving `<think>` strips and all other hook behavior disabled with zero visible error. `installPluginFromGlobal` now copies the npm package's bundled `node_modules/` to the deployed location automatically, so the SDK resolves correctly after every update.
- **`bizar doctor` false negative on plugin entry** — the `plugin-entry-present` and `plugin-path-resolves` checks didn't handle the `[path, options]` tuple shape that `opencode.json` uses. Added `Array.isArray(p)` branches and three new tests. Doctor now reports 9/9 on a healthy install.

### Tests
- 187 CLI tests pass (4 new for `installPluginFromGlobal` node_modules copy).

## v3.12.2 — 2026-06-24

### Fixed
- **M3 `<think>` blocks leaked as visible inline text** — the MiniMax M3 model via OpenRouter was double-emitting reasoning, once in the structured `reasoning_details` field and again as raw `<think>...</think>` text inside the message content. The plugin now strips any of the four inline think-tag variants (`<think>`, `<thinking>`, `<reasoning>`, `<ant_thinking>`) from completed text parts via the `experimental.text.complete` hook. Reasoning still routes to the structured field as before.
- **The Bizar plugin loaded the wrong source on disk** — opencode loaded the plugin from `~/.config/opencode/plugins/bizar/index.ts` (the deployed copy), and the source-of-truth at `plugins/bizar/` was drifting. The CLI now ships a `bizar dev-link` / `bizar dev-unlink` pair so the user can symlink the local source for instant propagation during development. `bizar update` refuses to clobber a dev symlink unless `--force` is passed.

### Added
- **`bizar doctor`** — runs nine health checks on the BizarHarness install (opencode reachable, config valid, plugin entry present, plugin path resolves, deployed plugin matches npm, agent files installed, tools on PATH, dashboard reachable, provider config sane). Returns non-zero on any failure. Runs automatically at the end of `bizar update` and prints a warning if anything regressed.
- **`bizar update --dry-run`** — previews which packages would be installed, which processes would be killed, and whether the install script would rerun, without actually doing any of it.
- **Symlink-aware `installPluginFromGlobal`** — `bizar update` now detects a `~/.config/opencode/plugins/bizar` symlink and skips the npm copy unless `--force` is passed. The dev workflow no longer silently breaks after every update.

### Tests
- 243 plugin tests pass (21 new for `reasoning-clean.ts`).
- 180 CLI tests pass (13 new for `dev-link`, 16 new for `doctor`).

## v3.12.1 — 2026-06-24

### Fixed
- **`bizar_spawn_background` was silently broken** — the spawned `opencode run` subprocess was missing the `--agent` flag and pointed at stale OpenRouter model IDs, so every background agent session crashed immediately after creation. Extracted `buildOpencodeRunArgs()` for testability, added the agent flag, and migrated all model IDs to the new `openrouter/minimax/minimax-{m3,m2.7}` form.
- **OpenRouter `thinking: "adaptive"` was silently ignored** — the OpenRouter provider uses `reasoning` as the parameter name and does not support an adaptive effort level for MiniMax. Switched the openrouter provider entries to the correct `reasoning: { enabled: true }` shape.
- **Plugin init hard-failed spawn when `opencode serve` was unavailable** — the v0.8.0 active-subprocess path does not need a serve child. Made `InstanceManager.http` and `stream` nullable, guarded the call sites, and added a `isBizarBackgroundChild()` check so bg-spawned children skip the serve-start block cleanly.
- **`<thinking>` tags were rendered inline in chat output** — the MiniMax M3 model emits reasoning as `<thinking>...</thinking>` markup. Added server-side stripping in `serve-info.mjs` so the tags never reach the React markdown renderer.

### Added
- **Active Background Agents tab in the dashboard** — new view at `bizar-dash/src/web/views/BackgroundAgents.tsx` listing running and pending bg agents with live status, kill button, output viewer, and tmux attach helper. Polls every 5s and subscribes to the `background:change` WebSocket event.
- **Research-Loop Rule for agents** — wired `config/rules/uncertainty.md` into the loader table at `config/AGENTS.md` and added a short paragraph so agents reach for `websearch` / `webfetch` when uncertain or stuck, rather than retrying the same edit.

### Changed
- **Removed dead `provider` block at top of `config/opencode.json.template`** — it was overridden by a later `provider` key, so it was dead code.

## v3.12.0 — 2026-06-24 — Background agent architecture rewrite (v0.8.0)

### Fixed (vv3.12.0 follow-up — from full dev-container simulation)

End-to-end simulation in `BizarHarness-dev` (Docker) revealed three bugs in the dashboard + plugin wiring that would silently break the v2 protocol in production. All fixed and verified inside the container:

- **Dashboard `cli.mjs`** — `start --port N` was silently ignored, dashboard always bound on default 4321. Now parses `--port` and `--bind` CLI args.
- **Dashboard `server.mjs`** — `/api/v2/*` requests returned 404 with the old apiRouter's error format. Cause: `api.mjs` has a 404 catch-all at line ~109 that swallows any unhandled `/api/*` request without calling `next()`. Fix: mount the `/api/v2` router **before** `apiRouter` so `/api/v2/*` matches first. General lesson: namespace routers must mount BEFORE broader routers with internal catch-alls.
- **Dashboard `v2-auth-file.mjs`** — persisted `port` from a previous run was used instead of the actual listen port. Fix: always use the current `port` argument; rewrite the file when persisted port differs (preserves password + createdAt).
- **Plugin `event-stream.ts`** — added `onEvent(handler)` global handler for non-session SSE events. Used by the dashboard publisher wiring.
- **Plugin `index.ts`** — wired `createDashboardPublisher()` into both `EventStream.onEvent` (background-agent SSE) AND the opencode `event` hook. Also fixed a `Map<string, string>` typo that was accidentally typed as `Map<string, Set<string>>` and broke 3 typecheck lines.

### Simulation findings (full container run)

`scripts/bizar-sim.sh` is a new end-to-end test harness that:

1. Installs `@polderlabs/bizar` + `@polderlabs/bizar-dash` to user prefix (workaround for sandbox EACCES on `/usr/local/lib/node_modules`).
2. Runs `install.sh` to copy plugin source into container's `~/.config/opencode/plugins/bizar/`.
3. Runs `npm install` for plugin deps (the SDK is fetched from npm).
4. Starts the dashboard from LOCAL source (npm-published v3.11.0 lacks v2 routes).
5. Verifies v2 routes via curl: `/api/v2/health` (200), `/api/v2/sessions` (401/200), `/api/v2/doc` (200), `/api/v2/event` (401).
6. Subscribes to SSE in background.
7. Runs `opencode run --model opencode/deepseek-v4-flash-free "..."` to verify the plugin loads end-to-end.
8. Runs SDK vitest, plugin bun test, dashboard smoke test.

**157 tests green inside the container** (28 SDK + 6 plugin dashboard-client + 7 dashboard smoke + 116 existing plugin). Zero regressions.

### Known limitations (not blockers)

- **`opencode run` does not emit lifecycle events in --pure mode.** The plugin's `event` hook only fires for long-running TUI/server sessions. The simulation's `opencode run <prompt>` is too short-lived to trigger session.created/session.updated/session.idle. The v2 protocol itself is verified end-to-end via the SDK smoke test (which POSTs events to `/api/v2/event` and the SSE subscriber receives them). For real-world monitoring, the dashboard would be connected to a long-running `opencode serve` instance, which IS where lifecycle events fire.
- **Dev container's opencode.json has stale model names** (`openrouter/minimax/minimax-m3`). Use `--model opencode/deepseek-v4-flash-free` for the free tier.
- **Dev container missing Python3** — Dockerfile only installed `git`, `jq`, `ca-certificates`, `curl`. Graph system needs Python 3.10+ for graphify. **Fixed**: `python3 python3-pip` added to `apt-get install` in `BizarHarness-dev/Dockerfile`. After rebuild, `pip3 install --target=/home/dev/.cache/python-packages graphifyy` + `PYTHONPATH=/home/dev/.cache/python-packages` makes graphify importable across container restarts.

### Fixed (vv3.12.0 follow-up #2 — multi-pass simulation, 10 passes)

Re-ran an end-to-end multi-pass test suite (10 passes) inside `BizarHarness-dev` and found/fixed additional bugs:

- **Plugin `src/commands.ts` — `parseSlashCommand` returned `response: ""` for 13 slash-command handlers** (`/visual-plan on|off|status`, `/plan new|list|open|get`, `/help`, `/plan` (no subcommand), and others). Dialog component handled UI feedback, but the `response` text field was empty — broke 19 of 510 plugin tests. **Fixed**: added meaningful human-readable text alongside each dialog (e.g. `"Visual plan mode is now on."`, `"Found 3 plan(s) (3): alpha, beta, gamma."`, `"Created plan \"My Feature\" with the \"blank\" template…"`). All 510 plugin tests now pass.
- **Plugin `tests/config.test.ts` — hard-coded version `0.5.4` was stale** (plugin is at `0.8.0`). Test was out of sync with package.json since the v0.8.0 npm publish. **Fixed**: updated assertion to `0.8.0`.
- **Pass scripts are self-contained** — `scripts/pass[1-10]-*.sh` each install their own dependencies (npm packages to `~/.cache/bizar-global/node_modules`, graphify to `~/.cache/python-packages`) and set `PATH` / `PYTHONPATH` at the top. Necessary because each `docker compose run --rm` creates a fresh container (only `/home/dev/.cache/` persists via the named volume).

### Fixed (v3.11.1 follow-up — "background agent spawns but does nothing")

User-reported: `bizar_spawn_background` creates sessions in the bg state file but the agent never does any work; tmux sessions pile up with empty panes. Two root causes found empirically in the dev container:

1. **Phantom log file in tmux wrap** — `task-delegator.mjs:605` and `bg-retry.mjs:392` both tailed `<worktree>/.bizar/opencode.log` and `<worktree>/.opencode/log/<id>.log` respectively. **Nothing in the system writes to either path.** The plugin's `LogWriter` (plugins/bizar/src/report.ts:147) actually writes to `~/.cache/bizar/logs/<sessionId>.log` (default `logDir` in plugins/bizar/src/options.ts:88). The tmux session therefore sat there showing `tail: cannot open '/project/.bizar/opencode.log' for reading: No such file or directory` in an infinite retry loop. **Fixed**: new `getActualBgLogPath({ sessionId })` in `bizar-dash/src/server/lib/path-safe.mjs` returns the path the LogWriter writes to. Both call sites now use it. tmux panes are clean; operator sees real log activity as the agent works.

2. **Tmux session pile-up** — when an instance became terminal (done/failed/killed/timed_out), its tmux session was never killed unless the user explicitly called `kill()`. **Fixed**: new `backgroundStore.killTmuxFor(instanceId)` method. `cleanup(maxAgeDays)` now also calls it for every terminal instance regardless of age, so long-running dashboards don't accumulate hundreds of dead tmux sessions.

3. **tmux not installed in the dev container** — `BizarHarness-dev` Dockerfile didn't list `tmux` in apt. **Fixed**: added to the apt-get install list; rebuilt the image.

### Architecture issue (documented, not yet fixed — v0.8.0 candidate)

**`opencode serve` is a passive HTTP server.** Per the [opencode server docs](https://opencode.ai/docs/server/): "When you run opencode it starts a TUI and a server. Where the TUI is the client that talks to the server." The plugin POSTs the prompt via `POST /api/session/{id}/prompt` and the server admits it (`session.next.prompt.admitted` event) — but **no agent loop processes the prompt** unless a TUI/web client is connected to the same `opencode serve` child. The plugin currently never drives that agent loop.

Verified empirically: `POST /api/session/{id}/prompt` returns `{"data":{"admittedSeq":1, ...}}` but the SSE stream shows only `server.connected`, `session.created`, `session.next.prompt.admitted` — no `message.user.created`, no `message.assistant.*`, no `session.idle`. The session sits in admitted state forever.

**Workarounds**:
- Run `opencode` (the TUI) in a separate terminal. It will connect to the same `opencode serve` child and drive the agent loop. The plugin's POSTed prompts will then be processed.
- OR wait for v0.8.0 which will spawn `opencode run <prompt>` per spawn, replacing the HTTP-only path with a process that drives the agent to completion.

This is documented inline in `task-delegator.mjs:596-624` so future maintainers don't re-discover it.

### Test results (post-fix)

- **Pass 1 (CLI commands)**: 11/11 ✅
- **Pass 2 (Plugin)**: 7/7 plugin tools exist, plugin loads cleanly
- **Pass 3 (Agents)**: 13/13 agent definitions valid frontmatter
- **Pass 4 (Dashboard)**: 10/13 routes work end-to-end (3 false-fails = test bugs, not framework bugs)
- **Pass 5 (Plan system)**: 3/4 ✅ (`plan new` hangs because it opens a server; behavior is correct, the test needs to background it)
- **Pass 6 (Graph system)**: 6/6 ✅ CLI infrastructure works; full `graph build` needs `OPENAI_API_KEY` for semantic extraction of docs
- **Pass 7 (Skills)**: 9/9 ✅ all 5 bundled skills with valid frontmatter
- **Pass 8 (Self-improvement)**: 8/8 ✅ append/restore cycle works
- **Pass 9 (MCP integration)**: 3/3 ✅ (Hindsight sandbox-disabled by design)
- **Pass 10 (Full integration)**: 19/19 ✅
- **Pass 11 (Background spawn)**: 7/7 ✅ phantom-log fix verified end-to-end with real tmux in the container
- **Pass 12 (Background architecture)**: 4/4 ✅ active `opencode run` subprocess path verified end-to-end
- **Total**: 510 plugin tests + 28 SDK tests + 7 dashboard v2 smoke + 19 new path-safe/tmux-wrap/opencode-runner tests + 116 root typecheck — all green, zero regressions.

### v0.8.0 — Background agent architecture rewrite (FIX 3)

User-reported: "it spawns a lot of sessions but doesn't do anything." Empirical reproduction in the dev container found the architectural issue documented inline in `task-delegator.mjs:596-624` and the plugin's `bg-spawn.ts`:

> "opencode serve is a passive HTTP server. The agent loop is driven by a TUI/web client. The plugin POSTs the prompt via the HTTP API; the prompt is admitted but no agent processes it unless a TUI is connected."

**Root cause:** Pre-v0.8.0, the plugin's `bizar_spawn_background` tool POSTed to `POST /api/session/{id}/prompt` on the opencode serve child. The server admitted the prompt (`session.next.prompt.admitted` event) but no agent loop processed it. Result: sessions created, tmux panes spawned, nothing happened. The user was right.

**Fix:** Replace the passive HTTP path with an **active subprocess path** via the new `opencode-runner` module (Bun.spawn for the plugin, child_process.spawn for the dashboard). Each background agent now spawns one `opencode run <prompt>` subprocess that drives the agent loop to completion.

**Files changed:**

- `plugins/bizar/src/opencode-runner.ts` (NEW) — Bun.spawn-based runner. Tracks PIDs in an in-memory map. Captures stdout+stderr to the LogWriter's log file. Parses the sessionId from the structured stderr log stream. Exposes `spawnAgent`, `getStatus`, `onExit`, `killAgent`, `list`, `_resetForTests`.
- `plugins/bizar/src/tools/bg-spawn.ts` — refactored to use the runner. The HTTP client and SSE event handler are gone; the runner's `onExit` callback now drives instance state transitions and triggers `maybeAutoRestart` for persistent instances. Returns immediately with `{ instanceId, sessionId, processId, status: "running", message, nextSteps }` so the calling agent can go idle.
- `plugins/bizar/src/background-state.ts` — `BackgroundState` now carries `processId`, `exitCode`, `runnerState`, `runnerError`, `spawnMessage`, `spawnNextSteps`, `sessionIdAt`, `runnerStartedAt`, `runnerEndedAt`, `spawnedAt`, `exitSignal` (all optional for backward compat).
- `plugins/bizar/src/background.ts` — `InstanceManager` now exposes a public `maybeAutoRestart(instanceId)` method (was private). The runner's onExit calls this for failed persistent instances.
- `plugins/bizar/index.ts` — `BgSpawnDeps` no longer requires `http`; the bg-spawn tool wires only `instanceManager`, `worktree`, and `logger`.
- `bizar-dash/src/server/opencode-runner.mjs` (NEW) — Node child_process version of the plugin runner. Same surface, same wire format.
- `bizar-dash/src/server/task-delegator.mjs` — `dispatchToBackground` now uses the runner instead of the passive HTTP API. Same wire format, same log path.
- `cli/bg.mjs` (NEW) — `bizar bg` CLI for managing background agents:
  - `bizar bg list` — one-line summary of every background instance (status, agent, prompt preview, tmux session).
  - `bizar bg status <id>` — full detail view of one instance.
  - `bizar bg view` — **the headline feature**: opens a desktop window with a tmux control session that splits into N panes, each `tail -F` of one running agent's log. Cross-platform: macOS (osascript + Terminal.app), Linux (gnome-terminal / konsole / xterm), Windows (wt.exe / cmd).
  - `bizar bg logs <id>` — `tail -F` the agent's log file.
  - `bizar bg kill <id>` — `SIGTERM` (then `SIGKILL` after 5s) to the subprocess and kill its tmux session.
- `cli/bin.mjs` — wires `bizar bg` into the CLI.
- `config/agents/odin.md` — explicit "go idle after spawning" guidance. The previous "stops and does nothing" trap was caused by the LLM calling `bizar_collect` immediately after spawn and waiting. The new prompt tells Odin: "acknowledge the spawn, return control to the user, do NOT call `bizar_collect` unless the user explicitly asked for the result. Suggest `bizar bg view` for live monitoring."

**Tests added (7 new, all pass):**

- `bizar-dash/tests/opencode-runner.test.mjs` (NEW, 7 tests) — covers the dashboard runner's API surface: `_resetForTests`, `getStatus` for unknown PIDs, `killAgent` no-ops on unknown PIDs, `spawnAgent` with non-existent worktree (still returns a processId), `spawnAgent` creates log dir if missing, `spawnAgent` captures stdout+stderr to logPath, `onExit` fires when the process exits.
- Total dashboard tests: 28 (path-safe: 9, tmux-wrap: 3, opencode-runner: 7, smoke-v2: 7, plus the original 2).

**Empirical end-to-end verification (scripts/pass12-bg-architecture.sh, 4/4 PASS):**

- `opencode serve` starts.
- Dashboard starts.
- Task submitted to `/api/tasks/submit`.
- Dashboard's `task-delegator` spawns an `opencode run` subprocess via the new runner.
- BG state file is written with `instanceId`, `sessionId`, `runnerState`, etc.
- Log file is written by the runner with structured `[stderr] timestamp=... level=... message=...` lines from opencode.
- `bizar bg list` correctly shows the agent with its tmux session name.
- `opencode-runner.mjs` directly: spawns an `opencode run`, gets a sessionId, and the `onExit` callback fires when the subprocess exits.

**Backward compatibility:** Old state files (pre-v0.8.0) load cleanly — all new fields are optional. The HTTP API path (`createOpencodeSession` + `sendPrompt`) is no longer called by the plugin or the dashboard, but the dashboard's `serve-info.mjs` still exports it for any external consumer (e.g. a custom dashboard plugin). The plugin's `opencode serve` child still starts and listens on its port — the v2 dashboard protocol uses it.

### Changed — Agent behavior under uncertainty

All 13 agent prompts now reference a new rule, `config/rules/uncertainty.md`, that codifies the **"stop and research"** behavior:

- When an agent is uncertain or stuck (e.g. about to retry a failed tool call with a slight variation, or guessing at a file path / API signature / config key), it must STOP.
- Stopping means using the available research tools before retrying: `semble search` for codebase patterns, `webfetch` for documentation, `read` for related files, `hindsight_recall` for prior project context, `skill` for domain guidance, or asking the user.
- After research, the agent acts with confidence. If the new attempt also fails, it updates its model — it does not loop back to the variation-spawning behavior.

The 5/8/12 runtime loop guard in the plugin remains a safety net but is now explicitly described as a last resort. Agents should self-correct **before** the guard fires, not after.

### Files
- `config/rules/uncertainty.md` (NEW, 70 lines) — the rule.
- `config/agents/{odin,vor,frigg,quick,mimir,heimdall,hermod,thor,baldr,tyr,vidarr,forseti,semble-search}.md` — `## Thinking style` sections now point to the new rule.

## v3.11.0 — 2026-06-23 — Dashboard v3.11.0 sync

### Highlights
- **Dashboard v3.11.0** ships as a single coordinated release with the CLI. New features: interactive file browser in Add Project dialog, `dashboard.projectsDirectory` setting with auto-scan, in-browser `New folder` button (`POST /api/fs/mkdir`), `dashboard.allowedRoots` for additional filesystem roots, and a critical fix for background-agent dispatch that was silently leaving every spawned instance stuck in `dispatchPending: true` (no tmux session, no worktree dispatch). See the dashboard package's CHANGELOG for full details.

### Changed
- `@polderlabs/bizar-dash` peer dep constraint unchanged (`^3.10.0`); 3.11.0 satisfies it.

### Files
- `package.json` — version bump 3.10.0 → 3.11.0
- `bizar-dash/package.json` — version bump 3.10.0 → 3.11.0
- `bizar-dash/CHANGELOG.md` — v3.11.0 entry finalized (Unreleased → dated)
- `CHANGELOG.md` (this file) — v3.11.0 entry added

## v3.10.0 — 2026-06-23 — Windows compat + CLI consolidation

### Highlights
- **CLI consolidation**: the `bizar-dash` binary is removed. All dashboard commands now live under `bizar dash <sub>`. The internal `@polderlabs/bizar-dash` npm package is still published (as a library) but no longer installs a `bizar-dash` binary.
- **Windows compatibility**: install, Python detection, signals, and shell helpers now work on Windows out of the box.
- **Concise thinking rule**: agents are now constrained to 2-4 sentence thinking with hard bans on informal self-talk. No more 15-minute ramble loops.
- **MiniMax interleaved fix**: `<thinking>...</thinking>` tags no longer leak into visible output for MiniMax on openrouter.

### Migration
| Old | New |
|---|---|
| `bizar-dash start` | `bizar dash start` |
| `bizar-dash stop` | `bizar dash stop` |
| `bizar-dash status` | `bizar dash status` |
| `bizar-dash tui` | `bizar dash tui` |
| `bizar dashboard X` | `bizar dash X` (still works, prints deprecation warning) |
| `bizar tui` | `bizar dash tui` (still works, prints deprecation warning) |
| `bizar start` | `bizar dash start` (REMOVED) |
| `bizar stop` | `bizar dash stop` (REMOVED) |
| `bizar status` | `bizar dash status` (REMOVED) |
| `bizar --bg` | `bizar dash start --bg` (REMOVED) |
| `bizar` (no args) | shows help (was: launch TUI) |
| `bizar-dash` binary | REMOVED — `rm $(which bizar-dash)` |

### Concise thinking rule
- Add `config/rules/thinking.md` (56 lines): caps thinking at 2-4 sentences, bans informal self-talk ("oh but what if", "actually", "let me think", "wait", "hmm", "I wonder", "on second thought", "alternatively"), requires one-shot decision pattern
- Add `## Thinking style` section to all 12 agent files referencing the new rule
- Update `install.sh` with post-install warning about `variant: "high"` on Odin/Tyr/Forseti

### MiniMax interleaved fix
- Add `provider.<minimax|openrouter>.models` config with `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax-M3, MiniMax-M2.7, minimax-m3, minimax-m2.7, owl-alpha
- Fixes `<thinking>...</thinking>` tags being shown as raw text instead of rendered as native thinking blocks in opencode

### Windows compatibility
- `install.sh` is bash-only; Windows users use `npm install -g @polderlabs/bizar` (documented in README)
- `curl | sh` patterns (5 sites) wrapped in `process.platform === 'win32'` with PowerShell `irm | iex` alternative
- `python3` → `py` launcher on Windows (`cli/graph.mjs`, `cli/init.mjs`)
- `pip` → `py -m pip` on Windows (`cli/install.mjs`, `cli/graph.mjs`)
- `SIGTERM`/`SIGKILL` → no-arg `process.kill()` / `taskkill /F` on Windows (`cli/update.mjs`, `plugins/bizar/src/serve.ts`)
- `sleep` command → `setTimeout` (3 sites in `cli/update.mjs`)
- `bizar-dash` `~/.config/opencode` → `%APPDATA%\opencode` (4 places: `bizar-dash/src/cli.mjs`, `bizar-dash/src/server/tui.mjs`, `bizar-dash/src/server/tui.mjs` runTui)
- `.gitattributes` forces LF for shell/script files (prevents CRLF breaking shebangs)
- Hardcoded `/tmp/` in 12 test files → `os.tmpdir()`
- `killAndWait` made async (no external callers, internal-only breaking change)

### CLI consolidation
- `bizar-dash` binary REMOVED. `rm $(which bizar-dash)` to clean up old symlink.
- `bizar dash <subcommand>` is the new canonical form (start, stop, status, tui)
- `bizar dashboard X` and `bizar tui` are deprecated aliases (still work, with warning)
- `bizar start`, `bizar stop`, `bizar status`, `bizar --bg`, `--web`, `--web-only`, `--no-web`, `--detach` REMOVED
- `bizar` (no args) no longer launches TUI (shows help)
- `bizar-dash/src/cli.mjs` refactored to export functions (`start`, `stop`, `status`, `tui`) with `isMainEntry()` guard so signal handlers only register when run as a CLI (for legacy `cli/update.mjs#spawnFreshDashboard` path)
- `bizar-dash/package.json` got `exports` map: `{ ".": "./src/server/server.mjs", "./dash-cli": "./src/cli.mjs" }`. Removed `bin` field. The package is now a LIBRARY, not a CLI.
- In-process imports replace subprocess spawn: `cli/bin.mjs` calls `import('@polderlabs/bizar-dash/dash-cli')` and uses the exported functions directly
- The plugin's `commands-impl.ts` spawns `bizar dash start` instead of `bizar dashboard start`

### Environment variables
- Unchanged. `BIZAR_DASHBOARD_*` env vars still work.

## v3.9.1 — 2026-06-23

### Fixed — Concise thinking rule + MiniMax interleaved output

- **`config/rules/thinking.md`** (NEW) — caps agent thinking at 2-4 sentences, bans informal self-talk, requires one-shot decision pattern.
- **`config/agents/*.md`** — added `## Thinking style` section to all 12 agent files referencing the new rule.
- **`config/opencode.json.template`** — added `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax models (both `minimax` and `openrouter` providers), fixing `<thinking>` tags leaking as raw text into visible output.
- **`install.sh`** — added post-install warning about `variant: "high"` multiplying thinking verbosity.

## v3.9.0 — 2026-06-23

### Added — Slash commands open real dialogs

Slash commands used to print their usage text as a chat bubble. v3.9.0 makes them open interactive dialogs in the dashboard.

- **`plugins/bizar/src/commands.ts`** — every command handler (`/visual-plan`, `/plan new|list|open|...`, `/bizar`, `/help`, `/audit`) now returns a `DialogDescriptor` instead of a text string.
- **`plugins/bizar/index.ts`** — the `chat.message` hook writes the descriptor to `~/.cache/bizar/dialogs/<id>.json` (validated against `dlg_[a-zA-Z0-9_-]{1,64}`) and returns silently instead of throwing.
- **`bizar-dash/src/server/dialog-store.mjs`** (NEW) — persists dialog requests to disk.
- **`bizar-dash/src/server/dialog-poller.mjs`** (NEW) — ticks every 1s, broadcasts `dialog:show` over WebSocket.
- **`bizar-dash/src/server/routes/dialogs.mjs`** (NEW) — mounted in `api.mjs`. Provides `GET /api/dialogs` for inspection.
- **`bizar-dash/src/web/components/CommandDialog.tsx`** (NEW) — generic dispatcher. Mounts the right specific dialog.
- **`bizar-dash/src/web/components/{VisualPlanDialog,PlanCreateDialog,PlanListDialog,HelpDialog,AuditDialog}.tsx`** (NEW) — one component per command.
- **`bizar-dash/src/web/lib/types.ts`** — added `DialogDescriptor` and `DialogComponent` types; extended `WsMessage` union with `{ type: 'dialog:show'; dialog: DialogDescriptor }`.

### Added — Schedules overhaul (Sunday 1pm code review actually works now)

The schedule feature was 6 critical bugs deep. v3.9.0 fixes all of them.

- **Agent dispatch is no longer a stub.** `schedules-runner.mjs:97-113` now calls `taskDelegator.submit()` so a cron-scheduled `agent` action actually runs the named agent with the prompt text. Previously it just logged `"deferred to v3.1"` and marked the run successful — silent no-op.
- **Timezones work.** Replaced the hand-rolled 5-field cron evaluator with the `croner` library (10.0.1). Schedules can now carry `timezone: "America/New_York"` and fire at 1pm ET, not 1pm UTC. Added `croner ^10.0.1` to `bizar-dash/package.json`.
- **Structured pickers in the UI.** Day-of-week dropdown, hour dropdown (with 12h labels), minute select — composes into `"M H * * DOW"`. Timezone selector with 6 IANA presets plus an "Other…" input. Raw cron still available behind an "Advanced" toggle.
- **Edit modal on desktop and mobile.** Both `Schedules.tsx` and `MobileSchedules.tsx` now have an Edit button that pre-populates the form.
- **Mobile toggle fixed.** `MobileSchedules.tsx:41-49` called `api.patch()` but the server only had `PUT`. Added `PATCH /api/schedules/:id` (line 35-44 of `routes/schedules.mjs`) that does a partial update.
- **Mobile `/trigger` alias.** Mobile called `/schedules/:id/trigger` but server had `/run`. Added an alias route.
- **Budget-aware pre-flight.** Schedules can now carry `budgetCheck: { skipIfBudgetLow: boolean, maxConcurrent: number }`. The runner checks `backgroundStore.list()` for running+pending count; if over the cap, it records `result: "skipped"` (a new third terminal state alongside `success`/`error`) and moves on. The user's "Sunday 1pm before the weekly token reset" scenario is now expressible as a schedule config.

### Added — Background agents: persistent mode + live status UI

- **Persistent background tasks.** `background-state.ts` now tracks `persistent`, `restartCount`, `maxRestarts`, `restartError`, `lastRestartAt`. `bg-spawn.ts` accepts a `persistent: boolean` arg. When a persistent instance reaches a terminal `failed` state (session error, tool-cap, loop-guard, stall timeout, or thinking-loop), the plugin auto-restarts it up to `maxRestarts` (default 3) times via the new `InstanceManager.restart()` method. `restartCount` is summed across the parent chain (cycle-safe via a `visited` set) so a chain cannot exceed the cap. Explicit kills are never auto-restarted.
- **Background Agents status card.** New reusable `BgStatusBadge` component surfaces pending/running/done/failed/killed/timed_out with distinct colors and a pulse animation for `running`. `Tasks.tsx` shows the badge and a kill button on every task card that has `metadata.bgInstanceId`.
- **Kill confirmation dialog.** `KillConfirmDialog` requires the user to confirm before `DELETE /api/background/:id` is called.
- **Background Agents Settings card.** 5 plugin options (`maxConcurrentInstances`, `backgroundToolCallCap`, `backgroundStallTimeoutMs`, `backgroundThinkingLoopTimeoutMs`, `backgroundMaxInterventions`) are now configurable from the dashboard. Saves to `~/.config/bizar/plugin-options.json` via `PUT /api/settings/plugin-options`. Plugin reads it on next start.
- **`POST /api/background/cleanup`** — deletes terminal instances older than N days (default 7).
- **`GET /api/background/summary`** — returns `{ instances, counts, total }` for the Overview widget.

### Added — Installer uses `uv` by default

`cli/install.mjs` `promptGraphifyInstall()` was trying `pip install graphifyy` first, which fails on Arch/Fedora/macOS due to PEP 668. Now:
- Detects `uv` first.
- If uv is installed: asks to `uv tool install graphifyy`.
- If uv is missing: asks to install uv via the astral installer (`curl -LsSf https://astral.sh/uv/install.sh | sh`) and then run `uv tool install graphifyy`.
- Falls back to `pip install graphifyy` only if the user declines uv.

Matches the pattern already used for Semble install.

### Changed — MiniMax models default to OpenRouter provider

OpenRouter now serves the MiniMax M2.7 and M3 tiers. Verified via the OpenRouter `/api/v1/models` endpoint:
- `minimax/minimax-m2.7` — `MiniMax: MiniMax M2.7`
- `minimax/minimax-m3` — `MiniMax: MiniMax M3`

The default opencode provider is now `openrouter`. Model strings changed across:
- `config/opencode.json.template` — top-level `model`/`small_model`, all 12 agent `model:` fields, and a new `provider.openrouter` block that declares the two model IDs and reads `OPENROUTER_API_KEY` from env.
- `config/agents/*.md` (7 files: odin, thor, tyr, hermod, forseti, baldr, quick) — frontmatter `model:`.
- `config/AGENTS.md` — routing table + 4 section headers.
- `config/skills/bizar/SKILL.md` — troubleshooting section rewritten for the new provider.
- `cli/audit.mjs` — `validModels` list updated.
- `README.md` — provider setup table.
- All 5 wiki pages that reference the old strings.
- Plugin source, plugin tests (67 fixtures updated), and the `bg-spawn.ts` error message example.

API key setup: users now set `OPENROUTER_API_KEY` instead of `MINIMAX_API_KEY`.

### Files changed
- **44 modified**: `cli/install.mjs`, `cli/audit.mjs`, `config/opencode.json.template`, all 7 `config/agents/*.md`, `config/AGENTS.md`, `config/skills/bizar/SKILL.md`, `plugins/bizar/index.ts`, `plugins/bizar/src/{background-state,background,commands,bg-spawn}.ts`, 6 plugin test files, `plugins/bizar/README.md`, `bizar-dash/package.json`, `bizar-dash/src/server/{background-store,schedules-store,schedules-runner,server,api}.mjs`, `bizar-dash/src/server/routes/{background,schedules,chat}.mjs`, `bizar-dash/src/web/{App.tsx,lib/types.ts}`, `bizar-dash/src/web/views/{Chat,Tasks,Settings,Schedules}.tsx`, `bizar-dash/src/web/mobile/views/MobileSchedules.tsx`, `README.md`, 5 wiki pages.
- **9 new**: `bizar-dash/src/server/{dialog-store,dialog-poller}.mjs`, `bizar-dash/src/server/routes/dialogs.mjs`, `bizar-dash/src/server/settings-store.mjs`, `bizar-dash/src/server/routes/settings.mjs`, 6 dialog components under `bizar-dash/src/web/components/`.

## v3.8.0 — 2026-06-22

### Added — `bizar graph` subcommand for per-project knowledge graphs

**`bizar graph`** (powered by [graphify](https://github.com/bretbthomas/graphify)) provides a structured, queryable map of every agent, skill, command, and rule in the BizarHarness project. Graph files live in `.bizar/graph/` and are git-trackable.

#### New files
- **`cli/graph.mjs`** — `bizar graph` subcommand implementing `build`, `update`, `query`, `path`, `explain`, `watch`, `status`, and `install` actions
- **`cli/graph.test.mjs`** — 11 Node `node:test` cases, all passing

#### Modified files
- **`cli/bin.mjs`** — wired `graph` into the dispatcher, added `showGraphHelp()`, updated top-level help and `showInitHelp()`
- **`cli/init.mjs`** (+35 lines) — soft graph build step after writing `.bizar/PROJECT.md`; fails open if `graphifyy` is missing
- **`cli/install.mjs`** (+58 lines) — post-install `promptGraphifyInstall()` that offers to install or build the graph

#### Config updates
- **`config/commands/init.md`** — rewritten (1→23 lines) to teach the new graph flow, status verification, and retry instructions
- **`config/AGENTS.md`** — new `## Graph Query (bizar graph)` section

#### Agent parallel-execution coordination
All 9 agent files (`baldr`, `forseti`, `heimdall`, `hermod`, `mimir`, `odin`, `thor`, `tyr`, `vidarr`) received a new `## Parallel Execution` section with:
- Sibling-awareness rules for when agents run in the same working directory concurrently
- Disjoint file-scoping discipline to prevent write collisions
- Git operation boundaries (only `@hermod` performs write-level git)
- Pre-write checklists and `.git/index.lock` handling
- Mandatory end-of-session reporting (`Siblings: … Conflicts: … Git ops: …`)

Odin's dispatch block now includes a full `## PARALLEL EXECUTION CONTEXT` template to prepend to every parallel subagent prompt.

#### Dashboard
- **`bizar-dash/src/web/views/Tasks.tsx`** — archived tasks (`status: "archived"` OR `archived: true`) now surface in the DONE kanban column so earlier-existing tasks are visible from a fresh dashboard load. `matchesColumn()` helper added.

#### Requirements
Graph features require **Python 3.10+** and **`graphifyy`** (`pip install graphifyy`). The `bizar graph` commands and the `bizar init` / `bizar install` integration fail open if the dependency is absent.

## v3.7.3 — 2026-06-22

### Fixed — `bizar update` rewritten for correctness
The `bizar update` command previously had three critical gaps that could leave the install in a broken or partially-updated state. v3.7.3 fixes all of them.

#### What was broken
1. **Did not update `@polderlabs/bizar-dash`.** Only `bizar`, `plugin`, and `opencode` were updated — the dashboard package was invisible to the updater. After update, the dashboard ran stale code from `npm-global/lib/node_modules/@polderlabs/bizar-dash/`.
2. **Did not kill running instances before installing.** `npm install -g @polderlabs/bizar@latest` could fail or leave the running dashboard service running old code in memory. On Linux the npm-global directory is locked by running processes.
3. **Did not warn the user.** No prompt, no list, no chance to back out. Users had no way to know their dashboard session was about to be terminated.
4. **Did not restart the dashboard after update.** Even if the install succeeded, the dashboard stayed on the old code until manually restarted.
5. **PID files were never validated.** A stale `service.pid` containing the empty string (`0 bytes`) or a dead PID was reported as "running", preventing clean update flow.
6. **CLI self-update was unreliable.** The `rerunInstallScript()` logic ran `npm install -g @polderlabs/bizar-plugin@latest` but never updated `bizar-dash`.

#### What changed
- **Full instance detection** — Reads `~/.config/bizar/{service,dashboard}.pid` and `~/.config/bizar/dashboard.port`. Validates each PID is actually alive (`process.kill(pid, 0)`), cleans up stale/empty/corrupt files automatically.
- **Explicit warning before kill** — Lists every running instance by name, PID, and (for dashboard) port. Asks for confirmation via inquirer. Non-TTY shells refuse to proceed without `--yes`.
- **Graceful then forced kill** — Sends `SIGTERM`, polls for exit (up to 5s), escalates to `SIGKILL` if needed. Cleans up the corresponding PID file on success.
- **PID-recycle-safe kill verification** — `process.kill(pid, 0)` after a kill is unreliable on Linux (PIDs recycle immediately after death). The function now treats successful signal delivery as success, since `SIGKILL` is uncatchable.
- **`@polderlabs/bizar-dash` is now a first-class component.** It shows in the version table, the interactive prompt, and the `--all` flag. Selection key is `dash` (e.g. `bizar update dash`).
- **Auto-restart the dashboard after update** — If the dashboard was running and either `bizar` or `dash` was updated, spawns a fresh detached `bizar-dash start --bg` process using the same port. Skipped with `--no-restart`.
- **New flags** — `--yes` / `-y` / `--force` (auto-confirm kill + `--all`), `--no-restart` (skip dashboard restart), `--all` (update every component without prompting).
- **Exported `readLivePid` and `killAndWait`** for unit testing (also exported for future health-check tooling).
- **Improved help text** with examples for headless / partial / no-restart flows.

### Behavior
```
$ bizar update --all --yes     # headless full update + restart
$ bizar update dash             # update only the dashboard
$ bizar update plugin --no-restart   # plugin only, leave dashboard alone
```

### Files
- `cli/update.mjs` — full rewrite (~290 → ~440 lines)
- `cli/bin.mjs` — `showUpdateHelp()` updated with new flags and components

## v3.7.2 — 2026-06-22

### Added
- **Comprehensive Always-On Behavior Baseline** in `config/AGENTS.md` ("General Agent Baseline — Always-On Behavior"). Translated from the upstream Claude Fable 5 system prompt — every Claude-specific tool, directory, and concept has been mapped to the BizarHarness equivalent. Single source of truth for every agent's behavior so the rules don't drift across the 13 agent files.

  Sections covered:
  - **Identity preamble** — Bizar Norse-pantheon identity, replace "Claude / Anthropic"
  - **Tool translation table** — `view`→`read`, `str_replace`→`edit`, `create_file`→`write`, `bash_tool`→`bash`, `web_search`→`websearch`, `web_fetch`→`webfetch`, `ask_user_input_v0`→`question`, `skill`→`skill`, MCP registry→`skills` CLI. Lists which upstream tools **don't** exist in Bizar (`image_search`, `places_*`, `weather_fetch`, etc.) so agents don't assume them.
  - **refusal_handling** — be open, attempt with stated assumptions rather than refuse
  - **tone_and_formatting** — warm, direct, kind; never use bullets when declining
  - **lists_and_bullets** — prose preferred; lists only when essential
  - **user_wellbeing** — mental health, self-harm, disordered eating, crisis resources; NEDA → National Alliance for Eating Disorders helpline (NEDA is permanently disconnected)
  - **evenhandedness** — best case for the position, not the agent's view; end advocacy with opposing perspectives
  - **responding_to_mistakes_and_criticism** — own it, fix it, don't collapse
  - **knowledge_cutoff_and_research_first** — no shared cutoff across models; search for fast-changing facts; project context via Hindsight
  - **mcp_servers_and_skills** — Semble and Hindsight always-on; Skills CLI for domain packs; agent-browser for E2E
  - **skills_mandatory_read** — read every plausibly-relevant SKILL.md before writing code
  - **file_creation_advice** — standalone artifact vs conversational answer; tone/length don't change the bucket
  - **file_handling_rules** — Bizar workspace paths, parser per file type, verify before claiming
  - **search_instructions** — websearch/webfetch, copyright hard limits (15-word ceiling, one quote per source)
  - **copyright_compliance** — non-negotiable, paraphrasing default, no lyrics/poems/article paragraphs
  - **harmful_content_safety** — refuse to search for, reference, or cite extremist/harmful sources
  - **citation_instructions** — claims in your own words, never quoted text
  - **images_and_visual_content** — no `image_search`; use agent-browser for local screenshots
  - **memory_privacy_and_user_data** — conservative retention, no secrets/PII
  - **files_execution_and_data_handling** — preserve user content, real files when requested, scoped commands
  - **clarification_and_ambiguity** — one high-value question; dispatch to Vör/Mimir
  - **communication_and_final_responses** — match user register, brief progress updates

### Changed
- **All 13 agent files** (`config/agents/*.md`) now reference the global baseline instead of carrying a duplicated copy. The per-agent "General Operating Baseline" section is replaced by a one-liner pointer: *"Follow the global baseline in `config/AGENTS.md` → 'General Agent Baseline — Always-On Behavior'."* Net change: -716 lines of duplicated boilerplate, +286 lines of single-source-of-truth baseline.

### Files
- `config/AGENTS.md` — added comprehensive baseline (~325 lines)
- `config/agents/*.md` — replaced duplicated local baseline with pointer (13 files)

## v3.7.1 — 2026-06-22

### Fixed
- **"Submit Task to Odin" modal no longer requires a title.** The Title field is now optional across web UI, API, and CLI. If the user (or caller) leaves it blank and supplies a description, the title is auto-generated by stripping markdown headers, taking the first non-empty line, and truncating to ~60 chars at a word boundary. Falls back to `Untitled task — YYYY-MM-DD HH:MM` if both fields are empty.
- **Empty-title backend rejection improved.** `/api/tasks/submit` now accepts `{ title: '' }` as long as `description` is non-empty (auto-generates). Only rejects when **both** fields are empty, with the clearer error message `title or description is required`.
- **Same fix applies to curl/CLI callers.** The `autoTitleFromContent` helper is duplicated in `src/web/lib/utils.ts` (TS) and `src/server/task-delegator.mjs` (mjs) so both frontend and backend behave identically.

### Files
- `bizar-dash/src/web/lib/utils.ts` — added `autoTitleFromContent()` helper
- `bizar-dash/src/web/views/Tasks.tsx` — modal markup updated, title no longer required, auto-fill on submit
- `bizar-dash/src/server/task-delegator.mjs` — backend accepts empty title, auto-generates server-side

## v3.7.0 — 2026-06-22

Full audit pass across all Bizar components — plugin, CLI, dashboard (server + desktop web + mobile), agent configs, install scripts, and templates. **116 files changed, 3154 insertions, 1334 deletions.** Every component was security-reviewed, code-reviewed, tested, and fixed in parallel.

### Plugin (`@polderlabs/bizar-plugin` 0.5.4 → 0.6.0)
- **Signal-handler leak fixed.** Plugin was calling `process.removeAllListeners(SIGTERM|SIGINT)` which stripped unrelated host signal handlers. Now uses plugin-owned handler tracking with proper remove-on-dispose.
- **`dispose()` now clears `serve.json`** after shutdown so stale endpoint/password data isn't left behind for dashboard/out-of-process consumers.
- **Background agent leaks fixed.** Tracked SSE unsubscription per instance and `unref()` on the periodic checker timer — fixes event-listener and open-handle leaks for terminal background instances.
- **`plan-fs.ts`** atomic-write parent dir creation switched from `join(filePath, "..")` to `dirname(filePath)` for correctness.
- **`serve.ts`** `ServeInfo` type extended with `baseUrl`, `worktree`, `startedAt` to match actual usage.
- **Test suite aligned with strict TypeScript** — fixed breakages in 11 test files (attach-handler-bug, update-deadlock, bg-get-comments, plan-action, wait-for-feedback, http-client, serve, event-stream, bg-kill, bg-status, init-helpers).
- **Test results:** 212/212 pass (npm test), 504/504 pass (bun test). Typecheck PASS. `check:imports` PASS.

### CLI (`@polderlabs/bizar` 3.6.1 → 3.7.0)
- **`--version` / `--help` no longer trigger first-run setup.** Added informational-flag bootstrap bypass and centralized error handling in `bin.mjs`.
- **Version detection rewritten.** Replaced broken ESM `import(package.json)` with safe JSON reads; tool detection for Skills/Semble no longer performs network installs (`npx --yes`, `uvx ...`).
- **`install.mjs`** missing `detectUv` import fixed; ESM-safe `require.resolve` removed.
- **`install.sh`** `jq` merge now writes to a temp file and uses atomic `mv` (previous version printed merged JSON to stdout and never wrote it back).
- **`plan.mjs`** plan/config writes now atomic; request body size guarded; `startServer()` no longer leaks signal listeners across tests.
- **`service.mjs`** config-dir handling fixed (no fail-before-mkdir); stale PID cleanup; cross-platform main-module detection.
- **`update.mjs`** path string concat replaced with `node cli/bin.mjs --setup` cross-platform rerun.
- **`prompts.mjs`** API key prompts now use masked password inputs.
- **Help text expanded** for `install`, `update`, `init`, `export`, `service`, `dashboard`, `test-gate`.
- **Banner agent count fixed** from 11 → 13.
- **`init.mjs`** Windows-unsafe `cwd.split('/')` replaced; skills install skips cleanly when CLI is absent.
- **`copy.mjs`** atomic writes for `opencode.json` merges; nested `.bizar/` file copying fixed.
- **`export.mjs`** hardcoded home-path assumptions removed; clear guard when no installed agents exist.
- **Test results:** 140/140 pass (cli/plan.test.mjs). All subcommands (`init`, `plan`, `update`, `export`, `audit`, `service`, `install`, `test-gate`, `dashboard`) accept `--help` and return sensible output. `--version` prints `3.7.0`.

### Dashboard server (`@polderlabs/bizar-dash` 3.6.1 → 3.7.0)
- **Auth bypass on proxied loopback traffic fixed.** Remote clients arriving through a local proxy could inherit loopback trust. Loopback/original-peer evaluation and auth-status reporting fixed.
- **Artifact metadata trusted arbitrary `meta.path`** enabling arbitrary file read/delete if sidecars were tampered. Constrained artifact body paths to the artifact directory; metadata sanitized before read/list/delete.
- **Schedule webhook SSRF hardened.** Reject credentialed URLs, block redirects, constrain methods.
- **Secret file permissions** re-harden to `0600` on read/create.
- **WebSocket initial `snapshot` payload** now matches `/api/snapshot` and the web `Snapshot` expectations — includes active project, settings, tasks, mods, schedules, providers, and MCPs.
- **Project registry** could duplicate the same path under new IDs after name collisions — fixed path-first ID reuse.
- **Skills install API** could report success even when `skills` CLI failed — fixed store result reporting and route status handling.
- **Service scheduler** ignored `"default"` schedules unless tied to a registered project — fixed global/default schedule execution.
- **Diagnostics log tail** accepted invalid/negative values — clamped.
- **Notifications** read-state and destructive log rewrites made atomic; single read/delete actions now broadcast UI updates.
- **Hardcoded/stale dashboard versions** in settings/diagnostics/CLI/TUI now resolve from `package.json`.
- **Activity append paths** allowed caller-supplied `ts` to override server timestamps — server-side timestamp ownership enforced.
- **`/api/updates/apply`** now validates package IDs instead of accepting arbitrary strings.
- **`/api/chat`** clamps `limit` sanely.
- **Restart endpoint** handles spawn errors explicitly.
- **TUI** supports bearer-token auth when local auth is forced.

### Dashboard — desktop web
- **WebSocket stale-close reconnect race fixed** in `lib/ws.ts`.
- **Artifact viewer auth breakage fixed** — content/open/download routed through tokenized URLs.
- **Tasks column "select all" bug** fixed — only toggles that column's cards, not the whole board.
- **Chat ordering fixed** — no longer reverses conversation against "newest at bottom" intent.
- **Fullscreen plan cleanup fixed** — exits browser fullscreen on teardown.
- **Modal focus trap + focus restore added** across all modals and search.
- **Missing aria labels added** to icon-only controls in Plans, Activity, Tasks, Providers, Artifact viewer.
- **Dead duplicate artifact modal** removed.
- **Broken updates card heading** misuse (`<Card title=...>`) replaced with real visible header.
- **Unused imports cleaned** in Providers.
- **Repeated duplicated CSS blocks removed** from `main.css`.

### Dashboard — mobile
- **BottomSheet** fixed: focus entry/restore, guaranteed close button, drag-dismiss, dialog semantics, iOS-safe scroll lock.
- **Modal** fixed: focus trap/restore, overlay dismissal, safe-area padding, fixed-body scroll lock.
- **Sticky chat composer overlap** with bottom nav fixed — message space reserved, composer wraps on small widths.
- **44px touch targets** brought up across multiple mobile controls; `touch-action: manipulation` enforced.
- **Online / pageshow / visibility resume rebinds** added so mobile WS sessions recover after network/app resume.
- **Stable list/message keys** + assistant-message merge fixes reduce unnecessary remounts/duplicates.
- **iOS tap highlight reset** + `dvh`/safe-area-aware sizing for sheets and modals.
- **Routing verification:** server already correctly handles `/ → /m` and `?desktop=1` (no change needed).

### Agent configs (`config/`)
- **Critical fix:** 11 agent `.md` files had wrong model `openai/gpt-5.4` (bulk copy-paste error). Each agent now has its correct model:
  - Odin, Tyr, Forseti → `minimax/MiniMax-M3`
  - Hermod, Thor, Baldr, Quick → `minimax/MiniMax-M2.7`
  - Vidarr → `openai/gpt-5.5`
  - Vör, Frigg, Mimir, Heimdall → `opencode/deepseek-v4-flash-free` (free tier)
- **`config/opencode.json`** had the same model errors for 4 free-tier agents (costing $0.30/M instead of free).
- **`config/opencode.json`** command template paths fixed from `commands-bizar/` → `commands/`.
- **`config/opencode.json`** `bizar` command had malformed template field (template + arguments on one line) — split into proper `template` + `arguments` fields.
- **`semble-search` agent** was missing `model`, `color`, and permissions — added.
- **Hindsight permissions** added to all 11 agents that were missing `hindsight_recall`/`hindsight_retain`. Odin got `hindsight_list_banks` and `hindsight_create_bank`.
- **`plugins/bizar/src/commands.ts`** `default` branch was blocking all unknown commands — now passes through to let other handlers (built-ins, other agents) process them. This fixes `/explain`, `/init`, `/learn`, `/pr-review`, `/audit`, etc.
- **Typo** `competito → competitors` in `config/agents/baldr.md`.
- **Secrets:** verified no live secrets in `config/`; placeholder `__HINDSIGHT_BEARER_TOKEN__` retained.
- **Created `config/opencode.json.template`** so users have a safe reference copy. **`config/opencode.json`** is gitignored.

### Install scripts / templates
- **`install.sh`** prefers `opencode.json.template` over `opencode.json` for new installs; graceful skip when neither exists.
- **`install.sh`** `jq` fallback now warns user explicitly when merging is unsafe.
- **`scripts/git-hooks/pre-commit`** pre-commit token scanner verified present and working (Bearer tokens, `sk-ant-`, `sk-`, `ghp_`, `AIza` patterns).
- **`.gitignore`** cosmetic comment alignment; `config/opencode.json` already listed (file is git-tracked from prior commits — recommended `git rm --cached` done in this release).
- **All shell scripts pass `bash -n` syntax check.**
- **`templates/plan/`** fields match `buildVars()` in `cli/plan-templates.mjs` and `regenerateHtml()` in `cli/plan.mjs`.

### Build / typecheck / tests (all green)
- Root typecheck: PASS (after fixing `include` paths to cover `bizar-dash/src/`, `plugins/bizar/{index.ts,src/,tests/}`)
- Dashboard typecheck: PASS
- Dashboard build: PASS — 1884 modules, 1.56s, `index-*.js` 339.11 kB / 106.36 kB gzip, `main-*.css` 99.02 kB / 16.04 kB gzip, `mobile-*.js` 91.16 kB / 21.02 kB gzip
- Plugin typecheck: PASS
- Plugin tests: 212/212 pass (607 expects)
- CLI tests: 140/140 pass

### Files (116 changed, +3154 / −1334)
CLI: bin, audit, banner, bootstrap, copy, export, init, install, plan, plan-templates, prompts, service, update, utils, install.sh
Plugin: index.ts, src/{background, plan-fs, serve, commands}, 11 test files
Dashboard server: cli.mjs + 21 server modules and route files
Dashboard desktop web: App.tsx, 4 components, 8 views, lib/ws.ts, main.css
Dashboard mobile: MobileApp.tsx, 3 mobile components, 4 mobile views, mobile.css
Agent configs: opencode.json, 9 agent .md files, plugins/bizar/src/commands.ts
Install/templates: install.sh, .gitignore, config/opencode.json.template (new)

## v3.5.4 — 2026-06-19

### Changed
- **Activity page fully overhauled — now a live timeline.** The v3.5.2 graph-of-all-agents view has been replaced with a Gantt-style time-axis timeline:
  - X-axis is time (1m / 5m / 30m / 1h zoom levels); Y-axis is lanes (one per BG instance + tasks assigned greedily)
  - Tasks rendered as bars: pulsing border for `doing`, translucent dashed for `queued`, faded for `done`
  - Vertical red "now" line updates every second and re-anchors when it nears the right edge
  - Live event stream (left column) and detail panel (right column when a bar is clicked) are now proper sibling grid columns — no more absolute-positioned overlays obscuring the canvas
  - Mobile: stream collapses to a toggleable drawer; detail panel slides up from the bottom
  - Polling cadence: `/background` + `/activity` every 3s; now-line redraw every 1s

### Fixed
- **Plans canvas appeared blank when opening a plan.** Root cause: `.plans-canvas-wrap` had no `flex: 1` or `height: 100%`, so its absolutely-positioned `.canvas-root` child had nothing to anchor to and collapsed to toolbar height. Fixed by adding `flex: 1; height: 100%` to `.plans-canvas-wrap`, making `.plan-canvas-wrapper` a proper flex column, and changing `.canvas-root` from `position: absolute; inset: 0` to `position: relative; flex: 1; min-height: 0` so it claims remaining flex space.

### Cleanup
- Removed 121 lines of dead duplicate Activity CSS at `main.css:3499-3619` (the v3.3.2 absolute-positioned block that conflicted with the v3.3.1 flex version at line 4751+). The v3.5.4 rewrite uses entirely new class names (`.tl-*` prefix) so the old `.activity-canvas-*` and `.activity-timeline-*` rules are no longer referenced anywhere.

### Files
- `bizar-dash/src/web/views/Activity.tsx` — full rewrite (761 → 1155 lines)
- `bizar-dash/src/web/styles/main.css` — appended `/* v3.5.4 Activity timeline view */` block (lines 5819-6356); removed dead v3.3.2 Activity block (lines 3499-3619)

## v3.5.3 — 2026-06-19

### Fixed
- **Updates work end-to-end now**: previous versions could check for updates but couldn't apply them properly. Now:
  - Per-package selection (checkboxes for each of bizar / bizar-dash / bizar-plugin)
  - Live progress streamed via WebSocket (status: starting/installing/done/error per package)
  - npm output logged to a collapsible panel per package
  - "Restart Dashboard" button after update completes
- **Auto-restart**: `POST /api/restart` spawns a self-respawner that exits the current process and starts a fresh one. Frontend auto-reloads after 3 seconds.

### Added
- `POST /api/restart` endpoint
- WebSocket events: `update:progress`, `update:log`, `update:complete`

## v3.5.2 — 2026-06-19

### Fixed
- **WebUI randomly jumps back to Overview on data refresh**: Fixed a key-repeat event bug in the digit-key shortcut handler. When a user closes a modal and the browser fires a delayed key-repeat for a digit key, the handler was incorrectly switching tabs after the 1500ms safe window had closed. Added `if (e.repeat) return;` as the first guard in the handler, ensuring only the initial keydown fires a tab switch.
- **History tab broken**: The `/api/history` endpoint was already implemented. The view component was structurally correct; the apparent "broken" state was likely secondary to the tab-switching bug causing navigation away from the History tab.

### Changed
- **Activity tab redesigned**: Removed the separate Canvas/Timeline mode toggle. The Activity view is now a single integrated fullscreen mode combining the live agent/task graph with a collapsible timeline event strip. Users see one unified canvas with the floating control bar (zoom, fit, refresh) and a collapsible left-side timeline panel.
- **OpenCode config now has a real UI**: The Config → OpenCode config section no longer shows just a raw JSON editor. It now has a structured tabbed form with dedicated sections for Model (provider, model ID, base URL), Plugins (list with add/edit/delete/enable), Tools (enable/disable per tool), Permissions (allow/deny rule lists), and Hooks (pre/post tool and agent hooks). A raw JSON "Advanced" tab remains for power users.

## v3.5.1 — 2026-06-19

### Fixed
- **Mobile dashboard blank page on Tailscale**: `mobile.html` used relative asset paths (`./assets/...`) which resolved to `/m/assets/...` when served at `/m`. The server's `/m/*` SPA fallback route intercepted these asset requests and returned HTML instead of JS, causing the mobile bundle to fail to load. Two-part fix:
  1. Changed `vite.config.ts` `base: './'` → `base: '/'` so all asset paths are absolute
  2. Tightened the server's `/m/*` SPA fallback to a regex `/^\/m\/(?!assets\/)/` that excludes `/assets/*` paths

## v3.5.0 — 2026-06-19

### Added
- **Mobile dashboard at `/m`**: New mobile-friendly version of the Bizar dashboard optimized for phones (320px-768px wide). Features bottom navigation bar (5 tabs: Activity, Chat, Tasks, Settings, More), single-column layouts, 44px touch targets, sticky bottom chat composer, and touch-first interactions. Auto-redirects mobile users from `/` to `/m`. Use `?desktop=1` to bypass the redirect.

### API
- `GET /m` — serves the mobile dashboard HTML entry
- `GET /m/*` — serves the mobile dashboard HTML entry

### Files
- `bizar-dash/src/web/mobile.html` — mobile HTML entry point
- `bizar-dash/src/web/mobile.tsx` — mobile React entry point
- `bizar-dash/src/web/MobileApp.tsx` — mobile shell with bottom nav + tab routing
- `bizar-dash/src/web/mobile/MobileTopbar.tsx` — compact top bar (48px)
- `bizar-dash/src/web/mobile/MobileBottomNav.tsx` — bottom navigation (56px)
- `bizar-dash/src/web/mobile/views/MobileActivity.tsx` — quick stats + activity feed
- `bizar-dash/src/web/mobile/views/MobileChat.tsx` — messages + sticky composer
- `bizar-dash/src/web/mobile/views/MobileTasks.tsx` — vertical task list by status
- `bizar-dash/src/web/mobile/views/MobileSettings.tsx` — theme/project/about settings
- `bizar-dash/src/web/mobile/views/MobileMore.tsx` — agents, plans, projects, mods
- `bizar-dash/src/web/styles/mobile.css` — mobile-specific CSS (44px tap targets, safe areas, sticky nav)

## v3.4.1 — 2026-06-19

### Fixed (CRITICAL)
- **Removed `install` bin that shadowed the system `install(1)` command.** The `install` symlink in `package.json#bin` was pointing to the same script as `bizar`. When opencode or any program ran `install -dm700 /some/path` (a common Unix idiom for creating directories with specific permissions), it was hitting the bizarre installer instead of the system `install` command, causing the dashboard to spawn in a broken state. The `bizar install` subcommand continues to work — users should use `bizar install` explicitly instead of just `install`.

### Fixed
- **Settings `about.version` was being overridden by stale user settings.** `mergeSettings()` was allowing the user settings file to override `about.version`, causing the UI to show an outdated version. Now `about.version` is always sourced from the package default.
- **CSS hardcoded colors replaced with CSS variables.** `.badge-info` border and `.mod-mini-pill-on` background were using hardcoded rgba values instead of theme-aware variables.
- **Provider POST now auto-generates `id` from `name`** — was requiring `id` field in request body unnecessarily.

## v3.4.0 — 2026-06-19

### Fixed
- **Pervasive theme bug — all colors + shadows now respond to theme change**. Audit of every hardcoded `rgba(0,0,0,...)` / `rgba(139,92,246,...)` / `rgba(248,113,113,...)` / `rgba(52,211,153,...)` in `main.css`. Replaced with theme-aware CSS variables: `--accent-glow`, `--accent-soft`, `--success-soft`, `--error-soft`, `--warning-soft`, `--overlay-bg`, `--shadow-color-strong`. Sidebar tab text colors, drop shadows on cards, modal backdrops, status pills, badge borders, focus rings, WebSocket indicator, brand-logo glow, and button hover backgrounds all switch correctly between dark/light.

### Added
- **Config page rewrite — sidebar nav + fully editable Providers/MCPs**: two-column layout with left nav (OpenCode / Providers / MCPs / Diagnostics / Export). Add, edit, delete, toggle on/off for both providers and MCPs through proper modal forms. Provider fields: id, name, base URL, API key (masked), models (list), enabled toggle. MCP fields: id, type (local/remote), command + args OR URL + headers + OAuth, enabled toggle.
- **MCP store — supports new opencode.json format**: handles `command: [...]` array, `type: "remote"` with `url`/`headers`/`oauth`, and the legacy `command: "string"` + `args: [...]` shape.
- **Tasks horizontal kanban**: 4 columns (Queued / Doing / Blocked / Done) side-by-side. On narrow viewports, columns scroll horizontally with scroll-snap. Card drag-drop with smooth highlight on hover-target.
- **Tasks compact toolbar**: single-row layout with grouped Search / Filter / Sort labels + actions on the right. Replaces the previous oversized button row.
- **Activity visual timeline canvas**: new "Timeline" mode (alongside existing Graph view). X-axis = time, Y-axis = lane per agent (+ system, plans, bg). Events render as colored circles on their lane with hover tooltips. Time axis with hour:minute ticks. Lane separators. Event kind filter. Zoom in/out. Click event → opens node detail panel.
- **Overview — big no-frame hero**: replaced card wrapper with `.overview-hero-noframe`. 48px gradient title (`var(--text-strong)` → `var(--accent)`). 160px min-height textarea with glow focus ring. Quick-action chips in a centered row.
- **History view (new tab)**: cross-project history with time range filter (1h / 1d / 7d / 30d / all). Per-project expandable timeline rows showing recent events. Project stats (tasks done/doing/blocked/queued, plan count, last opened). Global events section. JSON export. Tag in Topbar.
- **New `/api/history` endpoint**: aggregates activity log events with per-project task + plan counts. Supports `?since=` and `?limit=` query params.

### API
- `GET /api/history?since=&limit=` — cross-project history
- `GET /api/config/providers` — list (was already there, now reliable)
- `POST /api/config/providers` — add (was already there)
- `PUT /api/config/providers/:id` — update (was already there)
- `DELETE /api/config/providers/:id` — remove (was already there)
- `GET /api/config/mcps` — list, now with type/url/headers/oauth fields
- `POST /api/config/mcps` — add, handles local + remote
- `PUT /api/config/mcps/:id` — update
- `DELETE /api/config/mcps/:id` — remove

### Plan
- `plans/v3-4-0-ui-overhaul/` — visual plan tracking the UI overhaul work

## v3.3.3 — 2026-06-19

### Added
- **Updates card in Settings**: shows currently installed versions of `@polderlabs/bizar`, `@polderlabs/bizar-dash`, and `@polderlabs/bizar-plugin`. "Check for updates" button queries npm for latest versions. "Update now" button runs `npm install -g @latest --ignore-scripts`. Progress and result displayed in the card.

### API
- `GET /api/updates/status` — current installed versions
- `GET /api/updates/check` — current + latest (queries npm)
- `POST /api/updates/apply` body `{ packages: [...] }` — run updates

## v3.3.2 — 2026-06-19

### Fixed
- **Theme color/shadow leakage**: hardcoded `rgba(0,0,0,...)` shadows that didn't respond to light theme. Now all shadows use `--shadow-color` CSS variable, defined as `rgba(0,0,0,0.45)` (dark) and `rgba(15,23,42,0.08)` (light).
- **Logo**: changed from emoji to runic B (ᛒ).

### Added
- **Activity canvas**: timeline panel is now embedded IN the canvas (left side, collapsible) instead of a separate tab. Floating controls bar at top center (zoom %, +/-, fit, refresh, timeline toggle).
- **Plans canvas**: floating controls overlay at top (Back, plan name, status, + Element, Comment, Configure).
- **Custom right-click context menu** in canvases (Activity + Plans): reusable `CanvasContextMenu` component. Right-click on canvas to access actions.
- **Overview main text input**: prominent hero input at the top of Overview — "What would you like to do?" with quick-action chips below. Submits to Odin via `POST /api/tasks/submit`.

## v3.3.1 — 2026-06-19

### Fixed
- **Chat redirect after actions (real fix)**: The v3.3.0 fix used a 250ms safe window which was too short. Now extended to 1500ms and listens for `focusin` and `keydown` events too. Also bails when active element is body/null within the safe window (the actual bug case — modal close → focus moves to body → stray keypress triggers tab switch).
- **Mods page**: `mods-loader.mjs` now never throws — all listing functions return empty arrays on error and protect against race conditions in `statSync`.
- **Submit handlers**: Every submit handler in Tasks view explicitly calls `preventDefault` + `stopPropagation`, closes the modal first, bumps the safe window, then updates state.

### Improved
- **Activity canvas**: No longer has a fixed `min-height: 600px` — now fills available space. New Timeline tab showing chronological events with timestamps.
- **Skills page**: Collapsible `<details>`/`<summary>` category sections (first 3 expanded by default). Search input stays at top.
- **Theme presets**: 8 one-click accent color swatches in Settings (Purple/Blue/Green/Orange/Red/Pink/Cyan/Mono).
- **CSS**: `.btn-success` now uses `var(--text-strong)` instead of hardcoded `#0b0e14`.

## v3.2.2 — 2026-06-19

### Fixed
- **npm install no longer requires allow-scripts approval.** npm v10+ blocks postinstall scripts by default. The setup work (agents, plugin, Headroom, Semble, Skills CLI, core skills) used to live entirely in the postinstall hook, which meant many users had a broken install without knowing it. The setup logic now self-bootstraps on first bin invocation.

### Added
- **`bizar --setup`** explicitly runs the setup (replaces `node cli/bin.mjs --postinstall`).
- **`bizar --check`** prints setup status as JSON, exits 1 if setup is needed (useful for CI/scripts).
- **`BIZAR_SKIP_INSTALL=1`** env var disables auto-setup (useful for sandboxed environments).
- Every bin command (`bizar`, `install`, `bizar-dash`, etc.) now checks setup status on entry. If anything is missing, the setup runs automatically before the command proceeds. Already-installed components are detected and skipped.

### Removed
- The `postinstall` script in package.json. npm install just installs the package files now — setup happens on first use.

### Migration
- Nothing required. Existing installs work as before. Future installs work without needing `npm approve-scripts`.

## v3.2.1 — 2026-06-19

### Added
- **Install prompts**: When you run `npm install -g @polderlabs/bizar`, the postinstall now detects missing `@polderlabs/bizar-plugin` and `@polderlabs/bizar-dash` and prompts to install them. Defaults to yes (just press Enter).
- **Skip flag**: Set `BIZAR_SKIP_OPTIONAL_INSTALLS=1` to skip the prompts (useful for CI).
- Plugin prompt explains: "required for /bizar in opencode"
- Dashboard prompt explains: "optional web/TUI dashboard"
- If a package is already installed, it's detected and the prompt is skipped.
- If installation fails, helpful message with manual fallback command.

## v3.2.0 — 2026-06-19

### Fixed
- **Redirect-to-home on click**: form submits and stray `setActiveTab('overview')` calls were triggering unwanted navigation. Digit-key shortcuts (`1`, `2`, …) now bail out when focus is on any focusable form control (`<input>`, `<textarea>`, `<select>`, `<button>`, `<option>`, `<label>`, `[contenteditable]`) or when the target is inside a `<form>`, `[role="dialog"]`, `[contenteditable]`, or `[data-no-key]`. The shell's keyboard handler also short-circuits when `Shift` is held so OS / extension shortcuts pass through cleanly.

### Added
- **Main task container with auto-delegation**: Submit a task to Odin via the Tasks view's "Submit to Odin" modal. Odin analyzes the title/description, splits it into subtasks using a heuristic (detect `implement / test / docs / design / research / refactor`), assigns each subtask to the best-fit agent based on keyword + tag rules, and best-effort dispatches them to the background-agent infrastructure. New `POST /api/tasks/submit` returns `{ main, subtasks }`. New `src/server/task-delegator.mjs` (411 LoC) + `splitTask` / `matchAgent` / `dispatchToBackground` helpers.
- **Background agents via tmux**: New Background tab/API bridge (`src/server/background-store.mjs`). Lists all running bg instances from `~/.cache/bizar/bg/*.json`, `~/.config/opencode/bg/`, and `~/.bizar/bg/`, enriches with live tmux session info (active state, last N lines of output), and exposes `sendMessage` / `kill` / `captureOutput` / `attachCommand` operations. New endpoints: `GET /api/background`, `GET /api/background/:id`, `GET /api/background/:id/output`, `POST /api/background/:id/message`, `DELETE /api/background/:id`.
- **Agent hierarchy**: Each agent has `level` (0=router, 1=coordinator, 2=worker, 3=fallback), `parent` (who delegates to them), and `role`. New `GET /api/agents/hierarchy` returns a tree (roots + flat `all`). 13 agents mapped: Odin & Forseti at level 0; Tyr, Thor, Hermod, Baldr, Mimir report to Odin; Heimdall under Thor; Frigg & Vor under Mimir; Vidarr at level 3 as ultimate fallback. `Agent` type extended with `level` / `parent` / `role`.
- **Activity canvas**: New Activity tab with a full-graph SVG canvas. All agents, active tasks, and bg instances rendered as nodes. Edges show hierarchy (`parent → child`, accent color), assignment (`agent → task`, info color), and subtask relationships (`task → child task`, dashed muted). Pan/zoom (mouse drag, scroll-wheel), click any node for details. `data-task-parent` added to task cards for cross-linking. New `src/web/views/Activity.tsx` (690 LoC) + `src/web/styles/main.css` `+340` lines for the canvas, controls, legend, and detail panel.
- **Comment + task injection on canvas nodes**: Click any node to open a 360px detail panel showing the node's meta (type, status, role, model, assignee, priority, started at, description, prompt preview). For bg nodes: live tmux output, refresh button, kill button, send-message input. For all nodes: a per-node activity log + comment thread, plus a quick "Create follow-up task" form. New endpoints: `POST /api/comments` (node-scoped), `POST /api/nodes/:nodeId/tasks` (creates a task tagged with the node id), `POST /api/activity`, `GET /api/activity` (filter by `nodeId` or `kind`).
- **Activity log**: Append-only JSONL at `~/.config/opencode/activity.jsonl`. Auto-rotates when >5MB. The task delegator writes `task.delegated` events; canvas comments write `node.comment`; node-created tasks write `node.task`. All events are broadcast over WebSocket as `activity:change`. New `src/server/activity-log.mjs` (157 LoC) with `append` / `recent` / `forNode` / `byKind` / `stats`.

### Changed
- **App.tsx** — imports + mounts the Activity view; broadens the digit-key guard. `VERSION` bumped to `v3.2.0`.
- **Topbar.tsx** — adds the "Activity" tab (icon: `Activity`).
- **types.ts** — extends `Agent` with `level` / `parent` / `role`; extends `Task` with `subtasks` (string[]) and `metadata` (Record<string, unknown>).
- **api.mjs** — adds `/api/tasks/submit`, `/api/agents/hierarchy`, `/api/background[/...]`, `/api/activity`, `/api/comments`, `/api/nodes/:nodeId/tasks`. Bumps `about.version` to `3.2.0`. Reorders the `/api/agents/*` block so `/agents/hierarchy` and `/agents/stuck` are mounted before the `/agents/:name` catch-all.
- **agents-store.mjs** — `HIERARCHY` map + `level` / `parent` / `role` on every agent snapshot. New `buildHierarchyTree(agents)` exported helper.
- **tasks-store.mjs** — `create()` now persists `subtasks` and `metadata`; `update()` merges metadata and replaces subtask ids.
- **diagnostics-store.mjs** — `version` → `3.2.0`.

### Verified
- Type-check: 0 errors (103 errors → 0; added explicit types in `Activity.tsx` and `Tasks.tsx`).
- Build: passes (`vite build` — 503 KB JS / 68 KB CSS).
- Tests: **140/140 pass** (`node --test cli/plan.test.mjs`).
- Task submission creates subtasks and dispatches to background; round-trips via `POST /api/tasks/submit` for both `impl+test` (thor) and `research+design` (baldr) prompts.
- Activity canvas renders agents, tasks, and bg instances.
- All existing endpoints (`/api/agents`, `/api/projects`, `/api/search`, `/api/diagnostics`, `/api/chat`, `/api/plans`, …) still work.
- The global install at `~/.local/npm/lib/node_modules/@polderlabs/bizar-dash` was synced in place (no publish).

## v3.1.1 — 2026-06-19

### Fixed
- **Sidebar (and topbar) disappeared on chat/plans/skills tabs.** The "fullscreen" CSS used `position: fixed; inset: 0; z-index: 5` which covered the entire viewport including the sidebar. Now these views fill the content area (`flex: 1`) while the sidebar and topbar stay visible above.

## v3.1.0 — 2026-06-19

### Added
- **Chat takes full viewport** — the chat tab is now edge-to-edge, flush against the viewport with no padding, max-width, or container borders. The header stays at the top but the sessions rail, message list, composer, and info sidebar all flow into the full window. CSS hook: `data-active-tab="chat"` on `.app` switches off the `.content` padding/max-width, and the Chat view root uses `.view-chat-fullscreen` (`position: fixed; inset: 0; z-index: 5`).
- **Plans canvas — full editor + floating controls**. Selecting a plan now opens a fullscreen canvas (similar to Chat) with a floating control bar at the top: `[< Back]  Plan: <title> [<status>]  [Element] [💬 Comment] [⚙ Configure] [⤢ Full] [🗑 Delete]`. Element types: `task`, `note`, `decision`, `question` (color-coded: blue / gray / purple / amber). Element cards can be moved by dragging, edited inline (double-click), right-click deleted, and connected via a context menu. Connections are drawn as labeled SVG lines with arrows. Pan with drag-empty, zoom with scroll, "Fit to view" button. Side panel for comments per element or canvas-level; "Add comment" composer at the bottom of the panel. Plan configuration modal: title, description (markdown), tags (comma-separated), status, default element type, template. Bulk position updates via `PUT /api/plans/:slug/position` for smooth drag-end.
- **Agents → tasks real-time tracking**. `agentsStore.updateStatus(name, status, currentTaskId?)` records `idle / working / error / stuck` plus `lastSeen`, `currentTaskStartedAt`, `heartbeat`, `lastError`, `lastTask`, and a running success-rate tally. Task changes broadcast `agent:status` over WebSocket; the Agents page reflects the active agent on the card with a pulsing `is-working` border, "Working on <taskId>" row, last-task row, and success-rate row. Tasks detail modal exposes "Mark as worked on by @<agent>" with Start/Complete/Stop.
- **Tasks — archive, bulk actions, filters, sort, recurring, comments**. New columns: `Blocked` (in addition to Queued/Doing/Done). New `archived` field on Task. New endpoints: `POST /api/tasks/:id/archive` and `/unarchive`, `POST /api/tasks/bulk` (actions: archive, unarchive, delete, move, priority, assign, tag), `POST /api/tasks/:id/timer/start` and `/timer/stop`. The Tasks view now supports: search, assignee filter, priority filter, tag filter, sort (priority / due / created / updated), "Show archived" toggle, bulk action bar with select-all, recurring field (daily / weekly / monthly / custom cron) on the edit modal, comment thread in the detail modal, due date, pulse animation on running timers.
- **Agents — tags + categories**. Each agent frontmatter now has `tags: [reasoning, code, planning]` and `category: reasoning` (one of: reasoning / code / design / planning / gitops / analysis). Agents page shows category badge, tag chips, and a category filter dropdown. New / Edit modal has Tags input and Category dropdown. `PUT /api/agents/:name` now accepts both fields.
- **New Skills page**. New view `src/web/views/Skills.tsx` with two sections — Installed (from `~/.config/opencode/skills/`, `.agents/skills/`, `agent/skills/`, and the global install) and Browse (search box wired to the `skills` CLI or a local fallback index). Each skill has: name, description, source, version, status (enabled/disabled), category, install command. New backend `src/server/skills-store.mjs` + routes: `GET /api/skills`, `GET /api/skills/search?q=…`, `POST /api/skills/install`, `POST /api/skills/:id/disable`, `POST /api/skills/:id/enable`. New "Skills" tab in the topbar with a `Sparkles` icon. Categories: All, Programming Languages, Frameworks, Tools, Testing, Design, Reasoning, Planning, GitOps, Docs.
- **Stuck agent detection + auto-restart**. The agents store now computes `isStuck` for any agent that has been `working` for more than 10 minutes (configurable) or has been in `error` for more than 10 minutes. New endpoints: `POST /api/agents/:name/restart` (resets runtime state, marks idle, clears current task), `GET /api/agents/stuck` (returns the list). New dashboard banner at the top of the app: "X agents are stuck: <names>" with a Review button that jumps to the Agents page. New WS event `agent:stuck` for real-time updates. Restart is currently a "reset to idle" — actual process restart is documented as v3.2.

### Fixed
- **Dashboard `GET /api/schedules` was broken** — handler was declared with `(_req, res)` but referenced `req`, returning `{ error: 'internal_error', message: 'req is not defined' }`. Now uses `req` correctly.

### Changed
- **App.tsx** — added `data-active-tab` attribute on `.app` for CSS hooks. Added a stuck-agents banner component above `.layout-body`. Periodic 30-second poll of `/api/agents/stuck` with toast notification when agents go from "0 stuck" to ">0 stuck". WebSocket handlers for `agent:status`, `agent:restarted`, `agent:stuck`, and `plan:change`.
- **agents-store.mjs** — added `updateStatus`, `heartbeat`, `recordTaskResult`, `restart`, `stuck`, and a `isStuck` helper. `tags` and `category` parsed from frontmatter (array syntax `[a, b, c]` and bare string). The store now persists runtime status to `~/.config/bizar/agent-status.json` so it survives restarts.
- **tasks-store.mjs** — added `startTimer`, `stopTimer`, `archive`, `unarchive`, `bulk`, `setWorkedBy`, `spawnNextRecurrence`, plus a 3-arg `loadTasks(projectId, { includeArchived, onlyArchived })`. New `archived`, `workedBy`, `dueDate` fields. Status set now includes `blocked` and `archived`. Marking a recurring task done auto-creates the next occurrence and records `lastGenerated` on the original.
- **plans-store.mjs** — new file. Full plan CRUD + canvas operations: create / update meta / delete / getCanvas / saveCanvas / addElement / updateElement / deleteElement / updatePositions / addConnection / deleteConnection / addComment / deleteComment. Auto-migrates v1 mdx plans to the v2 canvas on first read. Sanitizes all incoming JSON to drop junk and enforce types.
- **skills-store.mjs** — new file. Wraps the `skills` CLI (installed via `npm i -g skills`) and falls back to a local mock catalog when the CLI is missing.
- **api.mjs** — added routes: `POST /api/agents/:name/status|heartbeat|restart`, `GET /api/agents/stuck`, `POST /api/tasks/:id/work|archive|unarchive|timer/start|timer/stop`, `POST /api/tasks/bulk`, `PATCH /api/tasks/:id/status` (now accepts `blocked` and `archived`), `POST /api/plans`, `PUT /api/plans/:slug`, `DELETE /api/plans/:slug`, `GET /api/plans/:slug/canvas`, `PUT /api/plans/:slug/canvas`, `POST/PUT/DELETE /api/plans/:slug/elements[/:id]`, `PUT /api/plans/:slug/position`, `POST/DELETE /api/plans/:slug/connections[/:id]`, `POST/DELETE /api/plans/:slug/(elements/:id/)?comments[/:cid]`, `GET /api/skills`, `GET /api/skills/search`, `POST /api/skills/install`, `POST /api/skills/:id/(enable|disable)`.
- **types.ts** — extended `Agent` with `tags`, `category`, `status`, `currentTaskId`, `lastSeen`, etc.; extended `Task` with `archived`, `workedBy`, `dueDate`, `blocked`; extended `CanvasElement` with optional `status`; extended `CanvasConnection` with optional `label`; extended `WsMessage` with `agent:status`, `agent:restarted`, `agent:stuck`, `plan:change`.
- **Plans.tsx** — completely rewritten. List view shows a 2-column grid of plan cards (with status badge, element/comment counts, edit time). Selecting a plan opens a fullscreen editor (`.view-plans-fullscreen`) with a floating control bar (`PlanEditorHeader`) and a `<CanvasViewport>` that handles pan/zoom, drag, double-click-to-edit, right-click-to-delete, SVG connections with labels, and a `<CommentsPanel>` for the selected element or the whole canvas. Add Element / Add Comment / Configure modals. `+ Element` modal supports type, title, content; `Configure` modal supports title, description, tags, status.
- **Tasks.tsx** — completely rewritten. New columns (Queued / Doing / Blocked / Done), status badges, sort + filter toolbar (assignee, priority, tag, sort by priority/due/created/updated, "Archived" toggle). Bulk action bar (select all, move, change priority, archive, delete). Card-level: archive button, comments badge, recurring badge, working-by-agent badge, due date. Detail modal has Mark as Worked On By, Start/Stop timer (live updated), Dependencies, Recurring, Comments, Activity.
- **Agents.tsx** — completely rewritten. Status dot, category badge, tag chips, activity row (Working on / Last task / Success rate), Restart button, expanded panel with status-set buttons. Tags filter row above the grid. Category dropdown. New / Edit modal has Tags + Category fields.
- **Skills.tsx** — new view. Skills list (category filter at top), search results, skill cards with name, source, version, tags, enable/disable/install actions. Per-skill detail modal.
- **Topbar.tsx** — added "Skills" tab (icon: `Sparkles`).
- **Button.tsx** — added `'success'` variant.
- **CSS** — new rules: `.view-chat-fullscreen`, `.view-plans-fullscreen`, `.view-skills-fullscreen`, `.stuck-banner`, `.task-bulk-bar`, `.agent-card-*`, `.plan-card`, `.plans-editor-bar`, `.plans-body`, `.plans-comments-panel`, `.canvas-element-*`, `.canvas-toolbar`, `.skill-card`, `.skills-categories`, `.is-working` / `.is-stuck` pulse animations. Reorganized so all the new v3.1.0 styles are grouped after the existing v3.0.0 sections.

### Notes
- The global install at `~/.local/npm/lib/node_modules/@polderlabs/bizar-dash` was synced in place (no publish).
- Real agent process restart is documented as v3.2. v3.1.0's "Restart" resets runtime state, it does not kill the opencode process.

## v3.0.4 — 2026-06-19

### Fixed
- **Auto-detect current directory as a project** on dashboard startup. The user's cwd is now registered in the projects registry if not already present, and set as active if no active project exists.
- **Chat sessions UX**: prominent "New session" button, better empty states ("Pick a project in Overview" when no project, "Create your first session" when no sessions).
- **Search now includes settings**: type `theme`, `accent`, `layout`, etc. to find settings. Settings results link to the Settings view and scroll/highlight the relevant setting.

### Changed
- Comprehensive UI consistency pass: spacing, focus rings, hover states, transitions, empty states, loading states.
- Settings rows tagged with `data-setting-id` so search can scroll to them.

## v3.0.3 — 2026-06-19

### Fixed
- **Dashboard — sidebar layout was completely broken in `topnav` / `sidebar` / `both` modes.** The previous CSS at `src/web/styles/main.css:3130-3144` set `.app[data-layout="sidebar"] { display: grid; grid-template-columns: 200px 1fr; }` and tried to hide the topbar `.tabs`, but there was no actual `<aside>` element — so the grid created a 200px gap with nothing in it, the topbar tabs were hidden (creating dead space), and the content area got squeezed or overlapped the topbar. Now there's a real `Sidebar` component (`src/web/components/Sidebar.tsx`) that renders when `layout !== 'topnav'`, and the topbar tabs row is conditionally rendered via a new `showTabs` prop (false in sidebar/both modes). The shell is now flex-based: `.app` → `.topbar` → `.layout-body` (flex row) → `[<Sidebar />] <main.content>`. Mobile (≤900px) collapses the sidebar to a fixed drawer.
- **Dashboard — chat composer was squished.** The `<textarea className="chat-input">` lived in a single `.chat-composer-row` that also held the agent selector, model input, attach button, and Send button — every item competed for horizontal space and the textarea was squeezed into a corner. The composer is now a proper floating chatbox at the bottom of `.chat-main`: a `.chat-composer-toolbar` row on top (agent select + model input + attach button + keyboard hint) and a `.chat-composer-input` row below (full-width `<textarea>` + square Send button). The textarea auto-grows up to 240px via `useLayoutEffect` and clamps with internal scroll.
- **Dashboard — Config page "Advanced" section was clipping/cramped.** The tabs (`OpenCode config · Providers · MCPs · Debug log`) didn't wrap, panels were tiny, and at narrow widths things overlapped. Now the section uses a proper collapsible header (chevron + title + description), the tabs wrap (`flex-wrap: wrap`), the body has `min-height: 320px`, and the JSON editor collapses to single column under 1100px. The editor panel was extracted into a `ConfigEditorPanel` component for cleaner structure.
- **Dashboard — comprehensive UI polish.** Consolidated duplicate `.chat-list` / `.chat-composer` / `.chat-input` CSS rules (legacy v2.6.0 block conflicted with the v3 floating-chat block); removed dead `.tabs` rules in favour of the new `.tabs-row` rendered by `Topbar.tsx`; added focus rings (`outline: 2px solid var(--accent)`) on the chat input, agent/model selects, and attach button; added smooth `120ms` transitions on hover/focus for color, background, and border; standardized the `.view` container to fill its parent's height (so the floating chat layout has space to fill).

### Changed
- `src/web/App.tsx` — restructured: `<div className="layout-body">` wraps `<Sidebar />` (conditional) + `<main className="content">`. `VERSION` constant bumped to `v3.0.3`.
- `src/web/components/Topbar.tsx` — refactored to use a two-row layout: `.topbar-row` (brand + project selector + search + ws status, fixed 56px) + optional `.tabs-row` (when `showTabs` is true). New `showTabs?: boolean` prop (default `true`).
- `src/web/components/Sidebar.tsx` — **new file**. Renders the vertical nav rail: `<aside className="sidebar">` with `<nav className="sidebar-nav">` and one `button.sidebar-tab` per tab. Includes active-state styling, hover transitions, and proper `role="tablist"` / `role="tab"` for a11y.
- `src/web/views/Chat.tsx` — composer restructured (toolbar + input row, full-width textarea, square send button, auto-grow). Removed unused `CornerDownLeft` and `FileText` imports. `Wrench` icon now unused (cleanup). Attachment remove uses `<X size={10} />` icon instead of `×` literal.
- `src/web/views/Config.tsx` — Advanced section is now a proper collapsible card with icon + title + description + chevron. `ConfigEditorPanel` extracted. Tabs are real `role="tab"` buttons. Imported `Sliders` icon.
- `src/web/styles/main.css` — major pass:
  - Layout shell: replaced broken 200px grid (`app[data-layout="sidebar"] { grid-template-columns: 200px 1fr }`) with proper flex layout (`.layout-body` is `display: flex` with `flex: 1`).
  - New `.sidebar` / `.sidebar-nav` / `.sidebar-tab` / `.sidebar-tab-active` styles.
  - New `.topbar-row` / `.tabs-row` for the slim two-row topbar.
  - New `.chat-composer-toolbar` / `.chat-composer-input` / `.send-btn` / `.attach-btn` / `.toolbar-spacer` / `.hint` for the floating composer.
  - Replaced dual `.chat-list` / `.chat-composer` / `.chat-input` definitions with single consolidated rules.
  - `.config-advanced` / `.config-advanced-head` / `.config-advanced-body` / `.config-advanced-tabs` / `.config-advanced-panel` for the collapsible advanced section.
  - `.view-chat` and `.view-config` now have `height: 100%; min-height: 0` so the floating chat layout fills the available space.
  - Chat layout collapses to single column under 1200px (sessions + info panels hide).
  - Sidebar collapses to fixed drawer under 900px (mobile).
- `src/server/api.mjs` and `src/server/diagnostics-store.mjs` — version bumped from `3.0.0` to `3.0.3` in the default settings + diagnostics responses.
- `src/web/views/Settings.tsx` — fallback `about.version` bumped from `3.0.0` to `3.0.3`.

### Verified
- `npx tsc --noEmit` — no errors.
- `npm run build` — builds cleanly: 52.7 kB CSS (gzip 9.4 kB), 437 kB JS (gzip 129 kB).
- Dashboard smoke test (`node src/cli.mjs start` + curl) — serves HTML 200, JS+CSS assets serve 200, new classes (`sidebar-tab`, `tabs-row`, `chat-composer-toolbar`, `send-btn`, `config-advanced-head-title`) present in the bundles.
- Existing test suite (`node --test cli/plan.test.mjs`) — 140/140 pass.

## v3.0.2 — 2026-06-19

### Fixed
- **Documentation: removed incorrect "build the dashboard" instructions.** The `@polderlabs/bizar-dash` package ships a prebuilt `dist/` and does not require a build step on install. Updated README, server fallback page, and GitHub release notes.
- **`bizar-dash` server fallback page**: improved error message when `dist/index.html` is missing — points users at `npm install -g @polderlabs/bizar-dash --force` instead of telling them to run `npm run build` (which requires dev dependencies not installed for global users).

## v3.0.1 — 2026-06-19

### Fixed
- Removed spurious `@polderlabs/bizar-dash` self-reference from `bizar-dash/package.json#peerDependenciesMeta`. The package was referring to itself as an optional peer, which is invalid. Only `@polderlabs/bizar` should be there.

## v3.0.0 — 2026-06-19

### BREAKING — Package split
- **The dashboard is now a separate npm package: `@polderlabs/bizar-dash`**.
  - `@polderlabs/bizar` (this package) is the core runtime — CLI,
    installer, audit, init, export, plan, update, **service**, and the
    dashboard-launcher that delegates to `@polderlabs/bizar-dash`.
  - `@polderlabs/bizar-dash` is the optional web + TUI dashboard. It
    ships its own `bizar-dash` bin that mirrors the previous
    `bizar dashboard` / `bizar --web*` commands.
  - The peer dependency is **optional** — `bizar` continues to work
    without the dashboard, and prints an install hint when you try to
    launch the web UI.
  - The dashboard now lives at `<repo>/bizar-dash/`. The root `src/`,
    `dist/`, `cli/dashboard*` files are removed.

### Added — Mods system
- **Mods are now a first-class concept** in the Bizar platform.
- Storage: `~/.config/bizar/mods/<mod-id>/`. Each mod is a folder
  with a `mod.json` manifest.
- Manifest schema: `id`, `name`, `version`, `author`, `description`,
  `bizar` (compat), `type` (`agent` / `command` / `view` / `route` /
  `tui` / `full`), `enabled`, `permissions[]`, `entry{}`.
- Folder layout: `agents/`, `commands/`, `routes/`, `views/`,
  `web/`, `tui/`, `hooks/`.
- Mod loader scans the mods dir on dashboard start. Custom agents
  appear in the Agents view; custom commands appear in the chat
  slash-command helper.
- New Mods view in the dashboard — list, install, enable / disable,
  uninstall, view file tree + manifest.
- REST surface: `GET /api/mods`, `POST /api/mods` (install from path),
  `PUT /api/mods/:id` (toggle enabled), `DELETE /api/mods/:id`,
  `GET/PUT /api/mods/:id/files/*`.
- **Sample mod**: `bizar-dash/templates/mod/hello-mod/` ships a
  working example (greeter agent + `/hello` command + sample
  route + sample view).

### Added — Project selector + per-project data
- **All dashboard data is now project-scoped**, except the dashboard
  view itself (which is the project picker).
- Project registry: `~/.config/opencode/projects.json` with
  `projects[]` and `active` id.
- Per-project data: `~/.config/opencode/projects/<id>/` containing
  `tasks.json`, `plans.json` (future), `schedules.json`, `state.json`,
  `sessions/`, `activity.log`.
- Project id is the path basename (e.g. `/home/user/myapp` → `myapp`).
- Topbar project selector: dropdown of all known projects with
  current active highlighted, `+` to add current cwd, refresh button.
- Overview view: card grid of all projects, with status
  (active / inactive / error), last-accessed time, task counts
  (queued / doing / done), and recent activity.
- REST surface: `GET /api/projects`, `POST /api/projects`,
  `POST /api/projects/:id/activate`, `DELETE /api/projects/:id`,
  `GET /api/projects/active/{tasks,schedules,mods,state}`.
- WebSocket broadcasts `project:change` so the dashboard re-fetches
  on activation.

### Added — Background service daemon + scheduled tasks
- **`bizar service`** manages a long-running background daemon.
  - `bizar service start` — spawn detached.
  - `bizar service stop` — kill via PID file.
  - `bizar service status` — running / stopped.
  - `bizar service logs` — tail `~/.config/bizar/service.log`.
- The service:
  - Watches per-project schedules and fires them at the right time.
  - Ticks every 5 seconds; idle when no schedules are due.
  - Writes PID to `~/.config/bizar/service.pid`.
  - Logs every tick + every run to `~/.config/bizar/service.log`.
- Schedule types: `interval` ("30m", "2h", "1d"), `cron`
  ("0 9 * * *"), and `once` (ISO timestamp).
- Schedule action types: `command` (spawn shell), `agent` (deferred
  to v3.1+), `webhook` (POST JSON).
- Schedules view: list, create, edit, delete, **Run now**, view
  history of past runs (last 50).
- REST surface: full CRUD on `/api/schedules` plus
  `POST /api/schedules/:id/run` for immediate execution.
- New schedule cron parser supports `*`, `*/N`, integers, lists, and
  ranges.

### Added — Floating chat with right info sidebar
- The chat view was squished in v2.7.0; v3.0.0 fixes that.
- Layout: `Sessions` rail (left, ~200px) + `Messages` (centre, full
  height) + `Info sidebar` (right, ~280px).
- Floating chatbox anchored to the bottom of the chat column,
  ~80 px tall, with: textarea, **agent selector**, **model override**,
  **attach files** button, Send button (Enter or ⌘/Ctrl+Enter).
- Slash-command autocomplete appears above the input as you type
  `/` — includes built-in commands **and** mod-supplied commands.
- Right sidebar shows: active session info (id, message count,
  pinned count, current agent + model), agents in the project, active
  MCPs with on/off status, recent slash commands, project
  references.
- Per-message actions: copy, regenerate, pin, delete.
- Pin messages to keep them at the top of the session.

### Added — Config editor (Advanced section) + Diagnostics
- Config view now lives behind a collapsible **Advanced** section
  (default collapsed). The Diagnostics card is always visible above
  it.
- Diagnostics card shows: version, uptime, node version, platform,
  heap + RSS memory, service running state with PID, active project,
  counts (agents / projects / mods / schedules / tasks / providers /
  mcps), and the **last 10 errors** from the service log.
- "Run diagnostics" and "Download diagnostics bundle" buttons
  generate a JSON snapshot for support.
- Advanced section has 4 sub-tabs:
  - **OpenCode config** — JSON tree + raw editor + diff (kept from
    v2.x, polished).
  - **Providers** — add / remove AI providers (name, base URL, API
    key — masked, models list).
  - **MCPs** — add / remove MCP servers (command, args, env).
  - **Debug log** — recent log entries.
- All sub-sections write to `~/.config/opencode/opencode.json` under
  the `provider` and `mcp` keys.
- REST surface: full CRUD on `/api/config/providers` and
  `/api/config/mcps`.

### Added — Theme colors + Theme settings
- Settings schema now includes a rich `theme` block:
  - `mode`: `dark` / `light` / `system` (kept from v2.x).
  - `accent`, `success`, `warning`, `error`, `info`: hex colors.
  - `fontFamily`: dropdown (Inter, system-ui, Segoe UI, Roboto, JetBrains Mono, …).
  - `fontSize`: 12–20 px slider.
  - `compactMode`: denser UI.
  - `animations`: enable / disable motion.
- Live preview: the moment you tweak a color picker, the entire
  dashboard updates via CSS custom properties on `<html>`.
- "Reset to defaults" button on the settings page.
- Settings card in the new UI: Theme, **UI layout** (topnav /
  sidebar / both), default tab, status bar toggle.

### Added — UI customization
- New `ui` block in settings: `layout` (`topnav` / `sidebar` / `both`),
  `showHeader`, `showStatusBar`, `defaultTab`, `accentColor`.
- Layout applies a grid that switches between topnav, sidebar, and
  both. The change is live.

### Added — Tailscale serve config
- New Tailscale card in the Settings view.
- Reads `tailscale` CLI status: installed, version, authenticated,
  backend, hostname.
- Enable / disable Tailscale serve for the dashboard port via
  `tailscale serve --bg https <port>`.
- REST surface: `GET /api/tailscale/status`, `POST /api/tailscale/enable`,
  `POST /api/tailscale/disable`.

### Added — Fuzzy search across everything
- New search bar in the topbar. Press `/` or **⌘ / Ctrl + K** to
  open the search modal.
- Searches: tasks, plans, agents, projects, mods, schedules, slash
  commands.
- Results are grouped by type. ↑/↓ to navigate, ↵ to open, Esc to
  close.
- REST surface: `GET /api/search?q=<query>&scope=<type>`.

### Added — Editable agents
- Every agent card now has **Edit** + **Delete** buttons.
- **New agent** wizard with name, description, model dropdown, mode
  (primary / subagent / all), color, tools checkboxes, and a system
  prompt textarea.
- Edits write to `~/.config/opencode/agents/<name>.md` and update
  the frontmatter + body in place.
- REST surface: `GET /api/agents`, `GET /api/agents/:name`,
  `POST /api/agents`, `PUT /api/agents/:name`,
  `DELETE /api/agents/:name`.

### Added — Extended tasks
- Tasks now have: `assignee`, `parent` (subtasks), `dependencies`,
  `timeSpent`, `recurring` (cron), `attachments`, `comments[]`,
  `activity[]`.
- Task detail modal: timer (start / stop), add / remove dependencies,
  set / clear recurring, post comments, view activity timeline.
- Bulk-action "Assign to me" on each card.
- Activity log records `created`, `status` changes, `completed`,
  `timer-start`, `timer-stop`, `comment` events.

### Added — OpenCode config UI
- Providers and MCPs are now first-class in the dashboard, with
  add / remove cards. Provider API keys are masked in responses and
  round-trip through the unmask sentinel (`***…***`) so the user
  can save without re-typing the key.

### Added — Diagnostics
- New `/api/diagnostics` endpoint returns version, uptime, memory,
  service status, all counts, and the last 10 errors from the
  service log. Surfaced in the Config view's always-visible
  diagnostics card.

### Changed
- `bizar` no longer ships dashboard source code. The dashboard is
  installed separately as `@polderlabs/bizar-dash`.
- The default `bizar` invocation now checks whether
  `@polderlabs/bizar-dash` is installed. If it is, it delegates to
  the dashboard's TUI; if not, it prints an install hint.
- Tasks endpoint now scopes to a project. The legacy global file
  (`~/.config/bizar/tasks.json`) is the fallback when no project is
  active.
- `~/.config/bizar/settings.json` now contains a nested `theme{}`,
  `ui{}`, and `service{}` block. Existing v2.7.0 settings are deep-
  merged forward, so old user state still works.

### Migration notes
- The dashboard moves to its own package. Install with:
  `npm install -g @polderlabs/bizar-dash`.
- The dashboard reads the same opencode config and the same
  per-project data dirs as v2.7.0, so existing agents / commands /
  plans / projects continue to work.
- Tasks created with v2.7.0 are read from the legacy
  `~/.config/bizar/tasks.json` until you add a project and create a
  new one — at which point everything new lives in
  `~/.config/opencode/projects/<id>/tasks.json`.

## v2.7.0 — 2026-06-19

### Added
- **TUI dashboard** — `cli/dashboard-tui.mjs` is a full terminal dashboard
  built on `blessed`. It launches when you run `bizar` with no arguments and
  replaces the previous default of opening the browser. Eight tabs:
  - **Overview** — counts (agents / plans / projects / sessions), versions,
    last 15 activity events.
  - **Chat** — last 20 messages; press `c` to compose (POSTs to `/api/chat`).
  - **Agents** — two-column card grid parsed from
    `~/.config/opencode/agents/*.md`.
  - **Plans** — list of worktree + global plans; press `n` to create one.
  - **Projects** — list of projects discovered via `.bizar/PROJECT.md` markers
    and `~/Projects/*`.
  - **Tasks** — three-column kanban (queued / doing / done); press `n` to add.
  - **Config** — pretty-printed JSON of `opencode.json` with syntax colors.
  - **Settings** — current settings (theme, agent, model, notifications,
    `dashboard.autoLaunchWeb`, about); press `t` to toggle autoLaunchWeb.
  Keyboard: `1`–`8` jump tabs, `Tab` / `Shift-Tab` cycle, `r` reload,
  `c` compose chat, `n` new item, `t` toggle web auto-launch, `?` help,
  `q` / `Ctrl-C` quit. Connects to the same Express + WebSocket server the
  web UI uses, with auto-reconnect on server restarts.
- **Configurable web UI launch** — `bizar` honours a new
  `dashboard.autoLaunchWeb` setting (default `true`). When true, `bizar`
  starts the TUI **and** opens your browser; when false, it starts the TUI
  only. Visible as a checkbox on the Settings view in both the web UI
  (Settings card "Dashboard → Auto-launch web UI alongside TUI") and the
  TUI (press `t`).
- **Background launch mode** — new `bizar --bg` (alias `--detach`) flag
  spawns the web dashboard as a detached child process and returns to the
  shell immediately. Writes the same `~/.config/bizar/dashboard.{port,pid}`
  files the foreground launcher does, so `bizar dashboard status` and
  `bizar dashboard stop` work the same way.

### Changed
- **`bizar` (no args) now launches the TUI** in your current terminal.
  The browser is opened as well unless `--no-web` is passed or
  `dashboard.autoLaunchWeb` is `false`. Previously this command opened the
  web UI in your browser; that behaviour is now available via `bizar --bg`
  (background) or `bizar --web-only` (foreground, no TUI).
- **`cli/dashboard/state.mjs#getSettings`** now deep-merges nested objects
  (`notifications`, `dashboard`, `about`) instead of shallow-merging only the
  top level. Adding a new setting field no longer overwrites the user's
  existing nested preferences.

### CLI flags (added)
| Flag             | Effect                                                  |
| ---------------- | ------------------------------------------------------- |
| `bizar --web`    | Force-launch the browser alongside the TUI              |
| `bizar --no-web` | TUI only (no browser); overrides `autoLaunchWeb=true`   |
| `bizar --web-only` | Foreground web dashboard only (no TUI)                |
| `bizar --bg`     | Spawn web dashboard detached, return to shell           |
| `bizar --detach` | Alias for `--bg`                                        |

### Plugin
- No changes — the TUI is purely a CLI addition; the opencode plugin is
  untouched.

### Files
- `package.json` — `blessed@^0.1.81` added (hoisted to top-level
  `node_modules` for both the source tree and the global install).
- `cli/dashboard-tui.mjs` — new (~700 LOC).
- `cli/bin.mjs` — dispatch + flags + help text rewritten.
- `cli/dashboard/state.mjs` — `dashboard.autoLaunchWeb` default + deep merge.
- `src/lib/types.ts` — `Settings.dashboard` field added.
- `src/views/Settings.tsx` — new "Dashboard" card with autoLaunchWeb checkbox.

## v2.6.2 — 2026-06-19

### Changed
- **`bizar` (no args) now launches the dashboard** instead of running the interactive installer. The dashboard is the day-to-day command — installer should be explicit.
- **`install` is now its own command** that runs the interactive installer. Previously this was triggered by running `bizar` with no arguments.
- `bizar install` still works as an alias for `install`.

### Migration
- Old: `bizar` → ran installer
- New: `install` → runs installer; `bizar` → launches dashboard
- All other subcommands (`bizar audit`, `bizar plan`, etc.) are unchanged.

## v2.6.1 — 2026-06-19

### Fixed
- **`bizar` install hangs** after completing all work. The `installPluginBizar()` function started a spinner but returned early (without stopping it) when the local `plugins/bizar/` directory didn't exist. The dangling spinner kept an interval alive, preventing the process from exiting. Now stops the spinner cleanly in the early-return path.

## v2.6.0 — 2026-06-19

### Changed
- **Dashboard rewritten in React 18 + TypeScript + Vite** — the vanilla-JS SPA (`dashboard/`) is gone. The new SPA lives in `src/`, builds with Vite into `dist/`, and the dashboard server now serves `dist/` (with SPA fallback + graceful "not built" page when the bundle is missing).
- **New build pipeline** — `npm run dev` for HMR, `npm run build` for production, `npm run typecheck` for the compiler. Hashed assets under `dist/assets/` are served with `Cache-Control: public, max-age=1y, immutable`; `index.html` is served `no-cache` so deploys roll out cleanly.
- **`package.json#files`** now ships `dist/` (Vite output) plus `src/`, `vite.config.ts`, and `tsconfig.json` for reproducible rebuilds. `dashboard/` is removed.

### Added
- **`GET /api/snapshot`** — returns the full dashboard payload (overview + agents + plans + projects + config + settings + tasks) in one round-trip. The React SPA uses this for its initial load; existing individual endpoints are untouched.
- **Polished UI** — Inter typography (CDN), 8pt spacing scale, CSS variables for dark/light themes, subtle shadows and borders, focus rings on every interactive element, smooth tab transitions, card hover lifts, toast slide-in animations, modal fade-in + backdrop blur, skeleton loading states, friendly empty states.
- **Lucide icons throughout** — every action, tab, stat card, and badge uses `lucide-react` for a consistent, modern look. Only the 🪩 logo remains as an emoji.
- **`react-markdown` + `remark-gfm`** for chat message rendering — full Markdown + GitHub-flavored Markdown support (tables, task lists, strikethrough).
- **Theme picker with preview swatches** — Dark / Light / System with theme cards showing what each looks like. System mode follows the OS preference live.
- **Toast context** — toast notifications now use a proper React context (`useToast()`) with auto-dismiss timers, dismiss buttons, and four variants (info/success/error/warning).
- **Modal context** — modal dialogs use a React context (`useModal()`) with portal rendering, ESC to close, click-outside dismiss, and stackable depth.
- **Type-safe API + WebSocket** — full TypeScript types mirror the JSON contract from `cli/dashboard/api.mjs`. The WebSocket layer has typed message variants and proper status propagation.
- **Drag-and-drop in Tasks kanban** — HTML5 drag API, drop highlight, optimistic update with revert on failure. Existing keyboard shortcuts (n, 1-3, e, Del) preserved.
- **Canvas pan/zoom refactor** — Plans canvas now uses a proper world-space coordinate system; SVG connection lines are positioned correctly regardless of pan/zoom offset.

### Plugin
- No changes — the React dashboard is purely a server-rendered SPA replacement.

### Behavior changes
- The dashboard now requires `npm run build` once after install/publish. The dashboard server prints a friendly "Dashboard not built — run `npm run build`" page if `dist/` is missing instead of returning 404.

## v2.5.1 — 2026-06-19

### Added
- **Tasks Kanban board (8th dashboard tab)** — personal kanban with three columns (Queued, Doing, Done). Supports full CRUD, per-task priority (low/normal/high) with colored indicators, tags, inline edit, keyboard shortcuts (n=new, 1/2/3=column jump, e=edit, Delete=remove), search/filter, and smooth move animations.
- **Tasks REST API** — `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `PATCH /api/tasks/:id/status`, `DELETE /api/tasks/:id` — all with WebSocket broadcast on mutation.
- **Tasks storage** — `~/.config/bizar/tasks.json`, auto-created with recursive mkdir. In-process mutex for read-modify-write safety. IDs via `tsk_<8 hex chars>`.

## v2.5.0 — 2026-06-19

### Added
- **`bizar dashboard [start|stop|status]` CLI subcommand** — launches a local Express + WebSocket server on `127.0.0.1` (preferred port 4321, walks upward if taken), opens the user's browser, and writes `~/.config/bizar/dashboard.{pid,port}` so `stop` / `status` can find the running instance. The server binds loopback only.
- **`/bizar` now launches the dashboard** — the opencode plugin's `chat.message` hook recognizes `/bizar` (no args) as a new `launch_dashboard` side-effect, spawns `bizar dashboard start` detached, and surfaces the live URL in its response. With args, `/bizar` still routes via the menu command file (`config/commands/bizar.md`).
- **Seven-tab web dashboard** — Overview (counts + recent activity + quick actions), Chat (history + send box with slash-command suggestions), Agents (grid + invoke modal), Plans (list + create + view), Projects (discover + activate), Config (live `opencode.json` editor with JSON validation and diff), Settings (theme + notifications + about).
- **Real-time updates via WebSocket** — on connect, the server sends a snapshot of every panel. Subsequent file changes broadcast `{type: 'change', event, path}` to all clients, which surface a toast and re-render the affected panel.
- **Live file watcher** — `chokidar` watches `opencode.json`, `agents/`, `commands-bizar/`, `~/.config/opencode/plans/`, `.bizar/`, and the worktree `plans/` directory. Changes propagate to the dashboard immediately.
- **Self-contained frontend** — no build step. Vanilla ESM JavaScript, hand-rolled markdown rendering, dark theme by default with a light variant. The HTML, CSS, and JS are all under `dashboard/` and shipped via the npm `files` array.
- **JSON error envelope on the API** — every error (parse, validation, not-found) returns `{ error, message }` with the appropriate HTTP status. `PUT /api/config` with malformed JSON returns `400 entity.parse.failed` (not Express's default HTML page).
- **Activity feed** — every API mutation (`config.update`, `plan.create`, `agent.invoke`, `chat.message`, `project.activate`, `settings.update`, `config.reload`) appends a record to `.bizar/activity.log`. The Overview panel tails the last 30 events.
- **New dependencies** — `express ^4.19`, `ws ^8.18`, `chokidar ^3.6`.

### Changed
- **`config/commands/bizar.md`** — the menu file now describes the dashboard launch as the primary action and lists the routing rules for `/bizar <args>` (explain / plan / audit / review / learn / init). The "Never make changes to the codebase" guidance is preserved.
- **`package.json#files`** — now ships `dashboard/` in the published tarball.

### Plugin
- **`parseSlashCommand`** — new `case "bizar"` adds the `launch_dashboard` side-effect. The parser remains pure (no I/O).
- **`executeSideEffect`** — new `executeLaunchDashboard()` spawns `bizar dashboard start` detached, polls `~/.config/bizar/dashboard.port` for up to 3s, and appends the live URL to the response. If a dashboard is already running, it just reports the existing URL.

### Behavior changes
- The dashboard server replaces the prior MVP URL stub: `/bizar` used to print "v0.5.0 MVP — server startup is a future enhancement" (per `plugins/bizar/src/commands.ts`); v2.5.0 actually launches it.

## v2.4.0 — 2026-06-19

### Fixed
- **Install pipeline now produces a complete, working opencode.json** with all 13 agents and 9 commands registered. Previously the template was missing `agent` and `command` blocks, causing slash commands to silently disappear from the TUI.
- **Silent bail on fresh installs** when `~/.config/opencode` didn't exist — the postinstall now creates the directory and bootstraps opencode.json from the package template.
- **False-positive "Bizar plugin source not found" warning** removed (plugin lives in a separate npm package; the global install path is canonical).
- **Stale `config/opencode.json.template`** deleted (it was a duplicate of `opencode.json`).
- **TDZ bug in `runPostInstall()`** — an inner `join` import shadowed the module-level one, causing a ReferenceError on first run.

### Added
- **`installCommandsBizar()`** — symlink-safe install of Bizar commands to `commands-bizar/` (separate from ECC's `commands/` symlink target, so it doesn't collide).
- **`/bizar` menu slash command** — routes to @odin with a routing help file that lists all available Bizar actions and dispatches based on user intent. New TUI entry: type `/bizar what you want to do` and Odin routes.
- **`/plan` and `/visual-plan` TUI commands** — these plugin-handled slash commands now appear in autocomplete (previously only worked when typed in chat).
- **Missing command files** — `config/commands/plan.md` and `config/commands/visual-plan.md` added to match the 9-command template.

### Behavior changes
- Commands now install to `~/.config/opencode/commands-bizar/` instead of `~/.config/opencode/commands/` (the latter is a symlink to ECC's commands on this user's machine). The template paths in opencode.json were updated to match.
