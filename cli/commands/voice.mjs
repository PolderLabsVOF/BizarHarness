/**
 * cli/commands/voice.mjs
 *
 * v5.0.0 — Voice notes CLI — talks to the running dashboard's HTTP API.
 */
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

// ── Config dir helper ──────────────────────────────────────────────────────────

function getBizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(homedir(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

function getDashboardPort() {
  const portFile = join(getBizarConfigDir(), 'dashboard.port');
  try {
    const port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (Number.isFinite(port) && port > 0) return port;
  } catch {
    /* fall through */
  }
  return null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function delJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

// ── Help ───────────────────────────────────────────────────────────────────────

export function showVoiceHelp() {
  console.log(`
  bizar voice — Manage voice notes (via the dashboard's HTTP API)

  Usage:
    bizar voice list [vaultPath]       List voice notes (optionally scoped to vault)
    bizar voice delete <id>            Delete a voice note by id
    bizar voice configure --api-key <key>   Set Whisper API key
    bizar voice transcribe <audio-path>     Transcribe an audio file (CLI-side)

  Description:
    Voice notes are recorded in the browser (MediaRecorder API) and uploaded
    to the dashboard, which saves audio and transcribes via Whisper.

    Subcommands call the running dashboard's HTTP API. If no dashboard is
    reachable, you'll be told to run \`bizar dash start\` first.

  Examples:
    bizar voice list
    bizar voice list ~/vault
    bizar voice delete abc123def456
    bizar voice configure --api-key sk-...
  `);
}

// ── Config helpers ─────────────────────────────────────────────────────────────

const CONFIG_FILE = join(getBizarConfigDir(), 'voice-config.json');

function loadConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  const dir = join(getBizarConfigDir());
  if (!existsSync(dir)) {
    require('node:fs').mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Command runner ────────────────────────────────────────────────────────────

export async function runVoiceCommand(args) {
  const sub = args[0];
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const flags = args.slice(1).filter((a) => a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showVoiceHelp();
    return;
  }

  const port = getDashboardPort();
  if (!port) {
    console.error(chalk.red('  ✗ Dashboard is not running (no port file).'));
    console.error(chalk.dim('  Start it first: `bizar dash start --bg`'));
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    if (sub === 'list') {
      const vaultPath = positional[0] || '';
      const q = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : '';
      const r = await getJson(baseUrl, `/api/voice/list${q}`);
      const notes = r.notes || [];
      if (notes.length === 0) {
        console.log(chalk.dim('  (no voice notes)'));
        return;
      }
      console.log(chalk.bold(`  Voice Notes (${notes.length}):`));
      for (const n of notes) {
        const date = new Date(n.createdAtMs).toLocaleString();
        const transcript = n.transcript
          ? n.transcript.slice(0, 60) + (n.transcript.length > 60 ? '…' : '')
          : '(no transcript)';
        console.log(`  ${n.id}  ${date}`);
        console.log(`         ${chalk.dim(transcript)}`);
      }
    } else if (sub === 'delete') {
      const id = positional[0];
      if (!id) {
        console.error(chalk.red('  ✗ Missing note id. Usage: bizar voice delete <id>'));
        process.exit(1);
      }
      await delJson(baseUrl, `/api/voice/${id}`);
      console.log(chalk.green(`  ✓ Deleted note ${id}`));
    } else if (sub === 'configure') {
      const apiKeyIdx = flags.indexOf('--api-key');
      const apiKey = apiKeyIdx !== -1 ? flags[apiKeyIdx + 1] : positional[0];
      if (!apiKey) {
        console.error(chalk.red('  ✗ Missing API key. Usage: bizar voice configure --api-key <key>'));
        process.exit(1);
      }
      const cfg = loadConfig();
      cfg.openaiApiKey = apiKey;
      saveConfig(cfg);
      console.log(chalk.green('  ✓ Whisper API key saved to voice config.'));
      console.log(chalk.dim('  Set BIZAR_WHISPER_ENDPOINT env var to use a custom endpoint.'));
    } else if (sub === 'transcribe') {
      // CLI-side transcription: reads a local audio file and POSTs to the upload endpoint
      const audioPath = positional[0];
      if (!audioPath) {
        console.error(chalk.red('  ✗ Missing audio path. Usage: bizar voice transcribe <audio-path>'));
        process.exit(1);
      }
      if (!existsSync(audioPath)) {
        console.error(chalk.red(`  ✗ File not found: ${audioPath}`));
        process.exit(1);
      }
      console.log(chalk.dim(`  Transcribing ${audioPath}…`));
      const { readFileSync: rf } = await import('node:fs');
      const audioBuffer = rf(audioPath);
      const form = new FormData();
      form.append('audio', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
      form.append('vaultPath', '');
      const r = await fetch(`${baseUrl}/api/voice/upload`, { method: 'POST', body: form });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`upload failed: ${text}`);
      }
      const data = await r.json();
      console.log(chalk.green(`  ✓ Transcribed and saved (id: ${data.id})`));
      if (data.transcription) {
        console.log(chalk.dim('  Transcript:'));
        console.log(`  ${data.transcription}`);
      }
    } else {
      console.error(chalk.red(`  ✗ Unknown voice subcommand: ${sub}`));
      showVoiceHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ ${err.message}`));
    process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  await runVoiceCommand(args);
}
