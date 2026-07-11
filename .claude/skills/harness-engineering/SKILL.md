---
name: harness-engineering
description: Use when designing or evaluating the environment around an AI coding agent — instructions, state, verification, scope, and lifecycle. Triggers on questions about agent harness design, session lifecycle, definition of done, scope discipline, state persistence, loop engineering, context engineering, or observability. Synthesizes the walkinglabs/awesome-harness-engineering canon with Bizar's Norse-pantheon architecture so every agent session starts from a strong baseline.
---

# Harness Engineering for Bizar agents

The model decides the code. The harness decides when, where, and how.
Without a harness, even Opus 4.5 spends $9 in 20 minutes and ships
something broken; with one it ships working code in 6 hours. Same model,
different environment.

References:
- walkinglabs/awesome-harness-engineering (curated canon)
- walkinglabs/learn-harness-engineering (13 lectures, 7 projects)
- Anthropic: "Effective harnesses for long-running agents"
- Anthropic: "Effective context engineering for AI agents"
- OpenAI: "Harness engineering: leveraging Codex in an agent-first world"

## Five subsystems of a harness

```
                THE HARNESS
                ============

   Instructions       State            Verification
   -----------       -----            ------------
   AGENTS.md         PROGRESS.md      make check
   CLAUDE.md         feature_list.json make test
   .claude/          .harness/traces/ make e2e
     agents/         DECISIONS.md     make clean-check
     skills/         init.sh output
     hooks/

   Scope              Session Lifecycle
   -----              ------------------
   WIP=1 rule         make session-start
   one feature        make session-end
   per session        init.sh (install + verify)
   explicit DoD       clean restart
```

Bizar ships all five. This skill is your reminder to use them.

## Session lifecycle (L06, L12)

Every agent session MUST follow this lifecycle:

1. **Read AGENTS.md** — your operating manual.
2. **Read CLAUDE.md** — Claude Code mirror of AGENTS.md (auto-loaded).
3. **Read .claude/agents/_shared/AGENT_BASELINE.md** — baseline behavior rules.
4. **Run `make session-start`** — record session ID.
5. **Read PROGRESS.md** — state from the last session.
6. **Read feature_list.json** — pick the next `not_started` feature.
7. **Work on ONE feature only** — WIP=1.
8. **Run verification:** `make check && make test && make e2e`.
9. **Update PROGRESS.md + feature_list.json** — record evidence.
10. **Score against `templates/evaluator-rubric.md`** — every dim B+.
11. **Run `make session-end`** — close the session.
12. **Commit only when safe to resume** (Hermod does this).

If you find yourself doing steps 7-9 on more than one feature, stop.

## Definitions of Done (L08, L09)

A feature is `passing` only when ALL THREE LAYERS verify:

- **L1 typecheck:** `make check` exits 0.
- **L2 unit tests:** `make test` passes for the touched module.
- **L3 E2E:** `make e2e` exercises real plugin load + tools.

Do NOT proceed to L(n+1) if L(n) fails. Confidence ≠ correctness.

## Scope discipline (L07)

- WIP=1. Only one feature `active` in `feature_list.json`.
- No silent scope creep. If a fix requires touching unrelated code,
  STOP and report — do not improvise.
- No half-finishing three things. No rewriting the feature list to
  hide unfinished work.

## State persistence (L05)

- Progress belongs in PROGRESS.md + feature_list.json + git log.
- The repo is the single source of truth. If the agent can't see it,
  it doesn't exist.
- Handoff note: every session must leave a clean restart path.

## Loop engineering (L13)

When you find yourself repeating the same manual orchestration, build a
loop. Three primitives:

1. **Goal loop** — `while !done; run-one-step; done`
2. **Timer loop** — `every N minutes: run-the-job`
3. **Maker-checker loop** — `make.sh` produces, `check.sh` rejects

Bizar ships three:
- `scripts/run-loop.sh` — generic loop driver (see below)
- `make test` — verification (checker)
- `scripts/clean-state-check.sh` — final pass/fail gate

## Context engineering (Anthropic)

Treat the context window as a working memory budget, not a dump site:

- Progressive disclosure: load skills on demand, not all at once.
- KV-cache locality: keep system prompts stable; append, don't rewrite.
- Drop noisy tool output before passing to the next model call.

## Observability (L11, OTel)

If you can't see what the agent did, you can't fix what it broke. Bizar
records every session to `.harness/traces/sessions.jsonl` (gitignored)
and via the SessionEnd hook to `~/.bizar_home/memory/projects/<name>/sessions/`.
For OpenTelemetry-compatible exporters, see `packages/sdk/src/observability.ts`.

## Sandbox (CubeSandbox — v6.3.0)

For dangerous-pattern decisions and risky operations, Bizar routes the
execution through `bizar_sandbox_run` (CubeSandbox) instead of running
directly in the host shell. See the `cubesandbox` skill.

## Quick checklist before each commit

- [ ] feature_list.json updated (state machine moved)
- [ ] PROGRESS.md updated (current state, in progress, next steps)
- [ ] `make check` exits 0
- [ ] `make test` exits 0
- [ ] `make e2e` exits 0
- [ ] `make clean-check` 5/5 dimensions pass
- [ ] Every dim of `templates/evaluator-rubric.md` is B+
- [ ] Commit message is WHY-focused, not WHAT-focused

## Further reading

The skill `find-skills` can install the full walkinglabs course. The
local copy lives at `bizar-learn-harness` (auto-bundled by
`scripts/install-learn-course.sh`). To rebuild locally:

```bash
git clone https://github.com/walkinglabs/learn-harness-engineering /tmp/lhe
```
