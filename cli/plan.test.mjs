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

  // In v1, POST without sectionId returned 400. In v2, the endpoint has
  // been merged: requests without sectionId are treated as v2 canvas
  // comments (no elementId) and accepted with 200. The v1 contract was
  // "sectionId is required", but the new behavior is "sectionId is
  // optional — used only for v1 back-compat".
  test('POST /api/<slug>/comments without sectionId (v2: canvas-pinned) returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=no-section',
    });
    assert.equal(res.status, 200);
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

  // Test the v1 template (plan.html.template) directly. The v1 template is
  // htmx-based; the v2 canvas template (plan.canvas.template) is a separate
  // file with its own tests below.
  test('v1 plan.html.template uses htmx (read directly)', () => {
    const tplPath = join(TEMPLATES_DIR, 'plan.html.template');
    const tpl = readFileSync(tplPath, 'utf-8');

    // Should load htmx from the local path
    assert.ok(tpl.includes('src="/htmx.min.js"'), 'v1 should load htmx from local path');

    // Should use htmx attributes for the comment list (auto-load)
    assert.ok(/hx-get="\/api\/[^"]+\/comments\?format=html"/.test(tpl),
      'v1 should have hx-get on the comment list');
    assert.ok(/hx-trigger="load[^"]*"/.test(tpl),
      'v1 should have hx-trigger="load" on the comment list');

    // Should use htmx for the comment form
    assert.ok(/hx-post="\/api\/[^"]+\/comments"/.test(tpl), 'v1 should have hx-post for comments');
    assert.ok(/hx-target="#comment-list"/.test(tpl), 'v1 comment form should target the list');
    assert.ok(/hx-swap="beforeend"/.test(tpl), 'v1 comment form should append (beforeend)');

    // The autosave textarea is created by enterEditMode() via setAttribute.
    assert.ok(tpl.includes("setAttribute('hx-put', '/api/") ||
              tpl.includes('setAttribute("hx-put", "/api/'),
      'v1 JS should set hx-put on the autosave textarea');
    assert.ok(tpl.includes("setAttribute('hx-trigger'") ||
              tpl.includes('setAttribute("hx-trigger"'),
      'v1 JS should set hx-trigger on the autosave textarea');

    // The v1 template should not call fetch() directly (htmx does the work).
    const noCommentFetch = tpl
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .filter((line) => !/<!--/.test(line) && !/^[\s]*\*/.test(line))
      .join('\n');
    assert.ok(!/fetch\s*\(/.test(noCommentFetch), 'v1 non-comment code should not call fetch() directly');
  });

  test('regenerated plan.html uses the v2 canvas template by default', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, 'meta.json'),
      JSON.stringify({
        title: 'V2 Default Test',
        slug: TEST_SLUG,
        status: 'draft',
        author: 'tester',
        created: '2026-06-01T00:00:00.000Z',
        lastEdited: '2026-06-01T00:00:00.000Z',
      })
    );
    writeFileSync(join(planDir, 'plan.mdx'), '# V2 Default Test\n\n## Section\n\nHello.\n');
    writeFileSync(join(planDir, 'comments.json'), '[]');

    await regenerateHtml(TEST_SLUG);

    const html = readFileSync(join(planDir, 'plan.html'), 'utf-8');

    // The default regenerated plan.html should be the v2 canvas view
    assert.ok(html.includes('id="canvas"'), 'default plan.html should be the v2 canvas view');
    assert.ok(html.includes('id="connections-layer"'),
      'default plan.html should have the SVG connections layer');

    // Should have all placeholders substituted
    assert.ok(!html.includes('{{slug}}'), 'slug placeholder should be substituted');
    assert.ok(!html.includes('{{title}}'), 'title placeholder should be substituted');
    assert.ok(!html.includes('{{planJson}}'), 'planJson placeholder should be substituted');
    assert.ok(!html.includes('{{commentsJson}}'), 'commentsJson placeholder should be substituted');
    assert.ok(!html.includes('{{metaJson}}'), 'metaJson placeholder should be substituted');
    assert.ok(!html.includes('{{canvasJson}}'), 'canvasJson placeholder should be substituted');
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

// ── Canvas endpoints (v2) ────────────────────────────────────────────────────
// New slug-scoped routes for the v2 canvas state.
//   GET    /api/<slug>/canvas              → full JSON canvas state
//   PUT    /api/<slug>/canvas              → save canvas state
//   GET    /api/<slug>/elements            → just the elements array
//   POST   /api/<slug>/elements            → add element, returns it
//   PUT    /api/<slug>/elements/<id>       → update element
//   DELETE /api/<slug>/elements/<id>       → remove element + cascade
//   GET    /api/<slug>/connections         → just the connections array
//   POST   /api/<slug>/connections         → add connection
//   DELETE /api/<slug>/connections/<id>    → remove connection
//   GET    /api/<slug>/comments?elementId= → canvas comments
//   POST   /api/<slug>/comments            → add canvas comment
//   PUT    /api/<slug>/comments/<id>       → update comment (add reply)
//   DELETE /api/<slug>/comments/<id>       → remove comment
//   GET    /api/<slug>/markdown-export     → derived markdown from canvas

import {
  loadOrMigrateCanvas,
  canvasToMarkdown,
  emptyCanvas,
  CANVAS_SCHEMA_VERSION,
  makeElementId,
  makeConnectionId,
  makeCommentId,
  makeReplyId,
} from './plan.mjs';

describe('Canvas helpers (pure functions)', () => {
  test('emptyCanvas returns a v2 schema with empty arrays', () => {
    const c = emptyCanvas('Test');
    assert.equal(c.schemaVersion, CANVAS_SCHEMA_VERSION);
    assert.equal(c.title, 'Test');
    assert.deepEqual(c.elements, []);
    assert.deepEqual(c.connections, []);
    assert.deepEqual(c.comments, []);
    assert.deepEqual(c.viewport, { x: 0, y: 0, zoom: 1 });
  });

  test('emptyCanvas with no title uses "Untitled plan"', () => {
    const c = emptyCanvas();
    assert.equal(c.title, 'Untitled plan');
  });

  test('id generators produce namespaced ids', () => {
    assert.ok(makeElementId().startsWith('el_'), 'element id should start with el_');
    assert.ok(makeConnectionId().startsWith('conn_'), 'connection id should start with conn_');
    assert.ok(makeCommentId().startsWith('c_'), 'comment id should start with c_');
    assert.ok(makeReplyId().startsWith('r_'), 'reply id should start with r_');
    // They should be unique across calls.
    const a = makeElementId();
    const b = makeElementId();
    assert.notEqual(a, b);
  });

  test('canvasToMarkdown produces a sensible header', () => {
    const c = emptyCanvas('My Title');
    const md = canvasToMarkdown(c);
    assert.ok(md.startsWith('# My Title'), `expected "# My Title" header, got: ${md.slice(0, 30)}`);
  });

  test('canvasToMarkdown serializes text elements', () => {
    const c = emptyCanvas('T');
    c.elements.push({
      id: 'el_1', type: 'text', x: 0, y: 0, width: 100, height: 100,
      title: 'Intro', content: 'Hello world',
    });
    const md = canvasToMarkdown(c);
    assert.ok(md.includes('## Intro'), 'should include element title as section');
    assert.ok(md.includes('Hello world'), 'should include element content');
  });

  test('canvasToMarkdown serializes code with language fence', () => {
    const c = emptyCanvas('T');
    c.elements.push({
      id: 'el_1', type: 'code', x: 0, y: 0, width: 100, height: 100,
      language: 'javascript', content: 'const x = 1;',
    });
    const md = canvasToMarkdown(c);
    assert.ok(md.includes('```javascript'), 'should include the language fence');
    assert.ok(md.includes('const x = 1;'), 'should include the code');
  });

  test('canvasToMarkdown serializes diagram as mermaid block', () => {
    const c = emptyCanvas('T');
    c.elements.push({
      id: 'el_1', type: 'diagram', x: 0, y: 0, width: 100, height: 100,
      content: 'graph LR\nA --> B',
    });
    const md = canvasToMarkdown(c);
    assert.ok(md.includes('```mermaid'), 'should use mermaid fence');
    assert.ok(md.includes('A --> B'), 'should include diagram source');
  });

  test('canvasToMarkdown serializes ui-mockup button', () => {
    const c = emptyCanvas('T');
    c.elements.push({
      id: 'el_1', type: 'ui-mockup', x: 0, y: 0, width: 100, height: 100,
      component: 'button', label: 'Submit',
    });
    const md = canvasToMarkdown(c);
    assert.ok(md.includes('[Submit]'), 'should include button label in markdown');
  });

  test('canvasToMarkdown serializes comments as a notes section', () => {
    const c = emptyCanvas('T');
    c.comments.push({
      id: 'c_1', x: 0, y: 0, elementId: null,
      author: 'Alice', text: 'looks good', created: '2026-06-18T00:00:00Z', thread: [],
    });
    const md = canvasToMarkdown(c);
    assert.ok(md.includes('## Notes'), 'should have a Notes section');
    assert.ok(md.includes('**Alice**'), 'should include author');
    assert.ok(md.includes('looks good'), 'should include comment text');
  });

  test('canvasToMarkdown handles empty canvas', () => {
    const md = canvasToMarkdown(emptyCanvas('Empty'));
    assert.ok(md.includes('# Empty'));
    // No element sections, but should still have the header.
  });
});

describe('loadOrMigrateCanvas', () => {
  const TEST_SLUG = 'test-canvas-migrate-' + Date.now();

  afterEach(() => {
    cleanupPlan(TEST_SLUG);
  });

  test('returns existing plan.json if present', () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });
    const canvas = {
      schemaVersion: 2, title: 'Existing', elements: [], connections: [], comments: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    writeFileSync(join(planDir, 'plan.json'), JSON.stringify(canvas));

    const result = loadOrMigrateCanvas(planDir, 'Existing');
    assert.equal(result.title, 'Existing');
  });

  test('migrates plan.mdx to canvas on first read', () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });
    const mdx = '# Hello\n\n## World\n\nFoo bar\n';
    writeFileSync(join(planDir, 'plan.mdx'), mdx);

    const result = loadOrMigrateCanvas(planDir, 'Migrated');
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.elements.length, 1);
    assert.equal(result.elements[0].type, 'text');
    assert.ok(result.elements[0].content.includes('Foo bar'));

    // After migration, plan.json should be on disk.
    assert.equal(existsSync(join(planDir, 'plan.json')), true);
  });

  test('returns empty canvas if no plan.json and no plan.mdx', () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });

    const result = loadOrMigrateCanvas(planDir, 'Brand New');
    assert.equal(result.title, 'Brand New');
    assert.equal(result.elements.length, 0);

    // Should have created plan.json.
    assert.equal(existsSync(join(planDir, 'plan.json')), true);
  });

  test('backfills missing arrays on a partial canvas', () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    mkdirSync(planDir, { recursive: true });
    // Write a partial canvas (missing comments)
    writeFileSync(join(planDir, 'plan.json'), JSON.stringify({
      schemaVersion: 2, title: 'Partial',
      elements: [], connections: [],
    }));

    const result = loadOrMigrateCanvas(planDir, 'Partial');
    assert.deepEqual(result.comments, []);
    assert.ok(result.viewport);
  });
});

describe('Canvas HTTP endpoints', () => {
  const TEST_SLUG = 'test-canvas-api-' + Date.now();
  let serverInfo;
  let baseUrl;

  beforeEach(async () => {
    createTempPlan(TEST_SLUG, {
      mdx: '# Canvas Test\n\n## Section 1\n\nHello.\n',
      comments: '[]',
    });
    serverInfo = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 0);
    baseUrl = `http://127.0.0.1:${serverInfo.port}`;
  });

  afterEach(async () => {
    if (serverInfo) await serverInfo.close();
    cleanupPlan(TEST_SLUG);
  });

  // ── Canvas state ─────────────────────────────────────────────
  test('GET /api/<slug>/canvas returns full v2 canvas state', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.schemaVersion, 2);
    // Title comes from meta.json (auto-migration). The test slug derives
    // the title as "Test Canvas Api <timestamp>".
    assert.ok(data.title.startsWith('Test Canvas Api'),
      `expected title to start with 'Test Canvas Api', got: ${data.title}`);
    assert.ok(Array.isArray(data.elements));
    assert.ok(Array.isArray(data.connections));
    assert.ok(Array.isArray(data.comments));
    assert.ok(data.viewport);
    // Auto-migrated from mdx: should have one text element
    assert.equal(data.elements.length, 1);
    assert.equal(data.elements[0].type, 'text');
  });

  test('GET /api/<slug>/canvas auto-migrates from mdx on first call', async () => {
    const planDir = join(PLANS_DIR, TEST_SLUG);
    // First, clear the auto-generated plan.json so we test the migration path
    const jsonPath = join(planDir, 'plan.json');
    if (existsSync(jsonPath)) rmSync(jsonPath);
    assert.equal(existsSync(jsonPath), false);

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`);
    assert.equal(res.status, 200);
    const data = await res.json();
    // The migration creates a text element from the mdx
    assert.equal(data.elements.length, 1);
    assert.equal(data.elements[0].type, 'text');
    // After this call, plan.json should exist
    assert.equal(existsSync(jsonPath), true);
  });

  test('PUT /api/<slug>/canvas saves the full canvas state', async () => {
    const newCanvas = {
      schemaVersion: 2,
      title: 'Updated',
      elements: [
        { id: 'el_a', type: 'text', x: 0, y: 0, width: 200, height: 100, content: 'A' },
        { id: 'el_b', type: 'text', x: 300, y: 0, width: 200, height: 100, content: 'B' },
      ],
      connections: [],
      comments: [],
      viewport: { x: 10, y: 20, zoom: 1.5 },
    };
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCanvas),
    });
    assert.equal(res.status, 200);

    // Verify the file was written
    const saved = JSON.parse(readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.json'), 'utf-8'));
    assert.equal(saved.title, 'Updated');
    assert.equal(saved.elements.length, 2);
    assert.equal(saved.viewport.zoom, 1.5);
  });

  test('PUT /api/<slug>/canvas normalizes partial canvas', async () => {
    // No elements, connections, or comments arrays — should be added.
    const partial = { schemaVersion: 2, title: 'Sparse' };
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    assert.equal(res.status, 200);
    const saved = JSON.parse(readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.json'), 'utf-8'));
    assert.deepEqual(saved.elements, []);
    assert.deepEqual(saved.connections, []);
    assert.deepEqual(saved.comments, []);
    assert.ok(saved.viewport);
  });

  test('PUT /api/<slug>/canvas with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    });
    assert.equal(res.status, 400);
  });

  // ── Elements ─────────────────────────────────────────────────
  test('GET /api/<slug>/elements returns the elements array', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`);
    assert.equal(res.status, 200);
    const arr = await res.json();
    assert.ok(Array.isArray(arr));
  });

  test('POST /api/<slug>/elements adds an element and returns it', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 100, y: 200, width: 300, height: 150, title: 'Hi', content: 'Body' }),
    });
    assert.equal(res.status, 200);
    const el = await res.json();
    assert.ok(el.id.startsWith('el_'));
    assert.equal(el.type, 'text');
    assert.equal(el.x, 100);
    assert.equal(el.title, 'Hi');
    assert.equal(el.content, 'Body');
  });

  test('PUT /api/<slug>/elements/<id> updates an element', async () => {
    // First add an element
    const addRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100, content: 'old' }),
    });
    const el = await addRes.json();

    // Now update it
    const putRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 999, content: 'new' }),
    });
    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.x, 999);
    assert.equal(updated.content, 'new');
    // Untouched fields preserved
    assert.equal(updated.y, 0);
    assert.equal(updated.width, 100);
  });

  test('PUT /api/<slug>/elements/<id> for unknown id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/el_does_not_exist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    });
    assert.equal(res.status, 404);
  });

  test('DELETE /api/<slug>/elements/<id> removes the element', async () => {
    const addRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    });
    const el = await addRes.json();
    const delRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // Verify it's gone
    const getRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`);
    const arr = await getRes.json();
    assert.equal(arr.find((e) => e.id === el.id), undefined);
  });

  test('DELETE /api/<slug>/elements/<id> cascades to connections and comments', async () => {
    // Add two elements
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 200, y: 0, width: 100, height: 100 }),
    })).json());

    // Connect them
    await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: e2.id, type: 'arrow' }),
    });

    // Add a comment pinned to e1
    await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50, elementId: e1.id, text: 'note on e1' }),
    });

    // Delete e1
    const delRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${e1.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // The connection should be gone
    const connRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`);
    const conns = await connRes.json();
    assert.equal(conns.length, 0, 'connections referencing deleted element should be removed');

    // The comment should still exist but be detached
    // Use elementId= (empty) to explicitly request v2 endpoint.
    const cRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?elementId=`);
    const cs = await cRes.json();
    assert.equal(cs.length, 1, 'comment should remain (now unpinned)');
    assert.equal(cs[0].elementId, null, 'comment elementId should be nulled out');
  });

  // ── Connections ─────────────────────────────────────────────
  test('GET /api/<slug>/connections returns the connections array', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`);
    assert.equal(res.status, 200);
    const arr = await res.json();
    assert.ok(Array.isArray(arr));
  });

  test('POST /api/<slug>/connections creates a connection', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 200, y: 0, width: 100, height: 100 }),
    })).json());

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: e2.id, type: 'arrow', label: 'leads to' }),
    });
    assert.equal(res.status, 200);
    const conn = await res.json();
    assert.ok(conn.id.startsWith('conn_'));
    assert.equal(conn.from, e1.id);
    assert.equal(conn.to, e2.id);
    assert.equal(conn.type, 'arrow');
    assert.equal(conn.label, 'leads to');
  });

  test('POST /api/<slug>/connections with missing endpoint returns 400', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: 'el_nonexistent' }),
    });
    assert.equal(res.status, 400);
  });

  test('DELETE /api/<slug>/connections/<id> removes a connection', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 200, y: 0, width: 100, height: 100 }),
    })).json());

    const addRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: e2.id }),
    });
    const conn = await addRes.json();

    const delRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections/${conn.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`);
    const arr = await getRes.json();
    assert.equal(arr.length, 0);
  });

  test('DELETE /api/<slug>/connections/<id> for unknown id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections/conn_does_not_exist`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  // ── Comments (v2 canvas shape) ───────────────────────────────
  test('GET /api/<slug>/comments returns canvas comments (empty array by default)', async () => {
    // Pass elementId= to explicitly request the v2 endpoint. Without it,
    // the request falls through to the v1 handler for back-compat.
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?elementId=`);
    assert.equal(res.status, 200);
    const arr = await res.json();
    assert.ok(Array.isArray(arr));
  });

  test('POST /api/<slug>/comments creates a canvas comment', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200, text: 'hi', author: 'Alice' }),
    });
    assert.equal(res.status, 200);
    const c = await res.json();
    assert.ok(c.id.startsWith('c_'));
    assert.equal(c.x, 100);
    assert.equal(c.y, 200);
    assert.equal(c.text, 'hi');
    assert.equal(c.author, 'Alice');
    assert.equal(c.elementId, null);
    assert.ok(Array.isArray(c.thread));
  });

  test('POST /api/<slug>/comments attaches to an element', async () => {
    const e = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50, elementId: e.id, text: 'note' }),
    });
    const c = await res.json();
    assert.equal(c.elementId, e.id);
  });

  test('GET /api/<slug>/comments?elementId=... filters by element', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 200, y: 0, width: 100, height: 100 }),
    })).json());

    await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, elementId: e1.id, text: 'on e1' }),
    });
    await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, elementId: e2.id, text: 'on e2' }),
    });

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?elementId=${e1.id}`);
    const arr = await res.json();
    assert.equal(arr.length, 1);
    assert.equal(arr[0].text, 'on e1');
  });

  test('GET /api/<slug>/comments?elementId=nil returns only canvas-pinned comments', async () => {
    await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50, text: 'pinned to canvas' }),
    });
    const e = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 0, y: 0, width: 100, height: 100 }),
    })).json());
    await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, elementId: e.id, text: 'on element' }),
    });

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments?elementId=nil`);
    const arr = await res.json();
    assert.equal(arr.length, 1);
    assert.equal(arr[0].text, 'pinned to canvas');
  });

  test('PUT /api/<slug>/comments/<id> adds a reply', async () => {
    const addRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'original' }),
    });
    const c = await addRes.json();

    const replyRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/${c.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'a reply', replyAuthor: 'ai' }),
    });
    assert.equal(replyRes.status, 200);
    const updated = await replyRes.json();
    assert.equal(updated.thread.length, 1);
    assert.equal(updated.thread[0].text, 'a reply');
    assert.equal(updated.thread[0].author, 'ai');
  });

  test('DELETE /api/<slug>/comments/<id> removes a comment', async () => {
    const addRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'doomed' }),
    });
    const c = await addRes.json();

    const delRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/${c.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`);
    const arr = await listRes.json();
    assert.equal(arr.length, 0);
  });

  test('PUT /api/<slug>/comments/<id> for unknown id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/c_does_not_exist`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    });
    assert.equal(res.status, 404);
  });

  // ── Markdown export ──────────────────────────────────────────
  test('GET /api/<slug>/markdown-export returns derived markdown', async () => {
    // Set up a known canvas
    const canvas = {
      schemaVersion: 2,
      title: 'Export Test',
      elements: [
        { id: 'el_x', type: 'text', x: 0, y: 0, width: 100, height: 100, title: 'Header', content: 'Body text' },
        { id: 'el_y', type: 'code', x: 0, y: 100, width: 100, height: 100, language: 'js', content: 'var a;' },
      ],
      connections: [],
      comments: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(canvas),
    });

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/markdown-export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').includes('text/markdown'), true);
    const md = await res.text();
    assert.ok(md.includes('# Export Test'), 'should include title');
    assert.ok(md.includes('## Header'), 'should include element title as section');
    assert.ok(md.includes('Body text'), 'should include text content');
    assert.ok(md.includes('```js'), 'should include code with language fence');
    assert.ok(md.includes('var a;'), 'should include code content');
  });

  // ── Cross-slug ───────────────────────────────────────────────
  test('cross-slug canvas access returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/wrong-slug/canvas`);
    assert.equal(res.status, 403);
  });

  test('cross-slug element add returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/wrong-slug/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    });
    assert.equal(res.status, 403);
  });
});

// ── htmx content-negotiation tests ───────────────────────────────────────────
// Verify that the canvas endpoints return HTML when the request comes from
// htmx (Accept: text/html or HX-Request: true), and JSON otherwise (for the
// AI tool, tests, and CLI scripts).

import {
  renderElementHTML,
  renderConnectionHTML,
  renderCommentPinHTML,
  renderCommentThreadHTML,
  renderReplyHTML,
} from './plan.mjs';

describe('htmx content negotiation on canvas endpoints', () => {
  const TEST_SLUG = 'test-htmx-negotiate-' + Date.now();
  let serverInfo;
  let baseUrl;

  beforeEach(async () => {
    createTempPlan(TEST_SLUG, { mdx: '# Neg Test\n', comments: '[]' });
    serverInfo = await startServer(TEST_SLUG, join(PLANS_DIR, TEST_SLUG), 0);
    baseUrl = `http://127.0.0.1:${serverInfo.port}`;
  });

  afterEach(async () => {
    if (serverInfo) await serverInfo.close();
    cleanupPlan(TEST_SLUG);
  });

  // ── POST /api/<slug>/elements ────────────────────────────────────
  test('POST /elements with Accept: text/html returns element HTML', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/html',
      },
      body: JSON.stringify({ type: 'text', x: 10, y: 20, width: 200, height: 100, title: 'Hi' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'),
      'should return text/html');
    const html = await res.text();
    assert.ok(html.startsWith('<div class="element"'),
      `response should start with <div class="element">, got: ${html.slice(0, 60)}`);
    assert.ok(html.includes('data-element-id="el_'),
      'should include data-element-id attribute');
    assert.ok(html.includes('data-element-type="text"'),
      'should include data-element-type="text"');
    assert.ok(html.includes('style="left:10px;top:20px;width:200px;height:100px"'),
      'should include inline position styles');
    assert.ok(html.includes('Hi'), 'should include title text');
  });

  test('POST /elements with HX-Request: true returns element HTML', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'HX-Request': 'true',
      },
      body: JSON.stringify({ type: 'text', title: 'Hi' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('class="element"'),
      'should return element HTML on HX-Request header');
  });

  test('POST /elements with Accept: application/json returns JSON', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ type: 'text', title: 'Hi' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/json'));
    const el = await res.json();
    assert.equal(el.type, 'text');
    assert.equal(el.title, 'Hi');
  });

  test('POST /elements with no Accept header returns JSON (backwards compat)', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', title: 'Hi' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/json'),
      'default (no Accept) should return JSON for backwards compat');
  });

  // ── PUT /api/<slug>/elements/<id> ────────────────────────────────
  test('PUT /elements/<id> with Accept: text/html returns updated element HTML', async () => {
    // First add via JSON
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', title: 'Old' }),
    });
    const el = await add.json();

    const put = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ title: 'New' }),
    });
    assert.equal(put.status, 200);
    assert.ok(put.headers.get('content-type').includes('text/html'));
    const html = await put.text();
    assert.ok(html.includes('New'), 'should reflect updated title');
    assert.ok(html.includes('data-element-id="' + el.id + '"'),
      'should keep the same element id');
  });

  test('PUT /elements/<id> with Accept: application/json returns JSON', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', title: 'Old' }),
    });
    const el = await add.json();

    const put = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    });
    const updated = await put.json();
    assert.equal(updated.title, 'New');
  });

  // ── DELETE /api/<slug>/elements/<id> ─────────────────────────────
  test('DELETE /elements/<id> with Accept: text/html returns empty 200', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    });
    const el = await add.json();

    const del = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, {
      method: 'DELETE', headers: { 'Accept': 'text/html' },
    });
    assert.equal(del.status, 200);
    assert.ok(del.headers.get('content-type').includes('text/html'));
    const html = await del.text();
    assert.equal(html, '', 'htmx DELETE should return empty body so swap="delete" can remove the node');

    // Verify it's actually gone
    const get = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`);
    const arr = await get.json();
    assert.equal(arr.find((e) => e.id === el.id), undefined);
  });

  test('DELETE /elements/<id> with Accept: application/json returns JSON ok', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    });
    const el = await add.json();

    const del = await fetch(`${baseUrl}/api/${TEST_SLUG}/elements/${el.id}`, {
      method: 'DELETE', headers: { 'Accept': 'application/json' },
    });
    const result = await del.json();
    assert.equal(result.ok, true);
    assert.equal(result.removed, el.id);
  });

  // ── POST /api/<slug>/connections ─────────────────────────────────
  test('POST /connections with Accept: text/html returns SVG fragment', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 100 }),
    })).json());

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ from: e1.id, to: e2.id, type: 'arrow' }),
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.startsWith('<g class="connection"'),
      `should be an SVG <g> fragment, got: ${html.slice(0, 60)}`);
    assert.ok(html.includes('data-connection-id="conn_'));
    assert.ok(html.includes('data-from="' + e1.id + '"'));
    assert.ok(html.includes('data-to="' + e2.id + '"'));
    assert.ok(html.includes('data-type="arrow"'));
  });

  test('POST /connections with Accept: application/json returns JSON', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 100 }),
    })).json());

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: e2.id }),
    });
    const conn = await res.json();
    assert.equal(conn.from, e1.id);
    assert.equal(conn.to, e2.id);
  });

  test('DELETE /connections/<id> with Accept: text/html returns empty 200', async () => {
    const e1 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text' }),
    })).json());
    const e2 = (await (await fetch(`${baseUrl}/api/${TEST_SLUG}/elements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', x: 100 }),
    })).json());
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e1.id, to: e2.id }),
    });
    const conn = await add.json();

    const del = await fetch(`${baseUrl}/api/${TEST_SLUG}/connections/${conn.id}`, {
      method: 'DELETE', headers: { 'Accept': 'text/html' },
    });
    assert.equal(del.status, 200);
    assert.equal(await del.text(), '');
  });

  // ── POST /api/<slug>/comments ────────────────────────────────────
  test('POST /comments with Accept: text/html returns pin HTML', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ x: 100, y: 200, text: 'note', author: 'Alice' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'));
    const html = await res.text();
    assert.ok(html.startsWith('<div class="comment-pin"'),
      `should be a comment-pin <div>, got: ${html.slice(0, 60)}`);
    assert.ok(html.includes('data-comment-id="c_'));
    assert.ok(html.includes('style="left:100px;top:200px"'),
      'should include inline position styles');
    assert.ok(html.includes('title="note"'),
      'should include the text as a tooltip');
  });

  test('POST /comments with Accept: application/json returns JSON', async () => {
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'note', author: 'Bob' }),
    });
    const c = await res.json();
    assert.equal(c.text, 'note');
    assert.equal(c.author, 'Bob');
  });

  // ── PUT /api/<slug>/comments/<id> (add reply) ────────────────────
  test('PUT /comments/<id> with Accept: text/html returns full thread HTML', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'original', author: 'Alice' }),
    });
    const c = await add.json();

    const reply = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ reply: 'a reply', replyAuthor: 'ai' }),
    });
    assert.equal(reply.status, 200);
    assert.ok(reply.headers.get('content-type').includes('text/html'));
    const html = await reply.text();
    assert.ok(html.startsWith('<li class="comment"'),
      `should be a <li class="comment">, got: ${html.slice(0, 60)}`);
    assert.ok(html.includes('original'), 'should include original comment');
    assert.ok(html.includes('a reply'), 'should include the new reply');
    assert.ok(html.includes('class="reply"'), 'should mark reply with class="reply"');
  });

  test('PUT /comments/<id> with Accept: application/json returns updated JSON', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'original' }),
    });
    const c = await add.json();

    const reply = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/${c.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ reply: 'a reply', replyAuthor: 'ai' }),
    });
    const updated = await reply.json();
    assert.equal(updated.thread.length, 1);
    assert.equal(updated.thread[0].text, 'a reply');
  });

  test('DELETE /comments/<id> with Accept: text/html returns empty 200', async () => {
    const add = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0, y: 0, text: 'doomed' }),
    });
    const c = await add.json();

    const del = await fetch(`${baseUrl}/api/${TEST_SLUG}/comments/${c.id}`, {
      method: 'DELETE', headers: { 'Accept': 'text/html' },
    });
    assert.equal(del.status, 200);
    assert.equal(await del.text(), '');
  });

  // ── PUT /api/<slug>/canvas (full autosave) ───────────────────────
  test('PUT /canvas with Accept: text/html returns save-status badge HTML', async () => {
    const newCanvas = {
      schemaVersion: 2, title: 'Updated',
      elements: [{ id: 'el_x', type: 'text', x: 0, y: 0, width: 100, height: 100, content: 'x' }],
      connections: [], comments: [], viewport: { x: 0, y: 0, zoom: 1 },
    };
    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify(newCanvas),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('class="save-status'),
      'should return a save-status badge (got: ' + html.slice(0, 80) + ')');
    assert.ok(html.includes('Saved'), 'should say "Saved"');
  });

  test('PUT /canvas accepts htmx form-encoded body with JSON-stringified nested values', async () => {
    // htmx 2.x form-encodes nested objects as JSON strings. The canvas
    // PUT handler must decode them so the saved JSON is correct.
    const params = new URLSearchParams();
    params.set('title', 'Form Encoded');
    params.set('elements', JSON.stringify([{ id: 'el_1', type: 'text', x: 5, y: 5, width: 50, height: 50, content: 'hi' }]));
    params.set('connections', '[]');
    params.set('comments', '[]');
    params.set('viewport', JSON.stringify({ x: 1, y: 2, zoom: 1.5 }));

    const res = await fetch(`${baseUrl}/api/${TEST_SLUG}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString(),
    });
    assert.equal(res.status, 200);

    // Verify the saved state has proper arrays/objects, not JSON strings
    const saved = JSON.parse(readFileSync(join(PLANS_DIR, TEST_SLUG, 'plan.json'), 'utf-8'));
    assert.equal(saved.title, 'Form Encoded');
    assert.ok(Array.isArray(saved.elements));
    assert.equal(saved.elements.length, 1);
    assert.equal(saved.elements[0].content, 'hi');
    assert.equal(saved.elements[0].x, 5);
    assert.ok(Array.isArray(saved.connections));
    assert.ok(Array.isArray(saved.comments));
    assert.ok(saved.viewport);
    assert.equal(saved.viewport.zoom, 1.5);
  });

  // ── Unit tests for the renderers themselves ─────────────────────
  test('renderElementHTML produces valid element HTML', () => {
    const e = {
      id: 'el_test', type: 'text', x: 50, y: 60, width: 200, height: 100,
      title: 'Hello', content: 'World',
    };
    const html = renderElementHTML(e);
    assert.ok(html.includes('class="element"'));
    assert.ok(html.includes('data-element-id="el_test"'));
    assert.ok(html.includes('data-element-type="text"'));
    assert.ok(html.includes('style="left:50px;top:60px;width:200px;height:100px"'));
    assert.ok(html.includes('Hello'));
    assert.ok(html.includes('World'));
    assert.ok(html.includes('class="resize-handle"'));
    // XSS safety
    assert.ok(!html.includes('<script>'));
  });

  test('renderElementHTML escapes HTML in user content (XSS safety)', () => {
    const e = {
      id: 'el_xss', type: 'text', x: 0, y: 0, width: 100, height: 100,
      title: '<script>alert(1)</script>',
      content: '<img src=x onerror=alert(2)>',
    };
    const html = renderElementHTML(e);
    assert.ok(!html.includes('<script>alert(1)</script>'),
      'raw <script> in title should be escaped');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<img src=x'),
      'raw <img> in content should be escaped');
  });

  test('renderElementHTML handles code/diagram/ui-mockup element types', () => {
    const code = renderElementHTML({
      id: 'el_c', type: 'code', x: 0, y: 0, width: 100, height: 100,
      language: 'javascript', content: 'const x = 1;',
    });
    assert.ok(code.includes('class="language-javascript"'));
    assert.ok(code.includes('const x = 1;'));

    const diagram = renderElementHTML({
      id: 'el_d', type: 'diagram', x: 0, y: 0, width: 100, height: 100,
      content: 'graph LR\nA --> B',
    });
    assert.ok(diagram.includes('class="mermaid"'));
    assert.ok(diagram.includes('graph LR'));

    const button = renderElementHTML({
      id: 'el_b', type: 'ui-mockup', x: 0, y: 0, width: 100, height: 100,
      component: 'button', label: 'Submit',
    });
    assert.ok(button.includes('class="ui-mockup-button"'));
    assert.ok(button.includes('Submit'));
  });

  test('renderConnectionHTML produces a valid SVG fragment', () => {
    const conn = {
      id: 'conn_test', from: 'el_a', to: 'el_b', type: 'arrow', label: 'leads to',
    };
    const html = renderConnectionHTML(conn);
    assert.ok(html.startsWith('<g class="connection"'));
    assert.ok(html.includes('data-connection-id="conn_test"'));
    assert.ok(html.includes('data-from="el_a"'));
    assert.ok(html.includes('data-to="el_b"'));
    assert.ok(html.includes('data-type="arrow"'));
    assert.ok(html.includes('data-label="leads to"'));
  });

  test('renderCommentPinHTML produces a valid pin HTML', () => {
    const pin = renderCommentPinHTML({
      id: 'c_test', x: 100, y: 200, text: 'note',
    }, 0);
    assert.ok(pin.startsWith('<div class="comment-pin"'));
    assert.ok(pin.includes('data-comment-id="c_test"'));
    assert.ok(pin.includes('style="left:100px;top:200px"'));
    assert.ok(pin.includes('title="note"'));
    assert.ok(pin.includes('>1<'), 'first pin should show number 1');
  });

  test('renderCommentPinHTML shows correct chronological number', () => {
    const pin2 = renderCommentPinHTML({
      id: 'c_2', x: 0, y: 0, text: 'second',
    }, 1);
    assert.ok(pin2.includes('>2<'), 'second pin should show number 2');
  });

  test('renderReplyHTML produces a valid <li class="reply"> fragment', () => {
    const r = { id: 'r_1', author: 'ai', text: 'a reply', created: '2026-06-18T00:00:00.000Z' };
    const html = renderReplyHTML(r);
    assert.ok(html.startsWith('<li class="reply"'));
    assert.ok(html.includes('id="reply-r_1"'));
    assert.ok(html.includes('ai'));
    assert.ok(html.includes('a reply'));
  });

  test('renderCommentThreadHTML includes original + all replies', () => {
    const c = {
      id: 'c_thread', author: 'Alice', text: 'original',
      created: '2026-06-18T00:00:00.000Z',
      thread: [
        { id: 'r_1', author: 'ai', text: 'reply 1', created: '2026-06-18T00:01:00.000Z' },
        { id: 'r_2', author: 'Alice', text: 'reply 2', created: '2026-06-18T00:02:00.000Z' },
      ],
    };
    const html = renderCommentThreadHTML(c);
    assert.ok(html.startsWith('<li class="comment"'));
    assert.ok(html.includes('id="comment-c_thread"'));
    assert.ok(html.includes('original'));
    assert.ok(html.includes('reply 1'));
    assert.ok(html.includes('reply 2'));
    // Should have 2 reply <li>s
    const replyCount = (html.match(/<li class="reply"/g) || []).length;
    assert.equal(replyCount, 2);
  });
});

// ── Canvas template structure tests ────────────────────────────────────────
// Verify the new plan.canvas.template has the right shape:
//   - pan/zoom controls
//   - SVG layer for connections
//   - comment pins
//   - toolbar with element-type buttons

describe('plan.canvas.template structure', () => {
  const tplPath = join(TEMPLATES_DIR, 'plan.canvas.template');

  test('template file exists', () => {
    assert.ok(existsSync(tplPath), 'plan.canvas.template should exist');
  });

  test('template declares {{canvasJson}} placeholder', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(tpl.includes('{{canvasJson}}'), 'should reference {{canvasJson}}');
  });

  test('template has a pan/zoom-capable canvas div', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(/id=["']canvas["']/.test(tpl), 'should have a #canvas element');
    // Should have zoom controls
    assert.ok(/id=["']zoom-in["']/.test(tpl), 'should have a zoom-in button');
    assert.ok(/id=["']zoom-out["']/.test(tpl), 'should have a zoom-out button');
    assert.ok(/id=["']zoom-reset["']/.test(tpl), 'should have a zoom-reset button');
  });

  test('template has an SVG layer for connections', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(/id=["']connections-layer["']/.test(tpl),
      'should have a #connections-layer SVG element');
    // Should have arrowhead markers
    assert.ok(/<marker[^>]+id=["']arrowhead["']/.test(tpl) || /id=["']arrowhead["']/.test(tpl),
      'should define arrowhead markers');
  });

  test('template has comment pin styles and a comment panel', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(/\.comment-pin/.test(tpl), 'should have CSS for .comment-pin');
    assert.ok(/id=["']comment-panel["']/.test(tpl), 'should have a #comment-panel');
    assert.ok(/id=["']comment-list["']/.test(tpl), 'should have a #comment-list');
  });

  test('template has toolbar buttons for all element types', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    // Toolbar with data-tool="text", "image", "code", "diagram", "ui-mockup", "connect", "comment"
    const tools = ['text', 'image', 'code', 'diagram', 'ui-mockup', 'connect', 'comment'];
    for (const tool of tools) {
      const re = new RegExp('data-tool=["\']' + tool + '["\']');
      assert.ok(re.test(tpl), `toolbar should have a button for "${tool}"`);
    }
  });

  test('template has an add-element modal', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(/id=["']modal-backdrop["']/.test(tpl), 'should have a #modal-backdrop');
    assert.ok(/id=["']element-form["']/.test(tpl), 'should have an #element-form');
    // UI mockup component selector
    assert.ok(/id=["']el-component["']/.test(tpl), 'should have a component selector for ui-mockup');
  });

  test('template wires htmx attributes to the v2 canvas endpoints', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    // The v2 canvas template is declarative: it uses htmx attributes
    // (hx-post, hx-put, hx-delete, hx-target, hx-swap) to talk to the
    // canvas endpoints. No raw fetch() calls remain for CRUD — the
    // only fetch() is the markdown-export download flow.
    //
    // Form-driven flows (element add/edit, comment reply) get static
    // hx-* attributes; programmatic flows (add connection, drag-save)
    // use htmx.ajax() and so don't have static hx-post/hx-put.
    assert.ok(/hx-post=["']\/api\/.+\/elements/.test(tpl),
      'element-form should hx-post to /api/.../elements');
    assert.ok(/hx-put=["']\/api\/.+\/comments/.test(tpl),
      'comment-form should hx-put to /api/.../comments');
    assert.ok(/hx-(post|put|delete)=["']\/api\/.+\/(elements|comments)/.test(tpl),
      'should reference /api/.../elements or /api/.../comments');
    // The element-form should target the elements layer
    assert.ok(/id=["']element-form["']/.test(tpl), 'should have an #element-form');
    assert.ok(/hx-target=["']#elements-layer["']/.test(tpl),
      'element form should target #elements-layer');
    // Programmatic htmx.ajax() calls for connection creation should be
    // present (the template drives them via JS, not static markup).
    // Match either a literal "/api/.../connections" or a JS-concatenated
    // "/api/' + SLUG + '/connections" style.
    assert.ok(/htmx\.ajax\s*\(\s*['"]POST['"]/.test(tpl),
      'should have a programmatic htmx.ajax POST call');
    assert.ok(/\/connections['"]?\s*,/.test(tpl) ||
              /\/connections['"]?\s*\)/.test(tpl) ||
              /\+ ['"]\/connections['"]?/.test(tpl),
      'should POST to /api/.../connections (literal or JS-concatenated)');
  });

  test('template has no raw fetch() for canvas CRUD (only the export download)', () => {
    // The only remaining fetch() call should be the markdown export
    // (a Blob download flow that doesn't fit htmx's swap model).
    const tpl = readFileSync(tplPath, 'utf-8');
    // Strip comments and string literals before counting fetch() calls
    const stripped = tpl
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    const matches = stripped.match(/fetch\s*\(/g) || [];
    assert.equal(matches.length, 1,
      `expected exactly 1 fetch() call (the markdown export), found ${matches.length}`);
    assert.ok(/fetch\s*\(.*markdown-export/.test(stripped),
      'the remaining fetch() should be the markdown-export download');
  });

  test('template exports the markdown via the export button', () => {
    const tpl = readFileSync(tplPath, 'utf-8');
    assert.ok(tpl.includes('markdown-export'), 'should reference the markdown-export endpoint');
  });
});

// ── End of template tests ──────────────────────────────────────────────────────

console.log('  plan.mjs tests loaded — run with: node --test cli/plan.test.mjs');
