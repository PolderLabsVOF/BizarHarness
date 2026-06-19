// src/lib/types.ts — TypeScript types for the Bizar dashboard.
// All shapes here mirror the JSON returned by cli/dashboard/api.mjs.

export type ThemeName = 'dark' | 'light' | 'system';

export type Agent = {
  name: string;
  description: string;
  model: string;
  mode: string;
  file: string;
  path: string;
  mtime: number;
};

export type Project = {
  name: string;
  path: string;
  projectMdSize: number;
  hindsightCount: number;
  mtime: number;
  active: boolean;
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
  theme: ThemeName;
  defaultAgent: string;
  defaultModel: string;
  notifications: {
    onAgentComplete: boolean;
    onPlanApproval: boolean;
  };
  dashboard: {
    autoLaunchWeb: boolean;
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
  createdAt: string;
  updatedAt: string;
};

export type Snapshot = {
  overview: Overview;
  agents: Agent[];
  plans: Plan[];
  projects: Project[];
  config: ConfigResponse;
  settings: SettingsResponse;
  tasks: Task[];
};

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export type WsMessage =
  | { type: 'snapshot'; ts: number; data: Snapshot }
  | { type: 'change'; event: string; path: string; ts: number }
  | { type: 'tasks:change'; task: Task }
  | { type: 'tasks:delete'; id: string }
  | { type: 'settings:change'; settings: Settings }
  | { type: 'pong'; ts: number }
  | { type: 'ping' }
  | { type: 'refresh' };

/** Resolve a theme to the actual key applied to <html data-theme="..."> */
export function applyTheme(theme: ThemeName): 'dark' | 'light' {
  const resolved: 'dark' | 'light' =
    theme === 'system'
      ? typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  if (typeof document !== 'undefined') {
    if (resolved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  return resolved;
}
