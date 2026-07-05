/**
 * tests/clipboard.test.mjs
 *
 * v5.0.0 — Tests for the clipboard route save-format logic.
 *
 * These tests verify the note file format (frontmatter, body) produced
 * by the clipboard/save endpoint. We test via a lightweight HTTP server
 * using a temp project root.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import express from 'express';

const CLIPBOARD_ROUTES = await import('../src/server/routes/clipboard.mjs');

describe('clipboard note format', () => {
  let projectRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `bizar-clip-test2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

    const router = await CLIPBOARD_ROUTES.createClipboardRouter({ projectRoot });
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api', router);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    try { server?.close?.(); } catch { /* ignore */ }
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('saves a note with correct YAML frontmatter', async () => {
    const r = await fetch(`${baseUrl}/api/clipboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/test',
        title: 'Test Page Title',
        content: '<html>test content</html>',
        selection: 'selected text',
        savedAt: '2026-07-05T12:00:00.000Z',
      }),
    });
    assert.strictEqual(r.status, 201);
    const data = await r.json();
    assert.ok(data.ok);
    assert.ok(data.notePath);
    assert.ok(data.notePath.startsWith('clips/'));
    assert.ok(data.notePath.endsWith('.md'));

    // Read the file
    const noteFile = join(projectRoot, '.obsidian', data.notePath);
    assert.ok(existsSync(noteFile));
    const content = readFileSync(noteFile, 'utf8');

    // Check frontmatter
    assert.ok(content.startsWith('---'));
    assert.ok(content.includes('title: "Test Page Title"'));
    assert.ok(content.includes('url: "https://example.com/test"'));
    assert.ok(content.includes('type: "webclip"'));
    assert.ok(content.includes('savedAt: "2026-07-05T12:00:00.000Z"'));

    // Check body contains selection and content
    assert.ok(content.includes('selected text'));
    assert.ok(content.includes('<html>test content</html>'));

    // Check tags
    assert.ok(content.includes('"webclip"'));
  });

  it('returns 400 when url and content are both missing', async () => {
    const r = await fetch(`${baseUrl}/api/clipboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(r.status, 400);
    const data = await r.json();
    assert.strictEqual(data.error, 'bad_request');
  });

  it('GET /api/clipboard/list returns clips array', async () => {
    // Save a clip first
    await fetch(`${baseUrl}/api/clipboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/list-test',
        title: 'List Test',
        content: 'list content',
      }),
    });

    const r = await fetch(`${baseUrl}/api/clipboard/list`);
    assert.strictEqual(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.clips));
    assert.strictEqual(data.clips.length, 1);
    assert.ok(data.clips[0].id);
    assert.strictEqual(data.clips[0].title, 'List Test');
  });

  it('DELETE /api/clipboard/:id removes clip from log', async () => {
    // Save
    const saveRes = await fetch(`${baseUrl}/api/clipboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/delete-test',
        title: 'Delete Test',
        content: 'delete content',
      }),
    });
    const { id } = await saveRes.json();

    // Delete
    const delRes = await fetch(`${baseUrl}/api/clipboard/${id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    // List should be empty
    const listRes = await fetch(`${baseUrl}/api/clipboard/list`);
    const { clips } = await listRes.json();
    assert.strictEqual(clips.length, 0);
  });

  it('DELETE /api/clipboard/:id returns 404 for unknown id', async () => {
    const r = await fetch(`${baseUrl}/api/clipboard/nonexistent`, { method: 'DELETE' });
    assert.strictEqual(r.status, 404);
  });
});
