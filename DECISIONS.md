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
