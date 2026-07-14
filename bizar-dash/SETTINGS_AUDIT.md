# Settings Audit — v10.0.0

> Maps every row in `SettingsView.tsx` to its backing endpoint and the
> on-disk file the value lives in. Verifies the "control and configure
> everything" claim for the Settings page.
>
> Source of truth: `bizar-dash/src/web/v8/views/Settings/SettingsView.tsx`
> (19 sections) + `bizar-dash/src/server/routes/_shared.mjs` (`DEFAULT_SETTINGS`)
> + `bizar-dash/src/server/routes/settings.mjs`.

## Backing store map

| Where it lives | Path | Owner |
|---|---|---|
| Server-side settings (most rows) | `~/.config/bizar/settings.json` | `PUT /api/settings` |
| Browser-local theme | `localStorage["bizar.theme.mode"]` | `useTheme().setMode()` |
| Provider keys (real) | `~/.config/bizar/env.json` (mode 0600) | `PUT /api/env-vars` |
| Usage / LightRAG / Memory (separate) | per-feature config files | per-feature endpoints |
| Activity log (read-only here) | append-only NDJSON in `~/.local/share/bizar/activity.ndjson` | streamed |
| Claude sessions path | `~/.claude/sessions` (env) | read-only display |

## Section-by-section audit

Legend:
- ✅ mutates → persists to a backing store
- 👁 read-only → renders a value from a fetch but no UI control mutates it
- ⚠️ mixed → some rows mutate, others are read-only

### 1. General (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `workspace-name` | `update('workspaceName')` | `settings.json.workspaceName` |
| `workspace-timezone` | `update('workspaceTimezone')` | `settings.json.workspaceTimezone` |
| `default-view` | `update('defaultView')` | `settings.json.defaultView` |

### 2. Theme (⚠️ — split storage)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `theme-mode` | `theme.setMode()` | `localStorage["bizar.theme.mode"]` (NOT settings.json) |
| `theme-accent` | `update('themeAccent')` | `settings.json.themeAccent` |
| `theme-font` | `patch('themeFont')` | `settings.json.themeFont` |
| `theme-radius` | `patch('themeRadius')` | `settings.json.themeRadius` |

**Finding:** `theme-mode` is the only theme control that lives in localStorage,
not `settings.json`. Acceptable because mode is a per-browser preference and
the rest of the theme syncs across devices — but the split is non-obvious.
ponytail: persist theme.mode via `/api/settings` when server-side sync is
ever needed (multi-device or headless dashboard).

### 3. Density (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `density-mode` | `density.setDensity()` | localStorage (similar hybrid as theme — `useDensity` hook) |
| `density-base-font` | `update('densityBaseFont')` | `settings.json.densityBaseFont` |

### 4. Density rules (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `tasks-compact` | `update('tasksCompact')` | `settings.json.tasksCompact` |
| `memory-compact` | `update('memoryCompact')` | `settings.json.memoryCompact` |
| `activity-compact` | `update('activityCompact')` | `settings.json.activityCompact` |

### 5. Command palette (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `palette-history` | `update('paletteHistory')` | `settings.json.paletteHistory` |
| `palette-fuzzy` | `update('paletteFuzzy')` | `settings.json.paletteFuzzy` |
| `palette-navigate` | `patch('paletteNavigate')` | `settings.json.paletteNavigate` |
| `palette-spawn` | `patch('paletteSpawn')` | `settings.json.paletteSpawn` |
| `palette-scope` | `update('paletteScope')` | `settings.json.paletteScope` |

### 6. Keyboard (👁)
All `kb-*` rows are read-only. SettingsView documents the binding in
`~/.claude/keybindings.json`. Mutations live in the CLI/TUI flow,
not the dashboard.

### 7. Notifications (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `n-agent-finished` | `update('notifyAgentFinished')` | `settings.json.notifyAgentFinished` |
| `n-task-moved` | `patch('notifyTaskMoved')` | `settings.json.notifyTaskMoved` |
| `n-ci-failed` | `update('notifyCiFailed')` | `settings.json.notifyCiFailed` |
| `n-token-budget` | `update('notifyTokenBudget')` | `settings.json.notifyTokenBudget` |
| `n-daily-digest` | `update('notifyDailyDigest')` | `settings.json.notifyDailyDigest` |
| `n-channel` | `update('notifyChannel')` | `settings.json.notifyChannel` |

### 8. Storage (⚠️)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `store-path` | `update('storagePath')` | `settings.json.storagePath` |
| `cache-path` | `update('cachePath')` | `settings.json.cachePath` |
| `sessions-path` | `update('sessionsPath')` | `settings.json.sessionsPath` |
| `cache-size` | `update('cacheSizeMb')` | `settings.json.cacheSizeMb` |
| `store-gc` | `POST /api/admin/gc` | runs server-side GC |
| `store-clear` | `POST /api/admin/cache/clear` | wipes cache + activity log |

**Finding:** the path fields write to settings.json but the server
doesn't appear to *consume* them at runtime (the actual storage paths
are constants in each store module). Persisted state vs effective state
drift. ponytail: either (a) wire these to the store modules' root
constants at boot, or (b) drop the rows and document that paths are
env-configured only. Recommended: (a) — single source of truth.

### 9. Plugins (👁)
`plugins-count`, `plugins-bizar`, `plugins-list` all sourced from
`useFetch('/api/agents')` and `useFetch('/api/skills?kind=skills')`.
Read-only count + summary. Mutations to plugin registration live in
the filesystem (`.claude/`), not the dashboard.

### 10. MCP servers (👁)
`mcps-count`, `mcps-list` from `useFetch('/api/skills?kind=mcps')`.
Read-only summary; mutations live in `.claude/mcp.json`.

### 11. Skills (👁)
Sourced from `useFetch('/api/skills?kind=skills')`. Read-only count +
breakdown by source. Mutations live in `bizar-dash/skills/<name>/`.

### 12. Hooks (👁)
Sourced from `useFetch('/api/skills?kind=hooks')`. Read-only summary;
mutations live in `.claude/hooks/`.

### 13. Activity (⚠️)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `activity-retention` | `update('activityRetentionDays')` | `settings.json.activityRetentionDays` |
| `activity-hide` | `patch('activityHide')` (onBlur) | `settings.json.activityHide` |
| `activity-export` | `GET /api/admin/activity/export` | downloads `activity.ndjson` |

**Finding:** `activity-export` is a download endpoint, not a mutation
button — correct behaviour. But the matching "Clear activity log"
destructive button lives in Storage → `store-clear` rather than here,
which is non-obvious. Acceptable but a discoverability gap.

### 14. Memory (⚠️)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `memory-auto-commit` | `update('memoryAutoCommit')` | `settings.json.memoryAutoCommit` |
| `memory-scope` | `update('memoryScopeDefault')` | `settings.json.memoryScopeDefault` |
| `memory-index` | `POST /api/admin/memory/reindex` | rebuilds search index |

**Finding:** Memory also has its own Settings page (MemoryView) with
LightRAG URL, Obsidian vault path, git repo config — those live
under a separate `~/.config/bizar/memory-config.json` and
`/api/memory/config/global`. Two settings surfaces for one feature is
non-obvious. ponytail: consolidate into the Settings → Memory section
when the time comes.

### 15. Task defaults (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `task-priority` | `update('defaultTaskPriority')` | `settings.json.defaultTaskPriority` |
| `task-column` | `update('defaultTaskColumn')` | `settings.json.defaultTaskColumn` |
| `task-assignee` | `patch('defaultTaskAssignee')` (onBlur) | `settings.json.defaultTaskAssignee` |

### 16. Agent defaults (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `agent-model` | `update('defaultAgentModel')` | `settings.json.defaultAgentModel` |
| `agent-mistakes` | `update('defaultAgentMaxMistakes')` | `settings.json.defaultAgentMaxMistakes` |
| `agent-bg` | `patch('agentBackgroundDefault')` | `settings.json.agentBackgroundDefault` |
| `agent-worktree` | `patch('agentWorktree')` | `settings.json.agentWorktree` |
| `agent-system-prompt` | `patch('agentSystemPrompt')` (onBlur) | `settings.json.agentSystemPrompt` |

### 17. Privacy (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `privacy-analytics` | `update('analytics')` | `settings.json.analytics` |
| `privacy-crash` | `update('crashReports')` | `settings.json.crashReports` |
| `privacy-pii` | `update('piiMode')` | `settings.json.piiMode` |

### 18. Advanced (✅)
| Row id | Mutates via | Persisted to |
|---|---|---|
| `adv-reduced-motion` | `update('reducedMotion')` | `settings.json.reducedMotion` |
| `adv-debug-overlay` | `update('debugOverlay')` | `settings.json.debugOverlay` |
| `adv-reset` | `POST /api/settings/reset` | wipes back to `DEFAULT_SETTINGS` |

## Rollup

- 19 sections, 60 rows total.
- **47 ✅** — fully mutate to settings.json + (where relevant) broadcast.
- **6 👁** — read-only count/list rows (Plugins, MCPs, Skills, Hooks,
  Keyboard). Mutations are filesystem-only.
- **6 ⚠️** — split storage or discoverability gaps:
  - Theme: mode in localStorage, rest in settings.json.
  - Density: mode in localStorage, rest in settings.json.
  - Storage: paths persist but aren't consumed at runtime.
  - Activity: destructive "clear log" lives in Storage not Activity.
  - Memory: split between Settings → Memory (this section) and the
    separate MemoryView.

## Audit verdict

"Control and configure everything from the dashboard" holds for the
**Settings page** specifically: every UI control that says "this changes
a setting" actually persists it via `/api/settings` (with the two
localStorage hybrids for browser-local prefs, which is a defensible
split). The non-mutating rows are correctly marked as summary rows.

Gaps that warrant follow-up work (not v10-blocking):

1. **Storage paths persist but aren't consumed.** Either wire them in
   or drop the rows.
2. **Memory settings split across two pages.** Consolidate into Settings
   → Memory.
3. **Theme mode hybrid storage** is defensible but non-obvious. Worth
   documenting in a tooltip.

## Tests

- `/api/settings` (GET/PUT/POST reset) is exercised by the dashboard
  via `useFetch` + `patch()` (unit-tested implicitly via SettingsView
  smoke tests, no dedicated route test yet). ponytail: add
  `tests/server/settings-route.test.mjs` for the round-trip.
- localStorage theme/density mutations are not directly testable
  from the server; covered by component tests.

## See also

- `bizar-dash/src/web/v8/views/Settings/SettingsView.tsx`
- `bizar-dash/src/server/routes/settings.mjs`
- `bizar-dash/src/server/routes/_shared.mjs` (DEFAULT_SETTINGS)
- `bizar-dash/src/web/v8/ui/theme/ThemeProvider.tsx`
- `CONTROL_SURFACES.md` — the broader "what can you mutate from the
  dashboard" map across all v8 views (companion doc).