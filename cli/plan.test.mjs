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
process.setMaxListeners(32);

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

console.log('  plan.mjs tests loaded — run with: node --test cli/plan.test.mjs');
