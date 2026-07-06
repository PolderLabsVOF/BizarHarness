// src/lib/types.ts — TypeScript types for the Bizar dashboard.
// All shapes here mirror the JSON returned by src/server/api.mjs.

/**
 * Dialog component types that can be rendered in the dashboard.
 * Aligned with `DialogComponent` in plugins/bizar/src/commands.ts.
 * If you add a new component here, mirror it there and in
 * dialog-store.mjs KNOWN_COMPONENTS.
 */
export type DialogComponent = 'visual-artifact' | 'visual-plan' | 'plan-create' | 'plan-list' | 'artifact-create' | 'artifact-list' | 'help' | 'audit' | 'generic';

/**
 * A modal dialog request emitted by the slash-command plugin and
 * delivered to the dashboard via the `dialog:show` WS message.
 * Thor's plugin code emits these; the desktop Chat view (sibling scope)
 * mounts a component keyed by `component` and seeds it with `data`.
 */
export type DialogDescriptor = {
  id: string;
  title: string;
  /** Original slash command, e.g. "/visual-plan on". */
  command: string;
  /** Component key the Chat view mounts. One of: 'visual-plan' | 'plan-create' | 'plan-list' | 'help' | 'audit' | 'generic' */
  component: DialogComponent;
  /** Component-specific payload. Shape depends on `component`. */
  data?: Record<string, unknown>;
};

export type ThemeName = 'dark' | 'light' | 'system';

export type ThemeSettings = {
  mode: ThemeName;
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  fontFamily: string;
  fontSize: number;
  compactMode: boolean;
  animations: boolean;
};

export type UiSettings = {
  layout: 'topnav' | 'sidebar' | 'both';
  showHeader: boolean;
  showStatusBar: boolean;
  defaultTab: string;
  accentColor?: string;
};

export type Agent = {
  name: string;
  description: string;
  model: string;
  mode: string;
  file: string;
  path: string;
  mtime: number;
  tools?: string[];
  tags?: string[];
  category?: string;
  color?: string;
  prompt?: string;
  permissions?: unknown;
  // v3.1.0 — runtime status (server-attached)
  status?: 'idle' | 'working' | 'error' | 'stuck' | string;
  currentTaskId?: string | null;
  currentTaskStartedAt?: number;
  lastSeen?: number;
  heartbeat?: number;
  lastError?: { ts: number; message: string } | null;
  lastTask?: { id: string; finishedAt: number; status: string } | null;
  successRate?: number;
  tasksTotal?: number;
  tasksSucceeded?: number;
  tasksFailed?: number;
  isStuck?: boolean;
  // v3.2.0 — agent hierarchy (parent/level/role).
  level?: number;
  parent?: string | null;
  role?: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  lastAccessed?: string;
  status: 'active' | 'inactive' | 'error' | string;
  summary?: string;
};

export type ProjectsResponse = {
  projects: ProjectRecord[];
  active: string | null;
};

/** A single entry returned by GET /api/fs */
export type DirectoryEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
};

/** Response shape for GET /api/fs */
export type DirectoryListing = {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  /** True when the directory had more than 500 entries (capped). */
  truncated?: boolean;
  /** Actual entry count when truncated. */
  totalEntries?: number;
};

/** Request shape for POST /api/fs/mkdir */
export type MkdirRequest = { parent: string; name: string };

/** Response shape for POST /api/fs/mkdir */
export type MkdirResponse = { path: string; parent: string; name: string };

/** Response shape for POST /api/projects/scan */
export type ScanResult = {
  added: Array<{ id: string; path: string; name: string }>;
  skipped: number;
  scanned: number;
  error?: string;
};

// v3.19.0 — Artifact (formerly Plan). A user-facing proposal that an agent
// creates to surface design choices, options, or implementation paths.
// The user reviews it and either approves, rejects, or modifies.
export type Artifact = {
  /** Unique slug — used in the file path (`plans/<slug>/`) and URL. */
  slug: string;
  /** Human-readable title shown in the artifacts list. */
  title: string;
  /** One-line summary shown under the title. */
  description: string;
  /** Lifecycle status. */
  status: 'draft' | 'pending-review' | 'approved' | 'rejected' | 'archived';
  /** What kind of artifact this is — drives the renderer. */
  kind: 'design' | 'plan' | 'spec' | 'mockup' | 'report' | 'freeform' | string;
  /** Agent or user that created this artifact. */
  author: string;
  /** User's decision on this artifact. */
  decision: 'pending' | 'approved' | 'rejected' | 'modified' | null;
  /** Optional user-supplied notes when approving/rejecting. */
  decisionNote: string | null;
  /** Filesystem source. */
  source: 'worktree' | 'global' | string;
  /** Element count (visual elements) — for plan-like artifacts. */
  elementCount: number | null;
  /** Comment count. */
  commentCount: number | null;
  /** Last-modified time. */
  mtime: number;
  /** Optional URL to the artifact's full view. */
  artifactUrl: string | null;
  /** Tags — free-form, used for filtering. */
  tags: string[];
};

export type CanvasElement = {
  id: string;
  type: string;
  title?: string;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status?: string;
};

export type CanvasConnection = {
  id: string;
  fromElementId?: string;
  from?: string;
  toElementId?: string;
  to?: string;
  label?: string;
};

export type CanvasComment = {
  id: string;
  elementId?: string;
  text: string;
  author: string;
  created: string;
  thread?: { author: string; text: string }[];
};

export type CanvasViewport = { x: number; y: number; zoom: number };

export type Canvas = {
  schemaVersion?: number;
  title: string;
  elements: CanvasElement[];
  connections: CanvasConnection[];
  comments: CanvasComment[];
  viewport: CanvasViewport;
};

export type ConfigResponse = {
  path: string;
  data: unknown;
  raw: string;
  exists: boolean;
};

export interface SystemLlmConfig {
  enabled: boolean;
  provider: string;     // e.g. "opencode"
  model: string;        // e.g. "opencode/deepseek-v4-flash-free"
  // api key is read from auth.json for the provider, not stored here
}

export type Settings = {
  theme: ThemeSettings;
  ui: UiSettings;
  defaultAgent: string;
  defaultModel: string;
  notifications: {
    onAgentComplete: boolean;
    onPlanApproval: boolean;
  };
  dashboard: {
    autoLaunchWeb: boolean;
    projectsDirectory?: string;
    allowedRoots?: string[];
  };
  service: {
    enabled: boolean;
    autostart: boolean;
  };
  about: {
    version: string;
    homepage: string;
    license: string;
  };
  agents: {
    maxParallel: number;
    stuckThresholdMs: number;
    autoRestart: boolean;
  };
  // v3.19.0 — Personalization (free-form text shown to agents).
  personalization: {
    displayName: string;
    role: string;
    team: string;
    aboutMe: string;
    preferences: string;
  };
  // v3.19.0 — Workflow toggles.
  workflow: {
    /** Allow agents to create / mutate artifacts. */
    artifactsEnabled: boolean;
    /** When true, agents make decisions themselves instead of asking. */
    agentsDecideAutonomously: boolean;
    /** Per-tab override for autonomy (chat input). */
    chatAutonomous: boolean;
  };
  // v3.21.0 — System LLM calls (auto-title, enhance-prompt, summarization).
  systemLlm?: SystemLlmConfig;
  // v4.5.0 — MiniMax Token Plan integration. `apiKey` is the user's
  // Subscription Key (NOT a pay-as-you-go API key). `groupId` is usually
  // 'default' for an individual team. `baseUrl` is the Token Plan host
  // (the remains endpoint lives on www.*, not api.*). `chatBaseUrl` is
  // the chat-completions host (api.*/v1).
  minimax?: {
    enabled: boolean;
    apiKey: string;
    groupId: string;
    baseUrl: string;
    chatBaseUrl: string;
  };
  // v5.0.0 — Headroom context compression settings.
  headroom?: HeadroomSettings;
};

export type HeadroomSettings = {
  enabled: boolean;
  autoInstall: boolean;
  port: number;
  host: string;
  outputShaper: boolean;
  telemetry: boolean;
  budget: number;
  backend: string;
  autoStart: boolean;
  autoWrap: boolean;
  routeAllProviders: boolean;
};

export type SettingsResponse = {
  path: string;
  data: Settings;
  exists: boolean;
};

export type OverviewCounts = {
  agents: number;
  plans: number;
  projects: number;
  sessions: number;
  activeProject?: string | null;
};

export type OverviewVersions = {
  node: string;
  platform: string;
  projectRoot: string;
  bizarRoot: string;
};

export type ActivityItem = {
  ts: string;
  kind: string;
  [k: string]: unknown;
};

export type Overview = {
  counts: OverviewCounts;
  recentActivity: ActivityItem[];
  versions: OverviewVersions;
  generatedAt: string;
};

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system' | string;
  content?: string;
  message?: string;
  agent?: string;
  ts?: string | number;
  pinned?: boolean;
};

export type ChatSession = {
  id: string;
  file: string;
  mtime: number;
  size: number;
  /** 'bizar' sessions come from the per-project .jsonl store; 'opencode' come from opencode.db */
  source?: 'bizar' | 'opencode';
  /** Filled when source === 'opencode' — the URL to open that session in the opencode web UI */
  opencodeUrl?: string;
  /** Display title; defaults to id when absent */
  title?: string;
};

export type ChatResponse = {
  messages: ChatMessage[];
  sessions: ChatSession[];
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: 'queued' | 'doing' | 'done' | 'blocked' | 'archived' | string;
  tags: string[];
  priority: 'low' | 'normal' | 'high' | string;
  assignee?: string | null;
  parent?: string | null;
  dependencies?: string[];
  timeSpent?: number;
  recurring?: { cron?: string; lastGenerated?: string; freq?: 'daily' | 'weekly' | 'monthly' | string } | null;
  attachments?: string[];
  comments?: { id: string; text: string; createdAt: string }[];
  activity?: { id: string; type: string; ts: string; data?: unknown }[];
  archived?: boolean;
  workedBy?: string | null;
  dueDate?: string | null;
  // v3.2.0 — main-task fields from the task delegator.
  subtasks?: string[];
  metadata?: Record<string, unknown> | null;
  // v3.3.0 — progress fields surfaced from metadata.
  progress?: number;
  currentStep?: string | null;
  progressAgent?: string | null;
  progressHistory?: { ts: string; progress: number; step: string | null; agent?: string | null }[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  _timerStart?: number;
};

export type Notification = {
  id: string;
  ts: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  message: string;
  source: string;
  title?: string;
  link?: string | null;
  read?: boolean;
  meta?: Record<string, unknown> | null;
};

export type NotificationStats = {
  total: number;
  unread: number;
  lastTs: string | null;
  counts: Record<string, number>;
};

export type NotificationsResponse = {
  notifications: Notification[];
  stats: NotificationStats;
};

export type CustomTheme = {
  name: string;
  colors: Partial<ThemeSettings>;
  createdAt?: string | null;
};

export type BudgetCheck = {
  /** Skip the run if at least this many bg tasks are already running or pending. */
  maxConcurrent?: number;
  /** When true, the runner consults `maxConcurrent` and skips the run if the budget is exceeded. */
  skipIfBudgetLow?: boolean;
};

export type ScheduleAction = {
  type: 'command' | 'agent' | 'webhook';
  target: string;
  /** Free-form prompt for `agent` actions — the text the agent will work from. */
  prompt?: string;
  /** Optional webhook method override (defaults to POST). */
  method?: string;
  /** Webhook body. May also carry `prompt` for an agent dispatch. */
  body?: unknown;
  /** Title used when this action dispatches an agent task. */
  title?: string;
  /** Display name override when dispatching. */
  name?: string;
};

export type Schedule = {
  id: string;
  name: string;
  type: 'cron' | 'interval' | 'once';
  /** For `cron`: a 5-field cron expression. For `interval`: a "30m" / "2h" / "1d" string. For `once`: an ISO datetime. */
  schedule: string;
  /** IANA timezone for `cron` schedules. Defaults to "UTC" when absent. */
  timezone?: string;
  action: ScheduleAction;
  /** Optional budget pre-flight: skip the run when too many bg tasks are already in flight. */
  budgetCheck?: BudgetCheck;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun: string | null;
  lastResult: 'success' | 'error' | 'skipped' | null;
  lastError: string | null;
  nextRun: string | null;
  history: { ts: string; result: string; error: string | null }[];
};

export type Mod = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  bizar: string;
  type: string;
  enabled: boolean;
  permissions: string[];
  entry: Record<string, string>;
  files: { category: string; name: string; path: string }[];
  path: string;
  installedAt: string | null;
};

export type Provider = {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
};

export type McpServer = {
  id: string;
  type?: 'local' | 'remote';
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: boolean;
  enabled: boolean;
};

export type DiagnosticItem = {
  line: string;
  ts: string | null;
};

export type Diagnostics = {
  version: string;
  uptime: number;
  uptimeMs: number;
  nodeVersion: string;
  platform: string;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  counts: {
    agents: number;
    plans: number;
    tasks: number;
    projects: number;
    activeProject: string | null;
    mods: number;
    schedules: number;
    providers: number;
    mcps: number;
  };
  errors: DiagnosticItem[];
  service: { running: boolean; pid?: number; error?: string };
};

export type TailscaleStatus = {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  backend: string;
  hostname: string;
  settings: { enabled: boolean; port: number; https: boolean; hostname: string };
};

// ────────────────────────────────────────────────────────────────────────
// v6.0.0 — Doctor page types
// ────────────────────────────────────────────────────────────────────────

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
};

export type DoctorChecks = {
  system: DoctorCheck[];
  config: DoctorCheck[];
  services: DoctorCheck[];
};

export type DoctorHealth = {
  ts: string;
  status: DoctorStatus;
  issues: DoctorCheck[];
  groups: DoctorChecks;
};

export type DoctorCounts = {
  tasks: number;
  schedules: number;
  mods: number;
  providers: number;
  mcps: number;
  agents: number;
  projects: number;
  activeProject: string | null;
  workspaces: number;
  voiceNotes: number;
  evalRuns: number;
  backups: number;
};

export type DoctorService = {
  running: boolean;
  port?: number;
  host?: string;
  pid?: number;
  uptime?: number;
  error?: string;
  baseUrl?: string | null;
  reachable?: boolean;
  path?: string | null;
  logPath?: string;
  logExists?: boolean;
};

export type DoctorServices = {
  dashboard: DoctorService;
  headroom: DoctorService;
  lightrag: DoctorService;
  opencode: DoctorService;
};

export type DoctorRecentError = {
  line: string;
  ts: string | null;
  tsMs: number | null;
};

export type DoctorOpencode = {
  configExists: boolean;
  configPath: string;
  agentsDir: string;
  agentFiles: string[];
  dashboardConnected: boolean;
};

export type DoctorDisk = {
  path: string;
  exists: boolean;
  sizeBytes: number;
};

export type DoctorSnapshot = {
  timestamp: string;
  bizarVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  disk: DoctorDisk;
  services: DoctorServices;
  counts: DoctorCounts;
  recentErrors: DoctorRecentError[];
  configHealth: DoctorCheck[];
  opencode: DoctorOpencode;
  checks: DoctorChecks;
  health: { status: DoctorStatus; issues: DoctorCheck[] };
};

/**
 * The categories the Doctor page renders. Order is the render order.
 * Each maps 1:1 to either a `DoctorChecks` group or a derived slice.
 */
export type DoctorCategory =
  | 'system'
  | 'services'
  | 'counts'
  | 'errors'
  | 'actions';

export type DoctorCheckOrInfo =
  | DoctorCheck
  | { kind: 'count'; label: string; value: number | string };

export type DoctorPanelProps = {
  category: DoctorCategory;
  /** Title shown in the card header. Optional — derived from category if omitted. */
  title?: string;
  /** Lucide icon for the header. Optional — derived from category if omitted. */
  icon?: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  /** Per-line entries. Each carries an implicit `ok | warn | fail` status pill. */
  checks: DoctorCheck[];
  /**
   * Plain key/value rows that aren't checks (e.g. counts). Rendered
   * as a compact two-column list below the check rows when present.
   */
  info?: Array<{ label: string; value: string | number }>;
  /** Meta line shown beneath the title. */
  meta?: string;
  /** Optional custom body — bypasses the default check-list render. */
  children?: React.ReactNode;
  className?: string;
};

export type SearchResult = {
  type: string;
  score: number;
  item: Record<string, unknown>;
};

/**
 * One background-agent instance. Mirrors the JSON shape returned by
 * GET /api/background (src/server/routes/background.mjs). Status values:
 *   - 'pending'    — accepted by the runner, dispatch not yet started
 *   - 'running'    — actively executing in a tmux session
 *   - 'done'       — finished with success
 *   - 'failed'     — terminated with an error
 *   - 'killed'     — user-requested kill
 *   - 'timed_out'  — exceeded plugin stall/dispatch timeout
 */
export type BgInstance = {
  instanceId: string;
  status?:
    | 'pending'
    | 'running'
    | 'paused'
    | 'done'
    | 'failed'
    | 'killed'
    | 'timed_out'
    | 'steered'
    | string;
  agent?: string;
  prompt?: string;
  startedAt?: number;
  completedAt?: number;
  currentStep?: string | null;
  /** v5.x — Progress percentage (0..100; -1 = indeterminate). */
  progress?: number;
  /** v5.x — Free-form progress message. */
  progressMessage?: string;
  toolCallCount?: number;
  tmuxSession?: string;
  tmuxActive?: boolean;
  sessionId?: string;
  error?: string;
  // Optional fields the activity timeline tracks — not required for this view.
  parentAgent?: string;
  parentInstanceId?: string;
  promptPreview?: string;
  resultPreview?: string;
  lastEventAt?: number;
  taskId?: string;
  // v5.x — extended dashboard surface
  /** PID of the opencode run subprocess (for pause/resume/steer). */
  processId?: number;
  /** Free-form runner state from the opencode-runner. */
  runnerState?: string;
  /** Tags from spawn. */
  tags?: string[];
  /** Epoch ms when the subprocess was paused. */
  pausedAt?: number;
  /** When the instance was steered. */
  steeredAt?: number;
};

/**
 * v5.x — Per-tool-call history entry, surfaced by the
 * `bizar_status` tool and the `/api/background/:id/tool-calls` endpoint.
 */
export type BgToolCall = {
  id: string;
  name: string;
  args?: string;
  status: 'running' | 'ok' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
};

export type BackgroundListResponse = {
  instances: BgInstance[];
  status: { dir: string; exists: boolean; count: number };
};

export type BackgroundOutputResponse = {
  /** Captured stdout/stderr text (tail). */
  output?: string;
  /** True when the underlying log file is gone (e.g. after cleanup). */
  available?: boolean;
  /** Total captured bytes — useful for the modal header. */
  bytes?: number;
  /** Truncation flag set by the server when output was capped. */
  truncated?: boolean;
};

export type BackgroundTmuxResponse = {
  /** Computed tmux session name (e.g. "bg-r2u9q8"). */
  session?: string;
  /** Local command the user can paste to attach. */
  attachCommand?: string;
  /** Whether the session exists in tmux right now. */
  exists?: boolean;
  /** Optional reason when exists === false. */
  reason?: string;
};

export type Snapshot = {
  overview: Overview;
  agents: Agent[];
  artifacts: Artifact[];
  projects: ProjectRecord[];
  activeProject: ProjectRecord | null;
  config: ConfigResponse;
  settings: SettingsResponse;
  tasks: Task[];
  mods: Mod[];
  schedules: Schedule[];
  providers: Provider[];
  mcps: McpServer[];
};

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export type WsMessage =
  | { type: 'snapshot'; ts: number; data: Snapshot }
  | { type: 'change'; event: string; path: string; ts: number }
  | { type: 'tasks:change'; task: Task }
  | { type: 'tasks:delete'; id: string }
  | { type: 'task:progress'; taskId: string; progress?: number; step?: string | null; agent?: string | null }
  | { type: 'settings:change'; settings: Settings }
  | { type: 'agents:change' }
  | { type: 'background:change'; action?: string; id?: string; sessionId?: string }
  | { type: 'background:cleanup'; deleted?: number }
  | { type: 'agent:status'; agent: Agent }
  | { type: 'agent:restarted'; agent: Agent }
  | { type: 'agent:stuck'; agents: { name: string }[] }
  | { type: 'artifact:change'; slug: string; deleted?: boolean }
  | { type: 'schedules:change' }
  | { type: 'project:change'; project?: ProjectRecord }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'notification:new'; notification: Notification }
  | { type: 'notifications:change' }
  | { type: 'dialog:show'; dialog: DialogDescriptor }
  | { type: 'pong'; ts: number }
  | { type: 'ping' }
  | { type: 'refresh' };

/** Resolve a theme to the actual key applied to <html data-theme="..."> */
export function applyTheme(themeName: ThemeName | ThemeSettings): 'dark' | 'light' {
  const mode = typeof themeName === 'string' ? themeName : themeName.mode;
  const resolved: 'dark' | 'light' =
    mode === 'system'
      ? typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode === 'light'
        ? 'light'
        : 'dark';
  if (typeof document !== 'undefined') {
    if (resolved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  return resolved;
}

/** Apply the full theme object — sets CSS variables. */
export function applyThemeTokens(theme: ThemeSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--success', theme.success);
  root.style.setProperty('--warning', theme.warning);
  root.style.setProperty('--error', theme.error);
  root.style.setProperty('--info', theme.info);
  // Derive accent-bg/border lightly
  root.style.setProperty('--accent-bg', hexToRgba(theme.accent, 0.12));
  root.style.setProperty('--accent-border', hexToRgba(theme.accent, 0.4));
  if (theme.fontFamily) {
    root.style.setProperty('--font-sans', `'${theme.fontFamily}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  }
  if (theme.fontSize) {
    root.style.setProperty('--base-font-size', `${theme.fontSize}px`);
  }
  root.dataset.compactMode = theme.compactMode ? 'true' : 'false';
  root.dataset.animations = theme.animations ? 'true' : 'false';
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(139, 92, 246, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
