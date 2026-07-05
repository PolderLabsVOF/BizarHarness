/**
 * cli/artifact-server.mjs
 *
 * HTTP server and request routing for artifact viewing/editing.
 * Extracted from artifact.mjs to separate server logic from CLI and rendering.
 */
import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  getTemplate,
  getTemplateNames,
  listTemplates,
  printTemplates,
  substitute,
  buildVars,
  saveTemplate as saveTemplateToLibrary,
  deleteTemplate as deleteLibraryTemplate,
} from './artifact-templates.mjs';

import {
  CANVAS_SCHEMA_VERSION,
  emptyCanvas,
  readCanvasFile,
  writeCanvasFile,
  loadOrMigrateCanvas,
  canvasToMarkdown,
  makeElementId,
  makeConnectionId,
  makeCommentId,
  makeReplyId,
  readPlanMeta,
  renderElementHTML,
  renderConnectionHTML,
  renderCommentPinHTML,
  renderCommentThreadHTML,
  renderReplyHTML,
  escapeHtml,
  formatDate,
  isHtmxRequest,
  decodeHtmxFormBody,
  renderElementBody,
  renderCommentLi,
  renderCommentListHtml,
  renderCommentCountHtml,
  readRequestBody,
  bumpLastEdited,
  openBrowser,
  replaceTemplate,
  readTemplate,
  atomicWriteText,
  atomicWriteJson,
} from './artifact-render.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'artifact');
const PLANS_DIR = join(PROJECT_ROOT, 'artifacts');
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

// ─── Stdin question helper ────────────────────────────────────────────────────

function question(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once('data', (data) => resolve(data.toString()));
  });
}

// ─── Signal wait helper ──────────────────────────────────────────────────────

function waitForSignal(closeFn) {
  return new Promise((resolve) => {
    const finish = async () => {
      await closeFn();
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
  });
}

// ─── Local HTTP server ────────────────────────────────────────────────────────

/**
 * Starts a local HTTP server in the SAME process as the CLI.
 * Tries port 4321 first, falls back to 4322, 4323, etc. (max 10 attempts).
 * Returns { port, close } where close() stops the server.
 */
export async function startServer(slug, planDir, startPort = 4321) {
  let port = startPort;
  let maxAttempts = 10;
  let server;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    port = startPort + attempt;
    try {
      server = await new Promise((resolve, reject) => {
        const srv = createServer((req, res) => {
          // Fire-and-forget: handleRequest is async because PUT/POST bodies
          // are streamed, but Node's HTTP server is happy to wait for res.end().
          handleRequest(req, res, slug, planDir, port).catch((err) => {
            console.error(`[${new Date().toISOString()}] ERROR: ${err.stack || err.message}`);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            try { res.end('Server error: ' + (err.message || String(err))); } catch { /* already closed */ }
          });
        });
        srv.on('error', reject);
        srv.listen(port, '127.0.0.1', () => resolve(srv));
      });
      break;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
        continue; // try next port
      }
      throw err;
    }
  }

  if (!server) throw new Error(`Could not find available port in range ${startPort}–${startPort + maxAttempts - 1}`);

  const actualPort = server.address().port;

  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });

  return { port: actualPort, close };
}

// ─── Request handler ─────────────────────────────────────────────────────────

/**
 * Handle incoming HTTP requests.
 */
async function handleRequest(req, res, slug, planDir, serverPort) {
  const now = new Date().toISOString();
  // Use path-only URL parsing to avoid host-header injection
  const requestUrl = typeof req.url === 'string' ? req.url : '/';
  const pathname = requestUrl.split('?')[0].split('#')[0];

  // Log request to stderr
  console.error(`[${now}] ${req.method} ${pathname}`);

  // CORS — allow from any origin (user may be on a different port)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── Serve artifact.html ─────────────────────────────────────────────────
    if (pathname === `/${slug}/` || pathname === `/${slug}` || pathname === '/') {
      const htmlPath = join(planDir, 'artifact.html');
      if (!existsSync(htmlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('artifact.html not found. Run `bizar artifact new ${slug}` first.');
        return;
      }
      const html = readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ── Self-hosted htmx — served from templates/artifact/htmx.min.js ──────
    if (pathname === '/htmx.min.js' && req.method === 'GET') {
      const htmxPath = join(TEMPLATES_DIR, 'htmx.min.js');
      if (!existsSync(htmxPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('htmx.min.js not found in templates/artifact/');
        return;
      }
      const buf = readFileSync(htmxPath);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(buf);
      return;
    }

    // ── RESTful, slug-scoped routes ──────────────────────────────────────────
    if (pathname.startsWith('/api/') && pathname.split('/').length >= 4) {
      const parts = pathname.split('/').filter(Boolean);
      const urlSlug = parts[1];
      const resource = parts[2];

      if (urlSlug !== slug) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end(`Forbidden: this server is bound to artifact "${slug}"`);
        return;
      }

      const subParts = parts.slice(2);
      const subPath = subParts.join('/');

      // ── v2 canvas endpoints ─────────────────────────────────────────────────
      // GET /api/<slug>/canvas
      if (subPath === 'canvas' && req.method === 'GET') {
        const meta = readPlanMeta(planDir);
        const title = (meta && meta.title) || slug;
        const canvas = loadOrMigrateCanvas(planDir, title);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(canvas));
        return;
      }

      // PUT /api/<slug>/canvas
      if (subPath === 'canvas' && req.method === 'PUT') {
        let parsed;
        try {
          parsed = await readRequestBody(req);
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON body: ' + (err && err.message ? err.message : String(err)));
          return;
        }
        let next;
        try {
          if (parsed.kind === 'raw' && typeof parsed.data === 'string') {
            next = JSON.parse(parsed.data);
          } else if (parsed.kind === 'form') {
            next = decodeHtmxFormBody(parsed.data);
          } else {
            next = parsed.data;
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON: ' + (err && err.message ? err.message : String(err)));
          return;
        }
        if (!next || typeof next !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON object');
          return;
        }
        if (!Array.isArray(next.elements)) next.elements = [];
        if (!Array.isArray(next.connections)) next.connections = [];
        if (!Array.isArray(next.comments)) next.comments = [];
        if (!next.viewport || typeof next.viewport !== 'object') {
          next.viewport = { x: 0, y: 0, zoom: 1 };
        }
        if (typeof next.title !== 'string') next.title = 'Untitled artifact';
        next.schemaVersion = CANVAS_SCHEMA_VERSION;
        writeCanvasFile(planDir, next);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<span class="save-status saved">Saved</span>');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }

      // GET /api/<slug>/markdown-export
      if (subPath === 'markdown-export' && req.method === 'GET') {
        const meta = readPlanMeta(planDir);
        const title = (meta && meta.title) || slug;
        const canvas = loadOrMigrateCanvas(planDir, title);
        const md = canvasToMarkdown(canvas);
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(md);
        return;
      }

      // GET /api/<slug>/elements
      if (subPath === 'elements' && req.method === 'GET') {
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(canvas.elements));
        return;
      }

      // POST /api/<slug>/elements
      if (subPath === 'elements' && req.method === 'POST') {
        const parsed = await readRequestBody(req);
        const body = parsed.data;
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON object');
          return;
        }
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const el = {
          id: makeElementId(),
          type: typeof body.type === 'string' ? body.type : 'text',
          x: typeof body.x === 'number' ? body.x : 100,
          y: typeof body.y === 'number' ? body.y : 100,
          width: typeof body.width === 'number' ? body.width : 240,
          height: typeof body.height === 'number' ? body.height : 160,
        };
        if (typeof body.title === 'string') el.title = body.title;
        if (typeof body.content === 'string') el.content = body.content;
        if (typeof body.language === 'string') el.language = body.language;
        if (typeof body.component === 'string') el.component = body.component;
        if (typeof body.label === 'string') el.label = body.label;
        if (typeof body.placeholder === 'string') el.placeholder = body.placeholder;
        if (typeof body.value === 'string') el.value = body.value;
        if (typeof body.body === 'string') el.body = body.body;
        canvas.elements.push(el);
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderElementHTML(el));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(el));
        }
        return;
      }

      // /api/<slug>/elements/<id>  (PUT, DELETE)
      const elementMatch = subPath.match(/^elements\/([^\/]+)$/);
      if (elementMatch) {
        const elementId = elementMatch[1];
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const idx = canvas.elements.findIndex(function (e) { return e.id === elementId; });

        if (req.method === 'PUT') {
          if (idx < 0) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Element not found');
            return;
          }
          const parsed = await readRequestBody(req);
          const body = parsed.data;
          if (!body || typeof body !== 'object') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Expected a JSON object');
            return;
          }
          const cur = canvas.elements[idx];
          const allowedKeys = ['type', 'x', 'y', 'width', 'height', 'title', 'content',
            'language', 'component', 'label', 'placeholder', 'value', 'body'];
          for (let i = 0; i < allowedKeys.length; i++) {
            const k = allowedKeys[i];
            if (k in body) cur[k] = body[k];
          }
          writeCanvasFile(planDir, canvas);
          bumpLastEdited(planDir);
          if (isHtmxRequest(req)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderElementHTML(cur));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cur));
          }
          return;
        }

        if (req.method === 'DELETE') {
          if (idx < 0) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Element not found');
            return;
          }
          canvas.elements.splice(idx, 1);
          canvas.connections = canvas.connections.filter(function (c) {
            return c.from !== elementId && c.to !== elementId;
          });
          for (let i = 0; i < canvas.comments.length; i++) {
            if (canvas.comments[i].elementId === elementId) {
              canvas.comments[i].elementId = null;
            }
          }
          writeCanvasFile(planDir, canvas);
          bumpLastEdited(planDir);
          if (isHtmxRequest(req)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, removed: elementId }));
          }
          return;
        }
      }

      // GET /api/<slug>/connections
      if (subPath === 'connections' && req.method === 'GET') {
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(canvas.connections));
        return;
      }

      // POST /api/<slug>/connections
      if (subPath === 'connections' && req.method === 'POST') {
        const parsed = await readRequestBody(req);
        const body = parsed.data;
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON object');
          return;
        }
        if (typeof body.from !== 'string' || typeof body.to !== 'string') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing from or to');
          return;
        }
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const elementIds = new Set(canvas.elements.map(function (e) { return e.id; }));
        if (!elementIds.has(body.from) || !elementIds.has(body.to)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('from/to element not found');
          return;
        }
        const conn = {
          id: makeConnectionId(),
          from: body.from,
          to: body.to,
          type: ['arrow', 'line', 'dependency'].indexOf(body.type) >= 0 ? body.type : 'arrow',
        };
        if (typeof body.label === 'string') conn.label = body.label;
        canvas.connections.push(conn);
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderConnectionHTML(conn));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(conn));
        }
        return;
      }

      // DELETE /api/<slug>/connections/<id>
      const connectionMatch = subPath.match(/^connections\/([^\/]+)$/);
      if (connectionMatch && req.method === 'DELETE') {
        const connectionId = connectionMatch[1];
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const before = canvas.connections.length;
        canvas.connections = canvas.connections.filter(function (c) { return c.id !== connectionId; });
        const removed = before !== canvas.connections.length;
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (!removed) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Connection not found');
          return;
        }
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, removed: connectionId }));
        }
        return;
      }

      // GET /api/<slug>/comments?elementId=...
      if (subPath === 'comments' && req.method === 'GET') {
        const query = requestUrl.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const hasElementId = params.has('elementId');
        const elementId = params.get('elementId') || '';

        if (hasElementId) {
          const meta = readPlanMeta(planDir);
          const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
          let result = canvas.comments;
          if (elementId === 'nil' || elementId === 'null') {
            result = canvas.comments.filter(function (c) { return !c.elementId; });
          } else if (elementId !== '') {
            result = canvas.comments.filter(function (c) { return c.elementId === elementId; });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }
        // Fall through to v1 handler
      }

      // POST /api/<slug>/comments
      if (subPath === 'comments' && req.method === 'POST') {
        const parsed = await readRequestBody(req);
        const body = parsed.data;
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON or form object');
          return;
        }
        // v1 discriminator: sectionId is a non-empty string
        const isV1 = typeof body.sectionId === 'string' && body.sectionId;
        if (isV1) {
          const sectionId = body.sectionId;
          const text = body.text;
          const author = body.author;
          if (!text) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing text');
            return;
          }
          const comments = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
          const newComment = {
            id: makeCommentId(),
            sectionId,
            text,
            author: author || process.env.USER || 'anonymous',
            timestamp: new Date().toISOString(),
          };
          comments.push(newComment);
          atomicWriteJson(join(planDir, 'comments.json'), comments);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCommentLi(newComment));
          return;
        }
        // v2 path
        if (typeof body.text !== 'string' || !body.text) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing text');
          return;
        }
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const c = {
          id: makeCommentId(),
          x: typeof body.x === 'number' ? body.x : 0,
          y: typeof body.y === 'number' ? body.y : 0,
          elementId: typeof body.elementId === 'string' ? body.elementId : null,
          author: (typeof body.author === 'string' && body.author) || process.env.USER || 'anonymous',
          text: body.text,
          created: new Date().toISOString(),
          thread: [],
        };
        canvas.comments.push(c);
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCommentPinHTML(c, canvas.comments.length - 1));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(c));
        }
        return;
      }

      // PUT /api/<slug>/comments/<id>
      if (subPath.match(/^comments\/[^\/]+$/) && req.method === 'PUT') {
        const commentMatch = subPath.match(/^comments\/([^\/]+)$/);
        const commentId = commentMatch[1];
        const parsed = await readRequestBody(req);
        const body = parsed.data;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON object');
          return;
        }
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const idx = canvas.comments.findIndex(function (c) { return c.id === commentId; });
        if (idx < 0) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Comment not found');
          return;
        }
        const cur = canvas.comments[idx];
        if (typeof body.text === 'string') cur.text = body.text;
        if (typeof body.x === 'number') cur.x = body.x;
        if (typeof body.y === 'number') cur.y = body.y;
        if (typeof body.elementId === 'string' || body.elementId === null) {
          cur.elementId = body.elementId;
        }
        if (typeof body.reply === 'string' && body.reply) {
          if (!Array.isArray(cur.thread)) cur.thread = [];
          cur.thread.push({
            id: makeReplyId(),
            author: (typeof body.replyAuthor === 'string' && body.replyAuthor) || 'ai',
            text: body.reply,
            created: new Date().toISOString(),
          });
        }
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCommentThreadHTML(cur));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cur));
        }
        return;
      }

      // DELETE /api/<slug>/comments/<id>
      if (subPath.match(/^comments\/[^\/]+$/) && req.method === 'DELETE') {
        const commentMatch = subPath.match(/^comments\/[^\/]+$/);
        const commentId = commentMatch[1];
        const meta = readPlanMeta(planDir);
        const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
        const idx = canvas.comments.findIndex(function (c) { return c.id === commentId; });
        if (idx < 0) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Comment not found');
          return;
        }
        canvas.comments.splice(idx, 1);
        writeCanvasFile(planDir, canvas);
        bumpLastEdited(planDir);
        if (isHtmxRequest(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, removed: commentId }));
        }
        return;
      }

      // ── v1 routes (legacy) ───────────────────────────────────────────────
      // GET /api/<slug>/artifact
      if (resource === 'artifact' && req.method === 'GET') {
        const mdx = readFileSync(join(planDir, 'artifact.mdx'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(mdx);
        return;
      }

      // PUT /api/<slug>/artifact
      if (resource === 'artifact' && req.method === 'PUT') {
        const parsed = await readRequestBody(req);
        const content = parsed.kind === 'form' ? (parsed.data.content || '') : parsed.data;
        if (typeof content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a "content" form field or a raw text body');
          return;
        }
        try {
          atomicWriteText(join(planDir, 'artifact.mdx'), content);
          bumpLastEdited(planDir);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('saved');
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Save failed: ' + err.message);
        }
        return;
      }

      // GET /api/<slug>/comments?format=html&sectionId=...
      if (resource === 'comments' && req.method === 'GET') {
        const query = requestUrl.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const format = (params.get('format') || 'json').toLowerCase();
        const sectionId = params.get('sectionId') || '';
        const comments = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
        if (format === 'html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCommentListHtml(comments, sectionId));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(comments));
        }
        return;
      }

      // PUT /api/<slug>/comments
      if (resource === 'comments' && req.method === 'PUT') {
        const parsed = await readRequestBody(req);
        let arr;
        try {
          arr = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON');
          return;
        }
        if (!Array.isArray(arr)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON array of comments');
          return;
        }
        atomicWriteJson(join(planDir, 'comments.json'), arr);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      // GET /api/<slug>/count?sectionId=...
      if (resource === 'count' && req.method === 'GET') {
        const query = requestUrl.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const sectionId = params.get('sectionId') || '';
        const comments = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
        const n = comments.filter((c) => !sectionId || c.sectionId === sectionId).length;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCommentCountHtml(n));
        return;
      }
    }

    // Legacy routes (no slug prefix)
    if (pathname === '/api/artifact' && req.method === 'GET') {
      const mdx = readFileSync(join(planDir, 'artifact.mdx'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(mdx);
      return;
    }

    if (pathname === '/api/artifact' && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          atomicWriteText(join(planDir, 'artifact.mdx'), body);
          const meta = JSON.parse(readFileSync(join(planDir, 'meta.json'), 'utf-8'));
          meta.lastEdited = new Date().toISOString();
          atomicWriteJson(join(planDir, 'meta.json'), meta);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (pathname === '/api/comments' && req.method === 'GET') {
      const comments = readFileSync(join(planDir, 'comments.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(comments);
      return;
    }

    if (pathname === '/api/comments' && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          JSON.parse(body);
          atomicWriteText(join(planDir, 'comments.json'), body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (pathname === '/api/comments' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { sectionId, text, author } = JSON.parse(body);
          if (!sectionId || !text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sectionId or text' }));
            return;
          }
          const comments = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
          comments.push({
            id: Date.now().toString(),
            sectionId,
            text,
            author: author || process.env.USER || 'anonymous',
            created: new Date().toISOString(),
          });
          atomicWriteJson(join(planDir, 'comments.json'), comments);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, comments }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (pathname === '/api/regenerate' && req.method === 'POST') {
      try {
        const planMdx = readFileSync(join(planDir, 'artifact.mdx'), 'utf-8');
        const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
        const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');
        const meta = JSON.parse(metaJson);
        const planHtmlTemplate = readFileSync(join(TEMPLATES_DIR, 'artifact.html.template'), 'utf-8');
        const planJson = JSON.stringify(planMdx);
        const vars = {
          title: meta.title || slug,
          slug: meta.slug || slug,
          status: meta.status || 'draft',
          created: meta.created || new Date().toISOString(),
          lastEdited: meta.lastEdited || new Date().toISOString(),
          author: meta.author || 'unknown',
          planJson,
          commentsJson,
          metaJson,
        };
        let htmlContent = planHtmlTemplate;
        for (const [key, value] of Object.entries(vars)) {
          htmlContent = htmlContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        atomicWriteText(join(planDir, 'artifact.html'), htmlContent);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
}
