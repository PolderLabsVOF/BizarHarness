/**
 * cli/artifact-cli.mjs
 *
 * Artifact CLI dispatch and flag parsing.
 * Extracted from artifact.mjs to separate CLI from server and rendering logic.
 */
import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

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
  replaceTemplate,
  readTemplate,
  atomicWriteText,
  atomicWriteJson,
  openBrowser,
} from './artifact-render.mjs';

import {
  startServer,
} from './artifact-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'artifact');
const PLANS_DIR = join(PROJECT_ROOT, 'artifacts');
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

// ─── Slug validation ─────────────────────────────────────────────────────────

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

// ─── Template resolution ─────────────────────────────────────────────────────

/**
 * Resolve the content for a new artifact from the template system.
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
    const blankTpl = await readTemplate('artifact.mdx.template');
    return { content: replaceTemplate(blankTpl, vars), templateName: 'blank', source: 'built-in' };
  }

  return { content: substitute(tpl.content, vars), templateName: tpl.name, source: tpl.source };
}

// ─── Artifact operations ───────────────────────────────────────────────────────

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

export async function regenerateHtml(slug) {
  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) return;

  // Prefer the v2 canvas template. Fall back to the v1 template.
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
      return;
    }
  }

  const planMdx = readFileSync(join(planDir, 'artifact.mdx'), 'utf-8');
  const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
  const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');
  const meta = JSON.parse(metaJson);
  const planJson = JSON.stringify(planMdx);

  let canvasJson = 'null';
  try {
    const canvas = loadOrMigrateCanvas(planDir, meta.title || slug);
    canvasJson = JSON.stringify(canvas);
  } catch {
    // ignore
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

async function listPlans() {
  if (!existsSync(PLANS_DIR)) {
    console.log('  No artifacts found. Run `bizar artifact new <slug>` to create one.');
    return true;
  }

  const { readdirSync } = await import('node:fs');
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

async function exportArtifact(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Artifact "${slug}" not found.`);
    return false;
  }

  // Prefer the v2 canvas-derived markdown when artifact.json exists.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function question(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once('data', (data) => resolve(data.toString()));
  });
}

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

function writePlanFile(slug, filename, content) {
  const dir = join(PLANS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  atomicWriteText(join(dir, filename), content);
}

// ─── Help ────────────────────────────────────────────────────────────────────

export function showHelp() {
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

// ─── Main dispatcher ──────────────────────────────────────────────────────────

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

/**
 * Main entry point for `bizar artifact`.
 * Subcommands: new, open, list, delete, export, templates,
 *   template save <name> <artifact-slug>, template delete <name>, help
 */
export async function runArtifact(argsOrPositional, legacyFlags) {
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
