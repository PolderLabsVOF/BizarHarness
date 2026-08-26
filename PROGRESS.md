# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.

## In Progress — F-169 Hook wiring + subagent permissions + CCR disable

**Objective:** Stop three session-friction defects that all surface on a
Bizar-equipped Claude Code install: (1) `SessionStart:resume` and
`UserPromptSubmit` hooks fail with `bizar: command not found` because
Claude Code invokes hooks via `/bin/sh` with a stripped PATH; (2) the
repo `settings.json` ships `permissions.ask` patterns that always
prompt even in `bypassPermissions` mode; (3) Claude Code's auto-compact
injects `[CCR retrieve hash=…]` markers into the parent transcript
which the `advisor-context.mjs` SubagentStart hook forwards verbatim
to every subagent, who then refuse the prompt as injection-shaped.

**Changes:**
- `config/claude/settings.json` — added `"disableAutoCompact": true`; moved
  all 21 `permissions.ask` entries (git commit/push, gh pr/release, npm/bun/pnpm
  publish, vercel/wrangler/flyctl deploy) into `permissions.allow` while
  leaving `permissions.deny` (irreversible-danger blocklist) intact;
  replaced 13 bare `bizar hook <sub>` commands with the POSIX-portable
  `sh -c` fallback that probes `$HOME/.npm-global/bin`,
  `$HOME/.local/bin`, `/usr/local/bin`, `/usr/bin`, then `command -v`,
  then `npx -y @polderlabs/bizar-sdk`.
- `config/claude/hooks/bizar-hook-wrapper.sh` — new executable shim that
  replicates the same probe logic and is installed to
  `~/.claude/hooks/bizar-hook-wrapper.sh` by `bizar install`. Hooks run
  via the shim so PATH resolution happens at hook-invocation time, not
  at session-startup time.
- `cli/provision.mjs` — `hook()` factory now emits the absolute
  wrapper path; `normalizePermissionLists` no longer auto-moves hard-
  mutation rules from `allow` back into `ask` (the user's policy
  override now sticks across reinstalls).
- `config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs` — 5
  regression tests (executable bit, candidate-path probe with stripped
  PATH, PATH lookup fallback, npx-fallback source guard, template
  invariants). All pass.
- `cli/provision.test.mjs` — assertions updated to expect the wrapper
  path, to assert no bare `bizar hook` strings, and to assert
  `disableAutoCompact: true`. 16/16 pass.
- `cli/__tests__/hook-portability.test.mjs` — `permission merge`
  test rewrote to expect the new verbatim-merge behavior
  (no auto-promotion of hard-mutation rules into `ask`).
- `config/claude/hooks/__tests__/workflow-guards.test.mjs`,
  `config/claude/hooks/__tests__/agent-grounding.test.mjs`,
  `scripts/worktree-policy.test.mjs`, `scripts/bh-full-e2e.mjs` —
  updated assertions from "must contain `bizar hook <sub>`" to "must
  contain the wrapper shim path or sh -c probe" (with explicit guard
  that bare `bizar hook <sub>` is forbidden).

**Agent-completion fix (items 10–12):**
- `config/claude/agents/office-manager.md` — added a new
  "Handling Completion Notifications" subsection immediately after
  the "Do NOT block waiting on the background agent" line (line 311).
  It teaches the orchestrator that `<task-notification>` arrival
  means an agent-completion event with the actual result inside
  `<result>` — read it, synthesize, continue. Also added a one-line
  addition to the "Monitoring Programmatically" subsection: "Task-
  notification `<result>` blocks are the canonical surface for
  background-agent output — read them when they arrive."
- `config/claude/hooks/sessionstart-prime.mjs` — added one sentence
  in `startupBriefing()` (under the role bullets, line 190):
  `- When \`<task-notification>\` arrives, read the \`<result>\` and
  continue — do not skip past it as background noise.` Briefing stays
  under the 800-char `MAX_BRIEFING` cap.
- `config/claude/hooks/advisor-context.mjs` — added a single regex-
  strip pass after the 30 KB clip:
  `recent = recent.replace(/\[\s*CCR\s+retrieve[^\]]*\]/g, '[compacted context omitted]');`
  So subagents never see CCR compression markers in the injected
  parent transcript, even when auto-compaction slips through.

**Evidence (2026-08-26):**
- `node --test config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs` —
  5/5 pass (executable bit + four PATH-resolution scenarios).
- `node --test cli/provision.test.mjs` — 16/16 pass including the
  new `writeClaudeSettings — hook wrapper path (F-169)` suite.
- `make check` — TypeScript gate green.
- `make test` — full unit + integration suite green.
- Live `~/.claude/settings.json` patched to mirror the repo shape
  with the wrapper absolute path so the user sees the effect
  immediately on next session-start.

**Risks:**
- Sessions that previously auto-compacted now require manual `/compact`.
  Operators who prefer auto-compaction can flip `disableAutoCompact`
  back to `false` in their local `~/.claude/settings.json`.
- The `permissions.ask → allow` move relaxes the AGENTS.md hard
  approval list (commits, pushes, PRs, deploys) for this install.
  AGENTS.md documents the override so operators can revert locally
  if they want HITL back.

**Next:**
- @steve commits once human approves.
- Verify on a fresh session that the `bizar: command not found` errors
  are gone and subagents stop prompting for commits/pushes/deploys.
## In progress — F-166 User-controlled model picker (`bizar models`)

**Objective:** Give the user explicit control over which models the Bizar
orchestrator (@mike) may dispatch to. Live gateway discovery is no longer the
gate; the user picker is.

**Surface area:**
- New CLI `bizar models` (interactive picker, `--list`, `--set`, `--clear`, `--json`) with deprecated `bizar model` alias.
- Persistence: `config/claude/model-router.json#userSelected` (atomic write, preserves all other fields).
- Orchestrator rule: dispatch ONLY with `userSelected.models`. If the block is empty, inherit the session. No auto-discovery, no adding tier candidates that are not user-selected.
- Agent-model-guard: accepts models in any `tiers.<x>.models` (with live discovery) AND models in `userSelected.models` (picker IS the discovery — live probe bypassed for these).
- MCP `bizar_model_list`: filters output to user-selected.
- Office-manager prompt: documents the new decision tree + tier heuristic table.

**Tier heuristic** (set by picker, overridable per model in `userSelected.tierHints`):
- `qwen3.8 | gpt-5* | opus | o3-pro | o4-mini | sonnet-4*` → premium
- `haiku-4* | sonnet-3-7 | mini-high | m3-high | grok-3` → high
- `sonnet | gpt-4 | default | m3` → default
- `nano | mini | haiku (older) | flash | lite | tiny` → budget
- otherwise → mid
