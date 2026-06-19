#!/usr/bin/env node
/**
 * cli/dashboard-tui.mjs
 *
 * v2.7.0 — Blessed-based terminal dashboard for Bizar.
 *
 * Mirrors the React web dashboard with 8 tabs:
 *   1 Overview   2 Chat    3 Agents   4 Plans
 *   5 Projects   6 Tasks   7 Config   8 Settings
 *
 * Connects to the same Express + WebSocket server used by the web UI
 * (cli/dashboard/server.mjs). The caller (cli/bin.mjs) is responsible
 * for starting the server before invoking launchTui().
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ 🪩 Bizar Dashboard — v2.7.0                            │  header (3 lines)
 *   │ [1]Overview [2]Chat [3]Agents [4]Plans [5]Projects … │
 *   ├─────────────────────────────────────────────────────────┤
 *   │                                                         │
 *   │  (rendered tab content here)                            │  content
 *   │                                                         │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ ● connected | 4321 | 13 agents | 4 plans | 8 projects  │  status bar (1 line)
 *   └─────────────────────────────────────────────────────────┘
 *
 * Keyboard:
 *   1-8         jump to tab
 *   Tab / S-Tab cycle tabs
 *   r           reload snapshot
 *   /           search (basic, current tab)
 *   q / C-c     quit
 *   c           open chat composer
 *   n           new item (plan / task, tab-dependent)
 *
 * v2.7.0 design notes:
 *   - blessed tags are enabled (`{bold}`, `{color-fg}`, etc.) on every box.
 *   - The same blessed.textbox instance is reused for prompts to keep the
 *     code small. Prompts yield a Promise so callers can `await` the answer.
 *   - State is always loaded twice — once via /api/snapshot on connect and
 *     again every time a `change` arrives over WS. Belt-and-suspenders.
 *   - WebSocket auto-reconnects with backoff so a server restart doesn't kill
 *     the TUI.
 */
import blessed from 'blessed';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// blessed expects to be the entry point, so we set process.title.
process.title = 'bizar-tui';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();

const VERSION = '2.7.0';

// ── Tab definitions ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview', key: '1' },
  { id: 'chat', label: 'Chat', key: '2' },
  { id: 'agents', label: 'Agents', key: '3' },
  { id: 'plans', label: 'Plans', key: '4' },
  { id: 'projects', label: 'Projects', key: '5' },
  { id: 'tasks', label: 'Tasks', key: '6' },
  { id: 'config', label: 'Config', key: '7' },
  { id: 'settings', label: 'Settings', key: '8' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Truncate string to n cols, accounting for ANSI / blessed tags. */
function truncate(str, n) {
  if (str == null) return '';
  // Strip blessed tags {color-fg}...{/} and ANSI escape sequences for length
  // measurement only.
  const clean = String(str).replace(/\{[^}]+\}/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  if (clean.length <= n) return str;
  const cut = clean.slice(0, Math.max(0, n - 1)) + '…';
  return cut;
}

/** Pad a string to n cols (counting display cols, not tag chars). */
function pad(str, n) {
  const clean = String(str).replace(/\{[^}]+\}/g, '');
  const len = clean.length;
  if (len >= n) return str;
  return str + ' '.repeat(n - len);
}

/** Pretty-print a JSON value with syntax colors for the TUI. */
function jsonToTags(value, indent = 2) {
  const json = JSON.stringify(value, null, indent);
  if (json === undefined) return '';
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"([^"]+)"(?=\s*:)/g, '{cyan-fg}"$1"{/}')
    .replace(/:\s*"([^"]*)"/g, ': {green-fg}"$1"{/}')
    .replace(/\b(true|false|null)\b/g, '{yellow-fg}$1{/}')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '{magenta-fg}$1{/}');
}

/** Format an ISO timestamp as HH:MM:SS (or HH:MM). */
function shortTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toTimeString().slice(0, 8);
}

/** Format an ISO timestamp as a relative "5 min ago" string. */
function relativeTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Read a key from the prompt, returns Promise<string>. */
function prompt(screen, label, { secret = false, defaultValue = '' } = {}) {
  return new Promise((resolve) => {
    const box = blessed.prompt({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 5,
      border: 'line',
      tags: true,
      keys: true,
      hidden: false,
      label: ` ${label} `,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'magenta' },
        focus: { border: { fg: 'cyan' } },
      },
    });
    box.readInput('', defaultValue, (err, value) => {
      box.destroy();
      screen.render();
      if (err) resolve(null);
      else resolve(value);
    });
    box.focus();
    screen.render();
    if (secret) box.censor = true;
  });
}

/** Show a confirmation modal. */
function confirm(screen, label) {
  return new Promise((resolve) => {
    const box = blessed.question({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 5,
      border: 'line',
      tags: true,
      keys: true,
      label: ` ${label} (y/N) `,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    box.readInput('', '', (err, value) => {
      box.destroy();
      screen.render();
      const yes = typeof value === 'string' && /^y(es)?$/i.test(value.trim());
      resolve(yes);
    });
    box.focus();
    screen.render();
  });
}

/** Show a transient info banner; auto-dismiss after ms. */
function toast(screen, message, { color = 'cyan', ms = 2500 } = {}) {
  const t = blessed.message({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 3,
    border: 'line',
    tags: true,
    label: ' Bizar ',
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: color },
    },
  });
  t.display(`{${color}-fg}${message}{/}`, ms);
  screen.render();
}

// ── REST client ─────────────────────────────────────────────────────────────

function makeApiClient(port) {
  const base = `http://127.0.0.1:${port}`;
  async function req(method, path, body) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
    }
    if (r.status === 204) return null;
    return r.json();
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    patch: (p, b) => req('PATCH', p, b),
    del: (p) => req('DELETE', p),
  };
}

// ── Renderers ───────────────────────────────────────────────────────────────

function renderOverview(state) {
  const { overview = null } = state;
  if (!overview) {
    return '{gray-fg}Loading overview…{/}';
  }
  const c = overview.counts || {};
  const lines = [];
  lines.push('{bold}Counts{/bold}');
  lines.push(`  Agents   {cyan-fg}${c.agents ?? 0}{/}`);
  lines.push(`  Plans    {cyan-fg}${c.plans ?? 0}{/}`);
  lines.push(`  Projects {cyan-fg}${c.projects ?? 0}{/}`);
  lines.push(`  Sessions {cyan-fg}${c.sessions ?? 0}{/}`);
  lines.push('');

  lines.push('{bold}Versions{/bold}');
  const v = overview.versions || {};
  lines.push(`  node      {gray-fg}${v.node || '?'}{/}`);
  lines.push(`  platform  {gray-fg}${v.platform || '?'}{/}`);
  lines.push(`  project   {gray-fg}${truncate(v.projectRoot || '?', 60)}{/}`);
  lines.push(`  bizarRoot {gray-fg}${truncate(v.bizarRoot || '?', 60)}{/}`);
  lines.push('');

  const activity = overview.recentActivity || [];
  lines.push(`{bold}Recent activity{/bold}  {gray-fg}(last ${Math.min(activity.length, 15)}){/}`);
  for (const ev of activity.slice(0, 15)) {
    const t = shortTime(ev.ts);
    const kind = ev.kind || 'event';
    let detail = '';
    if (typeof ev.message === 'string') detail = ev.message;
    else if (ev.agent) detail = `@${ev.agent}`;
    else if (ev.slug) detail = ev.slug;
    else if (ev.name) detail = ev.name;
    else if (ev.path) detail = truncate(ev.path, 40);
    lines.push(`  {gray-fg}${t}{/}  ${pad(kind, 22)} ${truncate(detail, 60)}`);
  }
  if (activity.length === 0) {
    lines.push('  {gray-fg}(no activity recorded){/}');
  }
  return lines.join('\n');
}

function renderChat(state) {
  const { chat = [] } = state;
  const lines = [];
  lines.push('{bold}Recent messages{/bold}  {gray-fg}(newest first; press c to compose){/}');
  if (!chat.length) {
    lines.push('  {gray-fg}(no messages yet){/}');
    return lines.join('\n');
  }
  const recent = chat.slice(0, 20);
  for (const m of recent) {
    const t = shortTime(m.ts || m.timestamp);
    const role = m.role || m.from || 'user';
    const text = (m.message || m.content || '').toString().split(/\r?\n/)[0];
    lines.push(`  {gray-fg}${t}{/}  {bold}${pad(role, 8)}{/}  ${truncate(text, 80)}`);
  }
  return lines.join('\n');
}

function renderAgents(state) {
  const { agents = [] } = state;
  const lines = [];
  lines.push(`{bold}Agents{/bold}  {gray-fg}(press Enter for details, r to reload){/}`);
  if (!agents.length) {
    lines.push('  {gray-fg}(no agents installed){/}');
    return lines.join('\n');
  }
  const width = Math.max(20, Math.floor((process.stdout.columns || 100) / 2) - 4);
  for (let i = 0; i < agents.length; i += 2) {
    const left = agents[i];
    const right = agents[i + 1];
    lines.push(card(left, width) + '  ' + (right ? card(right, width) : ''));
  }
  return lines.join('\n');
}

function card(agent, width) {
  const lines = [];
  lines.push('┌─ ' + agent.name + ' ' + '─'.repeat(Math.max(0, width - agent.name.length - 4)) + '┐');
  const model = agent.model ? `model: ${agent.model}` : 'model: ?';
  const mode = agent.mode ? `mode:  ${agent.mode}` : '';
  lines.push('│ ' + pad(model, width - 4) + ' │');
  if (mode) lines.push('│ ' + pad(mode, width - 4) + ' │');
  const desc = truncate(agent.description || '', width - 4);
  if (desc) lines.push('│ ' + pad(desc, width - 4) + ' │');
  lines.push('└' + '─'.repeat(width - 2) + '┘');
  return lines.join('\n');
}

function renderPlans(state) {
  const { plans = [] } = state;
  const lines = [];
  lines.push(`{bold}Plans{/bold}  {gray-fg}(press n to create){/}`);
  if (!plans.length) {
    lines.push('  {gray-fg}(no plans){/}');
    return lines.join('\n');
  }
  for (const p of plans) {
    const status = p.status || 'draft';
    const elements = p.elementCount != null ? `${p.elementCount} el` : '';
    const comments = p.commentCount != null ? `${p.commentCount} cm` : '';
    const meta = [elements, comments].filter(Boolean).join(', ');
    const src = p.source === 'global' ? '{gray-fg}(global){/}' : '';
    lines.push(
      `  • {bold}${pad(p.title || p.slug, 28)}{/} {cyan-fg}${pad(status, 10)}{/} ${pad(meta, 14)} ${relativeTime(new Date(p.mtime).toISOString())} ${src}`,
    );
  }
  return lines.join('\n');
}

function renderProjects(state) {
  const { projects = [] } = state;
  const lines = [];
  lines.push('{bold}Projects{/bold}');
  if (!projects.length) {
    lines.push('  {gray-fg}(no projects discovered){/}');
    return lines.join('\n');
  }
  for (const p of projects) {
    const tag = p.active ? '{green-fg}[active]{/}' : '         ';
    lines.push(`  ${tag} {bold}${pad(p.name, 24)}{/} ${truncate(p.path, 70)}`);
  }
  return lines.join('\n');
}

function renderTasks(state) {
  const { tasks = [] } = state;
  const cols = { queued: [], doing: [], done: [] };
  for (const t of tasks) {
    const k = cols[t.status] ? t.status : 'queued';
    cols[k].push(t);
  }
  const lines = [];
  lines.push('{bold}Tasks{/bold}  {gray-fg}(press n to add, e to edit status){/}');
  const colWidth = Math.max(20, Math.floor((process.stdout.columns || 100) / 3) - 2);
  const header = ['QUEUED', 'DOING', 'DONE']
    .map((label) => `{bold}${pad(label, colWidth - 2)}{/}`)
    .join('  ');
  lines.push(header);
  lines.push(
    ['─'.repeat(colWidth - 2), '─'.repeat(colWidth - 2), '─'.repeat(colWidth - 2)]
      .map((h) => `{gray-fg}${h}{/}`)
      .join('  '),
  );
  const maxRows = Math.max(cols.queued.length, cols.doing.length, cols.done.length);
  for (let r = 0; r < maxRows; r++) {
    const row = ['queued', 'doing', 'done']
      .map((k) => {
        const t = cols[k][r];
        if (!t) return ' '.repeat(colWidth - 2);
        const mark = t.status === 'done' ? '{green-fg}✔{/}' : '{gray-fg}•{/}';
        const title = truncate(t.title || '(untitled)', colWidth - 6);
        return pad(`${mark} ${title}`, colWidth - 2);
      })
      .join('  ');
    lines.push(row);
  }
  if (maxRows === 0) {
    lines.push('{gray-fg}(no tasks yet — press n to add one){/}');
  }
  return lines.join('\n');
}

function renderConfig(state) {
  const { config = null } = state;
  if (!config) {
    return '{gray-fg}Loading config…{/}';
  }
  const lines = [];
  lines.push(`{bold}opencode.json{/bold}  {gray-fg}${truncate(config.path || '', 80)}{/}`);
  if (!config.exists) {
    lines.push('  {yellow-fg}(file does not exist yet){/}');
    return lines.join('\n');
  }
  try {
    const data = config.data ?? JSON.parse(config.raw || 'null');
    lines.push(jsonToTags(data, 2));
  } catch (err) {
    lines.push(`{red-fg}failed to parse: ${err.message}{/}`);
    lines.push(truncate(config.raw || '', 2000));
  }
  return lines.join('\n');
}

function renderSettings(state) {
  const { settings = null } = state;
  if (!settings) {
    return '{gray-fg}Loading settings…{/}';
  }
  const s = settings.data || {};
  const notif = s.notifications || {};
  const dash = s.dashboard || {};
  const about = s.about || {};
  const lines = [];
  lines.push('{bold}Settings{/bold}  {gray-fg}(press Enter to edit){/}');
  lines.push('');
  lines.push(`  {cyan-fg}theme{/}                ${pad(s.theme || 'dark', 10)}   (dark | light | system)`);
  lines.push(`  {cyan-fg}defaultAgent{/}         ${s.defaultAgent || 'odin'}`);
  lines.push(`  {cyan-fg}defaultModel{/}         ${s.defaultModel || '(none)'}`);
  lines.push('');
  lines.push('{bold}Dashboard{/bold}');
  lines.push(`  {cyan-fg}dashboard.autoLaunchWeb{/}  ${dash.autoLaunchWeb === false ? '{yellow-fg}false{/}' : '{green-fg}true{/}'}  (toggle via PUT /api/settings)`);
  lines.push('');
  lines.push('{bold}Notifications{/bold}');
  lines.push(`  {cyan-fg}onAgentComplete{/}  ${notif.onAgentComplete ? 'on' : 'off'}`);
  lines.push(`  {cyan-fg}onPlanApproval{/}   ${notif.onPlanApproval ? 'on' : 'off'}`);
  lines.push('');
  lines.push('{bold}About{/bold}');
  lines.push(`  version   ${about.version || '?'}`);
  lines.push(`  homepage  ${truncate(about.homepage || '?', 60)}`);
  lines.push(`  license   ${about.license || '?'}`);
  lines.push('');
  lines.push('{gray-fg}Settings file: ' + (settings.path || '?') + '{/}');
  return lines.join('\n');
}

const RENDERERS = {
  overview: renderOverview,
  chat: renderChat,
  agents: renderAgents,
  plans: renderPlans,
  projects: renderProjects,
  tasks: renderTasks,
  config: renderConfig,
  settings: renderSettings,
};

// ── WebSocket helper ────────────────────────────────────────────────────────

class DashboardSocket {
  constructor(port, onMessage) {
    this.port = port;
    this.onMessage = onMessage;
    this.ws = null;
    this.backoffMs = 500;
    this.stopped = false;
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.ws.on('open', () => {
      this.backoffMs = 500;
      this.onMessage({ type: '_status', status: 'connected' });
    });
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.onMessage(msg);
      } catch {
        /* ignore */
      }
    });
    this.ws.on('close', () => {
      this.onMessage({ type: '_status', status: 'disconnected' });
      this.scheduleReconnect();
    });
    this.ws.on('error', () => {
      /* close will follow */
    });
  }
  scheduleReconnect() {
    if (this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 15_000);
    setTimeout(() => this.connect(), wait);
  }
  close() {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ── Main launch function ────────────────────────────────────────────────────

/**
 * Launch the TUI. Caller must already have the dashboard server listening on
 * `port`. Returns once the user quits the TUI.
 *
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} [opts.projectRoot]
 * @param {string} [opts.opencodeConfigDir]
 * @param {string} [opts.bizarRoot]
 */
export async function launchTui(opts = {}) {
  const port = opts.port ?? 4321;
  const api = makeApiClient(port);

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    overview: null,
    chat: [],
    agents: [],
    plans: [],
    projects: [],
    config: null,
    settings: null,
    tasks: [],
    activeTab: 'overview',
    connected: false,
    serverPort: port,
  };

  // ── Screen + layout ───────────────────────────────────────────────────────
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Bizar Dashboard',
    fullUnicode: true,
    autoPadding: true,
    warnings: false,
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'magenta' } },
  });

  const content = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    scrollbar: { ch: ' ', style: { bg: 'magenta' } },
    style: { border: { fg: 'gray' } },
  });

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    style: { bg: 'magenta', fg: 'white' },
  });

  function refreshHeader() {
    const tabs = TABS.map((t) => {
      const active = t.id === state.activeTab;
      const label = `${t.key}${t.label}`;
      if (active) return `{inverse} ${label} {/inverse}`;
      return `{gray-fg}${label}{/gray-fg}`;
    }).join('  ');
    header.setContent(
      `{center}{bold}🪩 Bizar Dashboard — v${VERSION}{/bold}{/center}\n{center}${tabs}  {gray-fg}|  q:quit  r:reload  ?:help{/center}`,
    );
  }

  function refreshStatus() {
    const dot = state.connected ? '{green-fg}●{/green-fg}' : '{red-fg}●{/red-fg}';
    const c = state.overview?.counts || {};
    const counts = `agents:${c.agents ?? 0}  plans:${c.plans ?? 0}  projects:${c.projects ?? 0}  sessions:${c.sessions ?? 0}`;
    statusBar.setContent(
      ` ${dot} ${state.connected ? 'connected' : 'disconnected'}  ${state.serverPort}  ${counts}  `,
    );
  }

  function refreshContent() {
    const fn = RENDERERS[state.activeTab] || renderOverview;
    content.setContent(fn(state));
  }

  function render() {
    refreshHeader();
    refreshContent();
    refreshStatus();
    screen.render();
  }

  function setTab(id) {
    state.activeTab = id;
    content.setContent((RENDERERS[id] || renderOverview)(state));
    render();
  }

  // ── Data loaders ──────────────────────────────────────────────────────────
  async function loadSnapshot() {
    try {
      const snap = await api.get('/api/snapshot');
      Object.assign(state, snap);
      state.connected = true;
      render();
    } catch (err) {
      state.connected = false;
      statusBar.setContent(` {red-fg}●{/red-fg} load failed: ${err.message}  `);
      screen.render();
    }
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────────
  const sock = new DashboardSocket(port, (msg) => {
    if (msg.type === '_status') {
      state.connected = msg.status === 'connected';
      render();
      return;
    }
    if (msg.type === 'snapshot') {
      Object.assign(state, msg.data || {});
      render();
    } else if (msg.type === 'change' || msg.type === 'tasks:change') {
      loadSnapshot();
    } else if (msg.type === 'settings:change') {
      state.settings = msg.settings;
      render();
    }
  });

  // ── Action handlers ───────────────────────────────────────────────────────
  async function actionComposeChat() {
    setTab('chat');
    const agent = state.settings?.data?.defaultAgent || 'odin';
    const text = await prompt(screen, ' Message (agent: ' + agent + ') ');
    if (!text || !text.trim()) return;
    try {
      await api.post('/api/chat', { message: text, agent });
      toast(screen, 'Message queued.', { color: 'green' });
      // Refresh chat after a moment
      setTimeout(loadSnapshot, 400);
    } catch (err) {
      toast(screen, `Send failed: ${err.message}`, { color: 'red' });
    }
  }

  async function actionNewPlan() {
    setTab('plans');
    const slug = (await prompt(screen, ' New plan slug (a-z, 0-9, dashes) ')) || '';
    if (!slug.trim()) return;
    const title = (await prompt(screen, ' Plan title ')) || slug;
    try {
      await api.post('/api/plans', { slug: slug.trim(), title: title.trim() });
      toast(screen, `Plan "${slug}" created.`, { color: 'green' });
      loadSnapshot();
    } catch (err) {
      toast(screen, `Create failed: ${err.message}`, { color: 'red' });
    }
  }

  async function actionNewTask() {
    setTab('tasks');
    const title = (await prompt(screen, ' New task title ')) || '';
    if (!title.trim()) return;
    try {
      await api.post('/api/tasks', { title: title.trim(), status: 'queued' });
      toast(screen, 'Task created.', { color: 'green' });
      loadSnapshot();
    } catch (err) {
      toast(screen, `Create failed: ${err.message}`, { color: 'red' });
    }
  }

  async function actionToggleAutoLaunch() {
    const cur = state.settings?.data?.dashboard?.autoLaunchWeb;
    const next = cur === false ? true : false;
    const updated = {
      ...(state.settings?.data || {}),
      dashboard: {
        ...((state.settings?.data?.dashboard) || {}),
        autoLaunchWeb: next,
      },
    };
    try {
      const r = await api.put('/api/settings', updated);
      state.settings = r;
      toast(
        screen,
        `dashboard.autoLaunchWeb → ${next}`,
        { color: next ? 'green' : 'yellow' },
      );
      render();
    } catch (err) {
      toast(screen, `Save failed: ${err.message}`, { color: 'red' });
    }
  }

  function actionHelp() {
    toast(
      screen,
      '1-8 tab · Tab cycle · r reload · c chat · n new · t toggle web · q quit',
      { color: 'cyan', ms: 5000 },
    );
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  for (const tab of TABS) {
    screen.key([tab.key], () => setTab(tab.id));
  }
  screen.key(['tab'], () => {
    const idx = TABS.findIndex((t) => t.id === state.activeTab);
    setTab(TABS[(idx + 1) % TABS.length].id);
  });
  screen.key(['S-tab'], () => {
    const idx = TABS.findIndex((t) => t.id === state.activeTab);
    setTab(TABS[(idx - 1 + TABS.length) % TABS.length].id);
  });
  screen.key(['r'], () => {
    loadSnapshot();
    toast(screen, 'Reloaded.', { color: 'cyan', ms: 1000 });
  });
  screen.key(['c'], () => {
    if (state.activeTab === 'chat') actionComposeChat();
    else setTab('chat');
  });
  screen.key(['n'], () => {
    if (state.activeTab === 'plans') actionNewPlan();
    else if (state.activeTab === 'tasks') actionNewTask();
    else toast(screen, 'Nothing to create on this tab.', { color: 'yellow' });
  });
  screen.key(['t'], () => actionToggleAutoLaunch());
  screen.key(['?'], () => actionHelp());
  screen.key(['q', 'C-c'], () => shutdown());
  screen.key(['escape'], () => content.focus());

  // Scroll inside content
  content.key(['up'], () => content.scroll(-1));
  content.key(['down'], () => content.scroll(1));
  content.key(['pageup'], () => content.scroll(-(screen.height || 24)));
  content.key(['pagedown'], () => content.scroll(screen.height || 24));

  // ── Shutdown ──────────────────────────────────────────────────────────────
  let exiting = false;
  function shutdown() {
    if (exiting) return;
    exiting = true;
    try {
      sock.close();
    } catch {
      /* ignore */
    }
    try {
      screen.destroy();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ── Initial paint ─────────────────────────────────────────────────────────
  refreshHeader();
  refreshStatus();
  screen.render();

  await loadSnapshot();
  screen.render();

  // Keep the process alive until the user quits.
  await new Promise(() => {});
}

// ── Direct entry point ──────────────────────────────────────────────────────

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Allow running the file directly: `node cli/dashboard-tui.mjs [port]`
  const port = parseInt(process.argv[2] || '4321', 10);
  if (!Number.isFinite(port)) {
    console.error('Usage: node cli/dashboard-tui.mjs [port]');
    process.exit(2);
  }
  // Note: when run directly, the caller is responsible for starting the
  // server. We import it lazily so the module is usable as a library too.
  const { createServer } = await import('./server.mjs');
  const { server, close } = await createServer({
    port,
    projectRoot: process.cwd(),
    opencodeConfigDir: join(HOME, '.config', 'opencode'),
    bizarRoot: dirname(__dirname),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  await launchTui({ port });
  // launchTui() resolves when the user quits; tear down the server.
  close();
}