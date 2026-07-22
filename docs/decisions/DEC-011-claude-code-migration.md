# DEC-011 — Migration from Cline to Claude Code

**Date:** 2026-07-11
**Status:** Accepted
**Deciders:** @mike, @karen
**Supersedes:** none
**Related:** DEC-001 (OpenCode → Cline, now historical), DEC-002, DEC-004, DEC-007

## Context

The Bizar Harness was originally built on OpenCode (≤ v5.5.x), migrated
to Cline across v5.6.0-beta.x → v6.0.0 (DEC-001), and has been a
Cline-only system since v6.1.0 (the OpenCode support surface was
removed).

Cline is a strong runtime but its ecosystem has a few mismatches with
where Bizar is heading:

- **Agent SDK shape.** Cline exposes its runtime via `@cline/sdk`,
  which is a different shape from Anthropic's official Agent SDK
  (`@anthropic-ai/claude-agent-sdk`). The Agent SDK is the
  reference implementation Claude Code uses internally; aligning
  to it means the harness inherits Claude Code's native tool
  (Read, Edit, Write, Bash, Grep, Glob, WebFetch, WebSearch),
  Agent (subagent dispatch), Skill (auto-loaded SKILL.md),
  AskUserQuestion (one-question clarification), and EventMessage
  surfaces without adapter code.
- **Hook event bag.** Cline's `beforeTool` / `afterTool` /
  `beforeModel` / `onEvent` discrete shape predates Anthropic's
  standardized hook payloads. Claude Code's `PreToolUse` /
  `PostToolUse` / `UserPromptSubmit` / `SessionStart` /
  `SessionEnd` payloads are typed JSON and integrate with
  Anthropic's audit tooling directly.
- **Mistake recovery.** Claude Code's `onConsecutiveMistakeLimitReached`
  callback signature is simpler than Cline's `execution.maxConsecutiveMistakes`
  + reminder triple, and the default of `6` is enough headroom for
  the plugin's tool-discipline primer (which lifts it to `10` as
  a floor anyway).
- **Subprocess framing.** Claude Code is in-process by default;
  there is no equivalent to Cline's `cline serve` to avoid. The
  `ClineRuntime` wrapper is replaced by a thin `ClaudeSdkRuntime`
  (the source file is still `plugins/bizar/src/clineruntime.ts` for
  back-compat with the plugin manifest) that embeds
  `@anthropic-ai/claude-agent-sdk` directly.
- **Ecosystem / skills.** Claude Code's skill auto-loading and
  agent-team support are first-class. Skills move from
  `~/.cline/skills/<name>/SKILL.md` and
  `~/.agents/skills/<name>/SKILL.md` (Cline) to
  `.claude/skills/<name>/SKILL.md` (Claude Code project) plus
  `~/.claude/skills/<name>/SKILL.md` (user) — single source.
- **Configuration surface.** Claude Code uses `~/.claude/settings.json`
  and `.claude/settings.json` for tool / permission scoping. The
  legacy `~/.cline/cline.json` and `~/.config/cline/cline.json` are
  no longer read.

The migration completes the trajectory from the OpenCode era
(general-purpose plugin framework) through the Cline era
(agent-runtime as a dedicated product) into the Claude Code era
(the harness binds to Anthropic's first-party agent runtime).

## Decision

Migrate the entire plugin and tooling surface from Cline to
Claude Code. Specifically:

1. **Plugin → MCP server + skills.** The `plugins/bizar/` plugin
   that registered via Cline's `cline.json#plugin` array is now
   a Claude Code MCP server registered via `.claude/mcp.json`.
   Agent definitions move to `.claude/agents/*.md` (YAML
   frontmatter; Claude Code reads them directly).
2. **Hooks → Claude Code event bag.** The four hooks (`beforeTool`,
   `afterTool`, `beforeModel`, `onEvent`) become `PreToolUse`,
   `PostToolUse`, `UserPromptSubmit`, `SessionStart` / `SessionEnd`.
   The payload shapes change from Cline's `AgentBeforeToolResult` /
   `AgentAfterToolResult` to Claude Code's typed JSON.
3. **Runtime → Agent SDK.** `ClineRuntime` →
   `ClaudeSdkRuntime` (file kept as `clineruntime.ts` for the
   `plugins/bizar/` source layout; exports renamed). The wrapper
   uses `@anthropic-ai/claude-agent-sdk` directly. No `claude
   daemon` subprocess.
4. **Commands → slash commands.** The 14 user-level slash commands
   in `~/.cline/commands/` move to `~/.claude/commands/` and
   `.claude/commands/` (project). The 13 Bizar slash commands
   (`commands-bizar/`) move under `.claude/commands/`.
5. **Mistake-limit field.** `clineruntimeMaxConsecutiveMistakes`
   is renamed `claudeAgentMaxConsecutiveMistakes` in
   `config/cline.json.template` (now `config/claude.json.template`).
   Default value stays at 10 (floor against Claude Code's
   `onConsecutiveMistakeLimitReached` default of 6).
6. **Memory layer.** The `~/.bizar_memory/` and
   `~/.bizar/skills/` paths are unchanged (they are Bizar-owned,
   not Cline-owned). They are now loaded by Claude Code's skill
   loop instead of Cline's.
7. **Migration guide.** `docs/migration-guide.md` is rewritten
   for the Cline → Claude Code move. The OpenCode → Cline content
   is moved to a "Historical" section and marked archived.
8. **Documentation surface.** Every doc page that referenced
   Cline is reframed as Claude Code. ADRs DEC-001 (OpenCode →
   Cline) and DEC-002 (in-process `cline serve`) are marked
   historical; their decisions still apply (the harness is still
   in-process; the harness is still a single runtime per
   session) but the references to Cline-specific subprocesses
   and tool shapes are rewritten.
9. **Versions.** v6.3.0 is the migration release. v6.2.5 (the
   prior stable) is the last Cline release. `npm install
   @polderlabs/bizar` ships v6.3.0; existing v6.2.x installs
   upgrade via `bizar update`.

## Consequences

### Positive

- The harness inherits Claude Code's native tool surface
  (Read, Edit, Write, Bash, Grep, Glob, WebFetch, WebSearch,
  Agent, Skill, AskUserQuestion, SendMessage, NotebookEdit)
  without adapter code.
- Skill discovery is automatic: `.claude/skills/<name>/SKILL.md`
  is loaded by name; no `~/.cline/skills/` vs
  `~/.agents/skills/` double-mirror.
- Agent dispatch uses the Claude Code `Agent` tool natively
  (`subagent_type`, `run_in_background`, `isolation: "worktree"`).
  No custom subagent RPC over HTTP.
- Hook payloads are typed JSON; the harness's existing typed
  `ApprovalCheck` and `LogWriter` records map cleanly to
  Claude Code's `PreToolUse.hookSpecificOutput.permissionDecision`
  and `PostToolUse.additionalContext`.
- Mistake recovery becomes a single callback
  (`onConsecutiveMistakeLimitReached`) with a typed payload,
  instead of three separate Cline-era config fields.

### Negative

- Custom hooks written for Cline need to be ported to the
  Claude Code event-payload shape. The `docs/migration-guide.md`
  v6.3.0 section provides the mapping.
- The skill-lock semantics move from
  `~/.agents/.skill-lock.json` (a Cline-specific lock file)
  to Claude Code's marketplace registry. The `bizar validate`
  check `skill-marketplace-registered` is adapted.
- The `bizar spawn_background` tool family is replaced by the
  Claude Code `Agent` tool with `run_in_background: true`. Any
  external code calling `bizar_spawn_background` directly must
  switch to the `Agent` tool.

### Neutral

- The `plugins/bizar/` source layout is preserved; the
  internal class names rename (`ClineRuntime` →
  `ClaudeSdkRuntime`) but the file path stays.
- The dashboard (`bizar-dash/`) is unchanged at the file level.
- The `~/.bizar_memory/` vault is unchanged.

## Implementation notes

- `packages/sdk/cline.ts` was a thin Cline type export; renamed
  to `claude.ts` for the Agent SDK re-export.
- The plugin manifest moved from
  `package.json#cline.plugins` to `package.json#claude.mcpServers`.
- The `cli/provision.mjs` installer was rewritten to mirror
  skills/agents/commands/hooks to `.claude/` instead of
  `~/.cline/`.
- The harness engineering audit (`tools/audit-harness.sh`)
  gained a v6.3.0 column; the L01–L12 score stays at 73/73.

## References

- https://docs.claude.com/claude-code — Anthropic Claude Code docs.
- https://docs.claude.com/en/docs/claude-code/agent-sdk/overview
- `@anthropic-ai/claude-agent-sdk` on npm.
- `docs/migration-guide.md` v6.3.0 section — operator upgrade
  guide.
- `CHANGELOG.md` v6.3.0 — release notes.
