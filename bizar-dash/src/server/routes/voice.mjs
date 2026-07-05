/**
 * src/server/routes/voice.mjs
 *
 * v5.0.0 — Voice notes REST API.
 * v5.2   — Upload now saves audio immediately and enqueues background
 *           transcription instead of blocking the request on Whisper.
 *
 * Endpoints:
 *   POST   /api/voice/upload            — multipart upload, enqueue transcription
 *   GET    /api/voice/list?vaultPath=   — list notes (optionally filtered)
 *   GET    /api/voice/:id              — get note details
 *   DELETE /api/voice/:id              — delete note + audio + transcript
 *   GET    /api/voice/:id/audio        — stream audio file
 */

import { Router } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { info, warn, child } from '../logger.mjs';
import { saveVoiceNote, listVoiceNotes, getVoiceNote, deleteVoiceNote } from '../voice-store.mjs';
import { enqueueTranscription } from '../workers/transcription-worker.mjs';
import { wrap } from './_shared.mjs';
import formidable from 'formidable';

const log = child({ module: 'voice-routes' });

/**
 * @param {object} _deps
 * @returns {import('express').Router}
 */
export function createVoiceRouter(_deps) {
  const router = Router();

  /**
   * Whether Whisper is configured. When false, the worker is skipped
   * entirely — uploads still succeed, just without transcripts.
   */
  function whisperAvailable() {
    return Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.BIZAR_WHISPER_ENDPOINT);
  }

  // POST /api/voice/upload — multipart: audio file + vaultPath field
  router.post('/voice/upload', wrap(async (req, res) => {
    const form = formidable({ maxFileSize: 50 * 1024 * 1024 }); // 50 MB limit
    form.parse(req, async (err, fields, files) => {
      if (err) {
        warn('voice upload: parse error', { err: err.message });
        res.status(400).json({ error: 'upload_error', message: err.message });
        return;
      }

      const vaultPath = Array.isArray(fields.vaultPath)
        ? fields.vaultPath[0]
        : fields.vaultPath || null;

      const audioFile = files.audio?.[0];
      if (!audioFile) {
        res.status(400).json({ error: 'missing_audio', message: 'No audio file in upload' });
        return;
      }

      // Read audio bytes
      let audioBuffer;
      try {
        const { readFileSync } = await import('node:fs');
        audioBuffer = readFileSync(audioFile.filepath);
      } catch (readErr) {
        warn('voice upload: failed to read audio file', { err: readErr.message });
        res.status(500).json({ error: 'read_error', message: 'Could not read audio file' });
        return;
      }

      // v5.2 — Transcription is now asynchronous. Save the audio first;
      // the worker fills in the transcript when Whisper (or a local
      // proxy) responds. Clients can poll GET /api/voice/:id or watch
      // the `voice:updated` WS event for the transcript to appear.
      const transcript = null;

      // Duration from audioFile (formidable provides size but not duration — we
      // store null and the frontmatter will show '?')
      const durationSec = null;

      // Save
      let saved;
      try {
        saved = await saveVoiceNote({ audioBuffer, transcript, durationSec, vaultPath });
      } catch (saveErr) {
        warn('voice upload: save failed', { err: saveErr.message });
        res.status(500).json({ error: 'save_error', message: saveErr.message });
        return;
      }

      // Kick the background worker ONLY when we have a place to send
      // the audio. Without credentials the worker would just return
      // null forever and waste an open file descriptor.
      let transcriptionPending = false;
      if (whisperAvailable()) {
        try {
          enqueueTranscription(saved.id);
          transcriptionPending = true;
        } catch (enqErr) {
          warn('transcription enqueue failed', { id: saved.id, err: enqErr.message });
        }
      }

      log.info('voice note saved via upload', {
        id: saved.id,
        transcriptionPending,
        transcriptLength: 0,
      });
      res.json({
        notePath: saved.notePath,
        audioPath: saved.audioPath,
        id: saved.id,
        transcription: null,
        transcriptionPending,
      });
    });
  }));

  // GET /api/voice/list?vaultPath=
  router.get('/voice/list', wrap(async (req, res) => {
    const vaultPath = req.query.vaultPath || null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const notes = listVoiceNotes({ vaultPath, limit });
    res.json({ notes });
  }));

  // GET /api/voice/:id
  router.get('/voice/:id', wrap(async (req, res) => {
    const note = getVoiceNote(req.params.id);
    if (!note) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ note });
  }));

  // DELETE /api/voice/:id
  router.delete('/voice/:id', wrap(async (req, res) => {
    const ok = deleteVoiceNote(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // GET /api/voice/:id/audio — stream audio file
  router.get('/voice/:id/audio', wrap(async (req, res) => {
    const note = getVoiceNote(req.params.id);
    if (!note) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!existsSync(note.audioPath)) {
      warn('voice audio file missing', { id: req.params.id, path: note.audioPath });
      res.status(404).json({ error: 'audio_missing' });
      return;
    }
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(note.audioPath).pipe(res);
  }));

  return router;
}
