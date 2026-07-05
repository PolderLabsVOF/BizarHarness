/**
 * tests/ocr.test.mjs
 *
 * v5.0.0 — Tests for the OCR helper module and routes.
 *
 * The extractText tests require tesseract.js to be installed.
 */

import { describe, it, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

// ── Test OCR helper ────────────────────────────────────────────────────────────

describe('ocr.extractText', () => {
  let ocrModule;

  before(async () => {
    try {
      ocrModule = await import('../src/server/ocr.mjs');
    } catch {
      // tesseract.js or its deps not available
    }
  });

  it('extractText returns a string for a valid PNG buffer', { skip: !ocrModule }, async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const text = await ocrModule.extractText(pngBuffer);
    assert.strictEqual(typeof text, 'string');
  });

  it('checkOcrHealth returns ok or error message', { skip: !ocrModule }, async () => {
    const health = await ocrModule.checkOcrHealth();
    assert.ok(typeof health.ok === 'boolean');
    assert.ok(typeof health.message === 'string');
  });
});

// ── Test OCR routes ────────────────────────────────────────────────────────────

describe('ocr routes', () => {
  let projectRoot;
  let server;
  let baseUrl;
  let ocrRouterModule;

  before(async () => {
    ocrRouterModule = await import('../src/server/routes/ocr.mjs');
  });

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `bizar-ocr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

    const express = (await import('express')).default;
    const router = await ocrRouterModule.createOcrRouter({ projectRoot });
    const app = express();
    app.use(express.json({ limit: '25mb' }));
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

  it('GET /api/ocr/list returns entries array', async () => {
    const r = await fetch(`${baseUrl}/api/ocr/list`);
    assert.strictEqual(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.entries));
  });
});
