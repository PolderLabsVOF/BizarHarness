/**
 * src/server/routes/ocr.mjs
 *
 * v5.0.0 — Screenshot OCR endpoints.
 *
 * Accepts image uploads, extracts text via Tesseract.js, and saves
 * the result as a markdown note in the vault.
 */

import { Router } from 'express';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';

let _wrap = null;
let _extractText = null;
async function getShared() {
  if (!_wrap) {
    const mod = await import('./_shared.mjs');
    _wrap = mod.wrap;
  }
  return { wrap: _wrap };
}

async function getOcr() {
  if (!_extractText) {
    const mod = await import('../ocr.mjs');
    _extractText = mod.extractText;
  }
  return { extractText: _extractText };
}

function getLogPath(projectRoot) {
  return join(projectRoot, '.bizar', 'ocr-log.json');
}

function loadLog(projectRoot) {
  try {
    const p = getLogPath(projectRoot);
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function saveLog(projectRoot, log) {
  const p = getLogPath(projectRoot);
  mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
  writeFileSync(p, JSON.stringify(log, null, 2) + '\n', 'utf8');
}

function appendLog(projectRoot, entry) {
  const log = loadLog(projectRoot);
  log.unshift(entry);
  if (log.length > 100) log.length = 100;
  saveLog(projectRoot, log);
}

export async function createOcrRouter({ projectRoot }) {
  const router = Router();
  const { wrap } = await getShared();

  /**
   * POST /api/ocr/process
   *
   * Accepts a multipart image upload, runs OCR, saves the result
   * as a markdown note under ocr/<slug>.md.
   *
   * Expects: multipart/form-data with field "image"
   * Returns: { ok, text, notePath }
   */
  router.post('/ocr/process', wrap(async (req, res) => {
    let extractText;
    try {
      ({ extractText } = await getOcr());
    } catch (err) {
      res.status(503).json({
        error: 'ocr_unavailable',
        message: 'OCR engine is not available. Install tesseract.js: npm install tesseract.js',
      });
      return;
    }

    // Read image from body (binary or base64) or multipart
    let imageBuffer = null;

    if (Buffer.isBuffer(req.body)) {
      imageBuffer = req.body;
    } else if (req.body && req.body.image) {
      // Base64-encoded image
      const raw = req.body.image;
      const matches = raw.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (matches) {
        imageBuffer = Buffer.from(matches[2], 'base64');
      } else {
        // Assume raw base64 without prefix
        imageBuffer = Buffer.from(raw, 'base64');
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      res.status(400).json({
        error: 'bad_request',
        message: 'No image data provided. Send multipart/form-data with "image" field, or JSON with base64 "image" field.',
      });
      return;
    }

    // Validate size (max 20MB)
    if (imageBuffer.length > 20 * 1024 * 1024) {
      res.status(413).json({ error: 'too_large', message: 'Image exceeds 20MB limit' });
      return;
    }

    // Run OCR
    let text;
    try {
      text = await extractText(imageBuffer);
    } catch (err) {
      res.status(500).json({
        error: 'ocr_error',
        message: `OCR processing failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    // Build note
    const lang = req.body?.lang || 'eng';
    const timestamp = Date.now();
    const slug = `screenshot_ocr_${timestamp}`;
    const relPath = `ocr/${slug}.md`;
    const savedAt = new Date().toISOString();

    const fm = {
      title: `OCR Screenshot — ${savedAt}`,
      savedAt,
      type: 'ocr',
      lang,
      tags: ['ocr', 'screenshot'],
    };

    const noteBody = [
      '## Extracted Text',
      '',
      '```text',
      text || '(no text found)',
      '```',
      '',
    ].join('\n');

    const vaultDir = join(projectRoot, '.obsidian');
    mkdirSync(join(vaultDir, 'ocr'), { recursive: true });
    const notePath = join(vaultDir, relPath);

    const noteContent = [
      '---',
      ...Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
      '---',
      '',
      noteBody,
    ].join('\n');

    writeFileSync(notePath, noteContent, 'utf8');

    // Log
    appendLog(projectRoot, { id: slug, notePath: relPath, savedAt, textLength: text.length });

    res.status(201).json({ ok: true, text, notePath: relPath, id: slug });
  }));

  /**
   * GET /api/ocr/list
   *
   * Returns recent OCR entries from the log.
   */
  router.get('/ocr/list', wrap(async (_req, res) => {
    const entries = loadLog(projectRoot);
    res.json({ entries });
  }));

  return router;
}
