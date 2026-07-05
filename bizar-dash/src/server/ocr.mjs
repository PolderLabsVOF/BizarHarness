/**
 * src/server/ocr.mjs
 *
 * v5.0.0 — Tesseract.js wrapper for OCR text extraction.
 *
 * Provides a single `extractText(imageBuffer, options?)` function.
 * The worker is created lazily and terminated after each call to avoid
 * memory leaks in long-running server processes.
 */

import { createWorker } from 'tesseract.js';

let worker = null;

/**
 * Extract text from an image buffer using Tesseract.js OCR.
 *
 * @param {Buffer} imageBuffer - Raw image data (PNG, JPEG, etc.)
 * @param {{ lang?: string }} [options] - Recognition options.
 *   `lang` defaults to 'eng' (English).
 * @returns {Promise<string>} - The extracted text.
 */
export async function extractText(imageBuffer, { lang = 'eng' } = {}) {
  const w = worker || (worker = await createWorker(lang));

  try {
    const { data } = await w.recognize(imageBuffer);
    return (data.text || '').trim();
  } finally {
    // Terminate and reset so a new worker picks up any config changes
    // on the next call. This prevents the worker from accumulating state
    // across requests in long-running servers.
    try { await w.terminate(); } catch { /* ignore */ }
    worker = null;
  }
}

/**
 * Check whether Tesseract.js is available and can be initialised.
 * Useful for health-check endpoints.
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function checkOcrHealth() {
  try {
    const w = await createWorker('eng');
    await w.terminate();
    return { ok: true, message: 'Tesseract.js worker initialised OK' };
  } catch (err) {
    return {
      ok: false,
      message: `Tesseract.js init failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
