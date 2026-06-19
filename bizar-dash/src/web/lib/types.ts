// src/lib/types.ts — TypeScript types for the Bizar dashboard.
// All shapes here mirror the JSON returned by src/server/api.mjs.

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
  color?: string;
  prompt?: string;
  permissions?: unknown;
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

export type Plan = {
  slug: string;
  title: string;
  status: string;
  source: 'worktree' | 'global' | string;
  elementCount: number | null;
  commentCount: number | null;
  mtime: number;
  planUrl: string | null;
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
};

export type CanvasConnection = {
  id: string;
  fromElementId?: string;
  from?: string;
  toElementId?: string;
  to?: string;
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
};

export type ChatResponse = {
  messages: ChatMessage[];
  sessions: ChatSession[];
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: 'queued' | 'doing' | 'done' | string;
  tags: string[];
  priority: 'low' | 'normal' | 'high' | string;
  assignee?: string | null;
  parent?: string | null;
  dependencies?: string[];
  timeSpent?: number;
  recurring?: { cron?: string; lastGenerated?: string } | null;
  attachments?: string[];
  comments?: { id: string; text: string; createdAt: string }[];
  activity?: { id: string; type: string; ts: string; data?: unknown }[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type Schedule = {
  id: string;
  name: string;
  type: 'cron' | 'interval' | 'once';
  schedule: string;
  action: {
    type: 'command' | 'agent' | 'webhook';
    target: string;
    method?: string;
    body?: unknown;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun: string | null;
  lastResult: string | null;
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
  command: string;
  args: string[];
  env: Record<string, string>;
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

export type SearchResult = {
  type: string;
  score: number;
  item: Record<string, unknown>;
};

export type Snapshot = {
  overview: Overview;
  agents: Agent[];
  plans: Plan[];
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
  | { type: 'settings:change'; settings: Settings }
  | { type: 'agents:change' }
  | { type: 'schedules:change' }
  | { type: 'project:change'; project?: ProjectRecord }
  | { type: 'chat:message'; message: ChatMessage }
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
