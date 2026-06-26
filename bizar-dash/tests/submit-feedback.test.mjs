/**
 * tests/submit-feedback.test.mjs
 *
 * Tests for `artifactsStore.submitFeedback()` + the
 * `POST /api/artifacts/:slug/submit` route (v3.22.0).
 *
 * Run with:
 *   node --test bizar-dash/tests/submit-feedback.test.mjs
 *
 * Covers:
 *   - submitFeedback() creates feedback.md
 *   - meta.json status is updated to 'review'
 *   - meta.json lastEdited is updated
 *   - commentCount / questionCount reflect on-disk state
 *   - the API endpoint returns ok=true with counts
 *   - 404 for nonexistent slug
 *   - 400 for invalid slug
 *   - feedback.md has YAML frontmatter + Free-placed comments + Open-question answers + Full MDX source sections
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import express from 'express';
import { createServer } from 'node:http';

import { artifactsStore } from '../src/server/artifacts-store.mjs';
import { createArtifactsRouter } from '../src/server/routes/artifacts.mjs';

// ---------------------------------------------------------------------------
// Per-test isolated projectRoot + helpers
// ---------------------------------------------------------------------------

function makeProjectRoot() {
  return mkdtempSync(join(tmpdir(), 'submit-feedback-'));
}

function seedArtifact(projectRoot, slug, { comments = [], answers = [], status = 'draft' } = {}) {
  const dir = join(projectRoot, 'artifacts', slug);
  mkdirSync(dir, { recursive: true });
  const meta = {
    slug,
    title: `Test ${slug}`,
    status,
    author: 'drb0rk',
    created: '2026-01-01T00:00:00.000Z',
    lastEdited: '2026-01-01T00:00:00.000Z',
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  const canvas = {
    schemaVersion: 2,
    title: meta.title,
    elements: [],
    connections: [],
    comments,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(canvas, null, 2), 'utf8');
  writeFileSync(join(dir, 'comments.json'), JSON.stringify(comments, null, 2), 'utf8');
  writeFileSync(join(dir, 'artifact.mdx'), `---\ntitle: "${meta.title}"\nstatus: ${status}\n---\n\n# Test\n`, 'utf8');
  return dir;
}

// ---------------------------------------------------------------------------
// 1. submitFeedback() — core behavior
// ---------------------------------------------------------------------------

test('submitFeedback creates feedback.md', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-feedback-create';
    seedArtifact(root, slug, {
      comments: [{ id: 'c1', elementId: null, author: 'drb0rk', text: 'Fix the button', x: 100, y: 200, created: '2026-01-01T00:00:00Z', thread: [] }],
    });
    const result = artifactsStore.submitFeedback(slug, { answers: [] }, root);
    assert.equal(result.ok, true);
    assert.equal(result.slug, slug);
    const feedbackPath = join(root, 'artifacts', slug, 'feedback.md');
    assert.ok(existsSync(feedbackPath), 'feedback.md should be created');
    const content = readFileSync(feedbackPath, 'utf8');
    assert.ok(content.includes('glyph: ' + slug), 'frontmatter glyph line');
    assert.ok(content.includes('commentCount: 1'), 'commentCount in frontmatter');
    assert.ok(content.includes('## Free-placed comments'), 'has free-placed comments section');
    assert.ok(content.includes('Fix the button'), 'has comment text');
    assert.ok(content.includes('(100, 200)'), 'has (x, y) coordinates');
    assert.ok(content.includes('## Open-question answers'), 'has open-question answers section');
    assert.ok(content.includes('## Full MDX source'), 'has full MDX source section');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback updates meta.json status to "review"', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-status-update';
    seedArtifact(root, slug, { status: 'draft' });
    const result = artifactsStore.submitFeedback(slug, { answers: [] }, root);
    assert.equal(result.ok, true);
    const meta = JSON.parse(readFileSync(join(root, 'artifacts', slug, 'meta.json'), 'utf8'));
    assert.equal(meta.status, 'review', 'meta.status should be "review"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback updates meta.json lastEdited', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-lastedited-update';
    seedArtifact(root, slug);
    const before = Date.now();
    const result = artifactsStore.submitFeedback(slug, { answers: [] }, root);
    const after = Date.now();
    assert.equal(result.ok, true);
    const meta = JSON.parse(readFileSync(join(root, 'artifacts', slug, 'meta.json'), 'utf8'));
    const ts = Date.parse(meta.lastEdited);
    assert.ok(Number.isFinite(ts), 'lastEdited should be a parseable timestamp');
    assert.ok(ts >= before && ts <= after, `lastEdited ${meta.lastEdited} should be in [${before}, ${after}]`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback returns commentCount and questionCount', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-counts';
    seedArtifact(root, slug, {
      comments: [
        { id: 'c1', elementId: null, author: 'drb0rk', text: 'Comment 1', x: 10, y: 20, created: '2026-01-01T00:00:00Z', thread: [] },
        { id: 'c2', elementId: null, author: 'drb0rk', text: 'Comment 2', x: 30, y: 40, created: '2026-01-02T00:00:00Z', thread: [] },
        { id: 'c3', elementId: null, author: 'drb0rk', text: 'Comment 3', x: 50, y: 60, created: '2026-01-03T00:00:00Z', thread: [] },
      ],
    });
    const result = artifactsStore.submitFeedback(slug, {
      answers: [
        { questionId: 'q1', value: 'Answer 1' },
        { questionId: 'q2', value: 'Answer 2' },
      ],
    }, root);
    assert.equal(result.ok, true);
    assert.equal(result.commentCount, 3);
    assert.equal(result.questionCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback returns ok:false for nonexistent slug', () => {
  const root = makeProjectRoot();
  try {
    const result = artifactsStore.submitFeedback('does-not-exist', { answers: [] }, root);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'not_found');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback returns ok:false for invalid slug', () => {
  const root = makeProjectRoot();
  try {
    const result = artifactsStore.submitFeedback('INVALID', { answers: [] }, root);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_slug');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback writes Q/A section for question answers', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-qa-section';
    seedArtifact(root, slug);
    const result = artifactsStore.submitFeedback(slug, {
      answers: [
        { questionId: 'q-color', value: 'blue' },
        { questionId: 'q-size',  value: 'large' },
      ],
    }, root);
    assert.equal(result.ok, true);
    const content = readFileSync(result.feedbackFile, 'utf8');
    assert.ok(content.includes('## Open-question answers'));
    assert.ok(content.includes('q-color'), 'question id is in feedback file');
    assert.ok(content.includes('A: blue'), 'answer value is in feedback file');
    assert.ok(content.includes('q-size'));
    assert.ok(content.includes('A: large'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('submitFeedback falls back to comments.json when canvas has none', () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-comments-json-fallback';
    // Seed canvas with empty comments array, comments.json with one comment.
    seedArtifact(root, slug);
    const dir = join(root, 'artifacts', slug);
    // Replace plan.json with empty comments, populate comments.json.
    const canvas = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    canvas.comments = [];
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(canvas, null, 2), 'utf8');
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify([{ id: 'cx', elementId: null, author: 'drb0rk', text: 'fallback comment', x: 5, y: 6, created: '2026-01-01T00:00:00Z', thread: [] }]),
      'utf8',
    );
    const result = artifactsStore.submitFeedback(slug, { answers: [] }, root);
    assert.equal(result.ok, true);
    assert.equal(result.commentCount, 1, 'should pick up the fallback comment');
    const content = readFileSync(result.feedbackFile, 'utf8');
    assert.ok(content.includes('fallback comment'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/artifacts/:slug/submit — HTTP layer
// ---------------------------------------------------------------------------

async function startServer(projectRoot) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const router = createArtifactsRouter({
    state: {},
    broadcast: () => {},
    projectRoot,
  });
  app.use('/api', router);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('POST /api/artifacts/:slug/submit returns ok=true with counts', async () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-http-ok';
    seedArtifact(root, slug, {
      comments: [
        { id: 'c1', elementId: null, author: 'drb0rk', text: 'A', x: 1, y: 1, created: '2026-01-01T00:00:00Z', thread: [] },
        { id: 'c2', elementId: null, author: 'drb0rk', text: 'B', x: 2, y: 2, created: '2026-01-02T00:00:00Z', thread: [] },
      ],
    });
    const { baseUrl, close } = await startServer(root);
    try {
      const res = await fetch(`${baseUrl}/api/artifacts/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      });
      assert.equal(res.status, 200, 'HTTP 200');
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.slug, slug);
      assert.equal(body.commentCount, 2);
      assert.equal(body.questionCount, 0);
      assert.ok(typeof body.feedbackFile === 'string');
      assert.ok(existsSync(body.feedbackFile), 'feedbackFile path returned must exist');
    } finally {
      await close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/artifacts/:slug/submit returns 404 for nonexistent slug', async () => {
  const root = makeProjectRoot();
  try {
    const { baseUrl, close } = await startServer(root);
    try {
      const res = await fetch(`${baseUrl}/api/artifacts/does-not-exist/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'not_found');
    } finally {
      await close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/artifacts/:slug/submit returns 400 for invalid slug', async () => {
  const root = makeProjectRoot();
  try {
    const { baseUrl, close } = await startServer(root);
    try {
      const res = await fetch(`${baseUrl}/api/artifacts/INVALID/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_slug');
    } finally {
      await close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/artifacts/:slug/submit persists feedback.md on disk', async () => {
  const root = makeProjectRoot();
  try {
    const slug = 'glyph-http-disk';
    seedArtifact(root, slug);
    const { baseUrl, close } = await startServer(root);
    try {
      const res = await fetch(`${baseUrl}/api/artifacts/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      });
      assert.equal(res.status, 200);
      const feedbackPath = join(root, 'artifacts', slug, 'feedback.md');
      assert.ok(existsSync(feedbackPath), 'feedback.md should exist on disk');
      const content = readFileSync(feedbackPath, 'utf8');
      assert.ok(content.startsWith('---'), 'starts with YAML frontmatter');
      assert.ok(content.includes('## Full MDX source'), 'contains MDX source section');
    } finally {
      await close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});