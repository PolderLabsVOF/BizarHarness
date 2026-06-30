# .bizar

BizarHarness project data folder. Stores agent-generated artifacts per project.

## Contents

| File | Purpose | Created By |
|---|---|---|
| `PROJECT.md` | Living project description — name, stack, architecture, conventions | @mimir (first), @heimdall (updates) |
| `AGENTS_SELF_IMPROVEMENT.md` | Lessons learned from each task, active patterns | @heimdall |
| `PRE_PUSH_NOTES.md` | Pre-release checklist | @heimdall |
| `DESIGN.md` | Design system tokens and visual guidelines (optional) | @baldr |

## Directory layout

```
.bizar/
├── PROJECT.md              Living project description
├── AGENTS_SELF_IMPROVEMENT.md   Lessons learned from each task
├── PRE_PUSH_NOTES.md       Pre-release checklist
├── README.md               This file
├── memory.json             Bizar Memory Service config (gitignored)
├── activity.log            Agent activity log (gitignored)
├── audit/                  Security audit reports
├── specs/                  External-system specifications (e.g. bizar-remote)
├── architecture/           Plugin architecture decisions (versioned)
├── research/               Research notes and investigation documents
├── notes/                  Working notes and observations
├── artifacts/              Visual plan artifact outputs
├── plans/                  Visual plan directories
├── screenshots/            E2E test screenshots
├── scripts/                Agent/dev utility scripts
├── graph/                  Graphify knowledge graph (gitignored)
├── sim-logs/               Simulation run logs (gitignored)
├── lightrag/               LightRAG working directory (gitignored)
└── handoffs/               Per-session handoff documents (gitignored)
```

Created automatically by agents when needed.
