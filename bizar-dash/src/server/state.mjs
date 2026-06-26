/**
 * src/server/state.mjs
 *
 * v3.0.0 — Server-side state aggregation.
 *
 * Holds the read-only legacy endpoints (overview, artifacts, chat-via-legacy,
 * etc.) used by both the dashboard and the TUI. New endpoints (per-project
 * tasks, schedules, mods, projects) live directly in api.mjs and use the
 * dedicated stores.
 *
 * Data sources:
 *   - getOverview:  counts + .bizar/activity.log tail
 *   - getChat:      per-project sessions/<id>.jsonl (preferred) — falls
 *                   back to legacy .bizar/sessions if no project is active
 *   - getAgents:    ~/.config/opencode/agents/*.md (frontmatter parse)
 *   - getArtifacts:     scans artifacts/ (worktree) and ~/.config/opencode/artifacts/
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from './projects-store.mjs';

const HOME = homedir();

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.opencodeConfigDir
 * @param {string} opts.bizarRoot
 */
export function createState({ projectRoot, opencodeConfigDir, bizarRoot }) {
  const paths = {
    projectRoot,
    opencodeConfigDir,
    bizarRoot,
    opencodeJson: join(opencodeConfigDir, 'opencode.json'),
    agentsDir: join(opencodeConfigDir, 'agents'),
    commandsDir: join(opencodeConfigDir, 'commands-bizar'),
    bizarDir: join(projectRoot, '.bizar'),
    sessionsDir: join(projectRoot, '.bizar', 'sessions'),
    activityLog: join(projectRoot, '.bizar', 'activity.log'),
    plansDir: join(projectRoot, 'artifacts'),
    globalPlansDir: join(opencodeConfigDir, 'artifacts'),
    settingsFile: join(HOME, '.config', 'bizar', 'settings.json'),
  };

  function safeReadJSON(file, fallback = null) {
    try {
      if (!existsSync(file)) return fallback;
      const text = readFileSync(file, 'utf8');
      if (!text.trim()) return fallback;
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function safeReadText(file, fallback = '') {
    try {
      if (!existsSync(file)) return fallback;
      return readFileSync(file, 'utf8');
    } catch {
      return fallback;
    }
  }

  function atomicWriteText(filePath, text) {
    const tmp = `${filePath}.tmp.${process.pid}`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, filePath);
  }

  function safeStat(p) {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  }

  function parseFrontmatter(raw) {
    if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
    const end = raw.indexOf('\n---', 3);
    if (end === -1) return { frontmatter: {}, body: raw };
    const fmBlock = raw.slice(3, end).trim();
    const body = raw.slice(end + 4).replace(/^\s+/, '');
    const frontmatter = {};
    for (const line of fmBlock.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
    return { frontmatter, body };
  }

  function getOverview() {
    // Use the new store for project count to keep the v3 view consistent.
    const projectsList = projectsStore.list();
    const agents = readAgents();
    const artifacts = readPlans();
    const active = projectsStore.active();

    let sessionCount = 0;
    if (active) {
      const dir = join(projectsStore.projectDir(active.id), 'sessions');
      if (existsSync(dir)) {
        try {
          sessionCount = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length;
        } catch {
          sessionCount = 0;
        }
      }
    } else if (existsSync(paths.sessionsDir)) {
      try {
        sessionCount = readdirSync(paths.sessionsDir).filter((f) => f.endsWith('.jsonl')).length;
      } catch {
        sessionCount = 0;
      }
    }

    const recentActivity = [];
    try {
      const logFile = active
        ? join(projectsStore.projectDir(active.id), 'activity.log')
        : paths.activityLog;
      if (existsSync(logFile)) {
        const lines = readFileSync(logFile, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            recentActivity.push(JSON.parse(line));
          } catch {
            // skip
          }
        }
      }
    } catch {
      /* ignore */
    }
    recentActivity.reverse();
    const trimmedActivity = recentActivity.slice(0, 30);

    return {
      counts: {
        agents: agents.length,
        artifacts: artifacts.length,
        projects: projectsList.projects.length,
        sessions: sessionCount,
        activeProject: active?.id || null,
      },
      recentActivity: trimmedActivity,
      versions: {
        node: process.version,
        platform: process.platform,
        bizarRoot,
        projectRoot,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  function getChat({ sessionId = null, limit = 200 } = {}) {
    // v3.0.4 — Always return gracefully, even if no project is active
    // and the legacy .bizar/sessions dir doesn't exist. The frontend
    // relies on this returning an empty shape rather than crashing.
    const active = projectsStore.active();
    let sessionsDir;
    try {
      sessionsDir = active
        ? join(projectsStore.projectDir(active.id), 'sessions')
        : paths.sessionsDir;
    } catch {
      return { messages: [], sessions: [] };
    }
    if (!sessionsDir || !existsSync(sessionsDir)) {
      return { messages: [], sessions: [] };
    }
    let allFiles;
    try {
      allFiles = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return { messages: [], sessions: [] };
    }
    const sessions = allFiles.map((f) => {
      const st = safeStat(join(sessionsDir, f));
      return {
        id: f.replace(/\.jsonl$/, ''),
        file: f,
        mtime: st ? st.mtimeMs : 0,
        size: st ? st.size : 0,
      };
    });
    sessions.sort((a, b) => b.mtime - a.mtime);

    const target = sessionId
      ? allFiles.filter((f) => f === `${sessionId}.jsonl`)
      : allFiles;

    const messages = [];
    for (const file of target) {
      const full = join(sessionsDir, file);
      try {
        const lines = readFileSync(full, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            messages.push(JSON.parse(line));
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }

    messages.reverse();
    return { messages: messages.slice(0, limit), sessions };
  }

  function readAgents() {
    const dir = paths.agentsDir;
    if (!existsSync(dir)) return [];
    const out = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const full = join(dir, file);
      const raw = safeReadText(full);
      const { frontmatter } = parseFrontmatter(raw);
      const st = safeStat(full);
      out.push({
        name:
          frontmatter.name ||
          basename(file, '.md') ||
          file.replace(/\.md$/, ''),
        description: frontmatter.description || '',
        model: frontmatter.model || '',
        mode: frontmatter.mode || '',
        file,
        path: full,
        mtime: st ? st.mtimeMs : 0,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function getAgents() {
    return readAgents();
  }

  function readPlansFromDir(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = safeStat(full);
      if (!st || !st.isDirectory()) continue;
      const meta = safeReadJSON(join(full, 'meta.json'), null);
      const planPath = join(full, 'plan.mdx');
      const planExists = existsSync(planPath);
      out.push({
        slug: entry,
        title: meta?.title || entry,
        status: meta?.status || 'draft',
        source: dir === paths.plansDir ? 'worktree' : 'global',
        elementCount: meta?.elementCount ?? null,
        commentCount: meta?.commentCount ?? null,
        mtime: st.mtimeMs,
        planUrl: planExists ? `/${entry}/` : null,
      });
    }
    return out;
  }

  function readPlans() {
    const a = readPlansFromDir(paths.plansDir);
    const b = readPlansFromDir(paths.globalPlansDir);
    const seen = new Set();
    const out = [];
    for (const p of [...a, ...b]) {
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      out.push(p);
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  function getArtifacts() {
    return readPlans();
  }

  function getProjects() {
    // Legacy v2.x shape — list of {name, path, ...} for the Dashboard
    // UI. The new v3 API lives in api.mjs and returns the richer registry.
    const out = [];
    let dir = projectRoot;
    const seen = new Set();
    while (dir && dir !== dirname(dir) && !seen.has(dir)) {
      seen.add(dir);
      const marker = join(dir, '.bizar', 'PROJECT.md');
      if (existsSync(marker)) {
        const st = safeStat(marker);
        out.push({
          name: basename(dir),
          path: dir,
          projectMdSize: st ? st.size : 0,
          mtime: st ? st.mtimeMs : 0,
          active: dir === projectRoot,
        });
      }
      dir = dirname(dir);
    }
    const projectsRoot = join(HOME, 'Projects');
    if (existsSync(projectsRoot)) {
      try {
        for (const entry of readdirSync(projectsRoot)) {
          const full = join(projectsRoot, entry);
          const st = safeStat(full);
          if (!st || !st.isDirectory()) continue;
          if (out.some((p) => p.path === full)) continue;
          out.push({
            name: entry,
            path: full,
            projectMdSize: 0,
            mtime: st.mtimeMs,
            active: false,
          });
        }
      } catch {
        /* ignore */
      }
    }
    out.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    return out;
  }

  function appendActivity(event) {
    try {
      const active = projectsStore.active();
      const targetDir = active
        ? projectsStore.ensureProjectDir(active.id)
        : paths.bizarDir;
      const logFile = join(targetDir, 'activity.log');
      mkdirSync(targetDir, { recursive: true });
      const record = { ...(event || {}), ts: new Date().toISOString() };
      writeFileSync(logFile, JSON.stringify(record) + '\n', { flag: 'a', encoding: 'utf8' });
    } catch (err) {
      console.error('[dashboard state] appendActivity failed:', err);
    }
  }

  // v3.3.0 — Custom theme registry. Saved as a small JSON file under
  // ~/.config/bizar/themes.json so users can persist a few named
  // themes and switch between them from the Settings tab.
  const THEMES_FILE = join(HOME, '.config', 'bizar', 'themes.json');

  function readThemes() {
    try {
      if (!existsSync(THEMES_FILE)) return { themes: [] };
      const text = readFileSync(THEMES_FILE, 'utf8');
      if (!text.trim()) return { themes: [] };
      const parsed = JSON.parse(text);
      const themes = Array.isArray(parsed?.themes) ? parsed.themes : [];
      // Drop any malformed entries — each must have a name + colors.
      const cleaned = themes
        .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.colors && typeof t.colors === 'object')
        .map((t) => ({ name: t.name, colors: t.colors, createdAt: t.createdAt || null }));
      return { themes: cleaned };
    } catch {
      return { themes: [] };
    }
  }

  function writeThemes(payload) {
    try {
      mkdirSync(HOME + '/.config/bizar', { recursive: true });
    } catch {
      /* best-effort */
    }
    const themes = Array.isArray(payload?.themes) ? payload.themes : [];
    const cleaned = themes
      .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.colors)
      .map((t) => ({ name: t.name, colors: t.colors, createdAt: t.createdAt || new Date().toISOString() }));
    atomicWriteText(THEMES_FILE, JSON.stringify({ themes: cleaned }, null, 2) + '\n');
    return { themes: cleaned };
  }

  function addTheme(name, colors) {
    const cur = readThemes();
    const idx = cur.themes.findIndex((t) => t.name === name);
    if (idx >= 0) cur.themes[idx] = { name, colors, createdAt: new Date().toISOString() };
    else cur.themes.push({ name, colors, createdAt: new Date().toISOString() });
    return writeThemes(cur);
  }

  function removeTheme(name) {
    const cur = readThemes();
    const before = cur.themes.length;
    cur.themes = cur.themes.filter((t) => t.name !== name);
    if (cur.themes.length === before) return { themes: cur.themes, removed: false };
    writeThemes(cur);
    return { themes: cur.themes, removed: true };
  }

  return {
    paths,
    getOverview,
    getChat,
    getAgents,
    getArtifacts,
    getProjects,
    appendActivity,
    // v3.3.0 — theme registry
    getThemes: readThemes,
    setThemes: writeThemes,
    addTheme,
    removeTheme,
  };
}
