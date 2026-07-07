/**
 * src/server/artifacts-store.mjs
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
 *   1. <projectRoot>/.bizar/artifacts/<slug>      (worktree, project-scoped)
 *   2. ~/.config/cline/artifacts/<slug>       (global fallback)
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const GLOBAL_PLANS_DIR = join(HOME, '.config', 'cline', 'artifacts');

// Atomic JSON write: serialize to a sibling temp file, then rename into
// place. `rename` is atomic on POSIX (same filesystem), so a crash
// between write and rename never leaves a half-written / corrupt file.
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

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

export const artifactsStore = {
  GLOBAL_PLANS_DIR,

  /**
   * Resolve the on-disk directory for a slug. Searches the worktree
   * `artifacts/` first, then the global location.
   *
   * The caller passes `projectRoot` (typically the server's projectRoot).
   */
  resolveDir(slug, projectRoot) {
    const candidates = [];
    if (projectRoot) candidates.push(join(projectRoot, '.bizar', 'artifacts', slug));
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
      ? join(projectRoot, '.bizar', 'artifacts', slug)
      : join(GLOBAL_PLANS_DIR, slug);
    mkdirSync(target, { recursive: true });
    return target;
  },

  list(projectRoot) {
    const seen = new Set();
    const out = [];
    const dirs = [];
    if (projectRoot) dirs.push(join(projectRoot, '.bizar', 'artifacts'));
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
    // v3.20.15 — read `artifact.mdx` (the CLI's source-of-truth name from
    // cli/artifact.mjs:writePlanFile), with `plan.mdx` as a fallback for
    // legacy v0 plans that still exist on disk. Without this fallback,
    // every artifact opened in the dashboard showed empty content even
    // though `artifact.mdx` was present and correct.
    const planMdx = safeReadText(join(dir, 'artifact.mdx'))
      || safeReadText(join(dir, 'plan.mdx'));
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

  /**
   * Add a comment. Pass elementId to pin to an element; omit for canvas-level.
   *
   * v3.5.4 (bug: pin) — Accepts optional `x` and `y` (finite numbers) on the
   * body. Stored verbatim on the comment so the UI can render a canvas pin
   * even for canvas-level comments. `elementId` and (x, y) are independent:
   * a comment can be pinned to an element AND have a position override, or
   * be canvas-only with no coords. Both fields default to null.
   */
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
    // v3.5.4 (bug: pin) — Persist canvas-pin coordinates if provided. We
    // accept either `x`/`y` as direct numbers or a `pin: {x, y}` object so
    // the frontend can send whichever shape is convenient.
    const rawX = body?.pin?.x ?? body?.x;
    const rawY = body?.pin?.y ?? body?.y;
    if (Number.isFinite(rawX)) comment.x = rawX;
    if (Number.isFinite(rawY)) comment.y = rawY;
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

  /**
   * v3.3.0 — Record the user's response to a question element on the
   * canvas. Marks the question resolved, attaches the choice + any
   * freeform text to the element's `question.response` field, and
   * also writes a canvas-level comment so the conversation shows up
   * in the existing comment thread.
   *
   * Returns { plan, canvas, element, response } or null if not found.
   */
  respondToQuestion(slug, qid, { choiceId, text } = {}, projectRoot) {
    const plan = this.get(slug, projectRoot);
    if (!plan) return null;
    const canvas = sanitizeCanvas(plan.canvas, plan.meta?.title || slug);
    const idx = canvas.elements.findIndex((e) => e.id === qid);
    if (idx === -1) return null;
    const el = canvas.elements[idx];
    if (el.type !== 'question') return null;
    const choices = Array.isArray(el.choices) ? el.choices : [];
    const choice = choices.find((c) => c.id === choiceId) || null;
    const response = {
      choiceId: choiceId || null,
      label: choice?.label || null,
      text: text || null,
      respondedAt: new Date().toISOString(),
    };
    const next = {
      ...el,
      status: 'resolved',
      response,
    };
    canvas.elements[idx] = next;
    // Drop a canvas comment so the conversation thread is visible.
    const comment = {
      id: typeof el.id === 'string' && el.id.length >= 9 ? `cmt_${el.id.slice(-9)}` : `cmt_${Date.now().toString(36)}`,
      elementId: el.id,
      author: 'user',
      text: response.text
        ? `Answer: ${response.label || response.choiceId || 'custom'} — ${response.text}`
        : `Answer: ${response.label || response.choiceId || 'custom'}`,
      created: response.respondedAt,
      thread: [],
    };
    canvas.comments.push(comment);
    this._writePlan(plan.dir, { ...plan.meta, lastEdited: new Date().toISOString() }, canvas);
    return { plan, canvas, element: next, response, comment };
  },

  /**
   * v3.22.0 — Submit user feedback for an artifact (glyph).
   *
   * Reads the on-disk comments + canvas question answers, writes a
   * structured `feedback.md` file the agent can read, marks the
   * artifact's `meta.json` status as `review`, and returns the
   * feedback summary.
   *
   * `body.answers` is `{ questionId, value }[]` — the agent-side
   * OpenQuestions answers. We persist them by writing them into the
   * feedback file so a follow-up read finds them, and (best-effort)
   * also by walking the canvas elements to mark question elements
   * as resolved with the chosen value.
   *
   * Returns:
   *   { ok: true, slug, feedbackFile, commentCount, questionCount }
   *
   * Returns:
   *   { ok: false, error } — if the slug doesn't exist or is invalid.
   */
  submitFeedback(slug, body, projectRoot) {
    if (!VALID_SLUG.test(slug || '')) {
      return { ok: false, error: 'invalid_slug' };
    }
    const dir = this.resolveDir(slug, projectRoot);
    if (!dir) return { ok: false, error: 'not_found' };

    const meta = safeReadJSON(join(dir, 'meta.json'), defaultMeta(slug, slug));
    const now = new Date().toISOString();

    // Gather free-placed comments. Prefer the canvas.comments array
    // (the v2 source of truth), fall back to comments.json if the
    // canvas is empty.
    const canvas = safeReadJSON(join(dir, 'plan.json'), emptyCanvas(meta.title || slug));
    const commentsFromCanvas = Array.isArray(canvas.comments) ? canvas.comments : [];
    const commentsFromFile = safeReadJSON(join(dir, 'comments.json'), []);
    const comments = commentsFromCanvas.length > 0
      ? commentsFromCanvas
      : (Array.isArray(commentsFromFile) ? commentsFromFile : []);

    // Gather OpenQuestions answers. The body may carry
    // `[{ questionId, value }]` (preferred) or, for compatibility,
    // already-resolved question elements on the canvas.
    const rawAnswers = Array.isArray(body?.answers) ? body.answers : [];
    const answers = [];
    for (const a of rawAnswers) {
      if (!a || typeof a !== 'object') continue;
      const qid = typeof a.questionId === 'string' ? a.questionId : '';
      const value = typeof a.value === 'string' || typeof a.value === 'number'
        ? String(a.value)
        : (a.value == null ? '' : String(a.value));
      if (!qid) continue;
      // Try to find the question's label from the canvas.
      let label = qid;
      let kind = null;
      let options = null;
      const el = Array.isArray(canvas.elements)
        ? canvas.elements.find((e) => e && e.id === qid)
        : null;
      if (el && el.type === 'question') {
        if (typeof el.title === 'string' && el.title) label = el.title;
        if (typeof el.kind === 'string') kind = el.kind;
        if (Array.isArray(el.options)) options = el.options;
        // Persist the answer onto the question element so subsequent
        // reads see the resolved state.
        el.status = 'resolved';
        el.response = {
          choiceId: typeof a.choiceId === 'string' ? a.choiceId : null,
          label: typeof a.label === 'string' ? a.label : null,
          value,
          respondedAt: now,
        };
      }
      answers.push({ questionId: qid, label, kind, options, value });
    }

    // Build the markdown feedback file.
    const submittedBy = (body && typeof body.submitter === 'string' && body.submitter)
      ? body.submitter
      : (process.env.USER || 'drb0rk');

    const lines = [];
    lines.push('---');
    lines.push(`glyph: ${slug}`);
    lines.push(`submittedAt: ${now}`);
    lines.push(`submittedBy: ${submittedBy}`);
    lines.push(`commentCount: ${comments.length}`);
    lines.push(`questionCount: ${answers.length}`);
    lines.push('---');
    lines.push('');
    lines.push(`# Feedback for ${meta.title || slug}`);
    lines.push('');
    lines.push('## Free-placed comments');
    if (comments.length === 0) {
      lines.push('_no free-placed comments_');
    } else {
      for (const c of comments) {
        const x = Number.isFinite(c.x) ? c.x : null;
        const y = Number.isFinite(c.y) ? c.y : null;
        const author = typeof c.author === 'string' ? c.author : 'drb0rk';
        const text = typeof c.text === 'string' ? c.text : '';
        const coord = x !== null && y !== null ? `(${x}, ${y})` : '(canvas)';
        lines.push(`- ${coord} — ${author}: ${text}`);
      }
    }
    lines.push('');
    lines.push('## Open-question answers');
    if (answers.length === 0) {
      lines.push('_no open-question answers_');
    } else {
      for (const qa of answers) {
        lines.push(`### Q: ${qa.label}`);
        lines.push(`A: ${qa.value}`);
        if (qa.kind) lines.push(`(kind: ${qa.kind})`);
        lines.push('');
      }
    }
    lines.push('## Full MDX source');
    lines.push('');
    lines.push('```mdx');
    const planMdx = safeReadText(join(dir, 'artifact.mdx'))
      || safeReadText(join(dir, 'plan.mdx'))
      || '';
    lines.push(planMdx);
    lines.push('```');
    lines.push('');

    const feedbackFile = join(dir, 'feedback.md');
    writeFileSync(feedbackFile, lines.join('\n'), 'utf8');

    // Update meta.json — mark status as `review` and bump lastEdited.
    meta.status = 'review';
    meta.lastEdited = now;
    atomicWriteJson(join(dir, 'meta.json'), meta);

    // Persist the updated canvas (so question responses survive).
    if (Array.isArray(canvas.elements)) {
      atomicWriteJson(join(dir, 'plan.json'), canvas);
    }

    return {
      ok: true,
      slug,
      feedbackFile,
      commentCount: comments.length,
      questionCount: answers.length,
    };
  },

  // ── internal ────────────────────────────────────────────────────────
  _writePlan(dir, meta, canvas) {
    mkdirSync(dir, { recursive: true });
    atomicWriteJson(join(dir, 'meta.json'), meta);
    atomicWriteJson(join(dir, 'plan.json'), canvas);
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
          // v3.5.4 (bug: pin) — Preserve canvas-pin coordinates when
          // re-reading a plan. `pin: {x, y}` and top-level `x`/`y` both
          // round-trip; we normalize to top-level on the stored shape.
          const pinX = c.pin?.x ?? c.x;
          const pinY = c.pin?.y ?? c.y;
          const next = {
            id: typeof c.id === 'string' ? c.id : genId('cmt'),
            elementId: c.elementId || null,
            author: typeof c.author === 'string' ? c.author : 'drb0rk',
            text: typeof c.text === 'string' ? c.text : '',
            created: typeof c.created === 'string' ? c.created : new Date().toISOString(),
            thread: Array.isArray(c.thread) ? c.thread : [],
          };
          if (Number.isFinite(pinX)) next.x = pinX;
          if (Number.isFinite(pinY)) next.y = pinY;
          return next;
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


/**
 * Best-effort artifact-slug extraction from a bg agent's assistant
 * message. Looks for backtick-quoted paths under `artifacts/<slug>/`
 * or for `<artifact-slug>` mentions. Returns the slug string or null.
 *
 * v3.19.0: New export so bg-poller.mjs compiles. The previous Plans
 * store had a similar helper; this is a clean re-implementation.
 */
export function extractArtifactFromMessage(text) {
  if (!text || typeof text !== 'string') return null;
  // Match backtick-wrapped slugs first: `artifacts/foo` or `my-plan`
  const backtick = text.match(/`([a-z0-9][a-z0-9_-]{1,40})`/i);
  if (backtick) return backtick[1];
  // Match <artifact-slug> style tags
  const angle = text.match(/<\s*([a-z0-9][a-z0-9_-]{1,40})\s*>/i);
  if (angle) return angle[1];
  // Match `bizar artifact new <slug>` command-like lines
  const cmd = text.match(/(?:artifact|plan)\s+(?:new|create)\s+([a-z0-9][a-z0-9_-]{1,40})/i);
  if (cmd) return cmd[1];
  return null;
}
