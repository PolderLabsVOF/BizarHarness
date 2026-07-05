/**
 * cli/artifact-render.mjs
 *
 * HTML rendering helpers, canvas state management, and MDX export.
 * Extracted from artifact.mjs to separate rendering from CLI and server logic.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'artifact');
const PLANS_DIR = join(PROJECT_ROOT, 'artifacts');
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

// ─── Canvas schema version ─────────────────────────────────────────────────────

export const CANVAS_SCHEMA_VERSION = 2;

// ─── Canvas state ─────────────────────────────────────────────────────────────

/**
 * The current canvas schema. v2 introduces elements, connections, viewport,
 * and threaded comments. The single source of truth for new artifacts.
 */
export function emptyCanvas(title) {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    title: title || 'Untitled artifact',
    elements: [],
    connections: [],
    comments: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function readCanvasFile(planDir) {
  const path = join(planDir, 'artifact.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeCanvasFile(planDir, canvas) {
  atomicWriteJson(join(planDir, 'artifact.json'), canvas);
}

/**
 * Migration shim: if a v1 artifact (artifact.mdx) exists but no artifact.json, build
 * a v2 canvas with the mdx content as a single "text" element on the
 * canvas. Idempotent — won't overwrite an existing artifact.json.
 *
 * Returns the resulting canvas.
 */
export function loadOrMigrateCanvas(planDir, fallbackTitle) {
  const existing = readCanvasFile(planDir);
  if (existing) {
    // Backfill defaults for older v2 files that may not have every field.
    if (!Array.isArray(existing.elements)) existing.elements = [];
    if (!Array.isArray(existing.connections)) existing.connections = [];
    if (!Array.isArray(existing.comments)) existing.comments = [];
    if (!existing.viewport || typeof existing.viewport !== 'object') {
      existing.viewport = { x: 0, y: 0, zoom: 1 };
    }
    if (typeof existing.title !== 'string') existing.title = fallbackTitle || 'Untitled artifact';
    if (existing.schemaVersion !== CANVAS_SCHEMA_VERSION) existing.schemaVersion = CANVAS_SCHEMA_VERSION;
    return existing;
  }

  const mdxPath = join(planDir, 'artifact.mdx');
  if (existsSync(mdxPath)) {
    const mdx = readFileSync(mdxPath, 'utf-8');
    // If the mdx is empty or just whitespace, return a blank canvas.
    if (!mdx || !mdx.trim()) {
      const c = emptyCanvas(fallbackTitle);
      writeCanvasFile(planDir, c);
      return c;
    }
    // Wrap the entire mdx into a single "text" element centered on the canvas.
    const elId = 'el_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const canvas = emptyCanvas(fallbackTitle);
    canvas.elements.push({
      id: elId,
      type: 'text',
      x: 80,
      y: 80,
      width: 560,
      height: 420,
      title: 'Migrated content',
      content: mdx,
    });
    writeCanvasFile(planDir, canvas);
    return canvas;
  }

  // No artifact.json and no artifact.mdx — start fresh.
  const c = emptyCanvas(fallbackTitle);
  writeCanvasFile(planDir, c);
  return c;
}

/**
 * Convert a v2 canvas state to a derived markdown document.
 * Used by:
 *   - the /api/<slug>/markdown-export endpoint
 *   - the `bizar artifact export` subcommand (for backwards compat)
 *
 * Strategy: emit each element as a section, in a stable order (top-to-bottom
 * by y, then left-to-right by x). Connections are not represented in the
 * markdown — they're a visual concept.
 */
export function canvasToMarkdown(canvas) {
  const lines = [];
  const title = (canvas && canvas.title) || 'Untitled artifact';
  lines.push('# ' + title);
  lines.push('');
  lines.push('*Exported from canvas on ' + new Date().toISOString() + '*');
  lines.push('');

  const elements = (canvas && Array.isArray(canvas.elements)) ? canvas.elements.slice() : [];
  // Sort by y, then x. Elements without y/x are placed at the end.
  elements.sort(function (a, b) {
    const ay = typeof a.y === 'number' ? a.y : 99999;
    const by = typeof b.y === 'number' ? b.y : 99999;
    if (ay !== by) return ay - by;
    const ax = typeof a.x === 'number' ? a.x : 0;
    const bx = typeof b.x === 'number' ? b.x : 0;
    return ax - bx;
  });

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.title) {
      lines.push('## ' + String(el.title));
      lines.push('');
    }
    if (el.type === 'text') {
      const content = typeof el.content === 'string' ? el.content : '';
      if (content) {
        lines.push(content);
        lines.push('');
      }
    } else if (el.type === 'code') {
      const lang = (el.language || '').trim();
      lines.push('```' + lang);
      lines.push(typeof el.content === 'string' ? el.content : '');
      lines.push('```');
      lines.push('');
    } else if (el.type === 'image') {
      const url = typeof el.content === 'string' ? el.content : '';
      if (url) {
        lines.push('![' + (el.title || 'image') + '](' + url + ')');
        lines.push('');
      }
    } else if (el.type === 'diagram') {
      const content = typeof el.content === 'string' ? el.content : '';
      if (content) {
        lines.push('```mermaid');
        lines.push(content);
        lines.push('```');
        lines.push('');
      }
    } else if (el.type === 'ui-mockup') {
      const component = (el.component || '').toLowerCase();
      if (component === 'button') {
        lines.push('> [' + (el.label || 'Button') + ']');
        lines.push('');
      } else if (component === 'input') {
        lines.push('> Input(' + (el.placeholder || 'placeholder') + ') = "' + (el.value || '') + '"');
        lines.push('');
      } else if (component === 'card') {
        lines.push('> **' + (el.title || 'Card') + '**');
        if (el.body) lines.push('> ' + String(el.body).replace(/\n/g, '\n> '));
        lines.push('');
      } else {
        lines.push('> [ui-mockup: ' + component + ']');
        lines.push('');
      }
    } else {
      const content = typeof el.content === 'string' ? el.content : '';
      if (content) {
        lines.push(content);
        lines.push('');
      }
    }
  }

  // Comment summary at the end.
  const comments = (canvas && Array.isArray(canvas.comments)) ? canvas.comments : [];
  if (comments.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const author = c.author || 'Anonymous';
      const text = c.text || '';
      lines.push('- **' + author + '**: ' + text);
      if (Array.isArray(c.thread)) {
        for (let j = 0; j < c.thread.length; j++) {
          const reply = c.thread[j];
          lines.push('  - **' + (reply.author || 'ai') + '**: ' + (reply.text || ''));
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── ID generators ─────────────────────────────────────────────────────────────

export function makeElementId() {
  return 'el_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function makeConnectionId() {
  return 'conn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function makeCommentId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function makeReplyId() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Best-effort read of artifacts/<slug>/meta.json. Returns null on missing or
 *  invalid JSON. Used by the canvas endpoints to surface the artifact title. */
export function readPlanMeta(planDir) {
  const metaPath = join(planDir, 'meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── HTML fragment helpers (for htmx) ─────────────────────────────────────────

/** Minimal HTML escaper — same rules as the client-side renderer. */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

/**
 * Content negotiation: an htmx request prefers HTML fragments. JSON requests
 * (explicit Accept: application/json, or no Accept header at all) get JSON
 * for backwards compatibility with the AI tool, tests, and CLI scripts.
 *
 * Detection order:
 *   - If `HX-Request: true` is present → htmx (HTML)
 *   - If Accept header includes text/html (and not application/json) → htmx
 *   - Otherwise → JSON
 */
export function isHtmxRequest(req) {
  if ((req.headers['hx-request'] || '').toLowerCase() === 'true') return true;
  const accept = (req.headers['accept'] || '').toLowerCase();
  if (!accept) return false;
  if (accept.includes('application/json') && !accept.includes('text/html')) return false;
  if (accept.includes('text/html')) return true;
  return false;
}

/**
 * htmx form-encodes nested objects via JSON.stringify (see htmx 2.x `qn`
 * function). When the body is form-encoded with nested-stringified values,
 * walk the top-level keys and JSON-parse any value that looks like JSON
 * (starts with `[` or `{`). This lets htmx POST/PUT complex state (the
 * full canvas) without needing the `json-enc` extension.
 */
export function decodeHtmxFormBody(data) {
  if (!data || typeof data !== 'object') return data;
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (typeof v === 'string' && v.length > 0) {
      const c = v.charAt(0);
      if (c === '[' || c === '{') {
        try { data[k] = JSON.parse(v); } catch { /* keep as string */ }
      }
    }
  }
  return data;
}

/** Short label for the element type, matches the client-side typeLabel(). */
export function elementTypeBadge(type) {
  const t = (type || '').toLowerCase();
  if (t === 'ui-mockup') return 'UI';
  if (t === 'text') return 'TXT';
  if (t === 'image') return 'IMG';
  if (t === 'code') return 'CODE';
  if (t === 'diagram') return 'DIAG';
  return (type || '').toUpperCase();
}

/** Render the inner body of an element (text/image/code/diagram/ui-mockup). */
export function renderElementBody(e) {
  if (e.type === 'text') {
    return '<pre>' + escapeHtml(e.content || '') + '</pre>';
  }
  if (e.type === 'image') {
    if (e.content) {
      return '<img src="' + escapeHtml(e.content) + '" alt="' + escapeHtml(e.title || 'image') + '">';
    }
    return '<div class="muted">(no image URL set — double-click to edit)</div>';
  }
  if (e.type === 'code') {
    const lang = e.language ? ' class="language-' + escapeHtml(e.language) + '"' : '';
    return '<pre><code' + lang + '>' + escapeHtml(e.content || '') + '</code></pre>';
  }
  if (e.type === 'diagram') {
    return '<pre class="mermaid">' + escapeHtml(e.content || '') + '</pre>';
  }
  if (e.type === 'ui-mockup') {
    const comp = (e.component || '').toLowerCase();
    if (comp === 'button') {
      return '<button class="ui-mockup-button">' + escapeHtml(e.label || 'Button') + '</button>';
    }
    if (comp === 'input') {
      const ph = escapeHtml(e.placeholder || '');
      const val = escapeHtml(e.value || '');
      return '<input class="ui-mockup-input" type="text" placeholder="' + ph + '" value="' + val + '">';
    }
    if (comp === 'card') {
      const title = escapeHtml(e.title || 'Card');
      const body = escapeHtml(e.body || '');
      return '<div class="ui-mockup-card"><h4>' + title + '</h4><p>' + body + '</p></div>';
    }
    return '<div>Unknown ui-mockup component: ' + escapeHtml(comp) + '</div>';
  }
  return '<pre>' + escapeHtml(e.content || '') + '</pre>';
}

/**
 * Render a v2 canvas element as an HTML fragment.
 */
export function renderElementHTML(e) {
  if (!e || !e.id) return '';
  const id = escapeHtml(e.id);
  const type = escapeHtml(e.type || '');
  const title = escapeHtml(e.title || '');
  const x = typeof e.x === 'number' ? e.x : 0;
  const y = typeof e.y === 'number' ? e.y : 0;
  const w = typeof e.width === 'number' ? e.width : 240;
  const h = typeof e.height === 'number' ? e.height : 160;
  const badge = escapeHtml(elementTypeBadge(e.type));
  return '<div class="element"'
    + ' data-element-id="' + id + '"'
    + ' data-element-type="' + type + '"'
    + ' style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px">'
    + '<div class="element-header">'
    +   '<span class="type-badge">' + badge + '</span>'
    +   '<span class="title">' + title + '</span>'
    +   '<div class="actions">'
    +     '<button type="button" title="Edit content" data-action="edit-element">✎</button>'
    +     '<button type="button" title="Delete element" data-action="delete-element">🗑</button>'
    +   '</div>'
    + '</div>'
    + '<div class="element-body">' + renderElementBody(e) + '</div>'
    + '<div class="resize-handle" title="Resize"></div>'
    + '</div>';
}

/**
 * Render a v2 canvas connection as an SVG fragment.
 */
export function renderConnectionHTML(conn) {
  if (!conn || !conn.id) return '';
  return '<g class="connection" data-connection-id="' + escapeHtml(conn.id) + '"'
    + ' data-from="' + escapeHtml(conn.from) + '"'
    + ' data-to="' + escapeHtml(conn.to) + '"'
    + ' data-type="' + escapeHtml(conn.type || 'arrow') + '"'
    + (conn.label ? ' data-label="' + escapeHtml(conn.label) + '"' : '')
    + '></g>';
}

/**
 * Render a v2 canvas comment pin as an HTML fragment.
 */
export function renderCommentPinHTML(c, indexHint) {
  if (!c || !c.id) return '';
  const id = escapeHtml(c.id);
  const x = typeof c.x === 'number' ? c.x : 0;
  const y = typeof c.y === 'number' ? c.y : 0;
  const label = typeof indexHint === 'number' ? (indexHint + 1) : '?';
  const tip = escapeHtml((c.text || '').slice(0, 80));
  return '<div class="comment-pin"'
    + ' data-comment-id="' + id + '"'
    + ' title="' + tip + '"'
    + ' style="left:' + x + 'px;top:' + y + 'px">' + label + '</div>';
}

/** Render a single reply as an HTML fragment (used in the side panel). */
export function renderReplyHTML(r) {
  if (!r) return '';
  const author = escapeHtml(r.author || 'ai');
  const created = escapeHtml(formatDate(r.created));
  const text = escapeHtml(r.text || '');
  const rid = r.id ? ' id="reply-' + escapeHtml(r.id) + '"' : '';
  return '<li class="reply"' + rid + '>'
    + '<div class="reply-meta">' + author + ' · ' + created + '</div>'
    + '<div class="reply-text">' + text + '</div>'
    + '</li>';
}

/**
 * Render the entire comment (header + thread) as a fragment for the side panel.
 */
export function renderCommentThreadHTML(c) {
  if (!c) return '';
  const author = escapeHtml(c.author || 'Anonymous');
  const created = escapeHtml(formatDate(c.created));
  const text = escapeHtml(c.text || '');
  const thread = Array.isArray(c.thread) ? c.thread : [];
  const replies = thread.map(renderReplyHTML).join('');
  return '<li class="comment" id="comment-' + escapeHtml(c.id) + '">'
    + '<div class="comment-meta">' + author + ' · ' + created + '</div>'
    + '<div class="comment-text">' + text + '</div>'
    + replies
    + '</li>';
}

/** Render a single comment as an <li> fragment (no wrapper). */
export function renderCommentLi(c) {
  return '<li class="comment" id="comment-' + escapeHtml(c.id) + '">'
    + '<div class="comment-meta">' + escapeHtml(c.author || 'Anonymous')
    + ' · ' + escapeHtml(formatDate(c.timestamp || c.created)) + '</div>'
    + '<div class="comment-text">' + escapeHtml(c.text || '') + '</div>'
    + '</li>';
}

/** Render a comments list as <li> elements. If empty, returns the empty marker. */
export function renderCommentListHtml(comments, sectionId) {
  const items = comments
    .filter((c) => !sectionId || c.sectionId === sectionId)
    .sort((a, b) => String(a.timestamp || a.created || '').localeCompare(String(b.timestamp || b.created || '')));
  if (items.length === 0) {
    return '<li class="empty" data-empty>No comments yet — be the first.</li>';
  }
  return items.map(renderCommentLi).join('');
}

/** Render just the count badge for a section, used to update the comment button. */
export function renderCommentCountHtml(count) {
  return '<span class="count">' + count + '</span>';
}

/** Parse an HTTP request body. Supports:
 *   - application/x-www-form-urlencoded  (htmx default for <form>)
 *   - application/json                   (legacy / direct API)
 *   - text/plain                         (raw MDX for artifact save)
 *   - anything else: returns raw string
 */
export function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodySize = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      bodySize += chunk.length;
      if (bodySize > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        reject(new Error(`Request body too large (max ${MAX_REQUEST_BODY_BYTES} bytes)`));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      const ct = (req.headers['content-type'] || '').toLowerCase();
      try {
        if (ct.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of params) obj[k] = v;
          resolve({ kind: 'form', data: obj, raw: body });
        } else if (ct.includes('application/json')) {
          resolve({ kind: 'json', data: body ? JSON.parse(body) : {}, raw: body });
        } else {
          resolve({ kind: 'raw', data: body, raw: body });
        }
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Update the meta.json's lastEdited timestamp; ignores errors so a single bad
 *  meta doesn't block the rest of the save. */
export function bumpLastEdited(planDir) {
  const metaPath = join(planDir, 'meta.json');
  if (!existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.lastEdited = new Date().toISOString();
    atomicWriteJson(metaPath, meta);
  } catch { /* swallow */ }
}

// ─── Browser opening ──────────────────────────────────────────────────────────

function isWSL() {
  try {
    const version = readFileSync('/proc/version', 'utf8');
    if (version.toLowerCase().includes('microsoft')) return true;
  } catch { /* not WSL */ }
  return !!process.env.WSL_INTEROP;
}

export function openBrowser(url) {
  const platform = process.platform;
  const wsl = isWSL();
  let cmd, args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32' || wsl) {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  // Check if the command exists
  const probe = spawnSync('which', [cmd], { stdio: 'ignore' });
  if (probe.status !== 0) {
    console.log(`  ℹ Open ${url} in your browser (no ${cmd} available)`);
    return false;
  }

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      console.log(`  ℹ Could not open browser: ${err.message}`);
      console.log(`  Open manually: ${url}`);
    });
    child.unref();
    return true;
  } catch (err) {
    console.log(`  ℹ Could not open browser: ${err.message}`);
    console.log(`  Open manually: ${url}`);
    return false;
  }
}

// ─── File helpers ──────────────────────────────────────────────────────────────

export function replaceTemplate(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

export async function readTemplate(name) {
  const path = join(TEMPLATES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Template not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

export function atomicWriteText(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

export function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, JSON.stringify(value, null, 2));
}

export function writePlanFile(slug, filename, content) {
  const dir = join(PLANS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  atomicWriteText(join(dir, filename), content);
}

export function readPlanFile(slug, filename) {
  return readFileSync(join(PLANS_DIR, slug, filename), 'utf-8');
}
