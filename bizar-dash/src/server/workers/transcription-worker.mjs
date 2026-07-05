/**
 * src/server/workers/transcription-worker.mjs
 *
 * v5.2 — Background transcription worker for voice notes.
 *
 * When a user uploads a voice note, the audio is saved immediately and a
 * reference (noteId) is enqueued here. The worker drains the queue in
 * FIFO order: it reads the audio from disk, calls `transcribe()` (the
 * Whisper adapter), persists the result via `updateVoiceNote()`, and
 * pushes a `voice:updated` event on the dashboard WebSocket so the UI
 * can replace the "transcribing…" placeholder as soon as the text is
 * ready.
 *
 * Design choices:
 *   - In-memory queue (per-process). No cross-instance persistence; if
 *     the server dies with work in the queue, those notes remain
 *     un-transcribed (the audio file is still on disk and can be
 *     re-triggered manually if needed).
 *   - Single-threaded drain (`processing` flag). Multiple callers
 *     enqueueing during a drain are captured by the while-loop's
 *     `queue.length > 0` check on each iteration.
 *   - Errors inside `processOne()` are caught and logged by
 *     `processQueue()`; a failure on note X does NOT stop note X+1.
 *   - `broadcast()` is injected at startup so the worker doesn't take
 *     a hard dependency on server.mjs. In tests, a no-op stub is fine.
 *   - `setInterval(..., 5000)` is a safety net: any work left in the
 *     queue (e.g. from a processQueue race during teardown) gets a
 *     retry tick. `.unref()` keeps the interval from blocking process
 *     exit — the worker never closes the server by itself.
 *
 * Test injection: the four setters / helpers exposed on the bottom of
 * this file (`setTranscribe`, `setBroadcast`, `drainQueue`, `reset`)
 * exist so tests can stub the Whisper adapter and observe the queue
 * without booting a server or hitting the network. They have no effect
 * in production unless called.
 */

import { readFileSync, existsSync } from 'node:fs';
import { getVoiceNote, updateVoiceNote } from '../voice-store.mjs';
import { transcribe as defaultTranscribe } from '../voice-transcribe.mjs';
import { child } from '../logger.mjs';

const log = child({ module: 'transcription-worker' });

const POLL_INTERVAL_MS = 5000;

// ── Mutable worker state ────────────────────────────────────────────────────

/** @type {{ noteId: string, enqueuedAt: number }[]} */
const queue = [];
let processing = false;

/** Override hooks — defaults call through to the real Whisper adapter / no-op broadcast. */
let _transcribe = defaultTranscribe;
let _broadcast = () => {};

const idleWaiters = [];

// ── Core processing ─────────────────────────────────────────────────────────

/**
 * Process one note end-to-end. Returns a status object so tests (and
 * the drain loop) can distinguish "skipped for a reason" from "ok".
 *
 * @param {string} noteId
 * @returns {Promise<{ ok?: true, transcript?: string, skipped?: string }>}
 */
export async function processOne(noteId) {
  const note = getVoiceNote(noteId);
  if (!note) {
    log.debug('note missing, skipping', { noteId });
    return { skipped: 'missing' };
  }
  if (note.transcript) {
    log.debug('already transcribed', { noteId });
    return { skipped: 'already_transcribed' };
  }
  if (!existsSync(note.audioPath)) {
    log.error('audio file missing on disk', { noteId, audioPath: note.audioPath });
    return { skipped: 'audio_missing' };
  }

  let transcript;
  try {
    const audioBuffer = readFileSync(note.audioPath);
    transcript = await _transcribe(audioBuffer, { mimeType: 'audio/webm' });
  } catch (err) {
    log.error('transcription threw', { noteId, err: err.message });
    return { skipped: 'error', err: err.message };
  }

  if (!transcript) {
    log.warn('transcription returned null', { noteId });
    return { skipped: 'no_transcript' };
  }

  const updated = updateVoiceNote(noteId, { transcript });
  if (!updated) {
    log.error('updateVoiceNote returned null after successful transcription', { noteId });
    return { skipped: 'update_failed' };
  }

  try {
    _broadcast({ type: 'voice:updated', noteId, patch: { transcript } });
  } catch (err) {
    // Broadcast failure must not corrupt the on-disk state.
    log.warn('broadcast threw', { noteId, err: err.message });
  }

  log.info('transcription complete', { noteId, length: transcript.length });
  return { ok: true, transcript };
}

/**
 * Drain the queue. Guarded by the `processing` flag so concurrent
 * callers don't double-drain. Errors inside `processOne` are logged
 * and swallowed, NOT re-thrown — the next item must always get a
 * chance.
 */
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const { noteId } = queue.shift();
      try {
        await processOne(noteId);
      } catch (err) {
        log.error('transcription failed', { noteId, err: err.message });
      }
    }
  } finally {
    processing = false;
    if (queue.length === 0) {
      const toResolve = idleWaiters.splice(0);
      for (const r of toResolve) r();
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enqueue a note for background transcription.
 *
 * @param {string} noteId
 */
export function enqueueTranscription(noteId) {
  if (!noteId || typeof noteId !== 'string') return;
  queue.push({ noteId, enqueuedAt: Date.now() });
  // Drain is fire-and-forget — callers don't await per-note work.
  void processQueue();
}

/**
 * Start the worker. Idempotent — calling twice clears the previous
 * interval and starts a fresh one.
 *
 * @param {{ broadcast?: (msg: unknown) => void }} [opts]
 */
export function startTranscriptionWorker({ broadcast } = {}) {
  if (typeof broadcast === 'function') _broadcast = broadcast;
  // Replace any prior interval so tests + double-boot are safe.
  if (startTranscriptionWorker._interval) {
    clearInterval(startTranscriptionWorker._interval);
  }
  log.info('transcription worker started', { pollIntervalMs: POLL_INTERVAL_MS });
  const handle = setInterval(() => void processQueue(), POLL_INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  startTranscriptionWorker._interval = handle;
}

// ── Test hooks (no-op in production) ────────────────────────────────────────

/** @param {(buf: Buffer|Uint8Array, opts?: object) => Promise<string|null>} fn */
export function setTranscribe(fn) {
  _transcribe = typeof fn === 'function' ? fn : defaultTranscribe;
}

/** @param {(msg: unknown) => void} fn */
export function setBroadcast(fn) {
  _broadcast = typeof fn === 'function' ? fn : () => {};
}

/** Number of items waiting or currently being processed. */
export function getQueueDepth() {
  return queue.length + (processing ? 1 : 0);
}

/**
 * Resolve once the queue is fully drained (no items + not processing).
 * Returns a resolved promise immediately if already idle.
 */
export function drainQueue() {
  if (queue.length === 0 && !processing) return Promise.resolve();
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
    void processQueue();
  });
}

/** Reset all mutable state. ONLY for tests. */
export function reset() {
  queue.length = 0;
  processing = false;
  _transcribe = defaultTranscribe;
  _broadcast = () => {};
  idleWaiters.length = 0;
  if (startTranscriptionWorker._interval) {
    clearInterval(startTranscriptionWorker._interval);
    startTranscriptionWorker._interval = null;
  }
}
