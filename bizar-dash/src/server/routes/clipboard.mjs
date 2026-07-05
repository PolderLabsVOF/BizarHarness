/**
 * src/server/routes/clipboard.mjs
 *
 * v5.0.0 — Web Clipper endpoints.
 *
 * Accepts content pasted from the browser extension or bookmarklet,
 * saves it as a markdown note in the vault with YAML frontmatter.
 */

import { Router } from 'express';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';

let _wrap = null;
async function getShared() {
  if (!_wrap) {
    const mod = await import('./_shared.mjs');
    _wrap = mod.wrap;
  }
  return { wrap: _wrap };
}

/**
 * In-memory logs for recent clips. Persisted to a JSON file for reboot survival.
 */
function getLogPath(projectRoot) {
  return join(projectRoot, '.bizar', 'clipboard-log.json');
}

function loadLog(projectRoot) {
  try {
    const p = getLogPath(projectRoot);
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function saveLog(projectRoot, log) {
  const p = getLogPath(projectRoot);
  mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
  writeFileSync(p, JSON.stringify(log, null, 2) + '\n', 'utf8');
}

function appendLog(projectRoot, entry) {
  const log = loadLog(projectRoot);
  log.unshift(entry);
  if (log.length > 100) log.length = 100; // keep last 100
  saveLog(projectRoot, log);
}

function deleteLogEntry(projectRoot, id) {
  const log = loadLog(projectRoot);
  const idx = log.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  log.splice(idx, 1);
  saveLog(projectRoot, log);
  return true;
}

export async function createClipboardRouter({ projectRoot }) {
  const router = Router();
  const { wrap } = await getShared();

  /**
   * POST /api/clipboard/save
   *
   * Accepts { url, title, content, selection?, savedAt? }
   * Saves a markdown note to the vault at clips/<slug>.md
   */
  router.post('/clipboard/save', wrap(async (req, res) => {
    const { url, title, content, selection, savedAt } = req.body || {};
    if (!url && !content) {
      res.status(400).json({ error: 'bad_request', message: 'url or content is required' });
      return;
    }

    // Build a safe slug from the title or URL
    const slugBase = (title || url || 'clip')
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .trim()
      .substring(0, 60)
      .replace(/\s+/g, '_')
      .toLowerCase() || 'clip';

    const timestamp = Date.now();
    const slug = `${slugBase}_${timestamp}`;
    const relPath = `clips/${slug}.md`;

    // Build frontmatter
    const noteTitle = title || 'Web Clip';
    const fm = {
      title: noteTitle,
      url: url || '',
      savedAt: savedAt || new Date().toISOString(),
      type: 'webclip',
      tags: ['webclip'],
    };

    // Build body
    const body = [
      selection ? `> ${selection.replace(/\n/g, '\n> ')}` : '',
      '',
      '## Source',
      '',
      `- **URL**: ${url || '(no URL)'}`,
      `- **Date**: ${fm.savedAt}`,
      '',
      '## Content',
      '',
      '```html',
      (content || '').substring(0, 50000),
      '```',
      '',
    ].join('\n');

    // Write to vault
    const vaultDir = join(projectRoot, '.obsidian');
    mkdirSync(join(vaultDir, 'clips'), { recursive: true });
    const notePath = join(vaultDir, relPath);

    const noteContent = [
      '---',
      ...Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
      '---',
      '',
      body,
    ].join('\n');

    writeFileSync(notePath, noteContent, 'utf8');

    // Log for recent-clips listing
    const entry = {
      id: slug,
      title: noteTitle,
      url,
      notePath: relPath,
      savedAt: fm.savedAt,
    };
    appendLog(projectRoot, entry);

    res.status(201).json({ ok: true, notePath: relPath, id: slug });
  }));

  /**
   * GET /api/clipboard/list
   *
   * Returns recent clips from the log.
   */
  router.get('/clipboard/list', wrap(async (_req, res) => {
    const clips = loadLog(projectRoot);
    res.json({ clips });
  }));

  /**
   * DELETE /api/clipboard/:id
   *
   * Remove a clip from the log (does not delete the note file).
   */
  router.delete('/clipboard/:id', wrap(async (req, res) => {
    const { id } = req.params;
    const ok = deleteLogEntry(projectRoot, id);
    if (!ok) {
      res.status(404).json({ error: 'not_found', message: `clip ${id} not found` });
      return;
    }
    res.json({ ok: true });
  }));

  return router;
}
