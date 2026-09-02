import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

/* eslint-disable no-console */

// F-202 — Coding-tool selection. Each entry exposes a stable `id` (used as
// the literal passed to the provisioner), a human label, and a short
// description printed next to the multi-select checkbox. Order in the array
// IS the on-screen order; arrow keys move through it linearly.
export const CODING_TOOLS = Object.freeze([
  { id: 'claude', label: 'Claude Code',       description: 'Anthropic — Claude Code CLI + bundled Bizar agents/skills/hooks' },
  { id: 'codex',  label: 'OpenAI Codex CLI',  description: 'OpenAI — Codex CLI + Bizar assets mirrored into ~/.codex/ and ~/.agents/skills/' },
]);

function validToolId(id) {
  return typeof id === 'string' && CODING_TOOLS.some((t) => t.id === id);
}

function defaultSelection() {
  // Backward compat: Claude Code only. Existing installs, CI scripts, and
  // non-TTY fallbacks MUST keep installing Claude by default so the
  // documented contract holds (`bizar install` ships Claude, nothing else).
  return ['claude'];
}

function normalizeSelected(input, fallback = defaultSelection()) {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set();
  const out = [];
  for (const value of input) {
    if (!validToolId(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length === 0 ? fallback : out;
}

/**
 * Stateless input parser for runToolSelection. Each call maps a single
 * keypress to one of: confirm | toggle | move | null. Exported so tests can
 * drive the prompt without a TTY.
 */
export function parseToolSelectionKey(key) {
  switch (key) {
    case '\r':
    case '\n':
      return { type: 'confirm' };
    case ' ':
      return { type: 'toggle' };
    case 'j':
    case '[B': // arrow down
      return { type: 'move', delta: +1 };
    case 'k':
    case '[A': // arrow up
      return { type: 'move', delta: -1 };
    default:
      return null;
  }
}

function renderSelection(output, state, orderedTools) {
  const rows = orderedTools.map((tool, idx) => {
    const isCursor = idx === state.cursor;
    const isSelected = state.selected.has(tool.id);
    const checkbox = isSelected ? '[x]' : '[ ]';
    const cursorMark = isCursor ? '>' : ' ';
    return `  ${cursorMark} ${checkbox} ${tool.label} — ${tool.description}`;
  });
  rows.push('  ↑/↓ move   space toggle   enter confirm');
  for (const row of rows) writeLine(output, row);
}

function eraseSelection(output, rowCount) {
  if (!rowCount) return;
  // Move cursor to start of each line, clear it, then move up. Works on
  // any output sink that supports the same ANSI escape sequences as a TTY.
  const esc = (s) => s;
  for (let i = 0; i < rowCount; i++) {
    if (output && typeof output.write === 'function') output.write(esc('[2K[1A'));
    else process.stdout.write(esc('[2K[1A'));
  }
}

/**
 * Prompt the operator for which coding tools Bizar should install/configure.
 *
 *   return { ok: true, tools: ['claude'] }   // interactive TTY
 *   return { ok: true, tools: ['claude'] }   // non-TTY / disabled (default)
 *   return { ok: false, cancelled: true }   // EOF / Ctrl+C
 *
 * The prompt is a multi-select checkbox list backed by raw mode on the input
 * stream. When `input` is not a TTY (pipes, CI) or `enabled` is false, the
 * function returns the documented default ('claude') without reading any
 * input — preserving the existing non-interactive contract.
 *
 * `enabled === true` makes the prompt mandatory even in tests that pass a
 * stub `input.isTTY = true`. `enabled === false` returns the default.
 */
export async function runToolSelection({
  enabled = true,
  input = process.stdin,
  output = process.stdout,
  orderedTools = CODING_TOOLS,
  isTTY = input && typeof input.isTTY === 'boolean' ? input.isTTY : false,
} = {}) {
  if (!enabled || !isTTY) {
    return { ok: true, tools: defaultSelection(), interactive: false };
  }

  const orderedIds = orderedTools.map((t) => t.id);
  const cursor = { i: 0 };
  const selected = new Set(['claude', 'codex']);

  const initialRows = orderedTools.length + 1;
  writeLine(output, 'Which coding tools should Bizar install for?');
  renderSelection(output, { cursor: cursor.i, selected }, orderedTools);

  let setRaw;
  try {
    setRaw = typeof input.setRawMode === 'function' ? input.setRawMode.bind(input) : null;
    if (setRaw) setRaw(true);
  } catch { /* swallow — non-fatal on platforms without raw mode */ }

  return new Promise((resolve) => {
    let resolved = false;
    const settle = (result) => {
      if (resolved) return;
      resolved = true;
      try { input.removeListener('data', onData); input.removeListener('end', onEnd); } catch { /* ignore */ }
      if (setRaw) { try { setRaw(false); } catch { /* swallow */ } }
      resolve(result);
    };
    const onEnd = () => settle({ ok: true, tools: defaultSelection(), cancelled: true, interactive: true });
    const onData = (raw) => {
      const text = String(raw);
      // ANSI arrow-key sequences arrive as a 3-char run ( + [ + A/B/C/D).
      // Buffer them into a single logical key; everything else goes char-by-char.
      let pending = '';
      const moveCursorBy = (delta) => {
        eraseSelection(output, initialRows);
        cursor.i = (cursor.i + delta + orderedIds.length) % orderedIds.length;
        renderSelection(output, { cursor: cursor.i, selected }, orderedTools);
      };
      const flushSeq = (sequence) => {
        if (sequence === '[A' || sequence === '[D') moveCursorBy(-1);
        else if (sequence === '[B' || sequence === '[C') moveCursorBy(+1);
        else pending = ''; // unknown CSI — drop
      };
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (pending !== '') {
          if (pending === '' && ch === '[') { pending = '['; continue; }
          if (pending === '[') {
            pending += ch;
            if (pending.length === 3) { flushSeq(pending); pending = ''; }
            continue;
          }
          pending = '';
          continue;
        }
        if (ch === '') { pending = ''; continue; }
        const action = parseToolSelectionKey(ch);
        if (!action) continue;
        if (action.type === 'move') {
          moveCursorBy(action.delta);
        } else if (action.type === 'toggle') {
          eraseSelection(output, initialRows);
          const currentId = orderedIds[cursor.i];
          if (selected.has(currentId)) selected.delete(currentId);
          else selected.add(currentId);
          renderSelection(output, { cursor: cursor.i, selected }, orderedTools);
        } else if (action.type === 'confirm') {
          eraseSelection(output, initialRows);
          const picked = orderedIds.filter((id) => selected.has(id));
          const final = picked.length === 0 ? defaultSelection() : picked;
          settle({ ok: true, tools: final, interactive: true });
          return;
        }
      }
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', (err) => settle({ ok: false, error: `tool selection interrupted: ${err?.message || err}` }));
  });
}

export function providerSettingsPath(env = process.env) {
  const root = env.CLAUDE_CONFIG_DIR?.trim()
    || join(env.HOME?.trim() || homedir(), '.claude');
  return join(root, 'settings.json');
}

export function readProviderSettings(path = providerSettingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function detectProviderConfiguration({ env = process.env, settings = {} } = {}) {
  const settingsEnv = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const url = env.BIZAR_MODEL_ROUTER_URL?.trim()
    || env.ANTHROPIC_BASE_URL?.trim()
    || settingsEnv.BIZAR_MODEL_ROUTER_URL?.trim()
    || settingsEnv.ANTHROPIC_BASE_URL?.trim()
    || '';
  const key = env.ANTHROPIC_AUTH_TOKEN?.trim()
    || env.ANTHROPIC_API_KEY?.trim()
    || settingsEnv.ANTHROPIC_AUTH_TOKEN?.trim()
    || settingsEnv.ANTHROPIC_API_KEY?.trim()
    || '';
  return { url, key, missing: [...(!url ? ['url'] : []), ...(!key ? ['key'] : [])] };
}

export function isValidProviderUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function askLine(prompt, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

/** Read a secret through readline without forwarding its terminal redraws. */
export async function askSecret(prompt, { input = process.stdin, output = process.stdout } = {}) {
  const muted = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  const rl = createInterface({ input, output: muted, terminal: true });
  output.write(prompt);
  try {
    return await rl.question('');
  } finally {
    rl.close();
    output.write('\n');
  }
}

function writeLine(output, value = '') {
  output.write(`${value}\n`);
}

/**
 * Guided install preflight. Credentials are placed only in the current
 * process; the provisioner's settings writer persists them globally with the
 * rest of the install. Injected question functions keep the policy testable.
 */
export async function runInteractiveSetup({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  enabled = true,
  readSettings = readProviderSettings,
  askText = askLine,
  askHidden = askSecret,
} = {}) {
  let settings;
  try {
    settings = readSettings(providerSettingsPath(env));
  } catch (error) {
    return { ok: false, error: `Cannot read global Claude settings: ${error.message}` };
  }

  const detected = detectProviderConfiguration({ env, settings });
  const interactive = enabled && input.isTTY === true && output.isTTY === true;
  if (!interactive) {
    if (detected.missing.length > 0) {
      writeLine(output, `  ! Provider ${detected.missing.join(' and ')} not detected; set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN or run \`bizar setup-provider\`.`);
    }
    return { ok: true, interactive: false, configured: detected.missing.length === 0, missing: detected.missing };
  }

  writeLine(output, '');
  writeLine(output, '  Interactive setup');
  const confirmation = (await askText('  Continue with the installation? [Y/n] ', { input, output })).trim().toLowerCase();
  if (confirmation === 'n' || confirmation === 'no') {
    writeLine(output, '  Installation cancelled.');
    return { ok: true, interactive: true, cancelled: true, configured: detected.missing.length === 0 };
  }

  let url = detected.url;
  let key = detected.key;
  if (url) writeLine(output, `  ✓ Provider URL detected: ${url}`);
  while (!url) {
    const answer = (await askText('  Provider URL (for example https://gateway.example/v1): ', { input, output })).trim();
    if (!isValidProviderUrl(answer)) {
      writeLine(output, '  ! Enter a valid http:// or https:// URL.');
      continue;
    }
    url = answer.replace(/\/+$/, '');
  }

  if (key) writeLine(output, '  ✓ Provider key detected (hidden)');
  while (!key) {
    key = (await askHidden('  Provider API key (input hidden): ', { input, output })).trim();
    if (!key) writeLine(output, '  ! Provider key cannot be empty.');
  }

  env.ANTHROPIC_BASE_URL = url;
  env.BIZAR_MODEL_ROUTER_URL = url;
  env.ANTHROPIC_AUTH_TOKEN = key;
  writeLine(output, '  ✓ Provider configuration ready; the key will be stored in global Claude settings.');
  return { ok: true, interactive: true, cancelled: false, configured: true, missing: detected.missing };
}
