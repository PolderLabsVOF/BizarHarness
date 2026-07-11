# BizarHarness — Milestones

> The strategic roadmap for **Bizar** as a **self-improving, autonomous,
> long-horizon coding platform** built on Claude Code. Phased by capability, with
> hard success gates per phase. Updated at every phase end.

## Vision

> **Bizar is the smallest serious multi-agent coding harness with the largest
> closed learning loop in the field.**

A user submits a goal — a refactor, a new feature, a multi-day codebase
migration. They walk away. Bizar handles the work end-to-end, escalating
only when the decision is too expensive, too irreversible, or too uncertain
to make on its own. When the user comes back, the work is either done,
partially done with a clear handoff, or paused at a checkpoint that needs them.

Concretely, a goal looks like one of these:

- **"Refactor the auth module to use JWT."** Odin decomposes the work.
  Mimir investigates the current code. Tyr drafts the refactor with
  tests. Forseti reviews. Thor applies it across the codebase. The user
  approves the merge in a single click from their phone.
- **"Build a complete iOS app from this spec."** Tyr designs the
  architecture, breaks it into 40 features. The scheduler dispatches
  them to Thor in dependency-ordered waves, integrates the results,
  runs the test suite, fixes failures, and reports.
- **"Monitor this codebase for security issues and patch them."** A
  recurring background loop. Mimir watches for new CVEs, Tyr drafts
  patches, Forseti reviews, the agent-browser agent verifies the fix
  in a real browser.

## Pillars

| Pillar | Description | Status |
| --- | --- | --- |
| **1. Autonomy** | Run unsupervised, survive failures, make progress without human input | v6.0.0 |
| **2. Long-horizon** | Execute tasks that span hours, days, or weeks | v6.0.0 |
| **3. Looping** | Three closed feedback loops that make Bizar self-improving | v6.0.0 |
| **4. Cline integration** | First-class integration with Claude Code (in-process; Agent SDK + MCP + skills + Agent dispatch) | v6.0.0 |
| **5. Browser automation** | Self-healing CDP wrapper for browser-driven E2E verification | v6.0.0 (agent-browser) |
| **6. Provider model** | Provider abstraction + automatic fallback chain | v5.7.0 |
| **7. Knowledge graph** | Cross-agent knowledge graph | v6.0.0 |
| **8. Subagent RPC** | Zero-context-cost multi-step pipelines | v5.7.0 |
| **9. Trajectory capture** | Capture + replay + evaluate agent runs | v5.7.0 |
| **10. Approval gates + audit log** | Hard guardrails for tool execution | v6.0.0 |

## Closed feedback loops

### Loop A — Per-task improvement (every task)

```
Task starts
  ↓
Trajectory: tool call → model → result → model → ... → final response
  ↓
Capture:  .bizar/trajectories/<task-id>.jsonl  (turn-by-turn)
  ↓
Compress: 6-step compression (protect head/tail, summarize middle via LLM)
  ↓
Store:    .bizar/trajectories/<task-id>.jsonl.zst
  ↓
Skill extraction: "what reusable patterns did you see?"
  ↓
For each pattern: create or update .bizar/skills/<category>/<name>/SKILL.md
  ↓
Next task: include top-N relevant skills in system prompt
```

### Loop B — Per-session improvement (every session)

```
Session starts
  ↓
Memory prefetch: search .bizar/memory.db for similar past sessions
  ↓
Inject: <prior_work> block in system prompt
  ↓
Session runs (Loop A captures trajectory)
  ↓
Memory update: insert key facts into .bizar/memory.db
  ↓
User profile: update .bizar/users/<id>/profile.json
  ↓
Project profile: update .bizar/projects/<hash>/profile.json
```

### Loop C — Per-week curation (every week)

```
Curator cron fires (Saturday 2am)
  ↓
Read last 7 days of trajectories + skills
  ↓
For each skill: check usage count, last-used date
  ↓
Archive: skills with use_count == 0 for 90+ days
  ↓
Consolidate: skills with overlapping purpose merge
  ↓
Update: stale skills get a "needs-review" tag
  ↓
Report: .bizar/curator/weekly-<date>.md
```

## Phased milestones

### Phase 1 — Foundation (v6.0.0) ✅ SHIPPED

**Goal:** Bizar is the smallest serious multi-agent coding harness with a
closed learning loop.

| Deliverable | Status |
| --- | --- |
| Cline rewrite (OpenCode → Cline) | ✅ shipped (v5.6.0-beta.1) — historical, superseded by v6.3.0 Claude Code migration |
| All 22 tools use `createTool` from `@cline/sdk` | ✅ shipped |
| 4 + 2 safety hooks (beforeTool, afterTool, beforeModel, onEvent + curator + flush) | ✅ shipped |
| In-process ClineCore (no subprocess) | ✅ shipped (DEC-002) |
| In-process memory vault | ✅ shipped (DEC-003) |
| Cline agent teams (`bizar_spawn_team`) | ✅ shipped (DEC-004) |
| Kanban board (5 columns + team badge) | ✅ shipped (DEC-006) |
| DANGEROUS_PATTERNS approval gate (36 patterns) | ✅ shipped (DEC-007) |
| Skill curator (closed learning loop) | ✅ shipped (DEC-008) |
| Pre-compaction memory flush | ✅ shipped (DEC-009) |
| Knowledge graph query tools (3 tools) | ✅ shipped (DEC-010) |
| Harness engineering audit at 73/73 | ✅ shipped |
| Claude Code migration (Cline → Claude Code) | ✅ shipped (v6.3.0) |

**Test gate:** ✅ 656/658 plugin + 71/74 SDK + 27/27 E2E + 73/73 audit

### Phase 2 — Capability expansion (v5.7.0) — IN PROGRESS

**Goal:** Bizar is the Claude Code-native multi-agent coding harness for long-horizon coding.

| Deliverable | Status |
| --- | --- |
| Provider profile + fallback chain | ⏳ next |
| Knowledge graph query-tool surface polish | ✅ v6.0.0 |
| Subagent RPC (zero-context-cost pipelines) | ⏳ |
| Approval gates + audit log extension | ✅ v6.0.0 (gate done) |
| Trajectory capture + evaluation harness | ⏳ |
| Self-healing browser automation (agent-browser) | ⏳ **next** |
| Cline agent team progress on kanban | ⏳ |

**Test gate:** Phase 2 long-horizon eval suite (3-5 scenarios, 1-2 hours
each) passes at 70%+ completion.

**Success metric:** Bizar runs 4-hour tasks end-to-end without human
intervention. Provider fallback works (kill primary mid-task).

### Phase 3 — Differentiation (v5.8.0) — UPCOMING

**Goal:** Bizar is uniquely valuable for autonomous, long-horizon,
self-improving coding.

| Deliverable | Status |
| --- | --- |
| Scheduler (cron + on-exit) | ⏳ |
| Multi-phase Hands (3+ examples) | ⏳ |
| Terminal backends (Docker + SSH) | ⏳ |
| MCP server exposure | ⏳ |

**Test gate:** All Phase 2 tests pass + 24-hour unsupervised scenario
runs successfully.

**Success metric:** Bizar has ≥50 active skills, ≥3 multi-phase Hands,
≥2 terminal backends, and an MCP server is in use by ≥2 external agents.

### Phase 4 — Long-horizon master (v6.0.0 — far future)

**Goal:** Bizar is the autonomous long-horizon coding platform.

| Deliverable | Status |
| --- | --- |
| Weeks-long task execution | ⏳ |
| 5x reduction in human-in-the-loop cycles | ⏳ |
| 80%+ autonomy on Tier 1 work | ⏳ |
| MTTR < 30s for provider/process crashes | ⏳ |
| 50+ skills library with self-curation | ⏳ |

## Concrete metrics

### Autonomy

| Metric | Target | Current | Status |
| --- | --- | --- | --- |
| Tasks completed without human intervention (Tier 1) | 80%+ | TBD | ⏳ |
| Mean time to failure recovery | <30s | ~5s | ✅ |
| False-positive escalation rate | <5% | TBD | ⏳ |

### Long-horizon

| Metric | Target | Current | Status |
| --- | --- | --- | --- |
| Maximum task duration | 8h agent / 24h wall | 1h typical | ⏳ |
| 1-4h task completion rate | 70%+ | TBD | ⏳ |
| Crash recovery success rate | 95%+ | ~95% | ✅ |
| Token cost per typical refactor | <$50 | ~$5 | ✅ |

### Looping

| Metric | Target | Current | Status |
| --- | --- | --- | --- |
| Skills created per week (after week 4) | 5-20 | TBD | ⏳ |
| Skill reuse rate | 30%+ | TBD | ⏳ |
| Skill quality (when reviewed) | 90%+ useful | TBD | ⏳ |

## Audit

Every phase ends with the full harness engineering audit:

```sh
make check           # tsc + tests
make e2e             # real plugin load + tools + hooks
make check-arch      # arch-rules.json enforcement (currently 7 rules)
make clean-check     # 5-dimension exit gate
bash tools/audit-harness.sh .    # 73-component audit
```

### Audit score by version

| Version | Audit score |
| --- | --- |
| v5.5.6 | 65/73 |
| v5.6.0-beta.1 | 73/73 |
| v5.6.0-beta.6 | **73/73** + console violations fixed |
| v5.6.0 (stable, target) | 73/73 + 80%+ Phase 2 metrics |

## Documentation map

| Doc | Purpose |
| --- | --- |
| [README.md](README.md) | User-facing overview |
| [MILESTONES.md](MILESTONES.md) | **THIS FILE** — strategic roadmap |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | **Tactical roadmap + current state** |
| [AGENTS.md](AGENTS.md) | Agent entry point + hard constraints |
| [PROGRESS.md](PROGRESS.md) | Live cross-session state |
| [DECISIONS.md](DECISIONS.md) | Architectural decisions |
| [feature_list.json](feature_list.json) | Machine-readable features |
| [docs/INDEX.md](docs/INDEX.md) | Topic + role-based doc map |
| [docs/architecture.md](docs/architecture.md) | Layer model + module map |
| [docs/safety.md](docs/safety.md) | DANGEROUS_PATTERNS reference |
| [docs/curator.md](docs/curator.md) | Skill curator reference |
| [docs/graph-tools.md](docs/graph-tools.md) | Knowledge graph tools |
| [docs/migration-guide.md](docs/migration-guide.md) | OpenCode → Cline upgrade (historical) |
| [docs/code-review.md](docs/code-review.md) | Code review findings |
| [docs/decisions/](docs/decisions/) | 10 ADRs |

## See also

- [research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md](research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md) —
  the 12-item improvement plan this milestone map is derived from
- https://github.com/walkinglabs/awesome-harness-engineering — the
  curated list of 200+ agent-harness projects we cross-referenced
- https://github.com/vercel-labs/agent-browser — the browser
  automation CLI for AI agents
- https://docs.claude.com/claude-code — Claude Code documentation
