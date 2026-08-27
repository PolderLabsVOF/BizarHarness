# Architecture decisions

| ID | Decision | Status |
| --- | --- | --- |
| [DEC-007](docs/decisions/DEC-007-tool-approval-gate.md) | Deterministic PreToolUse safety and approval gates | Accepted |
| [DEC-008](docs/decisions/DEC-008-skill-curator.md) | Canonical skill library with verified mirror | Accepted |
| [DEC-010](docs/decisions/DEC-010-knowledge-graph-tools.md) | Local graph query/path MCP tools | Accepted |
| [DEC-011](docs/decisions/DEC-011-claude-code-migration.md) | Claude Code-native host and Agent SDK/MCP integration | Accepted |
| [DEC-012](docs/decisions/DEC-012-core-only-guarded-autonomy.md) | Core-only architecture and human approval boundaries | Accepted |
| [DEC-013](docs/decisions/DEC-013-collision-free-parallel-execution.md) | Worktree isolation, durable task leases, and serialized integration | Accepted |
| [DEC-014](docs/decisions/DEC-014-mandatory-agent-grounding.md) | Mandatory Bizar routing and official-documentation grounding | Accepted |
| [DEC-015](docs/decisions/DEC-015-openkan-control-plane.md) | OpenKan is Bizar's external control plane | Accepted |
| [POLICY-full-permissions-and-advisory-hooks](docs/decisions/POLICY-full-permissions-and-advisory-hooks.md) | Full permissions + advisory hooks + always-fetch-docs | Accepted (superseded by F-180) |
| [F-180](docs/decisions/POLICY-full-permissions-and-advisory-hooks.md) | Close residual F-176/F-167/F-169/F-170 drift in factory, AGENTS.md, decision frontmatter, and feature ledger | Accepted |
| [F-181](docs/decisions/POLICY-full-permissions-and-advisory-hooks.md) | Expand permissions.allow to maximum per operator directive (14 wildcards + `mcp__*`); keep `Bash(npm publish *)` HITL-gated | Accepted |
| [F-182](docs/decisions/POLICY-full-permissions-and-advisory-hooks.md) | Convert remaining hard-deny hooks (`simplify-guard`, `content-style-guard`, `agent-model-guard`) to the F-176 advisory pattern (`permissionDecision: "allow"` + 🟡 `additionalContext`); hard approval gates stay in `git-workflow-guard.mjs` and `permission-request.mjs` | Accepted |
| [F-183](docs/decisions/POLICY-full-permissions-and-advisory-hooks.md) | Make `bizar install --force` do a fully clean install (wipes `~/.claude/{agents,skills,commands,hooks,rules,workflows,plugins}` + `~/.agents/` + `settings.json`; preserves `~/.config/bizar/`, `~/.claude/{.credentials.json,statsig,.playwright-mcp}`; stashes `FORCE_CLEAN_PRESERVE_ENV_KEYS` into `BIZAR_SAVED_ENV` and re-merges on `writeClaudeSettings`; merge 5f114b6) | Accepted |
| F-184 | Land a userSelected-aware resolver (`packages/sdk/src/router/agent-model-registry.ts#rankUserSelectedForRole`) that ranks the operator-selected pool by capability profile before falling back to the tier default. Precedence: userSelected pool → tier default → inherit session. Capability score weights reasoning=0.3, toolCall=0.25, structuredOutput=0.15, attachment=0.1, temperature=0.05, +0.15 for image input. Eligibility floors (minContextTokens, requireReasoning/ToolCall/StructuredOutput/ImageInput, preferredTiers) surface human-readable `ineligibleReasons`. `parseUserSelected` reads `userSelected.profiles` defensively (silently skips invalid entries). `defaultTierHintForId` mirrors the picker heuristic. Closes IMP-016; IMP-019 (health-aware failover) deferred. | Accepted |
