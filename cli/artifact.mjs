/**
 * bizar artifact <subcommand>
 *
 * Subcommands:
 *   new <slug>                 Create a new artifact
 *                              Flags: --template <name> | --template <path>
 *   open <slug>                Open an existing artifact in the browser
 *   list                       List all artifacts
 *   delete <slug>              Delete a artifact (with confirmation)
 *   export <slug>              Export artifact.mdx to stdout
 *   templates                  List available artifact templates
 *   template save <name> <artifact-slug>   Save a artifact as a library template
 *   template delete <name>     Delete a user-added library template
 *   help                       Show this help
 *
 * The local server runs in the SAME process as the CLI (no child process).
 * The CLI keeps the process alive by waiting on a Promise that never resolves
 * until the user presses Ctrl-C (the server is stopped on SIGINT).
 */

import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'artifact');
const PLANS_DIR = join(PROJECT_ROOT, 'artifacts');
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

// ─── Flag parsing ────────────────────────────────────────────────────────────

/**
 * Parse a string of CLI args into { positional, flags }.
 * Supports --flag value and --flag=value styles. Booleans (no value)
 * are stored as true.
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next != null && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ─── Slug validation ─────────────────────────────────────────────────────────

// As per spec: ^[a-z0-9][a-z0-9-]{0,63}$
// 1-64 chars, lowercase, hyphens allowed, must start with alphanumeric
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validateSlug(slug) {
  if (!slug || !SLUG_REGEX.test(slug)) {
    console.error(
      `  ✗ Invalid slug "${slug}". Slug must be lowercase, may contain hyphens,\n` +
      `    must start with an alphanumeric character, and be 1–64 characters.`
    );
    return false;
  }
  return true;
}

// ─── Title case ──────────────────────────────────────────────────────────────

function titleCase(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Template replacement ────────────────────────────────────────────────────

function replaceTemplate(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// ─── File helpers ────────────────────────────────────────────────────────────

async function readTemplate(name) {
  const path = join(TEMPLATES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Template not found: ${path}`);
  }
  return readFile(path, 'utf-8');
}

function atomicWriteText(filePath, content) {
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

function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, JSON.stringify(value, null, 2));
}

function writePlanFile(slug, filename, content) {
  const dir = join(PLANS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  atomicWriteText(join(dir, filename), content);
}

function readPlanFile(slug, filename) {
  return readFileSync(join(PLANS_DIR, slug, filename), 'utf-8');
}

// ─── Canvas state (v2) ──────────────────────────────────────────────────────

/**
 * The current canvas schema. v2 introduces elements, connections, viewport,
 * and threaded comments. The single source of truth for new artifacts.
 */
const CANVAS_SCHEMA_VERSION = 2;

function emptyCanvas(title) {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    title: title || 'Untitled artifact',
    elements: [],
    connections: [],
    comments: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function readCanvasFile(planDir) {
  const path = join(planDir, 'artifact.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCanvasFile(planDir, canvas) {
  atomicWriteJson(join(planDir, 'artifact.json'), canvas);
}

/**
 * Migration shim: if a v1 artifact (artifact.mdx) exists but no artifact.json, build
 * a v2 canvas with the mdx content as a single "text" element on the
 * canvas. Idempotent — won't overwrite an existing artifact.json.
 *
 * Returns the resulting canvas.
 */
function loadOrMigrateCanvas(planDir, fallbackTitle) {
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
function canvasToMarkdown(canvas) {
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
        // Unknown component — emit a placeholder so it isn't lost.
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

// ─── ID generators ──────────────────────────────────────────────────────────

function makeElementId() {
  return 'el_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeConnectionId() {
  return 'conn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeCommentId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeReplyId() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Best-effort read of artifacts/<slug>/meta.json. Returns null on missing or
 *  invalid JSON. Used by the canvas endpoints to surface the artifact title. */
function readPlanMeta(planDir) {
  const metaPath = join(planDir, 'meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── new <slug> flow ─────────────────────────────────────────────────────────

/**
 * Resolve the content for a new artifact from the template system.
 * - If template is the string "blank" or null → use artifact.mdx.template (the v1 default)
 * - If template is a built-in name (feature-design, etc.) → use that template
 * - If template is an absolute path to a .mdx file → use that file
 * - Otherwise → throw with a helpful error
 *
 * Returns the MDX content with {{vars}} already substituted.
 */
async function resolveTemplateContent(template, vars) {
  if (template == null || template === '' || template === 'blank') {
    const tpl = await readTemplate('artifact.mdx.template');
    return { content: replaceTemplate(tpl, vars), templateName: 'blank', source: 'built-in' };
  }

  // Absolute path to a user file
  if (isAbsolute(template) || template.endsWith('.mdx') || template.startsWith('.')) {
    let p = template;
    if (!isAbsolute(p)) p = resolve(p);
    if (existsSync(p)) {
      const fileContent = readFileSync(p, 'utf-8');
      return {
        content: substitute(fileContent, vars),
        templateName: basename(p).replace(/\.mdx$/, ''),
        source: 'file',
      };
    }
  }

  // Built-in name
  const tpl = getTemplate(template);
  if (!tpl) {
    const available = getTemplateNames().join(', ');
    throw new Error(
      `Unknown template "${template}".\n` +
      `    Built-in templates: ${available}.\n` +
      `    Or pass an absolute path to a .mdx file.`
    );
  }

  if (tpl.content == null) {
    // "blank" via getTemplate — same as the default branch
    const blankTpl = await readTemplate('artifact.mdx.template');
    return { content: replaceTemplate(blankTpl, vars), templateName: 'blank', source: 'built-in' };
  }

  return { content: substitute(tpl.content, vars), templateName: tpl.name, source: tpl.source };
}

async function createArtifact(slug, { template = null } = {}) {
  const planDir = join(PLANS_DIR, slug);

  // Step 1: validate
  if (!validateSlug(slug)) return false;

  // Step 2: check existence
  if (existsSync(planDir)) {
    console.error(`  ✗ Artifact "${slug}" already exists at ${planDir}`);
    console.error(`    Use "bizar artifact open ${slug}" to open it.`);
    return false;
  }

  // Step 3: create directory
  mkdirSync(planDir, { recursive: true });

  // Step 4: generate values
  const now = new Date().toISOString();
  const title = titleCase(slug);
  const author = process.env.USER || 'unknown';
  const vars = {
    title,
    slug,
    author,
    created: now,
    lastEdited: now,
  };

  // Step 5: artifact.mdx (from template if --template was given)
  let mdxContent;
  let templateName = 'blank';
  try {
    const resolved = await resolveTemplateContent(template, vars);
    mdxContent = resolved.content;
    templateName = resolved.templateName;
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    // Clean up the empty artifact directory we just created
    rmSync(planDir, { recursive: true, force: true });
    return false;
  }
  writePlanFile(slug, 'artifact.mdx', mdxContent);

  // Step 6: meta.json
  const metaTemplate = await readTemplate('meta.json.template');
  const metaContent = replaceTemplate(metaTemplate, vars);
  writePlanFile(slug, 'meta.json', metaContent);

  // Step 7: comments.json (stored as empty array for comments)
  writePlanFile(slug, 'comments.json', JSON.stringify([], null, 2));

  // Step 8: artifact.html (regenerate from template)
  await regenerateHtml(slug);

  console.log(`  ✓ Created artifact "${title}" (slug: ${slug})`);
  if (templateName !== 'blank') {
    console.log(`    Template: ${templateName}`);
  }
  console.log(`    → ${planDir}`);

  return true;
}

// ─── regenerateHtml ───────────────────────────────────────────────────────────

export async function regenerateHtml(slug) {
  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) return;

  // Prefer the v2 canvas template. Fall back to the v1 template (kept for
  // backwards compat with artifacts that don't have artifact.json).
  let htmlTemplate;
  let templateName = 'artifact.html.template';
  try {
    htmlTemplate = await readTemplate('artifact.canvas.template');
    templateName = 'artifact.canvas.template';
  } catch {
    try {
      htmlTemplate = await readTemplate('artifact.html.template');
      templateName = 'artifact.html.template';
    } catch {
      // No HTML template yet — Tyr is working on it in parallel
      return;
    }
  }

  const planMdx = readFileSync(join(planDir, 'artifact.mdx'), 'utf-8');
  const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
  const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');

  const meta = JSON.parse(metaJson);

  // Bake in current state via string replacements
  // Note: We don't do full MDX parsing here — the HTML template handles rendering
  const planJson = JSON.stringify(planMdx);

  // For the v2 canvas template, also bake in the canvas JSON. Auto-migrate
  // mdx → canvas on the fly so the viewer has the right state from the
  // very first paint. The on-disk file is written by GET /api/<slug>/canvas
  // (or the first PUT), so this is just a temporary bake.
  let canvasJson = 'null';
  try {
    const canvas = loadOrMigrateCanvas(planDir, meta.title || slug);
    canvasJson = JSON.stringify(canvas);
  } catch {
    // ignore — leave canvasJson as null and let the client fetch via API
  }

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
    canvasJson,
    templateName,
  };

  const htmlContent = replaceTemplate(htmlTemplate, vars);
  atomicWriteText(join(planDir, 'artifact.html'), htmlContent);
}

// ─── open <slug> flow ────────────────────────────────────────────────────────

async function openArtifact(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Artifact "${slug}" not found at ${planDir}`);
    console.error(`    Use "bizar artifact new ${slug}" to create it.`);
    return false;
  }

  // Regenerate HTML to bake in current state
  await regenerateHtml(slug);

  // Start server
  const { port, close } = await startServer(slug, planDir);

  const url = `http://localhost:${port}/${slug}/`;
  console.log(`  ✓ Opening artifact "${slug}" at ${url}`);
  openBrowser(url);

  // Keep process alive until Ctrl-C
  await waitForSignal(close);

  return true;
}

// ─── list flow ───────────────────────────────────────────────────────────────

async function listPlans() {
  if (!existsSync(PLANS_DIR)) {
    console.log('  No artifacts found. Run `bizar artifact new <slug>` to create one.');
    return true;
  }

  const dirs = readdirSync(PLANS_DIR).filter((d) => {
    return existsSync(join(PLANS_DIR, d, 'meta.json'));
  });

  if (dirs.length === 0) {
    console.log('  No artifacts found. Run `bizar artifact new <slug>` to create one.');
    return true;
  }

  // Read meta for each
  const artifacts = [];
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(readFileSync(join(PLANS_DIR, dir, 'meta.json'), 'utf-8'));
      artifacts.push(meta);
    } catch {
      // Skip invalid meta.json
    }
  }

  // Sort by lastEdited newest first
  artifacts.sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));

  // Print table
  console.log('  Slug            Title                   Status    Last Edited              Author');
  console.log('  ──────────────  ──────────────────────  ────────  ────────────────────────  ───────────────');

  for (const artifact of artifacts) {
    const slug = (artifact.slug || '').padEnd(15);
    const title = (artifact.title || '').substring(0, 23).padEnd(23);
    const status = (artifact.status || 'draft').padEnd(9);
    const lastEdited = (artifact.lastEdited || '').substring(0, 27).padEnd(27);
    const author = (artifact.author || 'unknown').substring(0, 20);
    console.log(`  ${slug}  ${title}  ${status}  ${lastEdited}  ${author}`);
  }
  console.log();

  return true;
}

// ─── delete <slug> flow ─────────────────────────────────────────────────────

async function deleteArtifact(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Artifact "${slug}" not found.`);
    return false;
  }

  let title = slug;
  try {
    const meta = JSON.parse(readFileSync(join(planDir, 'meta.json'), 'utf-8'));
    title = meta.title || slug;
  } catch { /* use slug as fallback */ }

  // Read confirm from stdin
  const answer = await question(`  Delete artifact "${title}" (slug: ${slug})? This is irreversible. [y/N] `);

  if (answer.trim().toLowerCase() === 'y') {
    rmSync(planDir, { recursive: true });
    console.log(`  ✓ Deleted artifact "${slug}".`);
    return true;
  } else {
    console.log('  Cancelled.');
    return true;
  }
}

// ─── export <slug> flow ──────────────────────────────────────────────────────

async function exportArtifact(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Artifact "${slug}" not found.`);
    return false;
  }

  // Prefer the v2 canvas-derived markdown when artifact.json exists. Fall back
  // to the raw mdx for v1 artifacts.
  const canvasFile = join(planDir, 'artifact.json');
  if (existsSync(canvasFile)) {
    try {
      const canvas = JSON.parse(readFileSync(canvasFile, 'utf-8'));
      process.stdout.write(canvasToMarkdown(canvas));
      return true;
    } catch {
      // fall through to mdx export
    }
  }

  const planFile = join(planDir, 'artifact.mdx');
  if (!existsSync(planFile)) {
    console.error(`  ✗ Artifact "${slug}" not found.`);
    return false;
  }

  const content = readFileSync(planFile, 'utf-8');
  process.stdout.write(content);
  return true;
}

// ─── help ───────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  bizar artifact <subcommand> [options]

  Subcommands:
    new <slug> [--template <name>]   Create a new artifact (default: blank template)
    open <slug>                      Open an existing artifact in the browser
    list                             List all artifacts
    delete <slug>                    Delete a artifact (with confirmation)
    export <slug>                    Export artifact.mdx to stdout
    templates                        List available artifact templates
    template save <name> <artifact-slug> Save a artifact as a library template
    template delete <name>           Delete a user-added library template
    help                             Show this help

  Plans are stored in artifacts/<slug>/ as:
    - artifact.mdx         source content (in git)
    - artifact.html        viewer/editor (gitignored)
    - comments.json    comments array (gitignored)
    - meta.json        metadata (in git)

  Built-in templates:
    blank              Empty starter (the v1 default)
    feature-design     For designing a new feature
    bug-investigation  For investigating a bug
    decision-record    Architecture Decision Record (ADR)

  Examples:
    bizar artifact new my-feature
    bizar artifact new auth-v2 --template feature-design
    bizar artifact new oops --template bug-investigation
    bizar artifact templates
    bizar artifact open my-feature
    bizar artifact list
    bizar artifact export my-feature > my-feature.mdx
  `);
}

// ─── HTML fragment helpers (for htmx) ────────────────────────────────────────

/** Minimal HTML escaper — same rules as the client-side renderer. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
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
function isHtmxRequest(req) {
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
function decodeHtmxFormBody(data) {
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
function elementTypeBadge(type) {
  const t = (type || '').toLowerCase();
  if (t === 'ui-mockup') return 'UI';
  if (t === 'text') return 'TXT';
  if (t === 'image') return 'IMG';
  if (t === 'code') return 'CODE';
  if (t === 'diagram') return 'DIAG';
  return (type || '').toUpperCase();
}

/** Render the inner body of an element (text/image/code/diagram/ui-mockup). */
function renderElementBody(e) {
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
 * Render a v2 canvas element as an HTML fragment. The fragment is meant to
 * be appended to `#elements-layer` by htmx; its data attributes carry the
 * full state needed by the client-side controller to re-attach handlers
 * via event delegation.
 */
function renderElementHTML(e) {
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
 * Render a v2 canvas connection as an SVG fragment. The fragment contains
 * the hit-path (transparent, wide stroke for easier clicking) and the
 * visible line/path with the connection arrow marker.
 */
function renderConnectionHTML(conn) {
  if (!conn || !conn.id) return '';
  // The server doesn't have the element geometry at this point — the client
  // knows the endpoints. We emit the connection with placeholder coords
  // and let the client reconcile via a `data-connection` attribute. The
  // client-side rerender reads the data and draws the real line. We mark
  // it with a class so the client can find and replace it.
  return '<g class="connection" data-connection-id="' + escapeHtml(conn.id) + '"'
    + ' data-from="' + escapeHtml(conn.from) + '"'
    + ' data-to="' + escapeHtml(conn.to) + '"'
    + ' data-type="' + escapeHtml(conn.type || 'arrow') + '"'
    + (conn.label ? ' data-label="' + escapeHtml(conn.label) + '"' : '')
    + '></g>';
}

/**
 * Render a v2 canvas comment pin as an HTML fragment. The pin's number
 * is its 1-based index in chronological order. We compute that server-side
 * by reading the existing canvas (passed in via the caller).
 */
function renderCommentPinHTML(c, indexHint) {
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
function renderReplyHTML(r) {
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
 * Render the entire comment (header + thread) as a fragment for the side
 * panel. Used by PUT /api/<slug>/comments/<id> when a reply is added —
 * htmx replaces the panel content with the latest thread state.
 */
function renderCommentThreadHTML(c) {
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
function renderCommentLi(c) {
  return '<li class="comment" id="comment-' + escapeHtml(c.id) + '">'
    + '<div class="comment-meta">' + escapeHtml(c.author || 'Anonymous')
    + ' · ' + escapeHtml(formatDate(c.timestamp || c.created)) + '</div>'
    + '<div class="comment-text">' + escapeHtml(c.text || '') + '</div>'
    + '</li>';
}

/** Render a comments list as <li> elements. If empty, returns the empty marker. */
function renderCommentListHtml(comments, sectionId) {
  const items = comments
    .filter((c) => !sectionId || c.sectionId === sectionId)
    .sort((a, b) => String(a.timestamp || a.created || '').localeCompare(String(b.timestamp || b.created || '')));
  if (items.length === 0) {
    return '<li class="empty" data-empty>No comments yet — be the first.</li>';
  }
  return items.map(renderCommentLi).join('');
}

/** Render just the count badge for a section, used to update the comment button. */
function renderCommentCountHtml(count) {
  return '<span class="count">' + count + '</span>';
}

/** Parse an HTTP request body. Supports:
 *   - application/x-www-form-urlencoded  (htmx default for <form>)
 *   - application/json                   (legacy / direct API)
 *   - text/plain                         (raw MDX for artifact save)
 *   - anything else: returns raw string
 */
function readRequestBody(req) {
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
function bumpLastEdited(planDir) {
  const metaPath = join(planDir, 'meta.json');
  if (!existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.lastEdited = new Date().toISOString();
    atomicWriteJson(metaPath, meta);
  } catch { /* swallow */ }
}

// ─── Local HTTP server ───────────────────────────────────────────────────────

/**
 * Starts a local HTTP server in the SAME process as the CLI.
 * Tries port 4321 first, falls back to 4322, 4323, etc. (max 10 attempts).
 * Returns { port, close } where close() stops the server.
 */
export async function startServer(slug, planDir, startPort = 4321) {
  let port = startPort;
  let maxAttempts = 10;
  let server;
  let closeFn;

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

/**
 * Handle incoming HTTP requests.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
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
    if (pathname === `/${slug}/` || pathname === `/${slug}` || pathname === '/') {
      // Serve artifact.html
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

    // ── Self-hosted htmx — served from templates/artifact/htmx.min.js ────────────
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

    // ── New RESTful, slug-scoped routes (preferred for htmx) ─────────────────
    //   GET    /api/<slug>/artifact         → MDX text/plain
    //   PUT    /api/<slug>/artifact         → save MDX, returns empty 200
    //   GET    /api/<slug>/comments     → JSON (default) or HTML (?format=html or ?sectionId=)
    //   POST   /api/<slug>/comments     → add a comment, returns the new <li> HTML
    //   PUT    /api/<slug>/comments     → replace the whole comments array (JSON)
    //   GET    /api/<slug>/count        → comment count for a section (?sectionId=)
    // We validate the slug in the URL against the bound slug so the server can't
    // be tricked into serving data for a different artifact.

    if (pathname.startsWith('/api/') && pathname.split('/').length >= 4) {
      const parts = pathname.split('/').filter(Boolean); // ['api', '<urlSlug>', '<resource>']
      const urlSlug = parts[1];
      const resource = parts[2];

      if (urlSlug !== slug) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end(`Forbidden: this server is bound to artifact "${slug}"`);
        return;
      }

      // ── v2 canvas endpoints (preferred) ─────────────────────────────────
      //   GET    /api/<slug>/canvas              → full canvas JSON
      //   PUT    /api/<slug>/canvas              → save full canvas JSON
      //   GET    /api/<slug>/markdown-export     → derived markdown
      //   GET    /api/<slug>/elements            → just the elements array
      //   POST   /api/<slug>/elements            → add element
      //   PUT    /api/<slug>/elements/<id>       → update element
      //   DELETE /api/<slug>/elements/<id>       → remove element + cleanup
      //   GET    /api/<slug>/connections         → connections array
      //   POST   /api/<slug>/connections         → add connection
      //   DELETE /api/<slug>/connections/<id>    → remove connection
      //   GET    /api/<slug>/comments?elementId= → canvas comments
      //   POST   /api/<slug>/comments            → add canvas comment (JSON body)
      //   PUT    /api/<slug>/comments/<id>       → update comment (add reply)
      //   DELETE /api/<slug>/comments/<id>       → remove comment
      //
      // The v2 endpoints and the v1 endpoints share the URL space
      // (e.g. /api/<slug>/comments is both v1 and v2). To discriminate
      // we look at the request body / query for v2-specific fields:
      //   - v2 GET:    ?elementId=... (v1 uses ?sectionId=... or ?format=html)
      //   - v2 POST:   body has x/y/elementId fields (v1 has sectionId only)
      //   - v2 PUT:    body has reply field (v1 has a flat array)
      // If the discriminator says "not v2", the v2 handler falls through
      // (returns without writing a response) and the v1 handler picks it
      // up below. This keeps both API surfaces working.
      const subParts = parts.slice(2);
      const subPath = subParts.join('/');

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
            // htmx form-encodes nested values as JSON strings; decode them.
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
          // Autosave via htmx — return the new save-status badge HTML so
          // hx-target="#save-status" + hx-swap="innerHTML" updates the UI.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<span class="save-status saved">Saved</span>');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }

      // GET /api/<slug>/markdown-export  → derived markdown from canvas
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
            // htmx will swap this with the existing #elements-layer child
            // (hx-swap="outerHTML" is used by the caller for drag-saves)
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
            // Empty 200 — htmx removes the DOM element on 200 with no body
            // (per the responseHandling config: "{code:"[23]..",swap:true}").
            // We return an empty string to keep the swap a no-op for callers
            // that don't specify hx-swap="delete".
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

      // GET /api/<slug>/comments?elementId=...  → canvas comments array
      //   The v2 viewer always passes `?elementId=...` to filter (or
      //   ?elementId= for "all"). The presence of the elementId KEY
      //   (even with empty value) signals "this is a v2 request". When
      //   the elementId key is absent, the request falls through to the
      //   v1 handler which reads from comments.json. This preserves
      //   backwards compat with the v1 viewer.
      if (subPath === 'comments' && req.method === 'GET') {
        const query = requestUrl.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const format = (params.get('format') || '').toLowerCase();
        const sectionId = params.get('sectionId');
        const hasElementId = params.has('elementId');
        const elementId = params.get('elementId') || '';
        // v1 discriminator: format=html or sectionId=, OR no elementId key
        if (!hasElementId && (format === 'html' || sectionId !== null)) {
          // fall through to v1 handler below
        } else if (!hasElementId) {
          // ambiguous: fall through to v1 (back-compat for v1 viewer)
        } else {
          const meta = readPlanMeta(planDir);
          const canvas = loadOrMigrateCanvas(planDir, (meta && meta.title) || slug);
          let result = canvas.comments;
          if (elementId === 'nil' || elementId === 'null') {
            // canvas-pinned only
            result = canvas.comments.filter(function (c) { return !c.elementId; });
          } else if (elementId !== '') {
            // specific element
            result = canvas.comments.filter(function (c) { return c.elementId === elementId; });
          }
          // else: elementId === '' means "all comments"
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }
      }

      // POST /api/<slug>/comments
      //   v2 path (canvas): JSON body with text + x/y/elementId, writes to artifact.json
      //   v1 path (legacy): body has sectionId (form OR JSON), writes to comments.json
      //   v1 returns HTML <li>; v2 returns JSON.
      // We dispatch on body shape: if sectionId is present, it's v1.
      if (subPath === 'comments' && req.method === 'POST') {
        const parsed = await readRequestBody(req);
        const body = parsed.data;
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Expected a JSON or form object');
          return;
        }
        // v1 discriminator: sectionId is a non-empty string. v2 never uses
        // sectionId; it uses elementId. If a request has both, treat as v1
        // (back-compat).
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
          // htmx callers can use hx-swap="beforeend" on the pin layer (target
          // #comments-layer) AND hx-swap="outerHTML" on the side panel (target
          // #comment-thread) by chaining via hx-on or two-step. To keep things
          // simple we return the pin fragment; the side-panel refresh is
          // handled by the client-side openCommentPanel() call which is
          // already triggered on add.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCommentPinHTML(c, canvas.comments.length - 1));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(c));
        }
        return;
      }

      // PUT /api/<slug>/comments/<id>  → update canvas comment (add reply)
      // v1 doesn't have a PUT-to-id endpoint; only v2 supports this URL.
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

      // DELETE /api/<slug>/comments/<id>  → v2 has the same URL. The v1 routes
      // don't define DELETE so the v2 handler always runs.
      if (subPath.match(/^comments\/[^\/]+$/) && req.method === 'DELETE') {
        const commentMatch = subPath.match(/^comments\/([^\/]+)$/);
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

      // ── v1 routes (legacy, kept for backwards compat) ───────────────
      //   GET  /api/<slug>/artifact         → MDX text/plain
      //   PUT  /api/<slug>/artifact         → save MDX
      //   GET  /api/<slug>/comments     → JSON (default) or HTML (?format=html)
      //   POST /api/<slug>/comments     → add a v1 comment (form data with sectionId)
      //   PUT  /api/<slug>/comments     → replace the whole v1 array (JSON)
      //   GET  /api/<slug>/count        → comment count for a section

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

      // GET /api/<slug>/comments?format=html&sectionId=...  → HTML <li> list
      // GET /api/<slug>/comments                              → JSON array
      // v1 fallback — runs only if the v2 GET handler above didn't match
      // (e.g. ?format=html or ?sectionId= query params).
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

      // (v1 POST /api/<slug>/comments is now handled by the merged v2/v1
      //  handler above, which dispatches on body shape — sectionId → v1
      //  writes to comments.json; otherwise v2 writes to artifact.json.)

      // PUT /api/<slug>/comments  → v1: replace the whole array (JSON body)
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

      // GET /api/<slug>/count?sectionId=...  → HTML <span class="count">N</span>
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

      // (v2 endpoints are handled above; this block is the v1 fallback for
      //  the /api/<slug>/comments routes that didn't match a v2 discriminator.)
    }

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
          // Update lastEdited in meta.json
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
          // Validate JSON
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
        // Read current artifact.mdx and regenerate HTML
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

// ─── Browser opening ─────────────────────────────────────────────────────────

function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  // Check if the command exists
  const probe = platform === 'win32'
    ? spawnSync('where', [cmd], { stdio: 'ignore' })
    : spawnSync('which', [cmd], { stdio: 'ignore' });
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

// ─── Stdin question helper ───────────────────────────────────────────────────

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

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * Main entry point. Accepts a flat argv array (or a split {positional, flags}
 * object). Flag forms supported: --flag value, --flag=value.
 *
 * Subcommands:
 *   new <slug> [--template <name>]
 *   open <slug>
 *   list
 *   delete <slug>
 *   export <slug>
 *   templates
 *   template save <name> <artifact-slug>
 *   template delete <name>
 *   help
 */
export async function runArtifact(argsOrPositional, legacyFlags) {
  // Normalize the input — accept either a flat argv array (current bin.mjs
  // style) or an already-parsed { positional, flags } object (test style).
  let positional;
  let flags;
  if (Array.isArray(argsOrPositional)) {
    const parsed = parseArgs(argsOrPositional);
    positional = parsed.positional;
    flags = { ...(legacyFlags || {}), ...parsed.flags };
  } else if (argsOrPositional && Array.isArray(argsOrPositional.positional)) {
    positional = argsOrPositional.positional;
    flags = { ...(legacyFlags || {}), ...(argsOrPositional.flags || {}) };
  } else {
    positional = [];
    flags = legacyFlags || {};
  }

  // Special-case: "template save <name> <artifact-slug>" / "template delete <name>"
  if (positional[0] === 'template') {
    const action = positional[1];
    if (action === 'save') {
      const name = positional[2];
      const planSlug = positional[3];
      if (!name || !planSlug) {
        console.error('  ✗ Usage: bizar artifact template save <name> <artifact-slug>');
        return false;
      }
      try {
        const target = saveTemplateToLibrary(name, planSlug);
        console.log(`  ✓ Saved template "${name}" → ${target}`);
        return true;
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
        return false;
      }
    }
    if (action === 'delete' || action === 'rm') {
      const name = positional[2];
      if (!name) {
        console.error('  ✗ Usage: bizar artifact template delete <name>');
        return false;
      }
      try {
        const removed = deleteLibraryTemplate(name);
        console.log(`  ✓ Removed template "${name}" from library (${removed})`);
        return true;
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
        return false;
      }
    }
    if (action === 'list' || action === undefined) {
      printTemplates();
      return true;
    }
    console.error(`  ✗ Unknown template action: "${action}"`);
    console.error('    Use: save <name> <artifact-slug>, delete <name>, or list');
    return false;
  }

  const [subcommand, slug] = positional;

  switch (subcommand) {
    case 'new': {
      if (!slug) {
        console.error('  ✗ Usage: bizar artifact new <slug> [--template <name>]');
        return false;
      }
      const created = await createArtifact(slug, { template: flags.template || null });
      if (!created) return false;
      // Start server and open browser
      return await openArtifact(slug);
    }

    case 'open': {
      if (!slug) {
        console.error('  ✗ Usage: bizar artifact open <slug>');
        return false;
      }
      return await openArtifact(slug);
    }

    case 'list': {
      return await listPlans();
    }

    case 'delete': {
      if (!slug) {
        console.error('  ✗ Usage: bizar artifact delete <slug>');
        return false;
      }
      return await deleteArtifact(slug);
    }

    case 'export': {
      if (!slug) {
        console.error('  ✗ Usage: bizar artifact export <slug>');
        return false;
      }
      return await exportArtifact(slug);
    }

    case 'templates': {
      printTemplates();
      return true;
    }

    case 'help':
    case undefined: {
      showHelp();
      return true;
    }

    default: {
      console.error(`  ✗ Unknown subcommand: "${subcommand}"`);
      console.error(`    Run "bizar artifact help" for usage.`);
      return false;
    }
  }
}

// Default export for CLI entrypoint
export default runArtifact;

// Named exports for the v2 canvas helpers (used by tests and the AI tool).
// These are the public surface of the canvas subsystem.
export {
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
  // HTML fragment renderers (used by tests and external integrations that
  // need to produce htmx-compatible HTML for the v2 endpoints).
  renderElementHTML,
  renderConnectionHTML,
  renderCommentPinHTML,
  renderCommentThreadHTML,
  renderReplyHTML,
  escapeHtml,
  formatDate,
};
