/**
 * src/server/voice-transcribe.mjs
 *
 * v5.0.0 — Whisper transcription for voice notes.
 *
 * Uses OpenAI Whisper API (or a compatible BIZAR_WHISPER_ENDPOINT).
 * Returns null on failure so callers can degrade gracefully.
 */

import { info, warn, child } from './logger.mjs';

const log = child({ module: 'voice-transcribe' });

/**
 * Transcribe an audio buffer via Whisper.
 *
 * @param {Buffer|Uint8Array} audioBuffer - raw audio bytes
 * @param {{ mimeType?: string }} opts
 * @returns {Promise<string|null>} transcript text or null
 */
export async function transcribe(audioBuffer, { mimeType = 'audio/webm' } = {}) {
  if (!process.env.OPENAI_API_KEY && !process.env.BIZAR_WHISPER_ENDPOINT) {
    log.debug('no whisper credentials configured, skipping transcription');
    return null;
  }

  const endpoint =
    process.env.BIZAR_WHISPER_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions';

  const body = new FormData();
  body.append(
    'file',
    new Blob([audioBuffer], { type: mimeType }),
    'audio.webm',
  );
  body.append('model', 'whisper-1');

  const headers = {};
  if (process.env.OPENAI_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
  }
  // BIZAR_WHISPER_ENDPOINT may be a local proxy that doesn't need auth
  // but may also support Authorization header — only set if key exists

  log.info('submitting audio to whisper', { endpoint, sizeBytes: audioBuffer.byteLength });

  let resp;
  try {
    resp = await fetch(endpoint, { method: 'POST', body, headers });
  } catch (err) {
    warn('whisper fetch failed', { err: err.message });
    return null;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    warn('whisper returned error', { status: resp.status, body: text });
    return null;
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    warn('whisper returned non-JSON');
    return null;
  }

  const text = typeof data.text === 'string' ? data.text.trim() : null;
  log.info('transcription complete', { textLength: text?.length ?? 0 });
  return text;
}
