# Retained core feature audit — 2026-07-30

Scope: every shipped Bizar feature after removal of the application control plane and general note-vault/search subsystem. Source evidence is the current tree, `feature_list.json`, targeted tests, and the repository gates. Historical feature claims that no longer mapped to code were deleted rather than relabeled.

## Audit matrix

| Area | Feature IDs | Current implementation | Validation | Result / residual risk |
| --- | --- | --- | --- | --- |
| MCP and local plans/loops/graph | F-001, F-019 | `packages/sdk/src/mcp` | MCP unit inventory + E2E source/load check | Retained; nine tools only. File concurrency is intentionally simple. |
| Safety and HITL | F-011, F-016 | settings + PreToolUse hooks | hook tests + settings assertions | Retained and strengthened. Claude Code schema/version drift remains an integration risk. |
| Harness contracts | F-007–F-013, F-030 | Makefile, scripts, templates, docs, arch rules | script tests + architecture gate | Retained. Audit score is advisory; executable gates are authoritative. |
| Runtime/toolchain | F-015, F-025, F-027 | Node/Bun constraints, provisioner, Claude Code surfaces | provision/install tests + E2E | Retained. Global binary availability is environment-dependent. |
| Skills and routing | F-017, F-026, F-098, F-099, F-101, F-102 | `config/skills`, mirror, thinking/9Router routers | mirror check + thinking tests | Retained. External 9Router availability is optional and not simulated in unit tests. |
| Agent orchestration | F-034, F-107, F-112, F-114, F-115 | 16 uniquely named office agents, trigger router, three-phase coordinator | dynamic name/reference checker + dispatcher/hook tests | Retained. The duplicate `carl` definition was deleted and the research role now resolves as `greg`. Native Agent execution itself depends on Claude Code. |
| Browser automation | F-021, F-108 | official agent-browser CLI/MCP and discovery-first skill | lifecycle module tests + settings assertions | Retained as optional operator tooling; no bundled browser UI or Bizar daemon wrapper. |
| Sandbox | F-029 | current CubeSandbox/E2B command and skill | request/config tests + CLI validation | Retained; real cloud execution requires credentials and was not performed. |
| Adaptive learning/routing | F-033 | router, Q-learning, instincts, decisions | SDK tests | Retained as bounded JSONL evidence. No note CRUD/search or semantic index. |
| Cost and claim | F-035 | SQLite cost gate and feature bridge | CLI unit tests | Retained. Multi-host coordination is out of scope. |
| Federation and consensus | F-038, F-039 | SDK library primitives | SDK tests | Retained as opt-in primitives; not exposed as autonomous network services. |
| ESM/static hygiene | F-057 | CLI static test | Node test | Retained. |
| Progress parsing and sprint contracts | F-096 | `cli/progress-parser.mjs`, `scripts/sprint.mjs` | canonical root-heading, round-trip, and contract-generation tests | Retained after extraction from the deleted server tree; `.bizar/PROGRESS.md` is no longer a competing state source. |
| Session lifecycle | F-103, F-104 | SessionStart/SessionEnd hooks | lifecycle hook tests | Retained as bounded handoff/trace evidence. |
| Container verification | F-031 | `scripts/test-in-container.sh` | static audit; optional real run | Retained. Podman/Docker availability is environment-dependent. |

## Removal findings

The audit found the retired subsystems spread across package dependencies, root build scripts, install/provision paths, CLI commands, SDK exports and MCP tools, Docker/deploy files, bundled browser integrations, tests, docs, feature evidence, skills, settings, ignored project state, and architecture rules. Those surfaces were deleted. The second local artifact web editor, obsolete plugin compatibility layer, and nonexistent visual-plan canvas command were also removed. Reusable progress parsing and backup logic were moved into `cli/` and regression-tested.

`scripts/verify-removed-surfaces.mjs` is the prevention contract. It checks removed paths, dependencies, SDK exports, MCP/settings names, and runtime/config references.

## Audit corrections

- The old ledger claimed 17–23 MCP tools; the real retained surface is nine.
- Several old passing entries described deleted runtime tools or browser views. They were removed from the ledger.
- Generated settings referenced nonexistent hook files and absolute developer paths. Provisioning now installs existing hooks at user scope; project settings use `$CLAUDE_PROJECT_DIR`.
- Safe Bash calls were previously returned as explicitly `allow`, bypassing normal HITL behavior. They now return no decision and defer to Claude Code permissions.
- SessionStart used CommonJS `require` inside ESM. It now uses imported filesystem functions.
- Trigger routing used retired agent names and a removed consolidation worker. Both were corrected.
- The agent catalog contained two `carl` definitions and a research file whose declared name did not match `@greg`; the catalog now has 16 unique identities and the checker enforces uniqueness dynamically.
- The legacy migrator treated current `~/.config/bizar/` operational state as old input. It now migrates only retired Cline configuration and leaves current state untouched.
- Runtime paths disagreed across settings, doctor, provisioner, and MCP loops. They now derive from `~/.config/bizar/` (or `BIZAR_HOME`).
- The schedule command overclaimed a background runner. It now describes the real local registry and explicitly requires an external/Claude workflow to execute records.

## Stop condition

This audit is complete only when the absence, architecture, unit, E2E, clean-state, and TypeScript gates all pass on the same final tree and F-116 records that fresh evidence.
