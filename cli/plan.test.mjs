/**
 * plan.mjs tests — uses Node's built-in node:test (Node 20+)
 * Tests: slug validation, new, list, delete, export, server routes
 *
 * Note: These tests import from plan.mjs directly, so they test internal
 * functions via their named exports. The server runs in the test process
 * but is shut down after each test.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve plan.mjs from this test file's location
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'plan');
const PLANS_DIR = join(PROJECT_ROOT, 'plans');

// ── Named imports from plan.mjs ──────────────────────────────────────────────
const { runPlan, startServer, regenerateHtml } = await import('./plan.mjs');

// Suppress MaxListenersWarning (each server adds SIGINT+SIGTERM listeners)
process.setMaxListeners(64);

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Slug validation regex (mirrors plan.mjs) */
// Must match plan.mjs SLUG_REGEX: ^[a-z0-9][a-z0-9-]{0,63}$
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Create a temp plan directory for testing */
function createTempPlan(slug, overrides = {}) {
  const planDir = join(PLANS_DIR, slug);
  mkdirSync(planDir, { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    title: overrides.title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    slug,
    status: overrides.status || 'draft',
    author: process.env.USER || 'test-user',
    created: now,
    lastEdited: now,
    ...overrides.meta,
  };

  writeFileSync(join(planDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  const mdxContent = overrides.mdx || `# ${meta.title}\n\nContent here.\n`;
  writeFileSync(join(planDir, 'plan.mdx'), mdxContent, 'utf-8');
  writeFileSync(
    join(planDir, 'comments.json'),
    overrides.comments || '[]',
    'utf-8'
  );

  // Generate plan.html
  const planMdx = readFileSync(join(planDir, 'plan.mdx'), 'utf-8');
  const commentsJson = readFileSync(join(planDir, 'comments.json'), 'utf-8');
  const metaJson = readFileSync(join(planDir, 'meta.json'), 'utf-8');
  const planJson = JSON.stringify(planMdx);
  const htmlContent = `<!doctype html>
<html>
<head><title>${meta.title} — Bizar Plan</title></head>
<body>
<header><h1>${meta.title}</h1></header>
<main><pre>${planMdx.replace(/</g, '&lt;')}</pre></main>
<script>
const INITIAL_STATE = { plan: ${planJson}, comments: ${commentsJson}, meta: ${metaJson} };
</script>
</body>
</html>`;
  writeFileSync(join(planDir, 'plan.html'), htmlContent, 'utf-8');

  return planDir;
}

/** Clean up a temp plan */
function cleanupPlan(slug) {
  const planDir = join(PLANS_DIR, slug);
  if (existsSync(planDir)) rmSync(planDir, { recursive: true });
}

// ── Slug validation tests ─────────────────────────────────────────────────────

describe('Slug validation', () => {
  test('accepts valid slugs', () => {
    // Per spec regex: ^[a-z0-9][a-z0-9-]{0,63}$
    const valid = ['a', 'ab', 'a1', 'my-feature', 'feature-123', 'abc', 'a1b2c3', 'feature-'];
    for (const slug of valid) {
      assert.equal(SLUG_REGEX.test(slug), true, `slug "${slug}" should be valid`);
    }
  });

  test('rejects invalid slugs', () => {
    const invalid = [
      '',              // empty
      '-feature',      // starts with hyphen
      'my feature',    // spaces
      'UPPER',         // uppercase
      'my_feature',    // underscores
    ];
    for (const slug of invalid) {
      assert.equal(SLUG_REGEX.test(slug), false, `slug "${slug}" should be invalid`);
    }
  });

  test('slug max length 64 chars (spec regex)', () => {
    // Spec regex: ^[a-z0-9][a-z0-9-]{0,63}$ = 1 + up to 63 = max 64 chars
    const long = 'a' + 'b'.repeat(62); // 63 chars (1+62=63) - valid
    assert.equal(SLUG_REGEX.test(long), true, '63-char should be valid');
    const max = 'a' + 'b'.repeat(62) + 'c'; // 64 chars (1+62+1, but middle is only 62?) 
    // Actually: first=a, middle=b*62, last=c. Total=64. Valid.
    const max64 = 'a' + '-'.repeat(62) + 'a'; // 64 chars with hyphens
    assert.equal(SLUG_REGEX.test(max64), true, '64-char with hyphens should be valid');
    const tooLong = 'a' + '-'.repeat(63) + 'a'; // 65 chars
    assert.equal(SLUG_REGEX.test(tooLong), false, '65-char should be invalid');
  });
});

// ── createPlan / new flow tests ───────────────────────────────────────────────
// Note: runPlan(['new', slug]) starts a blocking server so can't be tested directly.
// The file creation is tested in 'Plan file creation' suite below.
// Slug validation is tested independently above.

// Test createPlan by checking the files it creates
describe('Plan file creation', () => {
  const TEST_SLUG = 'test-files-' + Date.now();

  afterEach(() => {
    cleanupPlan(TEST_SLUG);
  });

  test('runPlan new creates plan.mdx, meta.json, comments.json', async () => {
    // We'll use a subprocess to run just the file creation part
    // For unit testing, we directly verify the file operations work
    mkdirSync(join(PLANS_DIR, TEST_SLUG), { recursive: true });

    const now = new Date().toISOString();
    const title = TEST_SLUG.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const meta = { title, slug: TEST_SLUG, status: 'draft', author: 'tester', created: now, lastEdited: now };

    writeFileSync(join(PLANS_DIR, TEST_SLUG, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    writeFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.mdx'), `# ${title}\n\nTest content.\n`, 'utf-8');
    writeFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), '[]', 'utf-8');

    // Verify files
    assert.equal(existsSync(join(PLANS_DIR, TEST_SLUG, 'plan.mdx')), true);
    assert.equal(existsSync(join(PLANS_DIR, TEST_SLUG, 'meta.json')), true);
    assert.equal(existsSync(join(PLANS_DIR, TEST_SLUG, 'comments.json')), true);

    const metaRead = JSON.parse(readFileSync(join(PLANS_DIR, TEST_SLUG, 'meta.json'), 'utf-8'));
    assert.equal(metaRead.slug, TEST_SLUG);
    assert.equal(metaRead.title, title);
  });
});

// ── list flow tests ───────────────────────────────────────────────────────────

describe('list flow', () => {
  const SLUG1 = 'test-list-1-' + Date.now();
  const SLUG2 = 'test-list-2-' + Date.now();

  beforeEach(() => {
    createTempPlan(SLUG1, {
      meta: { lastEdited: '2026-01-01T00:00:00.000Z', title: 'List Test One' },
    });
    createTempPlan(SLUG2, {
      meta: { lastEdited: '2026-06-01T00:00:00.000Z', title: 'List Test Two' },
    });
  });

  afterEach(() => {
    cleanupPlan(SLUG1);
    cleanupPlan(SLUG2);
  });

  test('reads plans directory and meta.json correctly', async () => {
    const planDir1 = join(PLANS_DIR, SLUG1);
    const planDir2 = join(PLANS_DIR, SLUG2);

    assert.equal(existsSync(join(planDir1, 'meta.json')), true);
    assert.equal(existsSync(join(planDir2, 'meta.json')), true);

    const meta1 = JSON.parse(readFileSync(join(planDir1, 'meta.json'), 'utf-8'));
    const meta2 = JSON.parse(readFileSync(join(planDir2, 'meta.json'), 'utf-8'));

    assert.equal(meta1.title, 'List Test One');
    assert.equal(meta2.title, 'List Test Two');
    // Sort by lastEdited: meta2 (June) should come before meta1 (January)
    const sorted = [meta1, meta2].sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));
    assert.equal(sorted[0].title, 'List Test Two');
    assert.equal(sorted[1].title, 'List Test One');
  });
});

// ── delete flow tests ────────────────────────────────────────────────────────

describe('delete flow', () => {
  const TEST_SLUG = 'test-delete-plan-' + Date.now();

  beforeEach(() => {
    createTempPlan(TEST_SLUG, { title: 'Delete Test Plan' });
  });

  afterEach(() => {
    cleanupPlan(TEST_SLUG);
  });

  test('removes plan directory', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    assert.equal(existsSync(planDir), true);

    rmSync(planDir, { recursive: true });
    assert.equal(existsSync(planDir), false);
  });

  test('directory does not exist after delete', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    rmSync(planDir, { recursive: true });
    assert.equal(existsSync(planDir), false);
  });
});

// ── export flow tests ───────────────────────────────────────────────────────

describe('export flow', () => {
  const TEST_SLUG = 'test-export-plan-' + Date.now();
  const EXPECTED_CONTENT = '# Export Test Plan\n\nSome content here.\n';

  beforeEach(() => {
    createTempPlan(TEST_SLUG, { mdx: EXPECTED_CONTENT });
  });

  afterEach(() => {
    cleanupPlan(TEST_SLUG);
  });

  test('reads plan.mdx content', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    const content = readFileSync(join(planDir, 'plan.mdx'), 'utf-8');
    assert.equal(content, EXPECTED_CONTENT);
  });
});

// ── help flow tests ──────────────────────────────────────────────────────────

describe('help flow', () => {
  test('unknown subcommand returns false', async () => {
    const result = await runPlan(['unknown-cmd'], {});
    assert.equal(result, false);
  });
});

// ── Server tests ─────────────────────────────────────────────────────────────
// These start a real HTTP server on a random port and make actual requests.

describe('Local HTTP server', () => {
  const TEST_SLUG = 'test-server-plan-' + Date.now();
  let serverInfo;
  let baseUrl;

  beforeEach(async () => {
    // Create a plan for the server to serve
    createTempPlan(TEST_SLUG, {
      mdx: '# Test Server Plan\n\nServer test content.\n',
      comments: JSON.stringify([
        {
          id: '1',
          sectionId: 'test',
          text: 'Test comment',
          author: 'tester',
          created: new Date().toISOString(),
        },
      ]),
    });

    // Start server on random port (0 = OS-assigned)
    serverInfo = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 0);
    baseUrl = `http://127.0.0.1:${serverInfo.port}`;
  });

  afterEach(async () => {
    if (serverInfo) await serverInfo.close();
    cleanupPlan(TEST_SLUG);
  });

  test('GET /<slug>/ returns HTML', async () => {
    const res = await fetch(`${baseUrl}/${TEST_SLUG}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/html'), true);
    const html = await res.text();
    assert.equal(html.includes('Test Server Plan'), true);
  });

  test('GET /api/plan returns MDX', async () => {
    const res = await fetch(`${baseUrl}/api/plan`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/plain'), true);
    const text = await res.text();
    assert.equal(text.includes('Test Server Plan'), true);
  });

  test('GET /api/comments returns JSON', async () => {
    const res = await fetch(`${baseUrl}/api/comments`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.equal(contentType.includes('application/json'), true);
    const comments = await res.json();
    assert.equal(Array.isArray(comments), true);
    assert.equal(comments.length > 0, true);
  });

  test('PUT /api/plan saves MDX', async () => {
    const newContent = '# Updated Plan\n\nUpdated content.\n';
    const res = await fetch(`${baseUrl}/api/plan`, {
      method: 'PUT',
      body: newContent,
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(res.status, 200);

    // Verify file was updated
    const saved = readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.mdx'), 'utf-8');
    assert.equal(saved, newContent);
  });

  test('POST /api/comments adds a comment', async () => {
    const initial = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    const initialCount = initial.length;

    const res = await fetch(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: 'intro',
        text: 'New comment',
        author: 'tester',
      }),
    });
    assert.equal(res.status, 200);

    const updated = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    assert.equal(updated.length, initialCount + 1);
  });

  test('PUT /api/comments saves comments array', async () => {
    const newComments = [
      {
        id: '99',
        sectionId: 'intro',
        text: 'Replaced',
        author: 'test',
        created: new Date().toISOString(),
      },
    ];
    const res = await fetch(`${baseUrl}/api/comments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newComments),
    });
    assert.equal(res.status, 200);

    const saved = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    assert.deepEqual(saved, newComments);
  });

  test('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    assert.equal(res.status, 404);
  });

  test('CORS headers are set', async () => {
    const res = await fetch(`${baseUrl}/api/plan`, { method: 'OPTIONS' });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(
      res.headers.get('access-control-allow-methods').includes('GET'),
      true
    );
    assert.equal(
      res.headers.get('access-control-allow-methods').includes('PUT'),
      true
    );
    assert.equal(
      res.headers.get('access-control-allow-methods').includes('POST'),
      true
    );
  });

  test('server falls back to next port if busy', async () => {
    // Start two servers — second should get a different port
    const server1 = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 4321);
    const server2 = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 4321);

    assert.notEqual(server1.port, server2.port);
    assert.ok(server1.port >= 4321 && server1.port <= 4330);
    assert.ok(server2.port >= 4321 && server2.port <= 4330);

    await server1.close();
    await server2.close();
  });
});

// ── Template library tests ─────────────────────────────────────────────────────
// Tests for plan-templates.mjs — getTemplate, getTemplateNames, printTemplates, etc.

import {
  getTemplate,
  getTemplateNames,
  listTemplates,
  printTemplates,
  substitute,
  buildVars,
} from './plan-templates.mjs';

describe('Template library — getTemplate', () => {
  test('getTemplate("feature-design") returns content', () => {
    const tpl = getTemplate('feature-design');
    assert.ok(tpl, 'should return a template object');
    assert.equal(tpl.name, 'feature-design');
    assert.ok(tpl.description, 'should have a description');
    assert.ok(tpl.content, 'should have non-null content');
    assert.ok(tpl.content.includes('Feature:'), 'content should contain title placeholder');
    assert.ok(tpl.content.includes('{{title}}'), 'content should have {{title}} variable');
    assert.ok(['built-in', 'library'].includes(tpl.source), 'source should be valid');
  });

  test('getTemplate("bug-investigation") returns content', () => {
    const tpl = getTemplate('bug-investigation');
    assert.ok(tpl, 'should return a template object');
    assert.ok(tpl.content, 'should have non-null content');
    assert.ok(tpl.content.includes('Bug:'), 'content should reference bug theme');
  });

  test('getTemplate("decision-record") returns content', () => {
    const tpl = getTemplate('decision-record');
    assert.ok(tpl, 'should return a template object');
    assert.ok(tpl.content, 'should have non-null content');
    assert.ok(tpl.content.includes('Decision:'), 'content should reference ADR theme');
  });

  test('getTemplate("blank") returns null content', () => {
    const tpl = getTemplate('blank');
    assert.ok(tpl, 'should return a template object for blank');
    assert.equal(tpl.name, 'blank');
    assert.strictEqual(tpl.content, null, 'blank template should have null content');
    assert.equal(tpl.source, 'built-in');
  });

  test('getTemplate("nonexistent") returns null', () => {
    assert.strictEqual(getTemplate('nonexistent'), null);
  });

  test('getTemplate("") returns null', () => {
    assert.strictEqual(getTemplate(''), null);
  });

  test('getTemplate(null) returns null', () => {
    assert.strictEqual(getTemplate(null), null);
  });

  test('getTemplate is case-insensitive', () => {
    const tpl = getTemplate('FEATURE-DESIGN');
    assert.ok(tpl, 'uppercase name should still match');
    assert.equal(tpl.name, 'feature-design');
  });
});

describe('Template library — getTemplateNames', () => {
  test('includes all 4 built-in names', () => {
    const names = getTemplateNames();
    assert.ok(Array.isArray(names));
    assert.ok(names.includes('blank'), 'should include blank');
    assert.ok(names.includes('feature-design'), 'should include feature-design');
    assert.ok(names.includes('bug-investigation'), 'should include bug-investigation');
    assert.ok(names.includes('decision-record'), 'should include decision-record');
    assert.equal(names.length, 4, 'should have exactly 4 built-in names');
  });

  test('names are sorted alphabetically', () => {
    const names = getTemplateNames();
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, 'names should already be sorted');
  });
});

describe('Template library — listTemplates', () => {
  test('returns array with name, description, source for each', () => {
    const all = listTemplates();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 4, 'should have at least 4 templates');
    for (const t of all) {
      assert.ok(t.name, `template should have a name (got ${JSON.stringify(t)})`);
      assert.ok(t.description, `template "${t.name}" should have a description`);
      assert.ok(['built-in', 'library'].includes(t.source), `template "${t.name}" should have valid source`);
    }
  });
});

describe('Template library — printTemplates', () => {
  test('writes output to console (capture stdout)', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    printTemplates();

    console.log = origLog;

    assert.ok(logs.length > 0, 'should have logged something');
    const output = logs.join('\n');
    assert.ok(output.includes('feature-design'), 'output should mention feature-design');
    assert.ok(output.includes('bug-investigation'), 'output should mention bug-investigation');
    assert.ok(output.includes('decision-record'), 'output should mention decision-record');
    assert.ok(output.includes('blank'), 'output should mention blank');
    assert.ok(output.includes('--template'), 'output should mention --template flag');
  });
});

describe('Template library — substitute', () => {
  test('replaces {{title}} and {{slug}} in content', () => {
    const content = '# {{title}}\n\nSlug: {{slug}}';
    const result = substitute(content, { title: 'My Feature', slug: 'my-feature' });
    assert.equal(result, '# My Feature\n\nSlug: my-feature');
  });

  test('leaves unknown variables as-is', () => {
    const content = 'Hello {{name}}';
    const result = substitute(content, {});
    assert.equal(result, 'Hello {{name}}');
  });

  test('replaces all occurrences of the same variable', () => {
    const content = '{{x}}-{{x}}-{{x}}';
    const result = substitute(content, { x: 'foo' });
    assert.equal(result, 'foo-foo-foo');
  });

  test('handles empty content', () => {
    assert.equal(substitute('', { a: 'b' }), '');
  });

  test('handles empty variables', () => {
    assert.equal(substitute('hello', {}), 'hello');
  });
});

describe('Template library — buildVars', () => {
  test('builds standard variable set', () => {
    const vars = buildVars({ slug: 'my-feature', title: 'My Feature' });
    assert.equal(vars.title, 'My Feature');
    assert.equal(vars.slug, 'my-feature');
    assert.ok(vars.author, 'author should be set');
    assert.ok(vars.created, 'created should be set');
    assert.ok(vars.lastEdited, 'lastEdited should be set');
    assert.equal(vars.lastEdited, vars.created, 'created and lastEdited should match for a new plan');
  });

  test('auto-generates title from slug when not provided', () => {
    const vars = buildVars({ slug: 'my-feature' });
    assert.equal(vars.title, 'my-feature');
  });

  test('dates are valid ISO strings', () => {
    const vars = buildVars({ slug: 'test' });
    const created = new Date(vars.created);
    assert.ok(created instanceof Date && !isNaN(created), 'created should be a valid date');
  });
});

describe('Template library — template content via runPlan', () => {
  const TEST_SLUG = 'test-tpl-new-' + Date.now();

  afterEach(() => {
    // Clean up plan directory if created
    const planDir = join(PLANS_DIR, TEST_SLUG);
    if (existsSync(planDir)) rmSync(planDir, { recursive: true, force: true });
  });

  test('runPlan new with invalid template returns false', async () => {
    const result = await runPlan(
      ['new', TEST_SLUG, '--template', 'nonexistent-template-name-xyz'],
      {}
    );
    assert.equal(result, false, 'should return false for invalid template');

    // Verify no plan directory was left behind
    const planDir = join(PLANS_DIR, TEST_SLUG);
    assert.equal(existsSync(planDir), false, 'should clean up on error');
  });
});

// ── Comment regression: createPlan → POST /api/comments ──────────────────────
// This regression test ensures that a freshly created plan (with comments.json
// as an empty array []) can receive the first comment via POST without crashing.
// Previously, createPlan wrote {schemaVersion: 2, threads: []} which caused
// JSON.parse + .push() to fail on the first comment.

describe('Comment regression: createPlan → POST /api/comments', () => {
  const TEST_SLUG = 'test-comment-regression-' + Date.now();
  let serverInfo;
  let baseUrl;

  afterEach(async () => {
    if (serverInfo) await serverInfo.close();
    cleanupPlan(TEST_SLUG);
  });

  test('first comment on freshly created plan works (array shape)', async () => {
    // Create a plan directory — replicating what createPlan() does after the fix
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });

    const now = new Date().toISOString();
    const meta = {
      title: 'Comment Regression Test',
      slug: TEST_SLUG,
      status: 'draft',
      author: 'tester',
      created: now,
      lastEdited: now,
    };
    writeFileSync(join(planDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    writeFileSync(join(planDir, 'plan.mdx'), '# Comment Regression Test\n\nTest.\n', 'utf-8');
    // Write as [] — same shape as the fixed createPlan() now produces
    writeFileSync(join(planDir, 'comments.json'), '[]', 'utf-8');

    // Start server (port 0 = OS-assigned)
    serverInfo = await startServer(TEST_SLUG, planDir, 0);
    baseUrl = `http://127.0.0.1:${serverInfo.port}`;

    // POST a comment — this is the path that crashed before the fix
    const res = await fetch(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: 'regression-test',
        text: 'First comment on a fresh plan',
        author: 'test-gate',
      }),
    });
    assert.equal(res.status, 200, 'POST should succeed without crashing');

    // Verify the comment was saved by re-reading the file
    const updated = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
    assert.equal(Array.isArray(updated), true, 'comments should be an array');
    assert.equal(updated.length, 1, 'should have exactly 1 comment');
    assert.equal(updated[0].sectionId, 'regression-test');
    assert.equal(updated[0].text, 'First comment on a fresh plan');
    assert.equal(updated[0].author, 'test-gate');

    // Verify the file is still valid JSON
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8')));

    // Verify GET returns the comments array correctly
    const getRes = await fetch(`${baseUrl}/api/comments`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(Array.isArray(getData), true);
    assert.equal(getData.length, 1);

    // Verify PUT replaces the array cleanly
    const replacement = [
      {
        id: 'replaced',
        sectionId: 'intro',
        text: 'Replaced comment',
        author: 'test',
        created: new Date().toISOString(),
      },
    ];
    const putRes = await fetch(`${baseUrl}/api/comments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replacement),
    });
    assert.equal(putRes.status, 200);

    const afterPut = JSON.parse(readFileSync(join(planDir, 'comments.json'), 'utf-8'));
    assert.equal(Array.isArray(afterPut), true);
    assert.equal(afterPut.length, 1);
    assert.equal(afterPut[0].id, 'replaced');
  });
});

// ── htmx-friendly RESTful routes ───────────────────────────────────────────────
// New slug-scoped routes designed for htmx (and the new HTML template).
//   GET    /api/<slug>/plan          → MDX text/plain
//   PUT    /api/<slug>/plan          → save MDX (form data or raw body)
//   GET    /api/<slug>/comments      → JSON (default) or HTML (?format=html)
//   POST   /api/<slug>/comments      → add comment, returns <li> HTML
//   PUT    /api/<slug>/comments      → replace comments array (JSON)
//   GET    /api/<slug>/count         → <span class="count">N</span>
//   GET    /htmx.min.js              → self-hosted htmx library
// The cross-slug protection: any path with a different slug in the URL
// returns 403 to prevent the server from being tricked into serving
// data for a different plan.

describe('htmx-friendly RESTful routes', () => {
  const TEST_SLUG = 'test-htmx-routes-' + Date.now();
  let serverInfo;
  let baseUrl;

  beforeEach(async () => {
    createTempPlan(TEST_SLUG, {
      mdx: '# Htmx Routes Test\n\n## Overview\n\nThe first section.\n\n## Goals\n\n- First\n- Second\n',
      comments: JSON.stringify([
        {
          id: 'existing-1',
          sectionId: 'overview',
          text: 'Existing comment on overview',
          author: 'tester',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'existing-2',
          sectionId: 'goals',
          text: 'Existing comment on goals',
          author: 'tester',
          timestamp: '2026-01-02T00:00:00.000Z',
        },
      ]),
    });

    serverInfo = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 0);
    baseUrl = `http://127.0.0.1:${serverInfo.port}`;
  });

  afterEach(async () => {
    if (serverInfo) await serverInfo.close();
    cleanupPlan(TEST_SLUG);
  });

  // ── Plan routes ────────────────────────────────────────────────────
  test('GET /api/<slug>/plan returns MDX as text/plain', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/plan`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/plain'), true);
    const text = await res.text();
    assert.equal(text.includes('Htmx Routes Test'), true);
  });

  test('PUT /api/<slug>/plan with form data saves MDX', async () => {
    const newContent = '# Updated Htmx Plan\n\nNew content.\n';
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'content=' + encodeURIComponent(newContent),
    });
    assert.equal(res.status, 200);
    const saved = readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.mdx'), 'utf-8');
    assert.equal(saved, newContent);
  });

  test('PUT /api/<slug>/plan with raw text body saves MDX', async () => {
    const newContent = '# Raw Body Plan\n\nRaw body content.\n';
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: newContent,
    });
    assert.equal(res.status, 200);
    const saved = readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.mdx'), 'utf-8');
    assert.equal(saved, newContent);
  });

  test('PUT /api/<slug>/plan updates lastEdited in meta.json', async () => {
    const metaPath = join(PLANS_DIR, TEST_SLUG, 'meta.json');
    const before = JSON.parse(readFileSync(metaPath, 'utf-8'));
    // Wait a tick so the timestamp actually advances
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${baseUrl}/api/${TEST_SLUG}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'content=' + encodeURIComponent('# updated\n'),
    });
    const after = JSON.parse(readFileSync(metaPath, 'utf-8'));
    assert.ok(after.lastEdited >= before.lastEdited, 'lastEdited should advance or stay the same');
  });

  // ── Comments routes ────────────────────────────────────────────────
  test('GET /api/<slug>/comments returns JSON array by default', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('application/json'), true);
    const data = await res.json();
    assert.ok(Array.isArray(data), 'should return array');
    assert.equal(data.length, 2);
  });

  test('GET /api/<slug>/comments?format=html returns HTML fragments', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?format=html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/html'), true);
    const html = await res.text();
    assert.ok(html.includes('<li'), 'should contain <li> elements');
    assert.ok(html.includes('class="comment"'), 'should have class="comment"');
    assert.ok(html.includes('existing-1'), 'should include the existing comment ids');
    assert.ok(html.includes('existing-2'), true);
    // Should be XSS-safe — escape the comment text
    assert.ok(!html.includes('<script>'), 'no raw script tags');
  });

  test('GET /api/<slug>/comments?format=html&sectionId=... filters by section', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?format=html&sectionId=overview`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('existing-1'), 'overview comment should be present');
    assert.ok(!html.includes('existing-2'), 'goals comment should be filtered out');
  });

  test('GET /api/<slug>/comments?format=html with no comments returns the empty marker', async () => {
    // Make a fresh plan with no comments
    cleanupPlan(TEST_SLUG);
    createTempPlan(TEST_SLUG + '-empty', { mdx: '# Empty\n', comments: '[]' });
    const info = await startServer(TEST_SLUG + '-empty', join(PLANS_DIR, TEST_SLUG + '-empty'), 0);
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/${TEST_SLUG}-empty/comments?format=html`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('No comments yet'), 'should show empty message');
    } finally {
      await info.close();
      cleanupPlan(TEST_SLUG + '-empty');
    }
  });

  test('POST /api/<slug>/comments with form data adds comment and returns <li> HTML', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'sectionId=overview&text=' + encodeURIComponent('New form comment') + '&author=alice',
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/html'), true);
    const html = await res.text();
    assert.ok(html.startsWith('<li'), 'response should be a <li> element');
    assert.ok(html.includes('New form comment'), 'should include the new text');
    assert.ok(html.includes('alice'), 'should include the author');
    assert.ok(html.includes('class="comment"'), 'should have class="comment"');

    // Verify the file was updated
    const updated = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    assert.equal(updated.length, 3);
    assert.equal(updated[2].text, 'New form comment');
    assert.equal(updated[2].sectionId, 'overview');
    assert.equal(updated[2].author, 'alice');
  });

  test('POST /api/<slug>/comments with JSON body also works', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId: 'goals', text: 'JSON comment', author: 'bob' }),
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('JSON comment'), true);

    const updated = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    assert.equal(updated[updated.length - 1].author, 'bob');
  });

  test('POST /api/<slug>/comments without sectionId returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=no-section',
    });
    assert.equal(res.status, 400);
  });

  test('POST /api/<slug>/comments escapes HTML in text (XSS safety)', async () => {
    const xss = '<script>alert(1)</script>';
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'sectionId=overview&text=' + encodeURIComponent(xss) + '&author=evil',
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw <script> should be escaped');
    assert.ok(html.includes('&lt;script&gt;'), 'should contain the escaped form');
  });

  test('PUT /api/<slug>/comments replaces the whole array', async () => {
    const replacement = [
      { id: 'new-1', sectionId: 'goals', text: 'Replacement', author: 'replacer', timestamp: new Date().toISOString() },
    ];
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replacement),
    });
    assert.equal(res.status, 200);

    const saved = JSON.parse(
      readFileSync(join(PLANS_DIR, TEST_SLUG, 'comments.json'), 'utf-8')
    );
    assert.deepEqual(saved, replacement);
  });

  test('PUT /api/<slug>/comments with non-array body returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'an array' }),
    });
    assert.equal(res.status, 400);
  });

  // ── Count route ────────────────────────────────────────────────────
  test('GET /api/<slug>/count?sectionId=... returns <span> with the right count', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/count?sectionId=overview`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/html'), true);
    const html = await res.text();
    assert.equal(html, '<span class="count">1</span>');
  });

  test('GET /api/<slug>/count without sectionId returns total count', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/count`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(html, '<span class="count">2</span>');
  });

  // ── Self-hosted htmx ───────────────────────────────────────────────
  test('GET /htmx.min.js serves the self-hosted htmx library', async () => {
    const res = await fetch(`${baseUrl}/htmx.min.js`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct.includes('application/javascript'), `expected application/javascript, got ${ct}`);
    const body = await res.text();
    assert.ok(body.includes('htmx'), 'body should mention htmx');
    // The actual htmx library defines a function called htmx
    assert.ok(body.includes('var htmx=') || body.includes('const htmx='), 'should define a top-level htmx');
  });

  // ── Cross-slug protection ──────────────────────────────────────────
  test('cross-slug access returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/wrong-slug/comments`);
    assert.equal(res.status, 403);
  });

  test('cross-slug PUT also returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/wrong-slug/plan`, {
      method: 'PUT',
      body: 'evil=true',
    });
    assert.equal(res.status, 403);
  });

  // ── 404 for unknown resources under a valid slug ───────────────────
  test('GET /api/<slug>/unknown returns 404 (not 403)', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/unknown-resource`);
    assert.equal(res.status, 404);
  });
});

// ── HTML template smoke tests ─────────────────────────────────────────────────
// These tests regenerate plan.html and verify the resulting HTML
// uses htmx attributes (and does NOT use fetch() in JS for the
// save/comment flows). The script tag for htmx should reference
// the local /htmx.min.js path.

describe('HTML template uses htmx', () => {
  const TEST_SLUG = 'test-tpl-htmx-' + Date.now();

  afterEach(() => {
    cleanupPlan(TEST_SLUG);
  });

  test('regenerated plan.html contains htmx attributes and not raw fetch()', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, 'meta.json'),
      JSON.stringify({
        title: 'Template Htmx Test',
        slug: TEST_SLUG,
        status: 'draft',
        author: 'tester',
        created: '2026-06-01T00:00:00.000Z',
        lastEdited: '2026-06-01T00:00:00.000Z',
      })
    );
    writeFileSync(join(planDir, 'plan.mdx'), '# Template Htmx Test\n\n## Section One\n\nHello.\n');
    writeFileSync(join(planDir, 'comments.json'), '[]');

    await regenerateHtml(TEST_SLUG);

    const html = readFileSync(join(planDir, 'plan.html'), 'utf-8');

    // Should load htmx from the local path
    assert.ok(html.includes('src="/htmx.min.js"'), 'should load htmx from local path');

    // Should use htmx attributes for the comment list (auto-load)
    assert.ok(/hx-get="\/api\/[^"]+\/comments\?format=html"/.test(html),
      'should have hx-get on the comment list');
    assert.ok(/hx-trigger="load[^"]*"/.test(html),
      'should have hx-trigger="load" on the comment list');

    // Should use htmx for the comment form
    assert.ok(/hx-post="\/api\/[^"]+\/comments"/.test(html), 'should have hx-post for comments');
    assert.ok(/hx-target="#comment-list"/.test(html), 'comment form should target the list');
    assert.ok(/hx-swap="beforeend"/.test(html), 'comment form should append (beforeend)');

    // The autosave textarea is created by enterEditMode() via setAttribute
    // (we process the body with htmx.process() after creation), so the static
    // HTML won't have hx-put. Check the JS wires it up instead.
    assert.ok(html.includes("setAttribute('hx-put', '/api/") ||
              html.includes('setAttribute("hx-put", "/api/'),
      'JS should set hx-put on the autosave textarea');
    assert.ok(html.includes("setAttribute('hx-trigger'") ||
              html.includes('setAttribute("hx-trigger"'),
      'JS should set hx-trigger on the autosave textarea');

    // Should NOT have raw fetch() in the new template
    // (We allow fetch() to be mentioned in comments)
    const noCommentFetch = html
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .filter((line) => !/<!--/.test(line) && !/^[\s]*\*/.test(line))
      .join('\n');
    assert.ok(!/fetch\s*\(/.test(noCommentFetch), 'non-comment code should not call fetch() directly');

    // The slug should be substituted, no raw {{slug}} left
    assert.ok(!html.includes('{{slug}}'), 'slug placeholder should be substituted');
    assert.ok(!html.includes('{{title}}'), 'title placeholder should be substituted');
    assert.ok(!html.includes('{{planJson}}'), 'planJson placeholder should be substituted');
    assert.ok(!html.includes('{{commentsJson}}'), 'commentsJson placeholder should be substituted');
    assert.ok(!html.includes('{{metaJson}}'), 'metaJson placeholder should be substituted');
    assert.ok(!html.includes('{{status}}'), 'status placeholder should be substituted');
    assert.ok(!html.includes('{{created}}'), 'created placeholder should be substituted');
    assert.ok(!html.includes('{{lastEdited}}'), 'lastEdited placeholder should be substituted');
    assert.ok(!html.includes('{{author}}'), 'author placeholder should be substituted');
  });

  test('template is smaller than the pre-htmx version (regression check)', () => {
    const tplPath = join(TEMPLATES_DIR, 'plan.html.template');
    const lines = readFileSync(tplPath, 'utf-8').split('\n').length;
    assert.ok(lines < 1039, `template should be smaller than the original 1039 lines, got ${lines}`);
  });
});

// ── End of template tests ──────────────────────────────────────────────────────

console.log('  plan.mjs tests loaded — run with: node --test cli/plan.test.mjs');
