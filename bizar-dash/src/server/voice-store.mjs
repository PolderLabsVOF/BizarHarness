/**
 * src/server/voice-store.mjs
 *
 * v5.0.0 — Voice note persistence layer.
 *
 * Audio files are stored at:
 *   ~/.local/share/bizar/voice-notes/<id>.webm
 *
 * Markdown transcripts are written to the user's vault at:
 *   <vaultPath>/.obsidian/voice-notes/<id>.md
 * or (if no vaultPath is set) to the default vault:
 *   ~/.local/share/bizar/voice-notes/transcripts/<id>.md
 *
 * Metadata index is at:
 *   ~/.local/share/bizar/voice-notes/index.json
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { info, warn, child } from './logger.mjs';

const log = child({ module: 'voice-store' });

const HOME = homedir();
const VOICE_DIR = join(HOME, '.local', 'share', 'bizar', 'voice-notes');
const INDEX_FILE = join(VOICE_DIR, 'index.json');
const TRANSCRIPT_DIR = join(VOICE_DIR, 'transcripts');

// ── Paths ───────────────────────────────────────────────────────────────────

function audioPath(id) {
  return join(VOICE_DIR, `${id}.webm`);
}

function transcriptPath(id, vaultPath) {
  if (vaultPath) {
    const dir = join(vaultPath, '.obsidian', 'voice-notes');
    return join(dir, `${id}.md`);
  }
  return join(TRANSCRIPT_DIR, `${id}.md`);
}

// ── Atomic helpers ──────────────────────────────────────────────────────────

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

// ── Index ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} VoiceNote
 * @property {string} id
 * @property {string} audioPath
 * @property {string|null} notePath  - markdown transcript path (may not exist yet)
 * @property {string|null} transcript
 * @property {number|null} durationSec
 * @property {string|null} vaultPath
 * @property {number} createdAtMs
 * @property {number} updatedAtMs
 */

/** @returns {VoiceNote[]} */
function loadIndex() {
  try {
    if (!existsSync(INDEX_FILE)) return [];
    const text = readFileSync(INDEX_FILE, 'utf8');
    if (!text.trim()) return [];
    return JSON.parse(text);
  } catch {
    return [];
  }
}

function saveIndex(notes) {
  mkdirSync(dirname(INDEX_FILE), { recursive: true });
  atomicWriteJson(INDEX_FILE, notes);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a voice note: write audio file + markdown transcript + update index.
 *
 * @param {{ audioBuffer: Buffer|Uint8Array, transcript: string|null, durationSec: number|null, vaultPath: string|null }} opts
 * @returns {Promise<{ notePath: string, audioPath: string, id: string }>}
 */
export async function saveVoiceNote({ audioBuffer, transcript, durationSec, vaultPath }) {
  const id = randomBytes(8).toString('hex');
  const ap = audioPath(id);

  // 1. Write audio (binary, no atomic needed for raw bytes — just ensure dir)
  mkdirSync(dirname(ap), { recursive: true });
  writeFileSync(ap, Buffer.from(audioBuffer));

  // 2. Write markdown transcript if we have one
  let notePath = null;
  if (transcript) {
    const tp = transcriptPath(id, vaultPath);
    const tpDir = dirname(tp);
    mkdirSync(tpDir, { recursive: true });
    const md = [
      '---',
      `title: Voice Note ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      `date: ${new Date().toISOString()}`,
      `type: voice-note`,
      `audio: ${id}.webm`,
      `duration: ${durationSec ?? '?'}`,
      '---',
      '',
      `# ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      '',
      transcript,
    ].join('\n');
    writeFileSync(tp, md, 'utf8');
    notePath = tp;
  }

  // 3. Update index
  const notes = loadIndex();
  /** @type {VoiceNote} */
  const entry = {
    id,
    audioPath: ap,
    notePath,
    transcript: transcript || null,
    durationSec: durationSec || null,
    vaultPath: vaultPath || null,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  notes.unshift(entry); // newest first
  saveIndex(notes);

  log.info('voice note saved', { id, notePath, audioPath: ap });
  return { notePath, audioPath: ap, id };
}

/**
 * @param {{ vaultPath?: string|null, limit?: number }} opts
 * @returns {VoiceNote[]}
 */
export function listVoiceNotes({ vaultPath = null, limit = 50 } = {}) {
  const notes = loadIndex();
  const filtered = vaultPath
    ? notes.filter((n) => n.vaultPath === vaultPath)
    : notes;
  return filtered.slice(0, limit);
}

/**
 * @param {string} id
 * @returns {VoiceNote|undefined}
 */
export function getVoiceNote(id) {
  return loadIndex().find((n) => n.id === id);
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function deleteVoiceNote(id) {
  const notes = loadIndex();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return false;

  const { audioPath: ap, notePath: tp } = notes[idx];

  // Remove audio file
  try {
    if (existsSync(ap)) unlinkSync(ap);
  } catch (err) {
    warn('failed to remove audio file', { id, ap, err: err.message });
  }

  // Remove transcript file
  if (tp) {
    try {
      if (existsSync(tp)) unlinkSync(tp);
    } catch (err) {
      warn('failed to remove transcript file', { id, tp, err: err.message });
    }
  }

  notes.splice(idx, 1);
  saveIndex(notes);
  log.info('voice note deleted', { id });
  return true;
}
