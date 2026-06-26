# Graph Report - .  (2026-06-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1199 nodes · 2556 edges · 73 communities (68 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8292127c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 54 edges
2. `wrap()` - 49 edges
3. `useToast()` - 44 edges
4. `api` - 40 edges
5. `useModal()` - 33 edges
6. `Snapshot` - 29 edges
7. `createApiRouter()` - 27 edges
8. `Button` - 24 edges
9. `formatRelative()` - 22 edges
10. `Settings` - 21 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `createServer()`  [INFERRED]
  tests/smoke-v2.mjs → src/server/server.mjs
- `main()` --calls--> `createV2Router()`  [EXTRACTED]
  tests/smoke-v2.mjs → src/server/routes-v2/index.mjs
- `startDashboard()` --calls--> `createServer()`  [INFERRED]
  src/cli.mjs → src/server/server.mjs
- `runTui()` --calls--> `createServer()`  [INFERRED]
  src/cli.mjs → src/server/server.mjs
- `tick()` --calls--> `broadcast()`  [INFERRED]
  src/server/bg-poller.mjs → src/server/server.mjs

## Import Cycles
- 2-file cycle: `src/server/dialog-poller.mjs -> src/server/server.mjs -> src/server/dialog-poller.mjs`
- 2-file cycle: `src/server/bg-poller.mjs -> src/server/server.mjs -> src/server/bg-poller.mjs`

## Communities (73 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (39): autoTitleFromContent(), launchBrowser(), autoTitleFromContent(), card(), DashboardSocket, __dirname, __filename, HOME (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (28): createActivityRouter(), createAgentsRouter(), createArtifactsRouter(), createAuthRouter(), createBackgroundRouter(), createChatRouter(), createConfigRouter(), createDiagnosticsRouter() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (30): Card(), CardMeta(), CardProps, CardTitle(), EmptyState(), EmptyStateProps, Spinner(), SpinnerProps (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (25): BgStatusBadge(), STATUS_KIND, STATUS_LABELS, CollapsibleSection(), Props, MobileListItem(), Props, StatusBadge() (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (33): dependencies, blessed, chokidar, cors, croner, express, fuse.js, lucide-react (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (21): ArtifactMeta, ArtifactViewer(), fetchRawContent(), formatBytes(), getArtifactContentUrl(), openArtifactViewer(), Props, Task (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (27): useModal(), Notifications(), useToast(), Activity(), Agents(), BackgroundAgents(), Chat(), Config() (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (19): KillConfirmDialogProps, openKillConfirmDialog(), FOCUSABLE_SELECTOR, ModalApi, ModalContext, ModalProps, ModalProvider(), OpenModal (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (19): applyThemeTokens(), BudgetCheck, Canvas, CanvasElement, CanvasViewport, CustomTheme, DiagnosticItem, DialogComponent (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (17): requireAuth(), startBgRetryLoop(), stopBgRetryLoop(), broadcastDialog(), broadcast(), buildSnapshot(), buildSnapshotSafe(), createServer() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): Button, ButtonProps, ButtonSize, ButtonVariant, CmdEntry, HelpDialogProps, ICONS, Props (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (16): CanvasContextMenu(), ContextMenuItem, ContextMenuState, Props, CanvasComment, CanvasConnection, truncate(), CanvasElementView() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (17): MobileBottomSheet(), Props, Notification, MobileTopbar(), Props, TAB_LABELS, HistoryEntry, HistoryEvent (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.17
Nodes (17): ALLOWED_BINARIES, auditLogPath(), authorizeFsPath(), authorizeSpawn(), computeModHash(), createAuditWriter(), createModSecurityContext(), DEFAULT_PERMISSIONS (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (17): ChatMessage, Mod, Snapshot, AgentDetailView(), MobileView, PlanDetailView(), TABS, TaskDetailView() (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (11): ConfigResponse, Diagnostics, AutoDetectBanner(), AutoDetectResult, McpDraft, NAV_ITEMS, NavId, OC_SECTIONS (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (18): Schedule, ACTIONS, DOWS, EditorState, formatNextShort(), formatRel(), HOURS, humanizeSchedule() (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (14): agentsStore, artifactsStore, plansStore, projectsStore, appendActivity(), atomicWriteJson(), genShortId(), HOME (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (16): HIDDEN_PATH, atomicWriteJson(), DASH_PACKAGE_JSON, DASHBOARD_VERSION, DEFAULT_SETTINGS, HOME, mergeSettings(), OPENCODE_DIR (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (20): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module (+12 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (14): ACTIONS, buildInitialState(), DOW_OPTIONS, EditorState, HOUR_OPTIONS, humanizeSchedule(), INTERVAL_UNITS, MINUTE_OPTIONS (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (8): backgroundStore, BG_DIRS, HOME, BG_DIRS, HOME, pickBgDir(), taskDelegator, writeBgStateFile()

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (19): description_i18n, ar, de, en, es, fr, id, it (+11 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (19): title_i18n, ar, de, en, es, fr, id, it (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.13
Nodes (12): AuditDialogProps, AuditResult, Props, RESULT_TYPE_BY_SCOPE, SCOPES, SearchModal(), api, ApiError (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (13): MobileBottomNav(), MobileTab, Props, MobileSearchModal(), Props, Scope, SCOPE_ICONS, SCOPES (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (10): _cache, CacheEntry, FileBrowser(), FileBrowserProps, pathSegments(), sortEntries(), DirectoryEntry, DirectoryListing (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (15): Overview, ProjectRecord, ScanResult, formatRelative(), ActivityFeedItem(), activityIcon(), activityNavTarget(), activitySeverity() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (12): debounce(), hashText(), priorityColors, hasTaskArtifacts(), hasTaskChat(), MobileTasks(), NEXT_STATUS, Props (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.24
Nodes (14): checkWebSocketAuth(), ensureSecretFileMode(), EXTRA_ALLOWED_ORIGINS, getDirectPeerAddress(), getForwardedPeerAddress(), getOrCreateSecret(), isAllowedDashboardOrigin(), isAllowedDashboardOriginForRequest() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (14): deriveAbsoluteBgLogPath(), isBrokenBgLogPath(), atomicWriteJson(), BG_DIRS, _BG_RETRY_INTERNAL, buildReplayPromptText(), findBgFile(), HOME (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.23
Nodes (12): buildAuthHeader(), createOpencodeSession(), extractContentFromOpencodeMessage(), finalizeText(), HOME, isLoopbackHostname(), isSafeServeBaseUrl(), listOpencodeMessages() (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.19
Nodes (11): OPENCODE_JSON, safeReadJSON(), atomicWriteJson(), HOME, loadConfig(), mcpsStore, OPENCODE_AGENTS_DIR, OPENCODE_JSON (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (13): AGENTS_DIR, buildHierarchyTree(), defaultStatus(), fmVal(), HIERARCHY, HOME, isStuck(), parseFrontmatter() (+5 more)

### Community 34 - "Community 34"
Cohesion: 0.20
Nodes (15): atomicWriteJson(), ensureProjectsDir(), HOME, loadRegistry(), OPENCODE_DIR, PROJECT_ROOT_MARKERS, projectDir(), projectIdFromPath() (+7 more)

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (5): WsStatus, buildWsUrl(), Handler, StatusHandler, Ws

### Community 36 - "Community 36"
Cohesion: 0.21
Nodes (7): v2BasicAuth(), createV2EventsRouter(), createV2HealthRouter(), createV2Router(), __dirname, __filename, createV2SessionsRouter()

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (14): author, name, url, compat, agentSkills, description, homepage, license (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.16
Nodes (10): AuditDialog(), CommandDialog(), HelpDialog(), KNOWN_TEMPLATES, PlanCreateDialog(), PlanCreateDialogProps, PlanListDialog(), VisualPlanDialog() (+2 more)

### Community 39 - "Community 39"
Cohesion: 0.16
Nodes (10): MobileModal(), Props, Agent, Plan, CATEGORIES, CATEGORY_COLORS, MobileAgents(), Props (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.20
Nodes (9): defaultAllowedRoots(), FALLBACK_LOG_DIR, getActualBgLogPath(), getBgLogDir(), isDotRoot(), normalizeRoots(), FALLBACK, HOME (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.15
Nodes (13): SettingsResponse, TailscaleStatus, ActivityLogCard(), FONT_FAMILIES, formatCountdown(), LAYOUTS, PairDeviceCard(), PairSession (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (11): BIZAR_HOME, checkPidAlive(), DASH_PACKAGE_JSON, diagnosticsStore, HOME, parseLogTs(), readRecentErrors(), SERVICE_LOG (+3 more)

### Community 43 - "Community 43"
Cohesion: 0.16
Nodes (7): modsLoader, HOME, searchStore, SETTINGS_DESCRIPTIONS, SETTINGS_FILE, PACKAGES, updateStore

### Community 44 - "Community 44"
Cohesion: 0.23
Nodes (13): extractArtifactFromMessage(), killTmuxFor(), _pollerInternals, processedArtifacts, recordPollerFailure(), scanForArtifact(), startBgPoller(), stopBgPoller() (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (10): atomicWriteJson(), atomicWriteText(), BIZAR_HOME, getReadSet(), HOME, loadReadSet(), LOG_FILE, READ_FILE (+2 more)

### Community 46 - "Community 46"
Cohesion: 0.21
Nodes (12): checkBudget(), HOME, isPrivateHostname(), LOG_DIR, LOG_FILE, logLine(), runAction(), runAgentAction() (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.14
Nodes (14): od, capabilities, inputs, kind, mode, pipeline, platform, preview (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.18
Nodes (7): _pollerInternals, startDialogPoller(), tick(), DIALOG_DIR, dialogStore, HOME, KNOWN_COMPONENTS

### Community 50 - "Community 50"
Cohesion: 0.26
Nodes (8): readActiveProjectId(), atomicWriteJson(), computeNextRun(), loadSchedules(), parseInterval(), safeReadJSON(), saveSchedules(), schedulesStore

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (8): atomicWriteJson(), CATEGORIES, execFileP, HOME, safeExec(), saveState(), skillsStore, STATE_FILE

### Community 52 - "Community 52"
Cohesion: 0.22
Nodes (6): emptyCanvas(), genId(), GLOBAL_PLANS_DIR, HOME, sanitizeCanvas(), sanitizeElement()

### Community 53 - "Community 53"
Cohesion: 0.25
Nodes (9): DEFAULT_DIR, DEFAULT_FILE, HOME, LEGACY_FILE, loadOrCreateAuth(), writeAuthFile(), main(), test() (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (8): agents, getStatus(), killAgent(), list(), onExit(), _resetForTests(), spawnAgent(), HAS_OPENCODE

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (6): ICONS, Toast, ToastApi, ToastContext, ToastKind, ToastProvider()

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (8): applyTheme(), ThemeName, formatCountdown(), MobileSettings(), PairSession, PRESET_ACCENTS, Props, THEMES

### Community 57 - "Community 57"
Cohesion: 0.28
Nodes (5): ARTIFACTS_DIR, HOME, isWithinArtifactsDir(), resolveBodyPath(), sanitizeMeta()

### Community 58 - "Community 58"
Cohesion: 0.28
Nodes (6): execFileP, HOME, SETTINGS_FILE, tailscaleStatus(), tailscaleStore, tailscaleVersion()

### Community 59 - "Community 59"
Cohesion: 0.25
Nodes (6): AgentCard(), CATEGORIES, categoryColor(), MODELS, Props, TOOL_OPTIONS

### Community 60 - "Community 60"
Cohesion: 0.36
Nodes (4): buildAllowedRootsFromSettings(), resolveSafePath(), buildAllowedRoots(), resolveTargetUnderParent()

### Community 61 - "Community 61"
Cohesion: 0.25
Nodes (6): ActivityItem, EVENT_KINDS, EventKind, KIND_LABELS, MobileActivity(), Props

### Community 62 - "Community 62"
Cohesion: 0.29
Nodes (5): activityLog, atomicWriteText(), HOME, LOG_FILE, rotateIfNeeded()

### Community 63 - "Community 63"
Cohesion: 0.38
Nodes (5): gc(), mint(), pairTokenMiddleware(), tokens, verify()

### Community 65 - "Community 65"
Cohesion: 0.50
Nodes (4): COLOR, JsonHighlight(), Token, tokenize()

### Community 67 - "Community 67"
Cohesion: 0.40
Nodes (5): assets, designSystem, skills, primary, context

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (5): useCase, en, zh-CN, exampleOutputs, query

## Knowledge Gaps
- **408 isolated node(s):** `$schema`, `specVersion`, `name`, `title`, `zh-CN` (+403 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pad()` connect `Community 0` to `Community 16`, `Community 20`?**
  _High betweenness centrality (0.284) - this node is a cross-community bridge._
- **Why does `autoTitleFromContent()` connect `Community 0` to `Community 3`, `Community 28`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Why does `autoTitleFromContent()` connect `Community 0` to `Community 21`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **What connects `$schema`, `specVersion`, `name` to the rest of the system?**
  _408 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06079664570230608 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14102564102564102 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09716599190283401 - nodes in this community are weakly interconnected._