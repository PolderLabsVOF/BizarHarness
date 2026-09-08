/**
 * `bizar orchestrator` — manage Claude Code's multi-entry modelPicker setting.
 */
import chalk from 'chalk';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveClaudeConfigDir } from '../config-paths.mjs';

export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const GATEWAY_MODELS_PATH = '/v1/models';
export const MODELS_CACHE_PATH = join(homedir(), '.cache', 'bizar', 'models-dev-cache.json');
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

export const FALLBACK_MODELS = [
  { id: 'claude-opus-4-5-20260101', label: 'Claude Opus 4.5', description: 'Most capable model for complex reasoning', capabilities: ['reasoning', 'tool_call', 'structured_output'], source: 'fallback' },
  { id: 'claude-sonnet-4-5-20260101', label: 'Claude Sonnet 4.5', description: 'Balanced capability and speed', capabilities: ['reasoning', 'tool_call', 'structured_output'], source: 'fallback' },
  { id: 'claude-haiku-4-5-20260101', label: 'Claude Haiku 4.5', description: 'Fast, lightweight model', capabilities: ['tool_call', 'structured_output'], source: 'fallback' },
];

const CSI = '\x1b[';
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;
const INVERSE = `${CSI}7m`;
const GREEN = `${CSI}32m`;
const DIM = `${CSI}2m`;
const SHOW_CURSOR = `${CSI}?25h`;
const HIDE_CURSOR = `${CSI}?25l`;
const SCROLL_REGION_START = `${CSI}6;18r`;
const SCROLL_REGION_END = `${CSI}r`;

const writeOut = (value = '') => process.stdout.write(`${value}\n`);
const writeError = (value = '') => process.stderr.write(`${value}\n`);

export function settingsPath(env = process.env) {
  return join(resolveClaudeConfigDir({ env }), 'settings.json');
}

export function readSettings(path = settingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeSettings(path, settings, write = writeFileSync) {
  mkdirSync(dirname(path), { recursive: true });
  write(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

export function isAgentContext(env = process.env) {
  return Boolean(env.BIZAR_AGENT || env.CLAUDE_CODE_AGENT_NAME);
}

function agentContextMessage() {
  return '  ✗ orchestrator is an operator-only command. Refusing to run in agent context (BIZAR_AGENT or CLAUDE_CODE_AGENT_NAME is set).';
}

export function parseOrchestratorArgs(args = []) {
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : undefined;
  };
  const subcommands = new Set(['pick', 'show', 'clear', 'validate']);
  const subcommand = args.find((arg) => !arg.startsWith('-') && subcommands.has(arg)) || 'pick';
  return {
    subcommand,
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list'),
    json: args.includes('--json'),
    yes: args.includes('--yes') || args.includes('-y'),
    source: valueFor('--source') || 'both',
    provider: valueFor('--provider') || null,
  };
}

export function showOrchestratorHelp() {
  writeOut(`
  bizar orchestrator — multi-select models for Claude Code's /model picker

  Usage:
    bizar orchestrator [pick|show|clear|validate] [options]

  Subcommands:
    pick       Add selected models to the modelPicker array (default)
    show       Show modelPicker, metadata sources, and the single-entry hint
    clear      Delete the modelPicker array entirely
    validate   Check modelPicker ids and duplicate entries

  Options:
    --list              Dump the raw model list without opening a picker
    --json              Emit machine-readable output
    --yes, -y           Skip confirmation prompts
    --source <source>   models.dev, gateway, or both (default: both)
    --provider <name>   Filter models.dev to one provider

  Writes ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json).
  `);
}

function capabilityFlags(meta = {}) {
  return [
    ['reasoning', meta.reasoning],
    ['tool_call', meta.tool_call],
    ['structured_output', meta.structured_output],
    ['attachment', meta.attachment],
  ].filter(([, enabled]) => Boolean(enabled)).map(([name]) => name);
}

function normalizeModelsDev(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const models = [];
  for (const [provider, providerData] of Object.entries(data)) {
    if (!providerData?.models || typeof providerData.models !== 'object') continue;
    for (const [id, meta] of Object.entries(providerData.models)) {
      models.push({
        id,
        label: meta?.name || id,
        description: meta?.description || 'From models.dev',
        capabilities: capabilityFlags(meta),
        source: 'models.dev',
        provider,
      });
    }
  }
  return models;
}

function cachedModels(cachePath, ttl, now) {
  if (!existsSync(cachePath)) return null;
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    const fetchedAt = cached.fetchedAt ?? cached._cachedAt;
    const data = cached.data ?? cached;
    if (Number.isFinite(fetchedAt) && now() - fetchedAt < ttl) return normalizeModelsDev(data);
    return { stale: true, models: normalizeModelsDev(data) };
  } catch {
    return null;
  }
}

export async function fetchModelsDev(options = {}) {
  const cachePath = options.cachePath || MODELS_CACHE_PATH;
  const ttl = options.ttl ?? MODELS_CACHE_TTL_MS;
  const now = options.now || Date.now;
  const cached = cachedModels(cachePath, ttl, now);
  if (Array.isArray(cached)) return cached;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const response = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({ fetchedAt: now(), data }, null, 2)}\n`, { mode: 0o600 });
    return normalizeModelsDev(data);
  } catch (error) {
    if (cached?.models?.length) return cached.models;
    throw error;
  }
}

export async function fetchGatewayModels(baseUrl, authToken, options = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(`${root}${GATEWAY_MODELS_PATH}?limit=1000`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : payload?.models;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry?.id).map((entry) => ({
    id: entry.id,
    label: entry.display_name || entry.id,
    description: entry.description || 'From gateway',
    capabilities: [],
    source: 'gateway',
  }));
}

export function mergeModelSources(modelsDev = [], gateway = [], fallback = FALLBACK_MODELS) {
  const merged = new Map();
  for (const model of modelsDev) {
    if (model?.id && !merged.has(model.id)) merged.set(model.id, { ...model });
  }
  for (const model of gateway) {
    if (!model?.id) continue;
    const existing = merged.get(model.id);
    if (existing) {
      existing.label = model.label || existing.label;
      existing.description = model.description || existing.description;
    } else {
      merged.set(model.id, { ...model });
    }
  }
  if (!merged.size) {
    for (const model of fallback || []) {
      if (model?.id && !merged.has(model.id)) merged.set(model.id, { ...model });
    }
  }
  return [...merged.values()];
}

export function toggleSelection(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function searchable(model) {
  return [model.id, model.label, model.description, ...(model.capabilities || [])].filter(Boolean).join(' ').toLowerCase();
}

function filteredModels(models, filter) {
  const query = String(filter || '').trim().toLowerCase();
  return query ? models.filter((model) => searchable(model).includes(query)) : models;
}

function sourceTag(model) {
  return model.source === 'models.dev' ? model.provider || 'models.dev' : model.source || 'fallback';
}

export function renderPicker(models, selected, cursor, filter, sources = [], provider = null) {
  const filtered = filteredModels(models, filter);
  const safeCursor = Math.max(0, Math.min(cursor, Math.max(0, filtered.length - 1)));
  const start = Math.max(0, Math.min(safeCursor - 5, Math.max(0, filtered.length - 12)));
  const visible = filtered.slice(start, start + 12);
  const lines = [];
  let title = '🤖 orchestrator — multi-select models for /model picker';
  if (provider) title += ` — provider: ${provider}`;
  lines.push(`${BOLD}${title}${RESET}`);
  lines.push(`${DIM}Metadata: ${sources.join(', ') || 'none'}${RESET}`);
  lines.push(`${DIM}Search: ${filter || '(type to filter)'}${RESET}`);
  lines.push('');
  for (let offset = 0; offset < visible.length; offset += 1) {
    const model = visible[offset];
    const index = start + offset;
    const highlighted = index === safeCursor;
    const marker = selected.has(model.id) ? `${GREEN}✓${RESET}` : ' ';
    const pointer = highlighted ? '▶' : ' ';
    const label = model.label || model.id;
    const capabilities = (model.capabilities || []).join(', ') || 'no capability metadata';
    const line = `${marker} ${pointer} [${sourceTag(model)}] ${model.id}  ${DIM}${label} — ${capabilities}${RESET}`;
    lines.push(highlighted ? `${INVERSE}${BOLD}${line}${RESET}` : line);
  }
  lines.push('');
  lines.push(`${DIM}↑↓/jk move  space toggle  a toggle-all-visible  Enter confirm  Esc/Ctrl-C cancel${RESET}`);
  return lines;
}

async function readLine(prompt, input = process.stdin, output = process.stdout) {
  const readline = createInterface({ input, output });
  return new Promise((resolve) => readline.question(prompt, (answer) => {
    readline.close();
    resolve(answer);
  }));
}

async function pickModelsNonTty(models, input = process.stdin) {
  models.forEach((model, index) => writeOut(`${index + 1}. [${sourceTag(model)}] ${model.id} — ${model.label || model.id}`));
  const answer = await readLine('Select models (space-separated numbers): ', input, process.stdout);
  if (!answer.trim()) return [];
  const indexes = new Set(answer.trim().split(/\s+/).map(Number).filter((index) => Number.isInteger(index) && index >= 1 && index <= models.length));
  return models.filter((_, index) => indexes.has(index + 1));
}

export async function pickModels(models, options = {}) {
  if (options.list || !process.stdout.isTTY || !process.stdin.isTTY) return pickModelsNonTty(models, options.input);
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const selected = new Set(options.selectedIds || []);
  let cursor = 0;
  let filter = '';
  let buffer = '';
  let active = true;

  const redraw = () => {
    const lines = renderPicker(models, selected, cursor, filter, options.sources, options.provider);
    output.write(`\x1b[2J\x1b[H${HIDE_CURSOR}${SCROLL_REGION_START}${lines.join('\n')}\n${SCROLL_REGION_END}`);
  };
  const finish = (result) => {
    active = false;
    output.write(`${SHOW_CURSOR}\x1b[2J\x1b[H`);
    if (input.isRaw) input.setRawMode(false);
    input.pause();
    return result;
  };

  redraw();
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((resolve) => {
    const onData = (chunk) => {
      if (!active) return;
      buffer += chunk;
      let key = buffer;
      buffer = '';
      if (key === '' || key === '\x1b' || key === '\x1b') {
        input.off('data', onData);
        resolve(finish(null));
        return;
      }
      const filtered = filteredModels(models, filter);
      if (key === '\x1b[A' || key === 'k') cursor = Math.max(0, cursor - 1);
      else if (key === '\x1b[B' || key === 'j') cursor = Math.min(Math.max(0, filtered.length - 1), cursor + 1);
      else if (key === ' ') {
        const model = filtered[cursor];
        if (model) {
          const next = toggleSelection(selected, model.id);
          selected.clear();
          next.forEach((id) => selected.add(id));
        }
      } else if (key === 'a') {
        const displayed = filtered.slice(Math.max(0, Math.min(cursor - 5, Math.max(0, filtered.length - 12))), Math.max(0, Math.min(cursor - 5, Math.max(0, filtered.length - 12))) + 12);
        const allSelected = displayed.every((model) => selected.has(model.id));
        displayed.forEach((model) => allSelected ? selected.delete(model.id) : selected.add(model.id));
      } else if (key === '\x7f' || key === '\b') {
        filter = filter.slice(0, -1);
        cursor = 0;
      } else if (key === '\r' || key === '\n') {
        input.off('data', onData);
        resolve(finish(models.filter((model) => selected.has(model.id))));
        return;
      } else if (key.length === 1 && key >= ' ') {
        filter += key;
        cursor = 0;
      }
      redraw();
    };
    input.on('data', onData);
  });
}

export function updateOrchestratorSettings(current = {}, options = {}) {
  const next = { ...current };
  if (options.clear) {
    delete next.modelPicker;
    return next;
  }
  if (!Array.isArray(options.pick) || options.pick.length === 0) return next;
  const existing = Array.isArray(next.modelPicker) ? next.modelPicker.map((entry) => ({ ...entry })) : [];
  const ids = new Set(existing.map((entry) => entry.id));
  for (const entry of options.pick) {
    if (!entry?.id || ids.has(entry.id)) continue;
    existing.push({
      id: entry.id,
      label: entry.label || entry.id,
      description: entry.description || '',
      capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
    });
    ids.add(entry.id);
  }
  next.modelPicker = existing;
  return next;
}

export function validateOrchestratorSettings(current = {}, models = []) {
  const entries = Array.isArray(current.modelPicker) ? current.modelPicker : [];
  const known = new Set(models.map((model) => model.id));
  const unknown = entries.filter((entry) => !known.has(entry.id)).map((entry) => entry.id);
  const counts = new Map();
  entries.forEach((entry) => counts.set(entry.id, (counts.get(entry.id) || 0) + 1));
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const ok = unknown.length === 0 && duplicates.length === 0;
  return { ok, valid: ok, unknown, duplicates, unknownIds: unknown, duplicateIds: duplicates };
}

async function loadModels(options, env) {
  const useModelsDev = options.source === 'models.dev' || options.source === 'both';
  const useGateway = options.source === 'gateway' || options.source === 'both';
  let modelsDev = [];
  let gateway = [];
  let modelsDevFailed = false;
  let gatewayFailed = false;
  if (useModelsDev) {
    try {
      modelsDev = await options.fetchModelsDev();
    } catch (error) {
      modelsDevFailed = true;
      if (!options.json) writeError(chalk.yellow(`  ⚠ models.dev unavailable: ${error.message}`));
    }
  }
  if (useGateway) {
    try {
      gateway = await options.fetchGatewayModels(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', env.ANTHROPIC_AUTH_TOKEN);
    } catch (error) {
      gatewayFailed = true;
      if (!options.json) writeError(chalk.yellow(`  ⚠ gateway unavailable: ${error.message}`));
    }
  }
  const filteredModelsDev = options.provider
    ? modelsDev.filter((model) => model.provider === options.provider)
    : modelsDev;
  const models = mergeModelSources(filteredModelsDev, gateway, FALLBACK_MODELS);
  const fallbackUsed = !filteredModelsDev.length && !gateway.length && models.length > 0 && models.every((model) => model.source === 'fallback');
  return {
    models,
    sources: [useModelsDev && 'models.dev', useGateway && 'gateway'].filter(Boolean),
    fallbackUsed,
    modelsDevFailed,
    gatewayFailed,
  };
}

async function confirmApply(count, input = process.stdin) {
  const answer = await readLine(`Apply ${count} models to modelPicker? [Y/n] `, input, process.stdout);
  return !/^(n|no)$/i.test(answer.trim());
}

async function confirmClear(input = process.stdin) {
  const answer = await readLine('Delete modelPicker array? [y/N] ', input, process.stdout);
  return /^(y|yes)$/i.test(answer.trim());
}

export async function runOrchestrator(args = [], deps = {}) {
  const options = parseOrchestratorArgs(args);
  const env = deps.env || process.env;
  if (options.help) {
    showOrchestratorHelp();
    return { ok: true };
  }
  if (!['models.dev', 'gateway', 'both'].includes(options.source)) {
    writeError(chalk.red(`  ✗ Invalid --source: ${options.source}`));
    return { ok: false, error: 'invalid source' };
  }
  if (isAgentContext(env)) {
    writeError(chalk.red(agentContextMessage()));
    return { ok: false, error: 'operator-only command' };
  }

  const path = deps.path || settingsPath(env);
  const read = deps.read || (() => readSettings(path));
  let current;
  try {
    current = read(path);
  } catch (error) {
    writeError(chalk.red(`  ✗ Invalid JSON in ${path}: ${error.message}`));
    return { ok: false, error: error.message };
  }

  if (options.subcommand === 'clear') {
    if (!options.yes && !(await confirmClear(deps.input))) {
      writeOut(chalk.yellow('  Cancelled.'));
      return { ok: false, cancelled: true };
    }
    const next = updateOrchestratorSettings(current, { clear: true });
    writeSettings(path, next, deps.write || writeFileSync);
    writeOut(chalk.green('  ✓ Deleted modelPicker array.'));
    return { ok: true, settings: next };
  }

  const loaded = await loadModels({
    ...options,
    fetchModelsDev: deps.fetchModelsDev || (() => fetchModelsDev(deps.fetchOptions)),
    fetchGatewayModels: deps.fetchGatewayModels || ((baseUrl, token) => fetchGatewayModels(baseUrl, token, deps.fetchOptions)),
  }, env);

  if (loaded.fallbackUsed && !options.json) writeError(chalk.yellow('  ⚠ using fallback model list (models.dev unreachable and no cache)'));

  if (options.subcommand === 'show') {
    if (options.list) {
      const result = { modelPicker: current.modelPicker || [], metadataSources: loaded.sources, provider: options.provider, fallback: loaded.fallbackUsed };
      writeOut(options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result.modelPicker, null, 2));
      return { ok: true, ...result };
    }
    const result = {
      modelPicker: current.modelPicker || [],
      metadataSources: loaded.sources,
      provider: options.provider,
      fallback: loaded.fallbackUsed,
    };
    const custom = current.env?.ANTHROPIC_CUSTOM_MODEL_OPTION;
    if (custom) result.singleEntryHint = 'ANTHROPIC_CUSTOM_MODEL_OPTION is also set and adds one entry at the top of the /model picker.';
    if (options.json) writeOut(JSON.stringify({ ...result, customModelOption: custom || null }, null, 2));
    else {
      writeOut(chalk.bold('\nmodelPicker:'));
      if (!result.modelPicker.length) writeOut(chalk.dim('  (empty)'));
      for (const entry of result.modelPicker) writeOut(`  - ${entry.id} — ${entry.label || entry.id}`);
      writeOut(chalk.dim(`\nMetadata sources: ${loaded.sources.join(', ')}`));
      if (options.provider) writeOut(chalk.dim(`Provider filter: ${options.provider}`));
      writeOut(custom ? `\nANTHROPIC_CUSTOM_MODEL_OPTION: ${custom}\n${chalk.dim('  Hint: this adds ONE entry at the top of /model, separately from modelPicker.')}` : chalk.dim('\nANTHROPIC_CUSTOM_MODEL_OPTION: (not set)'));
    }
    return { ok: true, ...result };
  }

  if (options.subcommand === 'validate') {
    const result = validateOrchestratorSettings(current, loaded.models);
    if (options.json) writeOut(JSON.stringify({ ...result, metadataSources: loaded.sources }, null, 2));
    else {
      if (result.ok) writeOut(chalk.green('  ✓ All modelPicker entries are valid.'));
      if (result.unknown.length) writeOut(chalk.red(`  ✗ Unknown model IDs: ${result.unknown.join(', ')}`));
      if (result.duplicates.length) writeOut(chalk.red(`  ✗ Duplicate model IDs: ${result.duplicates.join(', ')}`));
    }
    return { ...result, metadataSources: loaded.sources };
  }

  if (options.list) {
    if (options.json) writeOut(JSON.stringify(loaded.models, null, 2));
    else loaded.models.forEach((model, index) => writeOut(`${index + 1}. [${sourceTag(model)}] ${model.id} — ${model.label || model.id} (${(model.capabilities || []).join(', ')})`));
    return { ok: true, models: loaded.models };
  }

  const chosen = await (deps.pickModels || pickModels)(loaded.models, {
    input: deps.input,
    output: deps.output,
    provider: options.provider,
    sources: loaded.sources,
  });
  if (chosen === null) {
    writeOut(chalk.yellow('  Cancelled.'));
    return { ok: false, cancelled: true };
  }
  if (!chosen.length) {
    writeOut(chalk.yellow('  No models selected.'));
    return { ok: false, noSelection: true };
  }
  if (!options.yes && !(await confirmApply(chosen.length, deps.input))) {
    writeOut(chalk.yellow('  Cancelled.'));
    return { ok: false, cancelled: true };
  }
  const next = updateOrchestratorSettings(current, { pick: chosen });
  writeSettings(path, next, deps.write || writeFileSync);
  writeOut(chalk.green(`  ✓ Added ${chosen.length} models to modelPicker.`));
  return { ok: true, count: chosen.length, settings: next };
}

export async function run(nameOrArgs = [], args = [], isHelpRequest = false) {
  if (Array.isArray(nameOrArgs)) return runOrchestrator(nameOrArgs);
  if (nameOrArgs !== 'orchestrator') return false;
  if (isHelpRequest) {
    showOrchestratorHelp();
    return true;
  }
  const result = await runOrchestrator(args);
  if (result?.ok === false) process.exitCode = 1;
  return true;
}
