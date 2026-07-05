/**
 * tests/voice-transcribe-worker.test.mjs
 *
 * v5.2 — Tests for the background transcription worker.
 *
 * The worker is a singleton (in-memory queue + module-level broadcast
 * hook). Every test calls `reset()` at the top to drop any leftover
 * queue, then stubs `transcribe` and `broadcast` via the exported
 * setters so the test never touches the network or the WebSocket.
 *
 * Coverage:
 *   - FIFO ordering: notes are processed in the order they were enqueued,
 *     verified by tracking which audio buffer each `transcribe()` call
 *     sees.
 *   - Error isolation: a throw from `transcribe` for note N does NOT
 *     stop note N+1; the failing note's transcript stays null, the
 *     next one is persisted.
 *   - Broadcast on success: `broadcast({ type: 'voice:updated', ... })`
 *     fires exactly once per successful transcription with the right
 *     payload. Also: no broadcast on null transcript, no broadcast on
 *     already-transcribed notes, broadcast throws don't corrupt state.
 *   - Input guards: `enqueueTranscription` ignores bad ids.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const TEST_VAULT = join(
  tmpdir(),
  `bizar-voice-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

const worker = await import('../src/server/workers/transcription-worker.mjs');
const voiceStore = await import('../src/server/voice-store.mjs');

/**
 * Save a voice note with a stable, unique audio body. The body is
 * overwritten to a deterministic string so tests can identify "which
 * note is this" by audio contents alone (the worker reads the file
 * from disk and passes the buffer to `transcribe()`).
 */
async function saveNoteWithAudioFile(label) {
  const audioBuffer = Buffer.from(`audio-${label}-${'x'.repeat(64)}`);
  const saved = await voiceStore.saveVoiceNote({
    audioBuffer,
    transcript: null,
    durationSec: 1,
    vaultPath: TEST_VAULT,
  });
  writeFileSync(saved.audioPath, audioBuffer);
  return saved;
}

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(TEST_VAULT, { recursive: true });
  worker.reset();
});

afterEach(() => {
  worker.reset();
  try { rmSync(TEST_VAULT, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Input guards ────────────────────────────────────────────────────────────

describe('enqueueTranscription input guards', () => {
  it('ignores null / empty / non-string ids', () => {
    worker.enqueueTranscription(null);
    worker.enqueueTranscription('');
    worker.enqueueTranscription(undefined);
    worker.enqueueTranscription(42);
    worker.enqueueTranscription({});
    assert.strictEqual(worker.getQueueDepth(), 0);
  });
});

// ── FIFO order ──────────────────────────────────────────────────────────────

describe('FIFO order', () => {
  it('invokes transcribe in enqueue-order, one at a time', async () => {
    const a = await saveNoteWithAudioFile('a');
    const b = await saveNoteWithAudioFile('b');
    const c = await saveNoteWithAudioFile('c');

    /** @type {Buffer[]} */
    const seen = [];
    /** @type {string[]} */
    const concurrent = [];
    let inFlight = 0;

    worker.setTranscribe(async (buf) => {
      seen.push(buf);
      inFlight += 1;
      if (inFlight > 1) concurrent.push('overlap');
      // Yield to mimic real Whisper latency, then return.
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return `text-${seen.length}`;
    });

    worker.enqueueTranscription(a.id);
    worker.enqueueTranscription(b.id);
    worker.enqueueTranscription(c.id);
    await worker.drainQueue();

    assert.strictEqual(seen.length, 3, 'all three notes should have been attempted');
    assert.deepStrictEqual(concurrent, [], 'no two transcribes may run concurrently');

    assert.strictEqual(
      seen[0].toString('utf8'),
      readFileSync(a.audioPath).toString('utf8'),
      'first enqueue must be processed first',
    );
    assert.strictEqual(
      seen[1].toString('utf8'),
      readFileSync(b.audioPath).toString('utf8'),
      'second enqueue must be processed second',
    );
    assert.strictEqual(
      seen[2].toString('utf8'),
      readFileSync(c.audioPath).toString('utf8'),
      'third enqueue must be processed third',
    );
  });
});

// ── Error isolation ─────────────────────────────────────────────────────────

describe('error isolation', () => {
  it('a throwing transcription does not block the next item', async () => {
    const a = await saveNoteWithAudioFile('ea');
    const b = await saveNoteWithAudioFile('eb');
    const c = await saveNoteWithAudioFile('ec');

    const failedBody = readFileSync(a.audioPath).toString('utf8');
    let calls = 0;
    worker.setTranscribe(async (buf) => {
      calls += 1;
      if (buf.toString('utf8') === failedBody) {
        throw new Error('synthetic-whisper-failure');
      }
      return `ok-${calls}`;
    });

    worker.enqueueTranscription(a.id);
    worker.enqueueTranscription(b.id);
    worker.enqueueTranscription(c.id);
    await worker.drainQueue();

    assert.strictEqual(calls, 3, 'all three notes must be attempted');

    // The failing note retains null transcript.
    assert.strictEqual(
      voiceStore.getVoiceNote(a.id)?.transcript ?? null,
      null,
      'failing note keeps null transcript',
    );
    // The next two got transcripts.
    assert.ok(voiceStore.getVoiceNote(b.id)?.transcript, 'b should be transcribed');
    assert.ok(voiceStore.getVoiceNote(c.id)?.transcript, 'c should be transcribed');
  });

  it('null return from transcribe does not block the next item', async () => {
    const a = await saveNoteWithAudioFile('null-a');
    const b = await saveNoteWithAudioFile('null-b');

    let n = 0;
    worker.setTranscribe(async () => {
      n += 1;
      return n === 1 ? null : 'second-ok';
    });

    worker.enqueueTranscription(a.id);
    worker.enqueueTranscription(b.id);
    await worker.drainQueue();

    assert.strictEqual(voiceStore.getVoiceNote(a.id)?.transcript ?? null, null);
    assert.strictEqual(voiceStore.getVoiceNote(b.id)?.transcript, 'second-ok');
  });
});

// ── Broadcast on success ────────────────────────────────────────────────────

describe('broadcast on success', () => {
  it('sends a voice:updated event with the new transcript', async () => {
    const a = await saveNoteWithAudioFile('ba');

    const broadcasts = [];
    worker.setBroadcast((msg) => broadcasts.push(msg));

    worker.setTranscribe(async () => 'hello world');
    worker.enqueueTranscription(a.id);
    await worker.drainQueue();

    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'voice:updated');
    assert.strictEqual(broadcasts[0].noteId, a.id);
    assert.deepStrictEqual(broadcasts[0].patch, { transcript: 'hello world' });
  });

  it('does not broadcast when transcribe returns null', async () => {
    const a = await saveNoteWithAudioFile('bb');

    const broadcasts = [];
    worker.setBroadcast((msg) => broadcasts.push(msg));

    worker.setTranscribe(async () => null);
    worker.enqueueTranscription(a.id);
    await worker.drainQueue();

    assert.strictEqual(broadcasts.length, 0);
  });

  it('does not broadcast when the note is already transcribed', async () => {
    const a = await saveNoteWithAudioFile('bc');
    voiceStore.updateVoiceNote(a.id, { transcript: 'pre-existing' });

    const broadcasts = [];
    worker.setBroadcast((msg) => broadcasts.push(msg));

    let called = 0;
    worker.setTranscribe(async () => {
      called += 1;
      return 'should-not-be-called';
    });

    worker.enqueueTranscription(a.id);
    await worker.drainQueue();

    assert.strictEqual(called, 0, 'transcribe must not be called for already-done notes');
    assert.strictEqual(broadcasts.length, 0);
    assert.strictEqual(
      voiceStore.getVoiceNote(a.id)?.transcript,
      'pre-existing',
      'transcript must NOT be overwritten',
    );
  });

  it('still persists the transcript even if the broadcast throws', async () => {
    const a = await saveNoteWithAudioFile('bd');

    worker.setBroadcast(() => {
      throw new Error('spy-throws');
    });

    worker.setTranscribe(async () => 'persisted-text');
    worker.enqueueTranscription(a.id);
    await worker.drainQueue();

    assert.strictEqual(voiceStore.getVoiceNote(a.id)?.transcript, 'persisted-text');
  });
});

// ── processOne direct API ───────────────────────────────────────────────────

describe('processOne', () => {
  it('returns { skipped: "missing" } for unknown note id', async () => {
    const result = await worker.processOne('does-not-exist');
    assert.deepStrictEqual(result, { skipped: 'missing' });
  });

  it('returns { skipped: "already_transcribed" } if a transcript is set', async () => {
    const a = await saveNoteWithAudioFile('pa');
    voiceStore.updateVoiceNote(a.id, { transcript: 'done' });

    let called = 0;
    worker.setTranscribe(async () => {
      called += 1;
      return 'x';
    });

    const result = await worker.processOne(a.id);
    assert.strictEqual(result.skipped, 'already_transcribed');
    assert.strictEqual(called, 0);
  });

  it('returns { skipped: "audio_missing" } when the audio file is gone', async () => {
    const a = await saveNoteWithAudioFile('pm');
    // Wipe the audio file from disk.
    rmSync(a.audioPath);

    const result = await worker.processOne(a.id);
    assert.strictEqual(result.skipped, 'audio_missing');
  });
});

// ── drainQueue promise ─────────────────────────────────────────────────────

describe('drainQueue', () => {
  it('resolves immediately when the queue is already empty', async () => {
    const start = Date.now();
    await worker.drainQueue();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `drainQueue() should resolve immediately when idle (took ${elapsed}ms)`);
  });

  it('resolves once all enqueued work has finished', async () => {
    const a = await saveNoteWithAudioFile('da');
    const b = await saveNoteWithAudioFile('db');

    worker.setTranscribe(async () => 'ready');
    worker.enqueueTranscription(a.id);
    worker.enqueueTranscription(b.id);

    await worker.drainQueue();

    assert.strictEqual(worker.getQueueDepth(), 0);
    assert.ok(voiceStore.getVoiceNote(a.id)?.transcript);
    assert.ok(voiceStore.getVoiceNote(b.id)?.transcript);
  });
});

// ── startTranscriptionWorker wiring ─────────────────────────────────────────

describe('startTranscriptionWorker', () => {
  it('installs the broadcast hook and starts a polling interval (verified by behaviour)', async () => {
    const a = await saveNoteWithAudioFile('ws');

    /** @type {Array<{type: string, noteId: string}>} */
    const broadcasts = [];
    worker.startTranscriptionWorker({
      broadcast: (msg) => broadcasts.push(msg),
    });

    // After startTranscriptionWorker, enqueuing must route through the
    // installed broadcast hook.
    worker.setTranscribe(async () => 'broadcast-via-start');
    worker.enqueueTranscription(a.id);
    await worker.drainQueue();

    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'voice:updated');
    assert.strictEqual(broadcasts[0].noteId, a.id);

    // Stop the interval so the test process can exit cleanly.
    worker.reset();
  });
});
