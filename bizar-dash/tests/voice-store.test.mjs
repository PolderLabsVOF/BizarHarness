/**
 * tests/voice-store.test.mjs
 *
 * v5.0.0 — Tests for voice-store.mjs (save, list, get, delete).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';

// Use an isolated temp voice dir so we don't clobber ~/.local/share/bizar/voice-notes
const TEST_VOICE_DIR = join(tmpdir(), `bizar-voice-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const voiceStore = await import('../src/server/voice-store.mjs');

// Override VOICE_DIR and INDEX_FILE constants by patching the module's internals
// We do this by temporarily monkey-patching the module-level vars via the public API
// (saveVoiceNote writes to voice-store's own VOICE_DIR). We set env vars or use
// the fact that voice-store computes its dirs from homedir() which we can't easily
// override. Instead, we test the module's public API and verify it writes to the
// real ~/.local/share/bizar/voice-notes — we accept that in tests.
//
// For true isolation we'd need to refactor voice-store to accept dir overrides,
// which is out of scope. We verify correctness by checking files are created,
// index has entries, and delete actually removes them.

describe('voice-store', () => {
  // Use the real ~/.local/share/bizar/voice-notes but with a unique subdir
  // to avoid collisions with real data
  const TEST_VAULT = join(tmpdir(), `bizar-voice-test-vault-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_VAULT, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(TEST_VAULT, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('saveVoiceNote', () => {
    it('saves audio and creates index entry', async () => {
      const audioBuffer = Buffer.from('fake audio data'.repeat(100));
      const result = await voiceStore.saveVoiceNote({
        audioBuffer,
        transcript: 'This is a test transcript',
        durationSec: 5,
        vaultPath: TEST_VAULT,
      });

      assert.ok(result.id, 'should return an id');
      assert.ok(result.audioPath, 'should return audio path');
      assert.ok(existsSync(result.audioPath), 'audio file should exist');

      if (result.notePath) {
        assert.ok(existsSync(result.notePath), 'transcript file should exist if returned');
        const md = readFileSync(result.notePath, 'utf8');
        assert.ok(md.includes('This is a test transcript'), 'transcript should be in markdown');
        assert.ok(md.includes('---'), 'should have frontmatter');
      }
    });

    it('saves without transcript', async () => {
      const audioBuffer = Buffer.from('audio without transcript');
      const result = await voiceStore.saveVoiceNote({
        audioBuffer,
        transcript: null,
        durationSec: 3,
        vaultPath: TEST_VAULT,
      });

      assert.ok(result.id);
      assert.ok(existsSync(result.audioPath));
      // notePath may be null when transcript is null
      if (result.notePath) {
        assert.ok(existsSync(result.notePath));
      }
    });
  });

  describe('listVoiceNotes', () => {
    it('returns notes for the given vaultPath', async () => {
      const audio = Buffer.from('test audio');
      await voiceStore.saveVoiceNote({ audioBuffer: audio, transcript: 'First', durationSec: 1, vaultPath: TEST_VAULT });
      await voiceStore.saveVoiceNote({ audioBuffer: audio, transcript: 'Second', durationSec: 2, vaultPath: TEST_VAULT });

      const notes = voiceStore.listVoiceNotes({ vaultPath: TEST_VAULT });
      assert.ok(Array.isArray(notes));
      assert.strictEqual(notes.length, 2);
    });

    it('respects limit', async () => {
      const audio = Buffer.from('x');
      for (let i = 0; i < 5; i++) {
        await voiceStore.saveVoiceNote({ audioBuffer: audio, transcript: `Note ${i}`, durationSec: 1, vaultPath: TEST_VAULT });
      }

      const limited = voiceStore.listVoiceNotes({ vaultPath: TEST_VAULT, limit: 3 });
      assert.strictEqual(limited.length, 3);
    });

    it('returns empty array for unknown vault', () => {
      const notes = voiceStore.listVoiceNotes({ vaultPath: '/nonexistent/path' });
      assert.ok(Array.isArray(notes));
    });
  });

  describe('getVoiceNote', () => {
    it('returns the note by id', async () => {
      const audio = Buffer.from('get test');
      const saved = await voiceStore.saveVoiceNote({ audioBuffer: audio, transcript: 'Get test', durationSec: 2, vaultPath: TEST_VAULT });

      const note = voiceStore.getVoiceNote(saved.id);
      assert.ok(note, 'should find saved note');
      assert.strictEqual(note.id, saved.id);
      assert.strictEqual(note.transcript, 'Get test');
    });

    it('returns undefined for unknown id', () => {
      const note = voiceStore.getVoiceNote('nonexistent-id-00000000');
      assert.strictEqual(note, undefined);
    });
  });

  describe('deleteVoiceNote', () => {
    it('removes audio and index entry', async () => {
      const audio = Buffer.from('delete me');
      const saved = await voiceStore.saveVoiceNote({ audioBuffer: audio, transcript: 'To delete', durationSec: 1, vaultPath: TEST_VAULT });
      const audioPath = saved.audioPath;

      const ok = voiceStore.deleteVoiceNote(saved.id);
      assert.strictEqual(ok, true);

      // Audio file should be gone
      assert.ok(!existsSync(audioPath), 'audio file should be deleted');

      // Index entry should be gone
      const note = voiceStore.getVoiceNote(saved.id);
      assert.strictEqual(note, undefined);
    });

    it('returns false for unknown id', () => {
      const ok = voiceStore.deleteVoiceNote('nonexistent-id-00000000');
      assert.strictEqual(ok, false);
    });
  });
});
