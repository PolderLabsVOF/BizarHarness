/**
 * mods/ponytail/route.mjs
 *
 * Dashboard-side companion for @dietrichgebert/ponytail. Stores the
 * active level (lite | full | ultra | off) in the project's Obsidian
 * vault under `.obsidian/ponytail/state.json` so agents that read the
 * vault at session start can pick up the current level.
 *
 * Endpoints
 *   GET  /state            — current level + last-changed
 *   POST /level            — set level (body: { level })
 *   GET  /help             — short summary of the four levels
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function resolveActiveProjectRoot() {
  try {
    const active = globalThis.__bizarProjectsStore?.active?.();
    if (active && active.path && fs.existsSync(active.path)) return active.path;
  } catch { /* ignore */ }
  return process.cwd();
}

function statePath(projectRoot) {
  return path.resolve(projectRoot, '.obsidian', 'ponytail', 'state.json');
}

function readState(projectRoot) {
  const p = statePath(projectRoot);
  if (!fs.existsSync(p)) {
    return { level: 'full', updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      level: raw.level || 'full',
      updatedAt: raw.updatedAt || null,
      history: raw.history || [],
    };
  } catch {
    return { level: 'full', updatedAt: null };
  }
}

function writeState(projectRoot, level) {
  const p = statePath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cur = readState(projectRoot);
  const entry = {
    level,
    updatedAt: new Date().toISOString(),
    history: [
      ...(cur.history || []).slice(-19),
      { level, at: new Date().toISOString() },
    ],
  };
  fs.writeFileSync(p, JSON.stringify(entry, null, 2), 'utf8');
  return entry;
}

const LEVEL_DESCRIPTIONS = {
  lite: 'Small change. Touch the minimum number of files. One PR.',
  full: 'New feature. Ladder applies: YAGNI, reuse, stdlib, native, dep, one-liner.',
  ultra: 'Refactor / audit / over-build. Aggressive simplification. Cuts dependencies.',
  off: 'Bypass ponytail. Agent writes code the normal way.',
};

export default function register({ router }) {
  const projectRoot = resolveActiveProjectRoot();

  router.get('/state', (req, res) => {
    res.json(readState(projectRoot));
  });

  router.post('/level', (req, res) => {
    const { level } = req.body || {};
    if (!LEVEL_DESCRIPTIONS[level]) {
      res.status(400).json({
        error: 'bad_request',
        message: `level must be one of: ${Object.keys(LEVEL_DESCRIPTIONS).join(', ')}`,
      });
      return;
    }
    const next = writeState(projectRoot, level);
    res.json({ ok: true, state: next });
  });

  router.get('/help', (req, res) => {
    res.json({
      package: '@dietrichgebert/ponytail',
      levels: LEVEL_DESCRIPTIONS,
      installCommand: 'npx --yes @dietrichgebert/ponytail install --scope=user',
      repoUrl: 'https://github.com/DietrichGebert/ponytail',
    });
  });
}