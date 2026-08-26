# POLICY: Full permissions + advisory hooks + always-fetch-docs

**Status:** Accepted
**Date:** 2026-08-26
**Author:** @mike (orchestrator) on user request
**Implements:** F-176
**Superseded by:** F-180

## Context

Prior to this policy shift, Bizar Harness used a permission-gating model:

- `permissions.deny`: 13 entries blocking `rm -rf /`, `sudo`, `git push --force`,
  `git rebase`, `node_modules` writes, `.env` reads, `secrets/**`, etc.
- `permissions.ask`: 18 entries prompting on `git push`, `gh pr create`,
  `npm publish`, `vercel deploy`, etc.
- Hooks: pre-tool-use hooks that returned `permissionDecision: "deny"` for
  dangerous commands, with no contextual guidance on how to perform the task
  correctly.

This created three friction points that grew sharper as agents did more work
in parallel:

1. **Agent prompts.** Subagents repeatedly asked the user for permission,
   slowing routine local work that the user had already authorized in
   principle.
2. **Hook blindness.** When a hook returned `"deny"`, the agent received a
   bare block with no context for why the action was risky and no guidance
   on the safer alternative. The hook taught nothing.
3. **Doc-guessing.** Agents guessed at API names, command syntax, and
   configuration shapes for external systems instead of fetching current
   official documentation. The grounding contract existed (DEC-014) but was
   not consistently re-primed at every agent's task start.

The user requested a policy shift: trust agents with full permissions by
default, convert hooks into guidance channels, and require always-fetch-docs
priming so external integration work is grounded before any guess-and-try
attempt.

## Decision

Replace the permission-gating model with a guidance-injection model.

1. **`permissions.deny` → `[]`** and **`permissions.ask` → `[]`**. Agents
   have full permissions by default. The sandbox boundaries are the shell
   and the filesystem, not Bizar's hook layer.
2. **`permissions.allow`** retains explicit `Bash(git commit *)` family and
   other common patterns. Their purpose is documentation of expected usage
   rather than pre-clearance of every call.
3. **`defaultMode`** stays at `"bypassPermissions"`.
4. **Hooks become advisory.** Every `PreToolUse` hook returns
   `permissionDecision: "allow"` and injects safety guidance via
   `hookSpecificOutput.additionalContext`. The agent sees the guidance and
   decides. There is no machine-level block at the hook layer.
5. **Always-fetch-docs priming.** Every agent's startup briefing includes:
   "Before starting any non-trivial task or whenever uncertain during work,
   `WebFetch` / `WebSearch` for current official documentation." The same
   bullet appears in `config/claude/agents/office-manager.md`, `AGENTS.md`,
   and `config/claude/CLAUDE.md`.

## Rationale

- **Trust agents with guidance, not walls.** A blocked command teaches
  nothing. An advisory context that explains the risk and the safer
  alternative teaches the right thing.
- **Capability awareness.** The hook context shows the agent what it CAN do
  and what is risky, so it makes informed choices instead of stumbling into
  silent blocks.
- **Code-quality focus.** Hooks' job is now to teach proper technique
  (secret-push prevention, fetch-first, path ownership) rather than to
  enforce policy at the syscall layer. The hard approval list — commits,
  pushes, releases, publication, production writes, credential changes,
  irreversible destruction — remains a human-only gate.
- **Documentation as code.** Agents always know to fetch current docs at
  task start and when uncertain. Guess-and-try integration work is
  prohibited by policy, not by an after-the-fact review.

## Consequences

### Positive

- Subagents never ask the user for permission on routine work; the local
  loop proceeds without interruption.
- Hook output becomes a teaching channel, not a wall. Agents learn the
  capability surface instead of guessing at it.
- Always-fetch-docs removes the largest source of stale-API errors and
  trial-and-error loops in cross-component work.
- The `bizar` user experience matches the user's stated trust model: "I
  authorized the agent; let it work."

### Negative / risks

- **`rm -rf /` and similar catastrophes** are now runnable by an agent.
  Mitigation: the hook advisory context explicitly tells the agent to
  confirm with the user before running destructive patterns. The agent is
  responsible for following the advice. A misbehaving agent can still
  cause damage.
- **Secret-push.** `git-workflow-guard` no longer blocks. Mitigation: the
  advisory context says "Confirm with the user; rotate the secret if
  already pushed." Agents with adequate tooling will follow; agents
  without it may not.
- **Pre-existing CI/test breakage.** Scripts that reference
  `.claude-plugin/plugin.json` (deleted in `cf09bf6`) fail independently
  of this policy. Out of scope; tracked in F-170 (commit 4888ac7).

## Implementation surface

| Layer | File | Change |
| --- | --- | --- |
| Permissions | `config/claude/settings.json` | `deny: []`, `ask: []` |
| Hooks | `config/claude/hooks/pretooluse-bash.mjs` | advisory + injection |
| Hooks | `config/claude/hooks/pretooluse-editwrite.mjs` | advisory + injection |
| Hooks | `config/claude/hooks/path-ownership-guard.mjs` | advisory + injection |
| Hooks | `config/claude/hooks/git-workflow-guard.mjs` | advisory + injection |
| Priming | `config/claude/hooks/sessionstart-prime.mjs` | always-fetch-docs bullet |
| Routing | `config/claude/agents/office-manager.md` | always-fetch-docs bullet |
| Doc | `AGENTS.md` | always-fetch-docs bullet under "Autonomy" |
| Doc | `config/claude/CLAUDE.md` | mirrored bullet |
| Tests | `cli/__tests__/settings-permissions.test.mjs` (extended) | assert deny/ask are `[]` |
| Tests | `config/claude/hooks/__tests__/advisory-hooks.test.mjs` (new) | assert every hook returns allow + injection |

## Reversibility

This policy is reversible. To revert:

- Restore `permissions.deny` and `permissions.ask` lists from `cf09bf6`
  (last commit before this policy landed).
- Restore `permissionDecision: "deny"` returns in the four converted
  hooks.
- Remove the always-fetch-docs priming from the agent briefings.

A revert is itself a single logical commit that updates this decision
record to `Status: Superseded` and adds a successor.

## Related decisions

- [`docs/decisions/PLAN-agent-teams-default.md`](./PLAN-agent-teams-default.md) —
  defines how agents route work; this policy makes them less gated when
  they do.
- [`docs/decisions/DEC-014-mandatory-agent-grounding.md`](./DEC-014-mandatory-agent-grounding.md) —
  the original documentation-grounding contract that this policy
  re-asserts as an always-fetch-docs prime at every agent's startup.
- [`docs/decisions/DEC-012-core-only-guarded-autonomy.md`](./DEC-012-core-only-guarded-autonomy.md) —
  core-only architecture; this policy keeps the core-only guarantee
  (no daemon, no embedded service) while moving the autonomy locus from
  hook denial to advisory injection.
- `AGENTS.md` "Autonomy and parallelism" — operating under this policy.
