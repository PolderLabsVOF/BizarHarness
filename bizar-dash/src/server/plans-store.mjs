/**
 * src/server/plans-store.mjs
 *
 * v3.1.0 — Plan canvas editing.
 *
 * Each plan is a directory with a v2 canvas (`plan.json`) plus a
 * `meta.json` (title, status, tags, …) and an empty `comments.json`
 * for the v1 comment stream. The CLI's `cli/plan.mjs` uses a similar
 * on-disk layout but with `comments.json` and an mdx file; we treat
 * `plan.json` as the source of truth and ignore the mdx for v3.1.0
 * edits so the editor never races the markdown regenerator.
 *
 * Storage locations, in order of preference:
 *   1. <projectRoot>/plans/<slug>            (worktree, project-scoped)
 *   2. ~/.config/opencode/plans/<slug>       (global fallback)
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const GLOBAL_PLANS_DIR = join(HOME, '.config', 'opencode', 'plans');

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

function genId(prefix) {
  return `${prefix}_${randomBytes(5).toString('hex').slice(0, 9)}`;
}

const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function emptyCanvas(title = 'Untitled plan') {
  return {
    schemaVersion: 2,
    title,
    elements: [],
    connections: [],
    comments: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function defaultMeta(slug, title) {
  const now = new Date().toISOString();
  return {
    slug,
    title: title || slug,
    status: 'draft',
    tags: [],
    description: '',
    author: process.env.USER || 'drb0rk',
    created: now,
    lastEdited: now,
  };
}

export const plansStore = {
  GLOBAL_PLANS_DIR,

  /**
   * Resolve the on-disk directory for a slug. Searches the worktree
   * `plans/` first, then the global location.
   *
   * The caller passes `projectRoot` (typically the server's projectRoot).
   */
  resolveDir(slug, projectRoot) {
    const candidates = [];
    if (projectRoot) candidates.push(join(projectRoot, 'plans', slug));
    candidates.push(join(GLOBAL_PLANS_DIR, slug));
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return null;
  },

  /**
   * Same as resolveDir but allows creating a new plan in the worktree
   * (preferred) or falling back to the global directory.
   */
  ensureDir(slug, projectRoot) {
    const target = projectRoot
      ? join(projectRoot, 'plans', slug)
      : join(GLOBAL_PLANS_DIR, slug);
    mkdirSync(target, { recursive: true });
    return target;
  },

  list(projectRoot) {
    const seen = new Set();
    const out = [];
    const dirs = [];
    if (projectRoot) dirs.push(join(projectRoot, 'plans'));
    dirs.push(GLOBAL_PLANS_DIR);
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (seen.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (!st || !st.isDirectory()) continue;
        const meta = safeReadJSON(join(full, 'meta.json'), null);
        const canvas = safeReadJSON(join(full, 'plan.json'), null);
        const comments = safeReadJSON(join(full, 'comments.json'), null);
        const elementCount = canvas && Array.isArray(canvas.elements)
          ? canvas.elements.length
          : 0;
        const commentCount =
          (canvas && Array.isArray(canvas.comments) ? canvas.comments.length : 0) +
          (Array.isArray(comments) ? comments.length : 0);
        out.push({
          slug: entry,
          title: meta?.title || entry,
          status: meta?.status || 'draft',
          tags: meta?.tags || [],
          description: meta?.description || '',
          author: meta?.author || null,
          source: dir === GLOBAL_PLANS_DIR ? 'global' : 'worktree',
          elementCount,
          commentCount,
          created: meta?.created || null,
          lastEdited: meta?.lastEdited || null,
          mtime: st.mtimeMs,
          path: full,
        });
        seen.add(entry);
      }
    }
    out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return out;
  },

  get(slug, projectRoot) {
    if (!VALID_SLUG.test(slug || '')) return null;
    const dir = this.resolveDir(slug, projectRoot);
    if (!dir) return null;
    const meta = safeReadJSON(join(dir, 'meta.json'), null);
    const canvas = safeReadJSON(join(dir, 'plan.json'), null);
    const planMdx = safeReadText(join(dir, 'plan.mdx'));
    return {
      slug,
      dir,
      meta: meta || defaultMeta(slug, slug),
      canvas: canvas || emptyCanvas(meta?.title || slug),
      planMdx,
    };
  },

  /** Create a new plan. Returns the full plan record. */
  create(slug, body, projectRoot) {
    if (!VALID_SLUG.test(slug || '')) {
      const err = new Error('invalid slug — must match /^[a-z0-9][a-z0-9-]{0,63}$/');
      err.status = 400;
      throw err;
    }
    const dir = this.ensureDir(slug, projectRoot);
    if (existsSync(join(dir, 'meta.json')) || existsSync(join(dir, 'plan.json'))) {
      const err = new Error(`plan "${slug}" already exists`);
      err.status = 409;
      throw err;
    }
    const title = (body && body.title) || slug;
    const meta = {
      ...defaultMeta(slug, title),
      ...(body || {}),
      slug,
      created: new Date().toISOString(),
      lastEdited: new Date().toISOString(),
    };
    const canvas = emptyCanvas(title);
    this._writePlan(dir, meta, canvas);
    return { slug, dir, meta, canvas, planMdx: '' };
  },

  /** Update plan metadata (title, status, tags, description). */
  updateMeta(slug, body, projectRoot) {
    if (!VALID_SLUG.test(slug || '')) return null;
    const dir = this.resolveDir(slug, projectRoot);
    if (!dir) return null;
    const meta = safeReadJSON(join(dir, 'meta.json'), defaultMeta(slug, slug));
    if (typeof body?.title === 'string') meta.title = body.title.slice(0, 200);
    if (typeof body?.description === 'string') meta.description = body.description;
    if (Array.isArray(body?.tags)) meta.tags = body.tags.filter((t) => typeof t === 'string');
    if (typeof body?.status === 'string') {
      const valid = ['draft', 'approved', 'in-progress', 'done', 'rejected', 'archived'];
      if (valid.includes(body.status)) meta.status = body.status;
    }
    if (typeof body?.author === 'string') meta.author = body.author;
    meta.lastEdited = new Date().toISOString();
    const canvas = safeReadJSON(join(dir, 'plan.json'), emptyCanvas(meta.title));
    this._writePlan(dir, meta, canvas);
    return { slug, dir, meta, canvas, planMdx: safeReadText(join(dir, 'plan.mdx')) };
  },

  /** Delete a plan directory. */
  delete(slug, projectRoot) {
    const dir = this.resolveDir(slug, projectRoot);
    if (!dir) return false;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      return false;
    }
    return true;
  },

  /** Read the canvas (with auto-migration from mdx if no plan.json). */
  getCanvas(slug, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    if (!plan.canvas || !Array.isArray(plan.canvas.elements)) {
      plan.canvas = emptyCanvas(plan.meta?.title || slug);
    }
    return plan.canvas;
  },

  /** Save the full canvas (PUT). */
  saveCanvas(slug, canvas, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const next = sanitizeCanvas(canvas, plan.meta?.title || slug);
    const meta = { ...plan.meta, lastEdited: new Date().toISOString() };
    if (typeof next.title === 'string' && next.title.trim()) {
      meta.title = next.title.slice(0, 200);
    }
    this._writePlan(plan.dir, meta, next);
    return { ...plan, meta, canvas: next };
  },

  /** Add an element. Returns the new element. */
  addElement(slug, body, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const el = {
      id: genId('el'),
      type: typeof body?.type === 'string' ? body.type : 'note',
      title: typeof body?.title === 'string' ? body.title.slice(0, 200) : '',
      content: typeof body?.content === 'string' ? body.content : '',
      x: Number.isFinite(body?.x) ? body.x : 80,
      y: Number.isFinite(body?.y) ? body.y : 80,
      width: Number.isFinite(body?.width) ? body.width : 240,
      height: Number.isFinite(body?.height) ? body.height : 120,
      status: typeof body?.status === 'string' ? body.status : 'open',
    };
    canvas.elements.push(el);
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas, element: el };
  },

  /** Update an element. Returns the updated element. */
  updateElement(slug, elId, body, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const idx = canvas.elements.findIndex((e) => e.id === elId);
    if (idx === -1) return null;
    const cur = canvas.elements[idx];
    const next = { ...cur };
    if (typeof body?.type === 'string') next.type = body.type;
    if (typeof body?.title === 'string') next.title = body.title.slice(0, 200);
    if (typeof body?.content === 'string') next.content = body.content;
    if (Number.isFinite(body?.x)) next.x = body.x;
    if (Number.isFinite(body?.y)) next.y = body.y;
    if (Number.isFinite(body?.width)) next.width = body.width;
    if (Number.isFinite(body?.height)) next.height = body.height;
    if (typeof body?.status === 'string') next.status = body.status;
    canvas.elements[idx] = next;
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas, element: next };
  },

  /** Delete an element + its connections + its comments. */
  deleteElement(slug, elId, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const before = canvas.elements.length;
    canvas.elements = canvas.elements.filter((e) => e.id !== elId);
    if (canvas.elements.length === before) return null;
    canvas.connections = canvas.connections.filter(
      (c) => c.from !== elId && c.to !== elId && c.fromElementId !== elId && c.toElementId !== elId,
    );
    canvas.comments = canvas.comments.filter(
      (c) => c.elementId !== elId && c.id !== elId,
    );
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas };
  },

  /** Bulk-update element positions (drag end). */
  updatePositions(slug, positions, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const map = new Map();
    if (Array.isArray(positions)) {
      for (const p of positions) {
        if (p && typeof p.id === 'string') map.set(p.id, p);
      }
    }
    canvas.elements = canvas.elements.map((el) => {
      const p = map.get(el.id);
      if (!p) return el;
      const next = { ...el };
      if (Number.isFinite(p.x)) next.x = p.x;
      if (Number.isFinite(p.y)) next.y = p.y;
      return next;
    });
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas };
  },

  /** Add a connection between two elements. */
  addConnection(slug, body, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const from = body?.from || body?.fromElementId;
    const to = body?.to || body?.toElementId;
    if (!from || !to) return null;
    const conn = {
      id: genId('conn'),
      from,
      to,
      label: typeof body?.label === 'string' ? body.label : '',
    };
    canvas.connections.push(conn);
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas, connection: conn };
  },

  /** Delete a connection. */
  deleteConnection(slug, connId, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const before = canvas.connections.length;
    canvas.connections = canvas.connections.filter((c) => c.id !== connId);
    if (canvas.connections.length === before) return null;
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas };
  },

  /** Add a comment. Pass elementId to pin to an element; omit for canvas-level. */
  addComment(slug, elId, body, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const text = (body?.text || '').toString().trim();
    if (!text) return null;
    const comment = {
      id: genId('cmt'),
      elementId: elId || body?.elementId || null,
      author: (body?.author || process.env.USER || 'drb0rk').toString().slice(0, 60),
      text: text.slice(0, 4000),
      created: new Date().toISOString(),
      thread: [],
    };
    canvas.comments.push(comment);
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas, comment };
  },

  /** Delete a comment. */
  deleteComment(slug, cid, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const before = canvas.comments.length;
    canvas.comments = canvas.comments.filter((c) => c.id !== cid);
    if (canvas.comments.length === before) return null;
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas };
  },

  // ── internal ────────────────────────────────────────────────────────
  _writePlan(dir, meta, canvas) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(canvas, null, 2) + '\n', 'utf8');
    if (!existsSync(join(dir, 'comments.json'))) {
      writeFileSync(join(dir, 'comments.json'), '[]\n', 'utf8');
    }
  },
};

function sanitizeCanvas(raw, fallbackTitle) {
  const base = emptyCanvas(fallbackTitle);
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw };
  out.title = typeof raw.title === 'string' ? raw.title : base.title;
  out.elements = Array.isArray(raw.elements)
    ? raw.elements.map(sanitizeElement).filter(Boolean)
    : [];
  out.connections = Array.isArray(raw.connections)
    ? raw.connections
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          return {
            id: typeof c.id === 'string' ? c.id : genId('conn'),
            from: c.from || c.fromElementId || null,
            to: c.to || c.toElementId || null,
            label: typeof c.label === 'string' ? c.label : '',
          };
        })
        .filter((c) => c.from && c.to)
    : [];
  out.comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          return {
            id: typeof c.id === 'string' ? c.id : genId('cmt'),
            elementId: c.elementId || null,
            author: typeof c.author === 'string' ? c.author : 'drb0rk',
            text: typeof c.text === 'string' ? c.text : '',
            created: typeof c.created === 'string' ? c.created : new Date().toISOString(),
            thread: Array.isArray(c.thread) ? c.thread : [],
          };
        })
        .filter((c) => c.text)
    : [];
  if (!raw.viewport || typeof raw.viewport !== 'object') {
    out.viewport = { x: 0, y: 0, zoom: 1 };
  } else {
    out.viewport = {
      x: Number.isFinite(raw.viewport.x) ? raw.viewport.x : 0,
      y: Number.isFinite(raw.viewport.y) ? raw.viewport.y : 0,
      zoom: Number.isFinite(raw.viewport.zoom) ? raw.viewport.zoom : 1,
    };
  }
  return out;
}

function sanitizeElement(el) {
  if (!el || typeof el !== 'object') return null;
  return {
    id: typeof el.id === 'string' ? el.id : genId('el'),
    type: typeof el.type === 'string' ? el.type : 'note',
    title: typeof el.title === 'string' ? el.title : '',
    content: typeof el.content === 'string' ? el.content : '',
    x: Number.isFinite(el.x) ? el.x : 0,
    y: Number.isFinite(el.y) ? el.y : 0,
    width: Number.isFinite(el.width) ? el.width : 240,
    height: Number.isFinite(el.height) ? el.height : 120,
    status: typeof el.status === 'string' ? el.status : 'open',
  };
}
