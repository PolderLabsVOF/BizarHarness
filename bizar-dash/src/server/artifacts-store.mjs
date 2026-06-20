/**
 * src/server/artifacts-store.mjs
 *
 * v3.5.5 — Tangible artifacts emitted by agents.
 *
 * An "artifact" is a self-contained HTML file the agent declares when
 * it has produced something worth showing the user — a dashboard mock,
 * a generated report, a design comp, a working demo, etc. The
 * convention is: the agent wraps the HTML in a fenced block:
 *
 *     ```html-artifact
 *     <!doctype html>...
 *     ```
 *
 * The bg-poller scans the final assistant message for that block and
 * stores the HTML here. Tasks can be linked to one or more artifacts
 * via `task.metadata.artifactId` / `task.metadata.artifactIds[]`.
 *
 * Storage:
 *   ~/.bizar/artifacts/<id>.html          — the artifact body
 *   ~/.bizar/artifacts/<id>.meta.json     — metadata (task, name, ts, size)
 *
 * The .meta.json sidecar pattern keeps the on-disk format self-
 * describing without forcing a centralized index — `list()` just
 * globs the directory. Read/write/delete are all atomic against the
 * sidecar so a torn write to one file doesn't break the other.
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  renameSync,
} from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const ARTIFACTS_DIR = join(HOME, '.bizar', 'artifacts');

if (!existsSync(ARTIFACTS_DIR)) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
  } catch {
    // best effort — surface errors at call time
  }
}

function genId() {
  return `art_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function pickExtension(contentType) {
  if (!contentType) return '.html';
  if (contentType.includes('html')) return '.html';
  if (contentType.includes('markdown') || contentType.includes('md')) return '.md';
  if (contentType.includes('json')) return '.json';
  if (contentType.includes('svg')) return '.svg';
  if (contentType.includes('xml')) return '.xml';
  if (contentType.includes('text')) return '.txt';
  return '.bin';
}

export const artifactsStore = {
  ARTIFACTS_DIR,

  /**
   * Persist a new artifact. Returns the metadata record. The body is
   * written atomically via tmp + rename; the sidecar is written last
   * so a partial save leaves a 0-byte body with no metadata (which
   * `list()` skips).
   *
   * @param {{ taskId?: string, name?: string, contentType?: string, content: string, projectId?: string }} input
   * @returns {{ id: string, taskId: string|null, name: string, contentType: string, path: string, size: number, createdAt: number, projectId: string|null }}
   */
  save(input) {
    if (!input || typeof input.content !== 'string') {
      throw new Error('artifactsStore.save: content is required');
    }
    const id = genId();
    const contentType = (input.contentType || 'text/html').toString();
    const ext = pickExtension(contentType);
    const bodyPath = join(ARTIFACTS_DIR, `${id}${ext}`);
    const metaPath = join(ARTIFACTS_DIR, `${id}.meta.json`);
    const tmp = `${bodyPath}.tmp`;

    // Atomic write: body first, then metadata.
    writeFileSync(tmp, input.content, 'utf8');
    try {
      renameSync(tmp, bodyPath);
    } catch {
      // Fallback for exotic filesystems where renameSync isn't atomic.
      // Just copy + unlink the tmp.
      writeFileSync(bodyPath, input.content, 'utf8');
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }

    const meta = {
      id,
      taskId: input.taskId || null,
      projectId: input.projectId || null,
      name: (input.name || `artifact-${id}`).toString().slice(0, 200),
      contentType,
      path: bodyPath,
      size: Buffer.byteLength(input.content, 'utf8'),
      createdAt: Date.now(),
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    return meta;
  },

  /**
   * Read the metadata for one artifact. Returns null when the sidecar
   * is missing.
   */
  get(id) {
    if (!id) return null;
    const metaPath = join(ARTIFACTS_DIR, `${id}.meta.json`);
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      return null;
    }
  },

  /**
   * Read the body + metadata. Returns null when either is missing or
   * the body file was deleted out from under the sidecar.
   */
  read(id) {
    const meta = this.get(id);
    if (!meta) return null;
    if (!existsSync(meta.path)) return null;
    try {
      return { meta, content: readFileSync(meta.path, 'utf8') };
    } catch {
      return null;
    }
  },

  /**
   * List all artifacts, optionally filtered by taskId. Newest first.
   *
   * @param {{ taskId?: string, projectId?: string, limit?: number }} [opts]
   * @returns {Array}
   */
  list(opts = {}) {
    if (!existsSync(ARTIFACTS_DIR)) return [];
    const wantedTask = opts.taskId || null;
    const wantedProject = opts.projectId || null;
    const out = [];
    let files;
    try {
      files = readdirSync(ARTIFACTS_DIR).filter((f) => f.endsWith('.meta.json'));
    } catch {
      return [];
    }
    for (const f of files) {
      const full = join(ARTIFACTS_DIR, f);
      try {
        const raw = readFileSync(full, 'utf8');
        const meta = JSON.parse(raw);
        if (wantedTask && meta.taskId !== wantedTask) continue;
        if (wantedProject && meta.projectId && meta.projectId !== wantedProject) continue;
        // Drop entries whose body was deleted (orphaned sidecar).
        if (meta.path && existsSync(meta.path)) {
          try {
            meta.size = statSync(meta.path).size;
          } catch { /* keep original size */ }
        }
        out.push(meta);
      } catch {
        // skip corrupt sidecar
      }
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (typeof opts.limit === 'number' && opts.limit > 0) {
      return out.slice(0, opts.limit);
    }
    return out;
  },

  /**
   * Best-effort delete of body + sidecar. Returns true when the
   * sidecar was removed; false when the artifact never existed.
   */
  delete(id) {
    if (!id) return false;
    const meta = this.get(id);
    if (!meta) return false;
    try { unlinkSync(meta.path); } catch { /* ignore */ }
    try { unlinkSync(join(ARTIFACTS_DIR, `${id}.meta.json`)); } catch { /* ignore */ }
    return true;
  },

  /**
   * Find an existing artifact id for a task. Useful when a task can
   * only have one artifact (the common case) and we want to avoid
   * creating duplicates on agent re-runs.
   */
  findIdForTask(taskId) {
    if (!taskId) return null;
    const list = this.list({ taskId });
    return list.length > 0 ? list[0].id : null;
  },
};

/**
 * Extract the first `html-artifact` fenced block from a message body.
 * Used by the bg-poller to detect when an agent has produced an
 * artifact at the end of its final message.
 *
 * Accepted fences:
 *   ```html-artifact
 *   ...HTML...
 *   ```
 *   ```htmlartifact
 *   ...HTML...
 *   ```
 *
 * Returns null when no block is present, otherwise { html, name? }
 * where `name` comes from an optional HTML comment of the form
 * `<!--artifact-name:Foo Bar-->` on the first line.
 */
export function extractArtifactFromMessage(content) {
  if (typeof content !== 'string' || !content) return null;
  // Match either ```html-artifact or ```htmlartifact (case-insensitive)
  // followed by anything up to the next ``` on its own line.
  const m = content.match(/```html[-_]?artifact[ \t]*\n([\s\S]*?)```/i);
  if (!m) return null;
  let html = m[1].trim();
  let name = null;
  // Optional first-line name comment: <!--artifact-name:Name Here-->
  const nameMatch = html.match(/^<!--\s*artifact-name\s*:\s*([^\n>]+?)\s*-->/i);
  if (nameMatch) {
    name = nameMatch[1].trim().slice(0, 200);
    html = html.slice(nameMatch[0].length).trim();
  }
  return { html, name: name || null };
}

export default artifactsStore;
