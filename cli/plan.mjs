/**
 * bizarharness plan <subcommand>
 *
 * Subcommands:
 *   new <slug>                 Create a new plan
 *                              Flags: --template <name> | --template <path>
 *   open <slug>                Open an existing plan in the browser
 *   list                       List all plans
 *   delete <slug>              Delete a plan (with confirmation)
 *   export <slug>              Export plan.mdx to stdout
 *   templates                  List available plan templates
 *   template save <name> <plan-slug>   Save a plan as a library template
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
} from './plan-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'plan');
const PLANS_DIR = join(PROJECT_ROOT, 'plans');

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

function writePlanFile(slug, filename, content) {
  const dir = join(PLANS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf-8');
}

function readPlanFile(slug, filename) {
  return readFileSync(join(PLANS_DIR, slug, filename), 'utf-8');
}

// ─── new <slug> flow ─────────────────────────────────────────────────────────

/**
 * Resolve the content for a new plan from the template system.
 * - If template is the string "blank" or null → use plan.mdx.template (the v1 default)
 * - If template is a built-in name (feature-design, etc.) → use that template
 * - If template is an absolute path to a .mdx file → use that file
 * - Otherwise → throw with a helpful error
 *
 * Returns the MDX content with {{vars}} already substituted.
 */
async function resolveTemplateContent(template, vars) {
  if (template == null || template === '' || template === 'blank') {
    const tpl = await readTemplate('plan.mdx.template');
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
    const blankTpl = await readTemplate('plan.mdx.template');
    return { content: replaceTemplate(blankTpl, vars), templateName: 'blank', source: 'built-in' };
  }

  return { content: substitute(tpl.content, vars), templateName: tpl.name, source: tpl.source };
}

async function createPlan(slug, { template = null } = {}) {
  const planDir = join(PLANS_DIR, slug);

  // Step 1: validate
  if (!validateSlug(slug)) return false;

  // Step 2: check existence
  if (existsSync(planDir)) {
    console.error(`  ✗ Plan "${slug}" already exists at ${planDir}`);
    console.error(`    Use "bizarharness plan open ${slug}" to open it.`);
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

  // Step 5: plan.mdx (from template if --template was given)
  let mdxContent;
  let templateName = 'blank';
  try {
    const resolved = await resolveTemplateContent(template, vars);
    mdxContent = resolved.content;
    templateName = resolved.templateName;
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    // Clean up the empty plan directory we just created
    rmSync(planDir, { recursive: true, force: true });
    return false;
  }
  writePlanFile(slug, 'plan.mdx', mdxContent);

  // Step 6: meta.json
  const metaTemplate = await readTemplate('meta.json.template');
  const metaContent = replaceTemplate(metaTemplate, vars);
  writePlanFile(slug, 'meta.json', metaContent);

  // Step 7: comments.json (stored as empty array for comments)
  writePlanFile(slug, 'comments.json', JSON.stringify([], null, 2));

  // Step 8: plan.html (regenerate from template)
  await regenerateHtml(slug);

  console.log(`  ✓ Created plan "${title}" (slug: ${slug})`);
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

  let htmlTemplate;
  try {
    htmlTemplate = await readTemplate('plan.html.template');
  } catch {
    // No HTML template yet — Tyr is working on it in parallel
    return;
  }

  const planMdx = readFileSync(join(planDir, 'plan.mdx'), 'utf-8');
  const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
  const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');

  const meta = JSON.parse(metaJson);

  // Bake in current state via string replacements
  // Note: We don't do full MDX parsing here — the HTML template handles rendering
  const planJson = JSON.stringify(planMdx);

  const vars = {
    title: meta.title || slug,
    slug: meta.slug || slug,
    status: meta.status || 'draft',
    lastEdited: meta.lastEdited || new Date().toISOString(),
    author: meta.author || 'unknown',
    planJson,
    commentsJson,
    metaJson,
  };

  const htmlContent = replaceTemplate(htmlTemplate, vars);
  writeFileSync(join(planDir, 'plan.html'), htmlContent, 'utf-8');
}

// ─── open <slug> flow ────────────────────────────────────────────────────────

async function openPlan(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Plan "${slug}" not found at ${planDir}`);
    console.error(`    Use "bizarharness plan new ${slug}" to create it.`);
    return false;
  }

  // Regenerate HTML to bake in current state
  await regenerateHtml(slug);

  // Start server
  const { port, close } = await startServer(slug, planDir);

  const url = `http://localhost:${port}/${slug}/`;
  console.log(`  ✓ Opening plan "${slug}" at ${url}`);
  openBrowser(url);

  // Keep process alive until Ctrl-C
  await waitForSignal(close);

  return true;
}

// ─── list flow ───────────────────────────────────────────────────────────────

async function listPlans() {
  if (!existsSync(PLANS_DIR)) {
    console.log('  No plans found. Run `bizarharness plan new <slug>` to create one.');
    return true;
  }

  const dirs = readdirSync(PLANS_DIR).filter((d) => {
    return existsSync(join(PLANS_DIR, d, 'meta.json'));
  });

  if (dirs.length === 0) {
    console.log('  No plans found. Run `bizarharness plan new <slug>` to create one.');
    return true;
  }

  // Read meta for each
  const plans = [];
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(readFileSync(join(PLANS_DIR, dir, 'meta.json'), 'utf-8'));
      plans.push(meta);
    } catch {
      // Skip invalid meta.json
    }
  }

  // Sort by lastEdited newest first
  plans.sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));

  // Print table
  console.log('  Slug            Title                   Status    Last Edited              Author');
  console.log('  ──────────────  ──────────────────────  ────────  ────────────────────────  ───────────────');

  for (const plan of plans) {
    const slug = (plan.slug || '').padEnd(15);
    const title = (plan.title || '').substring(0, 23).padEnd(23);
    const status = (plan.status || 'draft').padEnd(9);
    const lastEdited = (plan.lastEdited || '').substring(0, 27).padEnd(27);
    const author = (plan.author || 'unknown').substring(0, 20);
    console.log(`  ${slug}  ${title}  ${status}  ${lastEdited}  ${author}`);
  }
  console.log();

  return true;
}

// ─── delete <slug> flow ─────────────────────────────────────────────────────

async function deletePlan(slug) {
  if (!validateSlug(slug)) return false;

  const planDir = join(PLANS_DIR, slug);
  if (!existsSync(planDir)) {
    console.error(`  ✗ Plan "${slug}" not found.`);
    return false;
  }

  let title = slug;
  try {
    const meta = JSON.parse(readFileSync(join(planDir, 'meta.json'), 'utf-8'));
    title = meta.title || slug;
  } catch { /* use slug as fallback */ }

  // Read confirm from stdin
  const answer = await question(`  Delete plan "${title}" (slug: ${slug})? This is irreversible. [y/N] `);

  if (answer.trim().toLowerCase() === 'y') {
    rmSync(planDir, { recursive: true });
    console.log(`  ✓ Deleted plan "${slug}".`);
    return true;
  } else {
    console.log('  Cancelled.');
    return true;
  }
}

// ─── export <slug> flow ──────────────────────────────────────────────────────

async function exportPlan(slug) {
  if (!validateSlug(slug)) return false;

  const planFile = join(PLANS_DIR, slug, 'plan.mdx');
  if (!existsSync(planFile)) {
    console.error(`  ✗ Plan "${slug}" not found.`);
    return false;
  }

  const content = readFileSync(planFile, 'utf-8');
  process.stdout.write(content);
  return true;
}

// ─── help ───────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  bizarharness plan <subcommand> [options]

  Subcommands:
    new <slug> [--template <name>]   Create a new plan (default: blank template)
    open <slug>                      Open an existing plan in the browser
    list                             List all plans
    delete <slug>                    Delete a plan (with confirmation)
    export <slug>                    Export plan.mdx to stdout
    templates                        List available plan templates
    template save <name> <plan-slug> Save a plan as a library template
    template delete <name>           Delete a user-added library template
    help                             Show this help

  Plans are stored in plans/<slug>/ as:
    - plan.mdx         source content (in git)
    - plan.html        viewer/editor (gitignored)
    - comments.json    comments array (gitignored)
    - meta.json        metadata (in git)

  Built-in templates:
    blank              Empty starter (the v1 default)
    feature-design     For designing a new feature
    bug-investigation  For investigating a bug
    decision-record    Architecture Decision Record (ADR)

  Examples:
    bizarharness plan new my-feature
    bizarharness plan new auth-v2 --template feature-design
    bizarharness plan new oops --template bug-investigation
    bizarharness plan templates
    bizarharness plan open my-feature
    bizarharness plan list
    bizarharness plan export my-feature > my-feature.mdx
  `);
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
        const srv = createServer((req, res) => handleRequest(req, res, slug, planDir, port));
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

  // Handle Ctrl-C to stop server
  const cleanup = async () => {
    console.log('\n  Shutting down server...');
    await close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { port: actualPort, close };
}

/**
 * Handle incoming HTTP requests.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleRequest(req, res, slug, planDir, serverPort) {
  const now = new Date().toISOString();
  // Use path-only URL parsing to avoid host-header injection
  const pathname = req.url.split('?')[0].split('#')[0];

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
      // Serve plan.html
      const htmlPath = join(planDir, 'plan.html');
      if (!existsSync(htmlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('plan.html not found. Run `bizarharness plan new ${slug}` first.');
        return;
      }
      const html = readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/api/plan' && req.method === 'GET') {
      const mdx = readFileSync(join(planDir, 'plan.mdx'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(mdx);
      return;
    }

    if (pathname === '/api/plan' && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          writeFileSync(join(planDir, 'plan.mdx'), body, 'utf-8');
          // Update lastEdited in meta.json
          const meta = JSON.parse(readFileSync(join(planDir, 'meta.json'), 'utf-8'));
          meta.lastEdited = new Date().toISOString();
          writeFileSync(join(planDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
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
          writeFileSync(join(planDir, 'comments.json'), body, 'utf-8');
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
          writeFileSync(join(planDir, 'comments.json'), JSON.stringify(comments, null, 2), 'utf-8');
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
        // Read current plan.mdx and regenerate HTML
        const planMdx = readFileSync(join(planDir, 'plan.mdx'), 'utf-8');
        const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
        const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');
        const meta = JSON.parse(metaJson);

        const planHtmlTemplate = readFileSync(join(TEMPLATES_DIR, 'plan.html.template'), 'utf-8');
        const planJson = JSON.stringify(planMdx);

        const vars = {
          title: meta.title || slug,
          slug: meta.slug || slug,
          status: meta.status || 'draft',
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
        writeFileSync(join(planDir, 'plan.html'), htmlContent, 'utf-8');

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
  const which = spawnSync('which', [cmd], { stdio: 'ignore' });
  if (which.status !== 0) {
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
    process.on('SIGINT', async () => {
      await closeFn();
      resolve();
    });
    process.on('SIGTERM', async () => {
      await closeFn();
      resolve();
    });
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
 *   template save <name> <plan-slug>
 *   template delete <name>
 *   help
 */
export async function runPlan(argsOrPositional, legacyFlags) {
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

  // Special-case: "template save <name> <plan-slug>" / "template delete <name>"
  if (positional[0] === 'template') {
    const action = positional[1];
    if (action === 'save') {
      const name = positional[2];
      const planSlug = positional[3];
      if (!name || !planSlug) {
        console.error('  ✗ Usage: bizarharness plan template save <name> <plan-slug>');
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
        console.error('  ✗ Usage: bizarharness plan template delete <name>');
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
    console.error('    Use: save <name> <plan-slug>, delete <name>, or list');
    return false;
  }

  const [subcommand, slug] = positional;

  switch (subcommand) {
    case 'new': {
      if (!slug) {
        console.error('  ✗ Usage: bizarharness plan new <slug> [--template <name>]');
        return false;
      }
      const created = await createPlan(slug, { template: flags.template || null });
      if (!created) return false;
      // Start server and open browser
      return await openPlan(slug);
    }

    case 'open': {
      if (!slug) {
        console.error('  ✗ Usage: bizarharness plan open <slug>');
        return false;
      }
      return await openPlan(slug);
    }

    case 'list': {
      return await listPlans();
    }

    case 'delete': {
      if (!slug) {
        console.error('  ✗ Usage: bizarharness plan delete <slug>');
        return false;
      }
      return await deletePlan(slug);
    }

    case 'export': {
      if (!slug) {
        console.error('  ✗ Usage: bizarharness plan export <slug>');
        return false;
      }
      return await exportPlan(slug);
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
      console.error(`    Run "bizarharness plan help" for usage.`);
      return false;
    }
  }
}

// Default export for CLI entrypoint
export default runPlan;
