# BizarHarness — Full Feature Inventory

Snapshot from `feature_list.json` vcr.passing = **68/68** (100%). All 68 features
in `feature_list.json` are `state: passing`. Feature IDs are chronological; gaps
(`F-040..F-051`) are reserved/skipped sprints.

Generated: 2026-07-22.

---

## How to read this list

| Column | Meaning |
|---|---|
| **ID** | feature_list.json ID (`F-NNN`) |
| **Layer** | L0=script-level · L1=compile/typecheck · L2=unit tests · L3=E2E |
| **Cat** | category from feature_list.json |
| **What** | one-line behavior |
| **Verify** | the literal command/assertion that proves it green |
| **Where** | the on-disk artifact(s) you can `cat` / `find` to confirm |
| **✅** | passing |

---

## A. Core Plugin + SDK (F-001..F-026)

| ID | L | Cat | What | Verify | Where |
|---|---|---|---|---|---|
| **F-001** ✅ | L1+L3 | core | MCP server loads via Claude Code Agent SDK | `make check` + `make e2e` (19 tools registered) | `packages/sdk/src/mcp/server.ts` |
| **F-002** ✅ | L1 | core | All 17 tools use Claude Code MCP tool registration | `make check` | `packages/sdk/src/tools/` |
| **F-003** ✅ | L1+L3 | core | In-process ClaudeSdkRuntime (no subprocess) | `make check` + `make e2e` (setup < 1s) | `packages/sdk/src/claude-sdk-runtime.ts` |
| **F-004** ✅ | L3 | core | Memory tools read/write in-process vault (no dashboard HTTP) | `make check` + `make e2e` (memory cycle) | `packages/sdk/src/memory-vault.ts` |
| **F-005** ✅ | L3 | teams | `bizar_spawn_team` + `bizar_team_status` | `make check` + `make e2e` | `packages/sdk/src/tools/team-spawn.ts` |
| **F-006** ✅ | L3 | ui | Kanban: `Tasks.tsx` + `/api/tasks` + `tasks-store` | Dashboard renders 5-column kanban | `bizar-dash/src/web/v8/views/Tasks/` |
| **F-007** ✅ | L1 | harness | Harness audit passes all CRITICAL items | `bash tools/audit-harness.sh .` | `.harness/audit/latest.json` |
| **F-008** ✅ | L1 | harness | Makefile with all required targets | `make help` lists all | `Makefile` |
| **F-009** ✅ | L1 | harness | scripts/{verify-feature.sh, check-arch.sh, clean-state-check.sh, session-trace.sh} | all executable, exit 0 | `scripts/` |
| **F-010** ✅ | L1 | harness | templates/{sprint-contract.md, evaluator-rubric.md, clean-state-checklist.md} | all 3 exist | `templates/` |
| **F-011** ✅ | L1 | harness | `.claude/settings.json` scopes tool access | JSON parses | `.claude/settings.json` |
| **F-012** ✅ | L1 | harness | `.harness/arch-rules.json` with WHAT/WHY/FIX | ≥3 rules | `.harness/arch-rules.json` |
| **F-013** ✅ | L1 | harness | `docs/{architecture.md, quality-document.md}` | both exist | `docs/` |
| **F-014** ✅ | L1 | harness | Module-level ARCHITECTURE/CONSTRAINTS in plugins/bizar, bizar-dash, packages/sdk | 4 module docs | `*/ARCHITECTURE.md`, `*/CONSTRAINTS.md` |
| **F-015** ✅ | L1 | harness | `.nvmrc` pins Node runtime | file exists with valid version | `.nvmrc` |
| **F-016** ✅ | L1 | harness | Tool approval gate (36 dangerous patterns, 25 deny + 11 require-approval) | `make check` + `bun test plugins/bizar/tests/safety.test.ts` | `plugins/bizar/src/dangerous-patterns.ts` |
| **F-017** ✅ | L1 | harness | Skill curator (closed learning loop, Hermes pattern) | `make check` + 5 safety tests | `plugins/bizar/src/hooks/skill-curator.ts` |
| **F-018** ✅ | L1 | harness | Pre-compaction memory flush (OpenClaw pattern) | `make check` + 3 tests | `plugins/bizar/src/hooks/memory-flush-on-compact.ts` |
| **F-019** ✅ | L1 | harness | Knowledge graph: `bizar_graph_query/_path/_explain` (3 tools) | `make check` + 3 unit + 3 e2e | `plugins/bizar/src/tools/graph-query.ts` |
| **F-020** ✅ | L1+L3 | harness | Harness research synthesis (applied walkinglabs canon + Bizar plan) | 4 new components + 19 tests + 5 e2e | `research/agent-harness-survey/` |
| **F-021** ✅ | L1+L3 | harness | agent-browser integration (v6.0.0) — 6 plugin tools | 7 agent-browser tests + `cli/agent-browser-up.sh doctor` | `plugins/bizar/src/tools/agent-browser.ts` |
| **F-022** ✅ | L1 | harness | `MILESTONES.md` + `IMPLEMENTATION_PLAN.md` | both exist + indexed | `MILESTONES.md`, `IMPLEMENTATION_PLAN.md` |
| **F-023** ✅ | L1 | harness | Mistake-recovery callback (continue/stop on invalid_tool_call) | 10 unit tests pass | `plugins/bizar/src/mistake-recovery.ts` |
| **F-024** ✅ | L1 | harness | Tool-discipline directive (cap bash, forbid xargs/sed -i/heredocs) | 9 unit tests pass | `plugins/bizar/src/tool-discipline.ts` |
| **F-025** ✅ | L1 | installer | Installer auto-configures Claude Code (rules sync + mistake limit) | `make check` + provision test green | `cli/provision.mjs` |
| **F-026** ✅ | L1 | harness | 9Router gateway — all 13 agents route via http://localhost:20128/v1; 8 capability skills | `bun cli/bin.mjs doctor` shows ✓9router-reachable | `config/skills/9router*/` |

---

## B. Ruflo ports (F-032..F-039) — federated agent runtime

| ID | L | Cat | What | Verify | Where |
|---|---|---|---|---|---|
| **F-032** ✅ | L1+L3 | ruflo-port | Swarm coordination: agent_spawn/list/terminate + swarm_init + BizarAgentRegistry | 72 SDK tests (+18 new) | `packages/sdk/src/agent-registry.ts`, `swarm-topology.ts` |
| **F-033** ✅ | L1+L2 | ruflo-port | ReasoningBank distillation pipeline (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) + Thompson sampling + Q-learning | 129 SDK tests (+25 new) | `packages/sdk/src/router/{model-router,q-learning-router,codemod-intent,memory-distillation}.ts` |
| **F-034** ✅ | L3 | ruflo-port | Background Workers: trigger-pattern dispatcher wired to UserPromptSubmit | 18/18 worker-dispatcher tests | `config/trigger-patterns.json`, `cli/worker-dispatcher.mjs`, `.claude/hooks/worker-suggest.mjs` |
| **F-035** ✅ | L1+L3 | ruflo-port | MetaHarness: atomic cost gate (SQLite) + 3-tier routing panel + ClaimService | 43 cost-gate + 5 RoutingDecisions tests | `cli/cost-gate.mjs`, `cli/feature-list-bridge.mjs`, `RoutingDecisions.tsx` |
| **F-036** ✅ | L1+L2+L3 | ruflo-port | Goal Planner UI: GOAP-style goal input → A* plan → kanban + dep graph + comm log + event log + quality gates | `make build:dash` + `make test:web` + browser screenshot | `bizar-dash/src/web/pages/GoalPlanner.tsx` |
| **F-037** ✅ | L1+L2+L3 | tech-debt | v6.3.0 migration gap cleanup — remove dead Cline paths | `make check` 0 TS errors + `make test` 294/294 + `make e2e` 13/13 | plugin docs rewritten, tsconfig slimmed, `migration-guide.md` updated |
| **F-038** ✅ | L1+L3 | ruflo-port | Agent federation: HMAC+nonce envelopes, PII pipeline (soc2/gdpr/hipaa), TrustEvaluator, PolicyEngine, AuditService, FederationBudget | 101/101 vitest + 34/34 roundtrip | `packages/sdk/src/federation/{envelope,hmac,pii,trust,policy,audit,budget,index}.ts` |
| **F-039** ✅ | L1+L3 | ruflo-port | Hive-mind PBFT consensus (3-of-5 majority, view changes, fault detection) | consensus tests + 4 e2e scenarios | `packages/sdk/src/consensus/{byzantine,types,queen,index}.ts` |

---

## C. Dashboard (bizar-dash) v8 — S10..S49 (F-052..F-097)

### Foundation + live data (S10..S14)

| ID | Sprint | View | Verify | Where |
|---|---|---|---|---|
| **F-052** ✅ | S10 | v8 dashboard live data plumbing (Overview/Tasks/Goals/Agents/Activity/Memory/Libraries/Settings) | 195 vitest + 15 node:test | `bizar-dash/src/server/{progress-parser,bg-poller,routes/{goals,agents-cc}}.mjs` + `web/v8/data/{fetcher,types,useFetch,useWebSocket}.ts` + 8 views rewritten |
| **F-053** ✅ | S11 | Agent detail Drawer + control plane (Send/Restart/Copy) | 7 control-plane tests + 4 agents-cc tests | `bizar-dash/src/web/v8/ui/agents/AgentDetail.tsx` + `server/routes/agents-cc.mjs` |
| **F-054** ✅ | S12 | Goal editor Drawer + create flow | 7 control-plane + 8 progress-parser | `bizar-dash/src/web/v8/ui/goals/GoalDetail.tsx` |
| **F-055** ✅ | S13 | Command palette control surface (Agents/Tasks/Projects groups) | AppCommandPalette test green | `bizar-dash/src/web/v8/views/CommandPalette/AppCommandPalette.tsx` |
| **F-056** ✅ | S14 | Settings section wiring pass (16 sections + live plugin/mcp/skill counts) | control-plane test green | `bizar-dash/src/web/v8/views/Settings/SettingsView.tsx` |

### Plumbing hardening (S23..S25, S30..S36)

| ID | Sprint | Fix / View | Where |
|---|---|---|---|
| **F-057** ✅ | S15 | ESM `require('node:fs')` regression fix + static guard | `cli/commands/{tailscale,voice}.mjs`, `cli/service-env.mjs`, `cli/__tests__/esm-no-require.test.mjs` |
| **F-058** ✅ | S23 | Overview snapshot includes real tasks/goals/agents/tokens/needsAttention counts | `bizar-dash/src/server/routes/overview.mjs` (+ test) |
| **F-059** ✅ | S24 | `/api/agents` merges Bizar + CC with `source` discriminator | `bizar-dash/src/server/routes/agents.mjs` |
| **F-060** ✅ | S25 | Live orchestration-center e2e (12-step snapshot/agents/goals/WS) | `tests/e2e/orchestration-center.mjs` |
| **F-061** ✅ | S32 | GoalsView inline create + delete (no window.prompt) | `bizar-dash/src/web/v8/views/Goals/GoalsView.tsx` |
| **F-062** ✅ | S32 | LibrariesView `CHANGE_EVENTS.hooks` typo fix (`'hooks:change'`) | `bizar-dash/src/web/v8/views/Libraries/LibrariesView.tsx` |
| **F-063** ✅ | S30+S31 | E2E hardening (settings roundtrip + goals fixture) | `tests/e2e/orchestration-center.mjs` |
| **F-064** ✅ | S33 | 7 new v8 pages: Doctor, Usage, Backup, Notifications, Diagnostics, Headroom, Eval | 7 view files in `bizar-dash/src/web/v8/views/{Doctor,Usage,Backup,Notifications,Diagnostics,Headroom,Eval}/` + Router + Sidebar |
| **F-065** ✅ | S34 | SettingsView audit gap closure (9 findings: hook switches, timezones, sliders) | `SettingsView.tsx` + `Select.tsx id_attr prop` + `audit-fixes.test.tsx` |
| **F-066** ✅ | S35 | TasksView + AgentsView create forms via Sheet | `views/{Tasks,Agents}/*View.tsx` |
| **F-067** ✅ | S36 | Real-environment e2e (14 steps, no fixture, notification read flow) | `tests/e2e/real-environment.mjs` |

### New views (S38..S49)

| ID | Sprint | View | Where |
|---|---|---|---|
| **F-068** ✅ | S38 | **ChatView** (3-pane, WS deltas, regenerate, audit, Sheet actions) | `bizar-dash/src/web/v8/views/Chat/ChatView.tsx` |
| **F-069** ✅ | S39 | **ProjectsView** (list, add, activate, remove, auto-detect, scan) | `bizar-dash/src/web/v8/views/Projects/ProjectsView.tsx` |
| **F-070** ✅ | S39 | **ClaudeSessionsView + Detail** (rename, delete, send follow-up) | `views/ClaudeSessions/{ClaudeSessionsView,ClaudeSessionDetail}.tsx` |
| **F-071** ✅ | S39 | `Project` interface in `data/types.ts` | `bizar-dash/src/web/v8/data/types.ts` |
| **F-072** ✅ | S40 | **HistoryView** (timeline + filter chips + live WS) | `bizar-dash/src/web/v8/views/History/HistoryView.tsx` |
| **F-073** ✅ | S40 | **AdminView** (7 tile grid: gc, cache-clear, memory-reindex, logs-purge, restart, rebuild, export) | `views/Admin/AdminView.tsx` + `server/routes/admin.mjs` bug fix |
| **F-074** ✅ | S40 | **AuthView** (status, reveal bearer, rotate) | `bizar-dash/src/web/v8/views/Auth/AuthView.tsx` |
| **F-075** ✅ | S41 | **EnvVarsView** (masked list, add/edit/bulk-import/export/delete) | `bizar-dash/src/web/v8/views/EnvVars/EnvVarsView.tsx` |
| **F-076** ✅ | S41 | **ConfigView** (4 tabs: Runtime/Providers/MCPs/System LLM) | `bizar-dash/src/web/v8/views/Config/ConfigView.tsx` |
| **F-077** ✅ | S42 | **DialogsView** (active queue + WS) | `views/Dialogs/DialogsView.tsx` |
| **F-078** ✅ | S42 | **ProvidersView** (list, active-default, masked keys, rotate, auto-detect) | `views/Providers/ProvidersView.tsx` |
| **F-079** ✅ | S42 | **ModsView** (installed + registry, enable/uninstall/upgrade) | `views/Mods/ModsView.tsx` |
| **F-080** ✅ | S42 | **UpdateView** (package list, check, apply, live progress) | `views/Update/UpdateView.tsx` |
| **F-081** ✅ | S43 | **ArtifactsView** (list, add, detail Sheet, delete) | `views/Artifacts/ArtifactsView.tsx` |
| **F-082** ✅ | S43 | **LightRAGView** (defaults form, status, autostart) | `views/LightRAG/LightRAGView.tsx` |
| **F-083** ✅ | S43 | **VoiceView** (list, upload, audio player, delete) | `views/Voice/VoiceView.tsx` |
| **F-084** ✅ | S43 | **ClipboardView** (list, save, delete) | `views/Clipboard/ClipboardView.tsx` |
| **F-085** ✅ | S43 | **ObsidianView** (vault stats, notes, expand, delete, rebuild index) | `views/Obsidian/ObsidianView.tsx` |
| **F-086** ✅ | S43 | **MiscView** (global fuzzy search + Tailscale card) | `views/Misc/MiscView.tsx` |
| **F-087** ✅ | S37 | Chat WS protocol foundations (4 WsMessage variants + 4 interfaces + 3 chat UI primitives) | `data/types.ts` + `ui/chat/{EventStream,MessageBubble,ChatDrawer}.tsx` |
| **F-088** ✅ | S45 | **AgentHierarchy view** (parent/child tree) | `views/Agents/AgentHierarchy.tsx` |
| **F-089** ✅ | S45 | Agents stuck banner (>5m no heartbeat) | `views/Agents/AgentsView.tsx` |
| **F-090** ✅ | S45 | AgentCard data-driven metric strip (successRate, lastSeenMs, ProgressBar) | `ui/agents/AgentCard.tsx` |
| **F-091** ✅ | S47 | `make check` green (3 TS2783 errors fixed in UpdateView) | `views/Update/UpdateView.tsx` |
| **F-092** ✅ | S48 | Inline Restart per-stuck-agent on AgentsView banner | `views/Agents/AgentsView.tsx` |
| **F-093** ✅ | S49 | AgentDetail agent↔task drilldown (client-filtered) | `ui/agents/AgentDetail.tsx` |
| **F-094** ✅ | v10-S1 | Pause + Resume + bulk "Pause all" on stuck banner; `BizarAgent.status` widens to `'paused'` | `views/Agents/AgentsView.tsx` + `server/routes/agents.mjs` + `data/types.ts` |
| **F-095** ✅ | v10-S2 | OverviewView Tokens StatTile gains hand-rolled SVG sparkline (last 24h) | `views/Overview/OverviewView.tsx` + `overview-trends.test.tsx` |
| **F-096** ✅ | v10-S3 | CC-shape PROGRESS.md round-trip + 2 bug fixes (active.path, status-line strip) | `server/routes/goals.mjs` + `server/progress-parser.mjs` + e2e |
| **F-097** ✅ | v10-S4 | `/api/agents/:name/restart` E2E + `readAgent` loadStatus bug fix | `server/agents-store.mjs` + `tests/e2e/agent-restart-roundtrip.mjs` |

---

## D. Thinking defaults (F-098..F-102) — 2026-07-22

| ID | L | Cat | What | Verify | Where |
|---|---|---|---|---|---|
| **F-098** ✅ | L1 | core | Ship 39 MIT `thinking-*` skills (verbatim from `tjboudreaux/cc-thinking-skills`) + 1 Bizar-authored `skillopt` SkillOpt workflow wrapper, all under `config/skills/<name>/SKILL.md` mirrored to `.claude/skills/` | `scripts/verify-thinking-skills.mjs` → 40/40 PASS | `config/skills/thinking-*/SKILL.md` × 39 + `config/skills/skillopt/SKILL.md` × 1 |
| **F-099** ✅ | L1 | core | `thinking-route.mjs` UserPromptSubmit hook — deterministic regex router (35 buckets) + auto-injects `hookSpecificOutput.additionalContext`; wired into `.claude/settings.json` as 3rd sibling | `node --test .claude/hooks/__tests__/thinking-route.test.mjs` → 53/53 PASS | `.claude/hooks/thinking-route.mjs` + `__tests__/thinking-route.test.mjs` + `.claude/settings.json` |
| **F-100** ✅ | L1 | core | `AGENT_BASELINE.md` §4b "Thinking Models (Default Layer)" — 3-row table pointing at router, skills, and SkillOpt install hint | `grep -n 'thinking-model-router\|skillopt' .claude/agents/_shared/AGENT_BASELINE.md` | `.claude/agents/_shared/AGENT_BASELINE.md` |
| **F-101** ✅ | L1 | core | `scripts/sync-skills-mirror.mjs` — idempotent mirror `config/skills/` → `.claude/skills/` | 2nd run reports `0 copied, 60 already in sync` | `scripts/sync-skills-mirror.mjs` |
| **F-102** ✅ | L1 | core | `scripts/verify-thinking-skills.mjs` — frontmatter + size validator; wired into `make check-arch` | `make check-arch` → verifier green | `scripts/verify-thinking-skills.mjs` + `Makefile` |

---

## Skills shipped (60 canonical under `config/skills/`)

### Thinking defaults (40) — F-098

**39 mental-model skills** (`thinking-*`):

```
thinking-archetypes          thinking-bayesian            thinking-bounded-rationality
thinking-circle-of-competence thinking-cynefin            thinking-debiasing
thinking-dual-process        thinking-effectuation        thinking-feedback-loops
thinking-fermi-estimation    thinking-first-principles    thinking-five-whys-plus
thinking-inversion           thinking-jobs-to-be-done     thinking-kepner-tregoe
thinking-leverage-points     thinking-lindy-effect        thinking-map-territory
thinking-margin-of-safety    thinking-model-combination   thinking-model-router
thinking-model-selection     thinking-occams-razor        thinking-ooda
thinking-opportunity-cost    thinking-pre-mortem          thinking-probabilistic
thinking-red-team            thinking-regret-minimization thinking-reversibility
thinking-scientific-method   thinking-second-order        thinking-socratic
thinking-steel-manning       thinking-systems             thinking-theory-of-constraints
thinking-thought-experiment  thinking-triz                thinking-via-negativa
```

**1 SkillOpt workflow** (Bizar-authored):

```
skillopt                     # pip install skillopt + 6-phase loop + best_skill.md
```

### Other canonical skills (20) — pre-existing

```
9router                      # 9Router OpenAI-compatible gateway entry
9router-chat                 # 9router capability: chat completions
9router-embeddings           # 9router capability: embeddings
9router-image                # 9router capability: image gen
9router-stt                  # 9router capability: speech-to-text
9router-tts                  # 9router capability: text-to-speech
9router-web-fetch            # 9router capability: web fetch
9router-web-search           # 9router capability: web search
bizar                        # Bizar core skill (canonical)
cpp-coding-standards         # C++ coding standards
cpp-testing                  # C++ test framework guidance
cubesandbox                  # TencentCloud CubeSandbox (E2B-compatible KVM)
embedded-esp-idf             # ESP-IDF embedded firmware
glyph                        # Visual glyph rendering at artifacts/<slug>/
harness-engineering          # walkinglabs/awesome-harness-engineering canon
lightrag                     # LightRAG mod always-on rules
memory-protocol              # Bizar memory vault usage
obsidian                     # Obsidian-compatible Bizar Memory Service
read-the-damn-docs           # Read the docs before guessing
self-improvement             # .bizar/AGENTS_SELF_IMPROVEMENT.md keeper
```

### Dev mirror under `.claude/skills/`

Same 60 plus 1 pre-existing orphan (`de-sloppify/`, surfaced as warning by F-101, not a feature).

---

## Hooks shipped (8) — `.claude/hooks/`

| Hook | Event | Behavior |
|---|---|---|
| `userpromptsubmit-tag.mjs` | UserPromptSubmit | Tag/mark user prompts |
| `worker-suggest.mjs` | UserPromptSubmit | Background-worker dispatcher (F-034) — suggests skills/agents from `trigger-patterns.json` |
| **`thinking-route.mjs`** | UserPromptSubmit | **(F-099)** Routes prompt → `thinking-<name>` via deterministic regex |
| `pretooluse-editwrite.mjs` | PreToolUse | Edit/Write gate |
| `pretooluse-bash.mjs` | PreToolUse | Bash gate |
| `posttooluse-editwrite.mjs` | PostToolUse | Edit/Write post-hook |
| `auto-instinct.sh` | PostToolUse | Auto-instinct learning |
| `post-merge-audit.sh` | PostToolUse | Post-merge audit (Bash(git push*)) |
| `sessionstart-prime.mjs` | SessionStart | Session priming |
| `sessionend-recall.mjs` | SessionEnd | Session-end recall |
| `learning-extract.mjs` | SessionEnd | Learning extraction |
| `worktree-setup.sh` | PostToolUse (EnterWorktree) | Worktree setup |

**Tested hooks**: `thinking-route.mjs` has 53/53 PASS in `.claude/hooks/__tests__/thinking-route.test.mjs`.

---

## Make targets (22)

`help · setup · dev · check · test · e2e · e2e-orchestration · e2e-real-env · vcr · verify-feature · check-arch · clean-check · audit · eval-gate · feature-state-machine · session-start · session-end · init · mirror-claude-md · mirror-claude-md-check · cleanup · mcp-serve · worktree-init · sync-skills-mirror · verify-thinking-skills`

(F-101 / F-102 added the last two.)

---

## Scripts shipped (28) — `scripts/`

| Script | Purpose |
|---|---|
| `audit.mjs` | 12-category harness audit (0–100 score) |
| `audit.test.mjs` | audit tests |
| `bh-full-e2e.mjs` | Full plugin+SDK E2E |
| `check-agents.mjs` | Agent roster sanity |
| `check-arch.sh` | Architectural constraints (L10) |
| `check-deps.mjs` | Dependency freshness |
| `clean-state-check.sh` | 5-dim clean-state verifier (L12) |
| `eval-gate.mjs` | Eval rubric gate (>=0.9 pass-rate) |
| `eval-gate.test.mjs` | eval-gate tests |
| `feature-state-machine.mjs` | Plan→exec→verify→audit gate |
| `feature-state-machine.test.mjs` | fsm tests |
| `install-curl.sh` | curl install helper |
| `install-hooks.sh` | git-hooks installer |
| `install-service.mjs` | service installer |
| `mirror-claude-md.sh` | Regenerate `.claude/CLAUDE.md` from `AGENTS.md` |
| `run-dev.mjs` | dev runner |
| `session-trace.sh` | session traces → `.harness/traces/sessions.jsonl` |
| `spec-dedup.test.mjs` | spec dedup tests |
| `sprint.mjs` | sprint tooling |
| **`sync-skills-mirror.mjs`** | **(F-101)** idempotent mirror |
| `test-in-container.sh` | podman+alpine container test |
| `verify-feature.sh` | `make verify-feature ID=<id>` |
| **`verify-thinking-skills.mjs`** | **(F-102)** frontmatter + size validator |
| `worktree-setup.sh` | new-worktree bootstrap |

---

## Tests shipped (≈40 files, ≥1,000 cases)

| Tier | Count | Where |
|---|---|---|
| Backend `node --test` | 9 files | `cli/*.test.mjs`, `cli/__tests__/*.test.mjs`, `cli/commands/*.test.mjs` |
| Hook tests | 1 file | `.claude/hooks/__tests__/thinking-route.test.mjs` (53 cases) |
| SDK vitest | 8 files | `packages/sdk/tests/`, `packages/sdk/src/__tests__/` (294 cases incl. federation 8 files / 101 cases) |
| Dashboard vitest | 50+ files | `bizar-dash/src/web/v8/__tests__/`, `bizar-dash/src/web/v8/views/*/{__tests__,__tests__}/*.test.tsx` |
| Server tests | 4 files | `bizar-dash/src/server/{progress-parser,bg-poller,routes/agents-cc,routes/overview}.test.mjs` |
| E2E | 5 scripts | `tests/e2e/{bh-full-e2e,orchestration-center,real-environment,ws-chat-roundtrip,goals-cc-roundtrip,agent-restart-roundtrip}.mjs` |

---

## What is NOT in the feature list (deliberate skips)

Per the lazy YAGNI rule, F-098..F-102 explicitly skipped:

1. **No TS layer for the router hook** — a regex matcher doesn't need types.
2. **No Python-side Bizar integration for SkillOpt** — `pip install skillopt` stays the install path.
3. **No SkillOpt benchmark/eval harness** — that's a research project in its own right (F-103+).
4. **No paraphrased upstream content** — verbatim port to preserve fidelity.

The plan file at `.claude/plans/fizzy-twirling-blossom.md` records these explicitly.

---

## How to verify a feature on disk

```bash
# Pick any feature and prove it green
make verify-feature ID=F-099

# Or just look at what shipped
cat feature_list.json | jq '.features[] | {id, state, category, layer}'

# Or run all three gates
make check-arch
node --test .claude/hooks/__tests__/thinking-route.test.mjs
make clean-check
```

---

## E. Hook Overhaul (F-103..F-106) — 2026-07-22

User-requested: "do an overhaul on the hooks so every session starts with the right knowledge and workflow."

Before the overhaul: `sessionstart-prime.mjs` shipped a hardcoded 4-bullet note. `sessionend-recall.mjs` wrote a 10-line placeholder. Three UserPromptSubmit siblings fired on every prompt — two with overlap. After the overhaul, every session starts with a real briefing tailored to its `source`, ends with a real handoff note + `session-state.json`, and emits one fewer sibling per prompt.

| ID | L | What | Verify | Where |
|---|---|---|---|---|
| **F-103** ✅ | L1+L2+L3 | `sessionstart-prime.mjs` REWRITE — reads 4 sources (PROGRESS.md, feature_list.json, git log, .bizar/PROJECT.md); branches on `source` (startup/clear/resume); WIP=1 guard; briefing hard-capped at 800 chars | `.claude/hooks/__tests__/sessionstart-prime.test.mjs` → **13/13 PASS** (source branching, WIP>1 violation, missing-source graceful, briefing cap) | `.claude/hooks/sessionstart-prime.mjs` |
| **F-104** ✅ | L1+L2+L3 | `sessionend-recall.mjs` REWRITE — reads `transcript_path` (last 200 lines JSONL); extracts last user prompt (skips fillers), files, bash, errors, tool counts; writes `.bizar/sessions/<date>-<id>.md` with structured frontmatter + `.bizar/session-state.json` handoff | `.claude/hooks/__tests__/sessionend-recall.test.mjs` → **9/9 PASS** (transcript extraction, errors, filler skip, malformed JSON, missing transcript, 200-line cap) | `.claude/hooks/sessionend-recall.mjs` |
| **F-105** ✅ | L1+L2 | `thinking-route.mjs` APPEND slash-command routing (team/plow-through/test/validate/plan/audit/pr-review); slash wins over keyword router when prompt starts with `/cmd`. `userpromptsubmit-tag.mjs` DELETED. `.claude/settings.json` UserPromptSubmit siblings: 3 → 2 | `.claude/hooks/__tests__/thinking-route.test.mjs` → **61/61 PASS** (53 existing + 8 new slash cases); `ls userpromptsubmit-tag.mjs`: No such file | `.claude/hooks/thinking-route.mjs` + `.claude/settings.json` |
| **F-106** ✅ | L2 | New test files: `sessionstart-prime.test.mjs` (13 tests) + `sessionend-recall.test.mjs` (9 tests). `thinking-route.test.mjs` appended 8 slash cases. | `node --test .claude/hooks/__tests__/*.test.mjs` → **121/121 PASS** across 4 files | `.claude/hooks/__tests__/` |

### State machine — SessionStart ↔ SessionEnd handoff

```
SessionEnd (session N)
  ↓ writes .bizar/session-state.json {nextStep, blockers, filesTouched}
SessionStart (session N+1, source: "resume")
  ↑ reads it; primes with "Last nextStep: …" + blockers
```

If `.bizar/session-state.json` is missing, `resume` degrades to "No prior session-state.json found — treating as fresh start."

### SessionStart briefing shape (startup)

```
Bizar SessionStart (startup):
- Project: Norse-pantheon multi-agent system for Claude Code. 14 agents across 4 cost tiers with cost-aware routing..
- Features: 90/90 passing. No active feature — pick next from not_started.
- Last commit: 3b4f6f7 chore(release): bump to v10.6.0 — G-autoloop foundation.
- Recent: afff684 (G-autoloop) | a47306a (release v10.5.0) | 7ac254e (baseline) | e727570 (hook policy) | 197737a (dash+tokens).
- Rules: AGENT_BASELINE.md §4b thinking defaults active; WIP=1 honored.
- First move: confirm scope, then read PROGRESS.md and feature_list.json.
```

### session-state.json shape

```json
{
  "lastSessionId": "abc123def456789",
  "lastSessionEnd": "2026-07-22T16:12:32Z",
  "reason": "exit",
  "activeFeature": "F-103",
  "nextStep": "Resume: implement F-103 hook overhaul",
  "filesTouched": [".claude/hooks/sessionstart-prime.mjs"],
  "blockers": [],
  "toolsUsed": { "Read": 1, "Write": 1, "Bash": 1 }
}
```

### Bug found (NOT fixed, logged as follow-up)

`pretooluse-bash.mjs` `rm-rf-home` rule has a false positive: any `rm /home/drb0rk/projects/...` triggers it. Should require `/home` to be the exact path component, not a prefix. Blocked on its own sprint per the plan's "Files I will NOT touch" rule.

---

## Coverage map (where each feature lives)

| Surface | Count | Where |
|---|---|---|
| Skills | 60 canonical + 60 dev mirror | `config/skills/` + `.claude/skills/` |
| Hooks | 11 executable | `.claude/hooks/` |
| Agents | 14 | `.claude/agents/` (F-107: legacy `config/agents/` removed) |
| Dashboard views | 30+ | `bizar-dash/src/web/v8/views/` |
| SDK modules | federation, consensus, router, agent-registry, swarm-topology, mcp, memory-vault, claude-sdk-runtime | `packages/sdk/src/` |
| Tests | ~40 files / ~1000 cases | across `cli/__tests__/`, `packages/sdk/tests/`, `bizar-dash/src/web/v8/__tests__/`, `tests/e2e/` |
| Docs | 15+ | `docs/`, `MILESTONES.md`, `IMPLEMENTATION_PLAN.md`, `*/ARCHITECTURE.md`, `*/CONSTRAINTS.md` |
