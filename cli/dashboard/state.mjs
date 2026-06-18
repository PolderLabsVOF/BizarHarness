/**
 * cli/dashboard/state.mjs
 *
 * Aggregates every piece of state the dashboard surfaces. Each getter is
 * defensive: missing files, missing directories, parse errors — all become
 * sensible empty defaults rather than crashes.
 *
 * Data sources:
 *   - getOverview:  counts + .bizar/activity.log tail
 *   - getChat:      .bizar/sessions/*.jsonl (one JSON record per line)
 *   - getAgents:    ~/.config/opencode/agents/*.md (frontmatter parse)
 *   - getPlans:     scans plans/ (worktree) and ~/.config/opencode/plans/
 *   - getProjects:  walks cwd for .bizar/PROJECT.md, also ~/Projects/*
 *   - getConfig:    ~/.config/opencode/opencode.json (live)
 *   - getSettings:  ~/.config/bizar/settings.json (created on demand)
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

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
    plansDir: join(projectRoot, 'plans'),
    globalPlansDir: join(opencodeConfigDir, 'plans'),
    settingsFile: join(HOME, '.config', 'bizar', 'settings.json'),
  };

  // ── helpers ───────────────────────────────────────────────────────────────

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

  function listFiles(dir, ext) {
    try {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) =>
        ext ? f.endsWith(ext) : true,
      );
    } catch {
      return [];
    }
  }

  function safeStat(p) {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  }

  /** Minimal frontmatter parser: returns { frontmatter, body }. */
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
      // strip surrounding quotes
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

  // ── public getters ────────────────────────────────────────────────────────

  function getOverview() {
    const agents = getAgents();
    const plans = getPlans();
    const projects = getProjects();

    const sessionsDir = paths.sessionsDir;
    let sessionCount = 0;
    if (existsSync(sessionsDir)) {
      try {
        sessionCount = readdirSync(sessionsDir).filter((f) =>
          f.endsWith('.jsonl'),
        ).length;
      } catch {
        sessionCount = 0;
      }
    }

    const recentActivity = [];
    try {
      if (existsSync(paths.activityLog)) {
        const lines = readFileSync(paths.activityLog, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            recentActivity.push(JSON.parse(line));
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      /* ignore */
    }
    // Last 30, newest first
    recentActivity.reverse();
    const trimmedActivity = recentActivity.slice(0, 30);

    return {
      counts: {
        agents: agents.length,
        plans: plans.length,
        projects: projects.length,
        sessions: sessionCount,
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
    if (!existsSync(paths.sessionsDir)) return { messages: [], sessions: [] };
    const allFiles = readdirSync(paths.sessionsDir).filter((f) =>
      f.endsWith('.jsonl'),
    );
    const sessions = allFiles.map((f) => {
      const st = safeStat(join(paths.sessionsDir, f));
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
      const full = join(paths.sessionsDir, file);
      try {
        const lines = readFileSync(full, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            messages.push(JSON.parse(line));
          } catch {
            // skip malformed line
          }
        }
      } catch {
        // skip unreadable file
      }
    }

    // newest first, then truncate
    messages.reverse();
    return {
      messages: messages.slice(0, limit),
      sessions,
    };
  }

  function getAgents() {
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

  function getPlans() {
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

  function getProjects() {
    const out = [];
    // 1. Walk up from projectRoot looking for .bizar/PROJECT.md markers
    let dir = projectRoot;
    const seen = new Set();
    while (dir && dir !== dirname(dir) && !seen.has(dir)) {
      seen.add(dir);
      const marker = join(dir, '.bizar', 'PROJECT.md');
      if (existsSync(marker)) {
        const st = safeStat(marker);
        const hindsight = join(dir, '.bizar', '.hindsight');
        let hcount = 0;
        if (existsSync(hindsight)) {
          try {
            hcount = readdirSync(hindsight).length;
          } catch {
            hcount = 0;
          }
        }
        out.push({
          name: basename(dir),
          path: dir,
          projectMdSize: st ? st.size : 0,
          hindsightCount: hcount,
          mtime: st ? st.mtimeMs : 0,
          active: dir === projectRoot,
        });
      }
      dir = dirname(dir);
    }

    // 2. Also scan ~/Projects/* as a discovery surface
    const projectsRoot = join(HOME, 'Projects');
    if (existsSync(projectsRoot)) {
      try {
        for (const entry of readdirSync(projectsRoot)) {
          const full = join(projectsRoot, entry);
          const st = safeStat(full);
          if (!st || !st.isDirectory()) continue;
          if (out.some((p) => p.path === full)) continue;
          const marker = join(full, '.bizar', 'PROJECT.md');
          const hasMarker = existsSync(marker);
          out.push({
            name: entry,
            path: full,
            projectMdSize: hasMarker ? safeStat(marker)?.size || 0 : 0,
            hindsightCount: 0,
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

  function getConfig() {
    const data = safeReadJSON(paths.opencodeJson, null);
    return {
      path: paths.opencodeJson,
      data,
      raw: data === null ? '' : JSON.stringify(data, null, 2),
      exists: existsSync(paths.opencodeJson),
    };
  }

  function getSettings() {
    const defaults = {
      theme: 'dark',
      defaultAgent: 'odin',
      defaultModel: '',
      notifications: {
        onAgentComplete: true,
        onPlanApproval: true,
      },
      about: {
        version: '2.5.0',
        homepage: 'https://github.com/DrB0rk/BizarHarness',
        license: 'MIT',
      },
    };
    const existing = safeReadJSON(paths.settingsFile, null);
    const merged = { ...defaults, ...(existing || {}) };
    return {
      path: paths.settingsFile,
      data: merged,
      exists: existsSync(paths.settingsFile),
    };
  }

  // ── mutators ──────────────────────────────────────────────────────────────

  function setConfig(newData) {
    mkdirSync(dirname(paths.opencodeJson), { recursive: true });
    writeFileSync(
      paths.opencodeJson,
      JSON.stringify(newData, null, 2) + '\n',
      'utf8',
    );
    return getConfig();
  }

  function setSettings(newData) {
    mkdirSync(dirname(paths.settingsFile), { recursive: true });
    writeFileSync(
      paths.settingsFile,
      JSON.stringify(newData, null, 2) + '\n',
      'utf8',
    );
    return getSettings();
  }

  function appendActivity(event) {
    try {
      mkdirSync(paths.bizarDir, { recursive: true });
      const record = {
        ts: new Date().toISOString(),
        ...event,
      };
      writeFileSync(
        paths.activityLog,
        JSON.stringify(record) + '\n',
        { flag: 'a', encoding: 'utf8' },
      );
    } catch (err) {
      console.error('[dashboard state] appendActivity failed:', err);
    }
  }

  return {
    paths,
    getOverview,
    getChat,
    getAgents,
    getPlans,
    getProjects,
    getConfig,
    getSettings,
    setConfig,
    setSettings,
    appendActivity,
  };
}
