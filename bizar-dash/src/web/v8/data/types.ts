/**
 * v8/data/types.ts — Wire types for the dashboard's REST + WS surface.
 *
 * Single source of truth for the shapes that flow between the
 * `bizar-dash` backend and the v8 views. Each interface corresponds to
 * a route in `src/server/routes/*.mjs`. Keep them narrow — optional
 * fields stay optional; the backend may emit more keys than the
 * dashboard needs and that's fine (we ignore them).
 */

/** `GET /api/snapshot` — top-level dashboard counts. */
export interface Snapshot {
  overview: {
    tasks?: { active?: number; queued?: number; done?: number; blocked?: number };
    agents?: { running?: number; idle?: number; error?: number; total?: number };
    goals?: { total?: number; atRisk?: number; done?: number };
    tokens?: { last24h?: number; trend?: 'up' | 'down' | 'flat' };
    needsAttention?: Array<{ label: string; value: string; hint?: string }>;
    recentActivity?: Array<ActivityEvent>;
  };
  agents: BizarAgent[];
  projects: Array<{ id: string; cwd?: string; name?: string }>;
  activeProject?: { id: string; cwd?: string; name?: string } | null;
}

/** `GET /api/agents` — Bizar agent roster (frontmatter + runtime status). */
export interface BizarAgent {
  name: string;
  description?: string;
  model?: string;
  mode?: string;
  color?: string;
  tools?: string[];
  tags?: string[];
  category?: string;
  status?: 'idle' | 'working' | 'error' | 'stuck';
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
  level?: number;
  parent?: string | null;
  role?: string;
}

/** `GET /api/cc-agents` — Claude Code background agent roster. */
export interface CCAgent {
  id?: string;
  pid?: number;
  cwd?: string;
  kind?: 'background' | 'interactive';
  startedAt?: number;
  sessionId?: string;
  name?: string;
  status?: string;
  state?: string;
  lastMessageAt?: number;
  messageCount?: number;
  lastMessageSnippet?: string;
}

/** `GET /api/goals` — long-horizon goals parsed from `.bizar/PROGRESS.md`. */
export interface Goal {
  id: string;
  title: string;
  status: 'on-track' | 'at-risk' | 'off-track' | 'done' | 'blocked' | 'active';
  description?: string;
  progress: number;
  keyResults: Array<{
    id: string;
    title: string;
    done: boolean;
    assignee?: string;
  }>;
  owner?: string;
  due?: string;
  section?: string;
}

/** `GET /api/tasks` — kanban tasks. */
export interface Task {
  id: string;
  title: string;
  status?: 'queued' | 'doing' | 'done' | 'blocked' | 'archived';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  description?: string;
  branch?: string;
  due?: string;
  comments?: number;
  attachments?: number;
  assignee?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

/** `GET /api/memory` — memo entries. */
export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  scope?: 'project' | 'global';
  updatedAt?: string;
  /** Optional references the renderer surfaces as chips. */
  refs?: Array<{ kind: string; value: string }>;
}

/** `GET /api/skills`, `/api/mcps`, `/api/hooks` — library items. */
export interface LibraryItem {
  id: string;
  name: string;
  slug?: string;
  status?: 'enabled' | 'disabled' | 'error';
  description?: string;
  meta?: string;
  source?: string;
  path?: string;
  version?: string;
  scope?: 'project' | 'global' | 'shipped' | 'user';
  badges?: string[];
}

/** Activity event from `/api/activity` (paged) or WS. */
export interface ActivityEvent {
  id?: string;
  kind?: string;
  title?: string;
  description?: string;
  meta?: string;
  ts?: number;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  agent?: string;
  iconKey?: string;
  slug?: string;
}

/** A single WebSocket message from `/ws`. */
export type WsMessage =
  | { type: 'tasks:change'; task?: Task }
  | { type: 'agents:change'; source?: string; digest?: string }
  | { type: 'agent:status'; agent?: BizarAgent }
  | { type: 'goals:change'; goal?: Goal }
  | { type: 'background:change'; id?: string; status?: string }
  | { type: 'background:syncError'; taskId?: string; instanceId?: string; fails?: number }
  | { type: 'artifact:new'; artifact?: { id?: string; title?: string } }
  | { type: 'activity:new'; event?: ActivityEvent }
  | { type: string; [key: string]: unknown };