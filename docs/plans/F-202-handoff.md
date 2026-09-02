# F-202 — OpenAI Codex CLI Support: Handoff

> Status: **in progress, paused by user request**.
> Branch: `feat/codex-cli-support` (pushed to `origin/feat/codex-cli-support`).
> Feature: `F-202` in `feature_list.json` (`wip: 1`, `wip_holder: @mike`).
> Last commit on branch before pause: `e5f3631` (plumb --tools/--all-tools).
> Paused by user request mid-implementation; resume by checking out the branch and reading this file top-to-bottom.

---

## 1. What was asked

> "check this project. create a new branch. i want to expand support for bizarharness to include openai codex cli aswell. add support for it and update the installer to ask when coding tools to install to."

Design decisions confirmed via AskUserQuestion:

| Decision | Choice |
|---|---|
| Scope | Multi-select install + mirror Bizar assets into Codex-compatible locations |
| Defaults | Keep Claude as default; add new flags `--tools=claude,codex`, `--all-tools`, `make setup CODEX=1`. Backward compat: `make setup` and `install.sh --yes` continue installing Claude Code only. |
| Auth | No `OPENAI_API_KEY` prompt from installer; on completion print `codex login` instructions so the operator authenticates with ChatGPT subscription or fresh API key. |

---

## 2. What is already done (committed)

### Commit 1 — `d81c497` — `feat(installer): multi-select coding-tools prompt`

File: `cli/install/interactive-setup.mjs` (+184 lines)

Adds:

```js
export const CODING_TOOLS = Object.freeze([
  { id: 'claude', label: 'Claude Code',       description: 'Anthropic — Claude Code CLI + bundled Bizar agents/skills/hooks' },
  { id: 'codex',  label: 'OpenAI Codex CLI',  description: 'OpenAI — Codex CLI + Bizar assets mirrored into ~/.codex/ and ~/.agents/skills/' },
]);

export function parseToolSelectionKey(key) {
  // \r/\n → confirm, space → toggle, j/k/[A/[B → move, else null
}

export async function runToolSelection({
  enabled = true, input = process.stdin, output = process.stdout,
  orderedTools = CODING_TOOLS, isTTY = …
} = {}) { /* raw-mode multi-select with ANSI arrow buffering */ }
```

Behavior:
- Non-TTY / `enabled=false` → returns `{ ok: true, tools: ['claude'], interactive: false }`. CI / pipes never hang.
- TTY → raw-mode checkbox list, space toggles, j/k or arrow keys move, enter confirms, EOF accepts the documented default.
- `pending` state machine buffers ANSI 3-char sequences (`ESC [ A/B/C/D`) into single logical keys.
- All three helpers exported so tests can drive without a TTY.

File: `cli/install/interactive-setup.test.mjs` (+136 lines, 22 tests)

### Commit 2 — `911fdcc` — `docs(progress): add F-202 Codex CLI support in_progress`

Updates:
- `PROGRESS.md`: new "In Progress — F-202" section before "F-201".
- `feature_list.json`: added F-202 entry (`wip: 1`, `state: in_progress`), demoted F-201 to `wip: 0` (state stays `in_progress` waiting on aggregate test-runner blocker).

### Commit 3 — `e5f3631` — `feat(installer): plumb --tools/--all-tools through install pipeline (F-202)`

Files (5 changed, +373 / −14):

- `cli/provision.mjs`: new `parseToolFlags(argv)` + `resolveEffectiveTools(tools)` + `formatToolsLabel(tools)` + helpers `dedupeTools` + `humanizeToolId`. `parseFlags` accepts `--tools=claude,codex`, `--tools <list>`, and `--all-tools`. Sets `process.env.BIZAR_INSTALL_TOOLS` when tools resolved. `runProvision(opts)` now takes `opts.tools`, renders the tool label in the banner.
- `cli/install/index.mjs`: `runInstaller(opts)` accepts `opts.tools`. Pre-selected wins; otherwise calls `runToolSelection` (only in TTY and not in update mode). Echoes resolved selection in the return shape.
- `cli/commands/install.mjs`: `install()` and `runUpdateWithFlags()` forward `tools` from `parseFlags`. Help text documents `--tools=` and `--all-tools`.
- `cli/install/index.test.mjs`: 3 new F-202 regressions.
- `cli/__tests__/parse-tool-flags.test.mjs`: **new file**, 20 tests covering `parseToolFlags`, `parseFlags` env propagation, `resolveEffectiveTools` precedence, `formatToolsLabel` output.

Test totals after this commit:
- `cli/__tests__/parse-tool-flags.test.mjs` — 20/20 passing.
- `cli/install/interactive-setup.test.mjs` — 22/22 passing (still green).
- `cli/install/index.test.mjs` — 3 new F-202 tests pass individually; full suite still hits the documented F-201 Node-24 test-process isolation issue (not a regression — same blocker as F-201).

`make check` (TypeScript gate) — green.

---

## 3. What is NOT yet done (the actual Codex work)

This is what remains to land F-202. Each numbered item maps to a future atomic commit.

### 3.1 Create `cli/provision-codex.mjs` (NEW FILE)

The Codex mirrorer. Mirrors what `cli/provision.mjs` already does for Claude, but into Codex-compatible locations. Should export:

```js
export async function mirrorCodexAssets({
  dryRun = false,
  force = false,
  codexHome = path.join(os.homedir(), '.codex'),
  agentsHome = path.join(os.homedir(), '.agents'),
} = {}): Promise<{ ok: boolean, message: string, mirrored: string[] }>
```

Responsibilities (researched against current Codex CLI docs, see §6 below):

1. **`~/.codex/config.toml`** — emit TOML with:
   ```toml
   [features]
   hooks = true
   # codex_hooks = true   # legacy alias for older Codex versions
   ```
   Only emit `codex_hooks = true` when the operator explicitly opts in (TODO: read Codex version). Default to the modern `[features].hooks = true` only.

2. **`~/.codex/hooks.json`** — single JSON file (Codex supports only this layout, not per-event files like Claude):
   ```json
   {
     "hooks": {
       "PreToolUse":  [{ "command": "node <bizarHome>/hooks/bizar-codex-pre.mjs" }],
       "PostToolUse": [{ "command": "node <bizarHome>/hooks/bizar-codex-post.mjs" }]
     }
   }
   ```
   Reuse the existing `cli/provision.mjs` hook chain. Map Claude event names → Codex event names:
   - `PreToolUse` → `PreToolUse`
   - `PostToolUse` → `PostToolUse`
   - `UserPromptSubmit` → (Codex has no equivalent — drop silently with a comment in `mirrored`)
   - `SessionStart` → (Codex has no equivalent — drop silently)
   - `SessionEnd` → `SessionEnd`
   - `PermissionRequest` → `PermissionRequest`

3. **`~/.agents/skills/<name>/SKILL.md`** — mirror Bizar skills (under `config/skills/`) here. Codex reads this directory for cross-tool skill discovery. Same file content as Claude skills; Codex skill frontmatter is similar (`name` + `description`).

4. **`~/.codex/prompts/<name>.md`** — translate Bizar slash commands (under `config/claude/commands/`) into Codex prompt format. Codex invokes them as `/prompts:<name>`. Each prompt file should:
   - Strip Claude-only frontmatter (`allowed-tools`, `argument-hint`, `model`) and keep only the body.
   - Wrap the body in a Codex-compatible format (TBD — check Codex prompt format spec).
   - Use the command's `description` as the Codex prompt's first-line summary.

5. **`~/.codex/AGENTS.md`** — append Bizar's agent roster summary so Codex can see which agents are available. Generated, not copied verbatim.

6. **`~/.codex/.bizar-installed.json`** — install manifest with version + hash so `bizar update` can short-circuit on no-op, same pattern Claude uses.

7. **Agent files** — Codex does NOT have its own agent directory (unlike `~/.claude/agents/`). Agents live in Claude; Codex sees them through `AGENTS.md`. Document this in `config/codex/README.md`.

The mirrorer must be idempotent (re-running is safe, same hash → no-op), respect `dryRun`, respect `force` (re-mirror even when hash matches).

### 3.2 Add `installCodexCli()` to `cli/provision.mjs`

Near the existing `installClaudeCli({ force, dryRun })` call at line ~1160, gate on `effectiveTools.includes('codex')`:

```js
if (effectiveTools.includes('codex')) {
  installCodexCli({ force, dryRun });
}
```

`installCodexCli` shells out:
```sh
npm install -g @openai/codex
```

with the same error-surfacing and dry-run semantics as `installClaudeCli`. On success, emit:
```
✓ codex <version> (OpenAI Codex CLI)
```

After install, append a `codex login` hint section (per the user's no-key decision):
```
  Authenticate Codex:
    $ codex login           # signs in with ChatGPT subscription
    $ export OPENAI_API_KEY=… && codex login --api-key   # or fresh key
```

This hint goes in `runInstaller`'s post-install summary, not inside `runProvision` (which must stay headless / scriptable).

### 3.3 Update `cli/install/paths.mjs`

Add Codex paths to the `PATHS` object and update `printInstallLocations()` to render both tool locations when Codex is selected:

```js
const PATHS = {
  // … existing Claude paths …
  codexDir:       join(homedir(), '.codex'),
  codexPrompts:   join(homedir(), '.codex', 'prompts'),
  codexHooks:     join(homedir(), '.codex', 'hooks.json'),
  agentsSkills:   join(homedir(), '.agents', 'skills'),
};
```

The `printInstallLocations` card should be tool-aware: if Codex is selected, render an extra `Codex CLI config` block.

### 3.4 Update `scripts/check-deps.mjs`

Add per-platform `codex` install commands. Existing pattern at lines 176, 192, 236 (Windows / macOS / Linux):

- `windowsInstallCmd`: `npm install -g @openai/codex`
- `macInstallCmd`: `npm install -g @openai/codex` (works under Homebrew Node too)
- `linuxInstallCmd`: `npm install -g @openai/codex`
- `nixosInstallCmd`: `npm install -g @openai/codex` (or wrap in `nix-shell -p nodejs` if no system npm)

These should be guarded behind the same `dryRun` / `enabled` plumbing as Claude today.

### 3.5 Update `Makefile`

Extend `setup:` target to honor `CODEX=1`:

```makefile
setup:                          ## install everything (Claude Code only by default)
	npm install -g @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code
	node scripts/check-deps.mjs claude
	@if [ "$(CODEX)" = "1" ]; then \
		echo "  installing Codex CLI …"; \
		npm install -g @openai/codex; \
		node scripts/check-deps.mjs codex; \
	fi

setup-codex:                    ## install only Codex CLI
	npm install -g @openai/codex
	node scripts/check-deps.mjs codex

setup-all: setup setup-codex    ## install every supported coding tool
```

Keep `setup:` Claude-only by default to preserve the documented contract.

### 3.6 Update `install.sh`

Parse `--tools=claude,codex` and `--all-tools`, export `BIZAR_INSTALL_TOOLS`, and pass it to `node cli/provision.mjs`. Existing call is at the bottom:

```sh
node cli/provision.mjs --mode=install $FORCE_FLAG $DRY_FLAG $YES_FLAG
```

becomes:

```sh
TOOLS_ARGS=""
if [ -n "$BIZAR_INSTALL_TOOLS" ]; then TOOLS_ARGS="--tools=$BIZAR_INSTALL_TOOLS"; fi
node cli/provision.mjs --mode=install $FORCE_FLAG $DRY_FLAG $YES_FLAG $TOOLS_ARGS
```

And add new flag parsing near the existing `case` blocks.

### 3.7 Update `cli/bin.mjs`

Lines 149-150 currently print hard-coded `npm install -g @anthropic-ai/claude-code` post-install hints. Make them tool-aware:

```js
if (selectedTools.includes('codex')) {
  console.log(chalk.dim(`  ${codexHint}`));
}
if (selectedTools.includes('claude')) {
  console.log(chalk.dim(`  ${claudeHint}`));
}
```

The `claudeHint` text must remain identical to today's output for `claude`-only installs (backward compat for runbooks).

### 3.8 Update `init.sh`

Add `--check-codex` flag, non-blocking Codex detection after the existing Claude check (~line 198). Don't fail the script if Codex isn't installed — just print the install hint.

### 3.9 Create `config/codex/README.md`

Documentation for operators:

- Translation table: which Bizar surface lives where under Codex.
- `CODEX_HOME` override documentation.
- Hook event mapping (Claude → Codex).
- How to extend with custom Codex-only prompts.
- Why skills live under `~/.agents/skills/` (cross-tool convention) and not `~/.codex/skills/`.
- The `[features].hooks = true` requirement and the legacy `codex_hooks` alias.

### 3.10 Tests for new surfaces

- `cli/provision-codex.test.mjs` — new file. Tests for `mirrorCodexAssets` idempotency, dry-run, force, hooks.json emission, config.toml emission, prompts translation, skills mirroring, manifest hash.
- `scripts/check-deps.test.mjs` — extend with `codex` per-platform tests.
- `cli/install/paths.test.mjs` — extend with `codexDir` / `agentsSkills` assertions.

### 3.11 Final commit sequence

1. `feat(installer): provision Codex CLI + mirror Bizar assets (F-202)`
   - `cli/provision-codex.mjs` (new)
   - `cli/provision-codex.test.mjs` (new)
   - `cli/provision.mjs` (call `installCodexCli` + `mirrorCodexAssets` when `effectiveTools` includes `codex`)
2. `feat(installer): tool-aware install paths and post-install hints (F-202)`
   - `cli/install/paths.mjs` (+ test)
   - `cli/bin.mjs`
3. `feat(platform): Codex CLI install commands for win/mac/linux (F-202)`
   - `scripts/check-deps.mjs` (+ test)
   - `Makefile`
   - `install.sh`
   - `init.sh`
4. `docs(codex): translation table + CODEX_HOME override (F-202)`
   - `config/codex/README.md`
5. `docs(progress): record F-202 completion + bump version (10.23.10)`
   - `PROGRESS.md`
   - `feature_list.json` (F-202 → `passing`)
   - `CHANGELOG.md`
   - `package.json` (version bump)
6. Final `make check && make test` — verify green.

---

## 4. The WIP stash (handle carefully on resume)

```
stash@{0}: On feat/codex-cli-support: F-201 follow-ups (stashed to isolate F-202)
```

This contains the F-201 follow-up files that I stashed at session start so the F-202 diff would stay clean. **Do NOT `git stash pop` it onto `feat/codex-cli-support`** unless you intend to mix F-201 work with F-202 work in the same commits. The right move on resume is one of:

- Land F-202 first, then `git checkout master && git stash pop` to land F-201 follow-ups on `master`, **or**
- Open a second worktree for F-201 follow-ups and pop there.

The stash contents (paths):

```
CHANGELOG.md
PROGRESS.md
cli/__tests__/models-disabled-providers.test.mjs
cli/__tests__/models-mirror-shipped.test.mjs
cli/__tests__/models-persists-under-bizar-home.test.mjs
cli/commands/models.mjs
cli/commands/tier.mjs
cli/commands/upgrade-defaults.mjs
config/agents/model-assignment.mjs
config/claude/agents/planner.md
config/claude/hooks/__tests__/agent-model-guard.test.mjs
config/claude/hooks/agent-model-guard.mjs
config/claude/hooks/sessionstart-model-sync.mjs
config/claude/model-router.json   (deleted)
config/workflows/__tests__/dispatch.test.mjs
config/workflows/lib/dispatch.js
docs/architecture.md
feature_list.json
package.json
packages/sdk/src/mcp/server.ts
scripts/agent-model-registry.test.mjs
scripts/verify-no-9router.mjs
cli/provision.mjs
cli/provision.test.mjs
```

If `git stash pop` reports conflicts, the most likely cause is `PROGRESS.md` and `feature_list.json` (F-202 already added new entries to both). Resolve by keeping the F-202 changes and re-applying the F-201 follow-ups manually if needed.

---

## 5. Known issues / risks on resume

1. **F-201 aggregate test-runner blocker (unrelated, pre-existing)** — `make test` and `make e2e` produce false `ERR_MODULE_NOT_FOUND` errors when run concurrently because both rebuild `packages/sdk/dist` while `make clean-check` deletes it. Documented in `PROGRESS.md`. **Run build-owning targets serially.** Read-only gates (`make check`, `make check-arch`, etc.) can still run in parallel.

2. **Agent dispatch impedance** — `Agent` tool with a configured Bizar model is rejected because Claude Code's Agent schema only accepts `sonnet/opus/haiku/fable`. Workaround: do scoped implementation in the primary session (`@mike`) instead of dispatching. Only use `Agent` for read-only research (`Explore`, `greg`, `susan`).

3. **Shipped router empty tiers (F-201 follow-up)** — `config/claude/model-router.json` was deleted; the global `$BIZAR_HOME/config/claude/model-router.json` is what the hook reads. Operators must run `bizar models --set=<id>` after install. **Hook still rejects unconfigured IDs** until the operator populates the global router. Out of scope for F-202.

4. **Codex version detection** — the `[features].hooks = true` vs `codex_hooks = true` decision depends on Codex version. Research current Codex version before deciding (research already done; see §6).

5. **Codex prompt format** — `/prompts:<name>` invocation syntax confirmed, but the file-format (frontmatter, body) needs verification on resume. The hook system research shows Codex prompt files use a slightly different schema than Claude slash commands.

---

## 6. Research already done (so resume doesn't repeat it)

### Codex CLI hooks (verified 2026-09-02)

- **Config file**: `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`). TOML, not JSON.
- **Hooks file**: `~/.codex/hooks.json` — single JSON file, NOT per-event files.
- **Hook events supported**: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SessionEnd`. Claude's `UserPromptSubmit` and `SessionStart` have no direct Codex equivalent — drop silently.
- **Feature gate**: `[features].hooks = true` (modern) or legacy `[features].codex_hooks = true` (older versions). Hooks are silently ignored without the flag.
- **Hook entry schema**: `{ command: string, async?: boolean, statusMessage?: string }`. Multiple entries per event allowed.
- **Hook decisions**: `permissionDecision: "allow" | "deny"`, `permissionDecisionReason`, exit code 2 with stderr, legacy `{"decision": "block"}`.

Source: <https://agenticcontrolplane.com/blog/codex-cli-hooks-reference>
Source: <https://github.com/openai/codex/issues/27133> (project-level `.codex/hooks.json` silently ignored under some conditions)

### Codex CLI skills & prompts (verified 2026-09-02)

- **Skills**: live under `~/.agents/skills/<name>/SKILL.md` (cross-tool convention), NOT `~/.codex/skills/`. Same frontmatter shape as Claude skills.
- **Slash-command-style prompts**: `~/.codex/prompts/<name>.md`, invoked as `/prompts:<name>`. Body format needs verification on resume.
- **AGENTS.md**: `~/.codex/AGENTS.md` for cross-tool agent roster discovery.

Sources still to fetch on resume (not done in this session):

- <https://learn.chatgpt.com/docs/config-file/config-reference> — prompt format, AGENTS.md conventions.
- <https://ofox.ai/blog/codex-cli-config-toml-deep-dive/> — full TOML schema.
- Official OpenAI Codex docs at <https://github.com/openai/codex> — version-gated feature flags.

### Bizar-side files to read on resume

- `cli/provision.mjs` (especially `installClaudeCli`, `syncSkillFiles`, `syncCommandFiles`, `syncHookFiles`, `writeClaudeSettings`) — patterns to mirror for Codex.
- `cli/install/paths.mjs` — PATHS object + `printInstallLocations` shape.
- `config/claude/hooks/` — full hook list to map onto Codex event names.
- `config/skills/` — skill source to mirror into `~/.agents/skills/`.
- `config/claude/commands/` — slash command source to translate into Codex prompts.

---

## 7. How to resume (TL;DR)

```sh
cd /home/drb0rk/projects/BizarHarness
git checkout feat/codex-cli-support          # if not already there
git pull --ff-only                           # in case the branch advanced remotely
node --test cli/__tests__/parse-tool-flags.test.mjs   # confirm baseline green
node --test cli/install/interactive-setup.test.mjs    # confirm baseline green
make check                                   # confirm TypeScript green
cat docs/plans/F-202-handoff.md              # re-read this file
# Then start at §3.1: create cli/provision-codex.mjs
```

**Do not** run `make test` or `make e2e` concurrently with `make clean-check` (see §5.1).

**Do not** `git stash pop` onto this branch without resolving the F-202 conflict in `PROGRESS.md` and `feature_list.json` (see §4).

When F-202 is complete and all commits land:

```sh
git push origin feat/codex-cli-support
gh pr create --base master --head feat/codex-cli-support --title "F-202: OpenAI Codex CLI support" --body "..."
```

---

## 8. Open questions for the user (when they resume)

These came up but were not blocking enough to interrupt; capture them so the next session can decide.

1. **`codex login` prompt** — should the installer print the hint always, or only when Codex is selected and the operator didn't pass `--yes`? (My plan: always print when Codex is selected, so non-interactive logs document the next step.)
2. **Codex prompt file format** — Codex may or may not need a YAML frontmatter; should we mirror Claude's `description` + `argument-hint` fields verbatim or strip them? (My plan: strip `argument-hint` and `allowed-tools`, keep `description` as the first-line summary, drop `model` since Codex has its own model picker.)
3. **`~/.agents/skills/` collision** — Codex reads `~/.agents/skills/`; Claude may also read it as a cross-tool skill registry. Should we mirror once and let both tools share, or maintain two parallel trees? (My plan: mirror once into `~/.agents/skills/`; document the shared nature.)
4. **`AGENTS.md` content** — what should the generated Codex `AGENTS.md` contain? Agent roster summary, key Bizar concepts, or a pointer to the Claude docs? (My plan: agent roster + one-line description each, sorted by tier.)

Decisions on these can be made on resume without re-asking the user if any of the defaults above feel right.
