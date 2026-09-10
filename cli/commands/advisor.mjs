import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ADVISOR_PAIRINGS = {
  'haiku-4-5': ['fable', 'opus-4-5', 'sonnet-4-5'],
  'sonnet-4-6': ['fable', 'opus-4-5', 'sonnet-4-5'],
  'sonnet-5': ['fable', 'opus-4-5', 'sonnet-5'],
  'opus-4-6': ['fable', 'opus-4-5', 'sonnet-5'],
  'opus-4-7+': ['fable', 'opus-4-7+'],
  'fable-5': ['fable-5'],
  'fable-5-1': ['fable-5-1'],
};

function modelMatches(modelId, pattern) {
  const id = String(modelId ?? '').toLowerCase();
  const hasPlus = pattern.endsWith('+');
  const prefix = pattern.toLowerCase().replace(/\+$/, '');
  return id === prefix || id.startsWith(`${prefix}-`) || id.includes(`-${prefix}-`) || (hasPlus && (id.includes(prefix) || id.includes(`-${prefix}`))) || (hasPlus && prefix === 'opus-4-7' && /opus-4-[7-9]/.test(id));
}

function mainPairingKey(modelId) {
  const id = String(modelId ?? '').toLowerCase();
  if (/opus-(?:[5-9]|4-(?:[7-9]|[1-9][0-9]+))/.test(id)) return 'opus-4-7+';
  return Object.keys(ADVISOR_PAIRINGS)
    .sort((a, b) => b.length - a.length)
    .find((key) => modelMatches(id, key));
}

export function validateAdvisorPairing(mainId, advisorId) {
  const mainKey = mainPairingKey(mainId);
  if (!mainKey) return { verdict: 'unknown-main', accepted: [] };
  const accepted = ADVISOR_PAIRINGS[mainKey];
  const verdict = accepted.some((pattern) => modelMatches(advisorId, pattern)) ? 'ok' : 'rejected';
  return { verdict, accepted };
}

export function settingsPath() {
  const root = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(root, 'settings.json');
}

export function readSettings(path = settingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function resolveMainModel(settings) {
  const env = settings?.env ?? {};
  return env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_DEFAULT_MODEL;
}

export function updateAdvisorSettings(current, options) {
  const next = { ...current, env: { ...(current?.env ?? {}) } };
  if (options.action === 'pick') next.advisorModel = options.model;
  if (options.action === 'disable') next.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = '1';
  if (options.action === 'clear') {
    delete next.advisorModel;
    delete next.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL;
  }
  return next;
}

export function parseAdvisorArgs(args = []) {
  const nonFlags = args.filter((arg) => !arg.startsWith('-'));
  return {
    subcommand: nonFlags[0] || 'pick',
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list'),
    json: args.includes('--json'),
    yes: args.includes('--yes'),
  };
}

export async function fetchAdvisorEndpointModels(url, authToken, apiKey) {
  const endpoint = `${url.replace(/\/$/, '')}/models`;
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  else if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`Models endpoint returned ${response.status} ${response.statusText}`);
  const body = await response.json();
  return Array.isArray(body) ? body : (body.data ?? []);
}

function providerName(url) {
  const lower = url.toLowerCase();
  if (lower.includes('bedrock') || lower.includes('amazonaws.com')) return 'AWS Bedrock';
  if (lower.includes('vertex') || lower.includes('googleapis.com')) return 'GCP Vertex';
  if (lower.includes('foundry') || lower.includes('azure.com')) return 'Microsoft Foundry';
  return url;
}

function isUnsupportedProvider(url) {
  const lower = url.toLowerCase();
  return lower.includes('bedrock') || lower.includes('vertex') || lower.includes('foundry') || lower.includes('amazonaws.com') || lower.includes('googleapis.com') || lower.includes('azure.com');
}

export function isAgentContext() {
  return process.env.BIZAR_AGENT !== undefined || process.env.CLAUDE_CODE_AGENT_NAME !== undefined;
}

function fableWarning(model) {
  return model?.toLowerCase().includes('fable')
    ? '⚠ Fable advisors require one-time consent to bill usage credits. Run: claude (then type /advisor off and /advisor <fable> to consent once).'
    : null;
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function eligibleModels(models, mainModel) {
  const key = mainPairingKey(mainModel);
  if (!key) return { models, notice: '⚠ could not determine main model — showing all options' };
  const accepted = ADVISOR_PAIRINGS[key];
  const filtered = models.filter((model) => accepted.some((pattern) => modelMatches(model.id, pattern)));
  if (filtered.length) return { models: filtered, notice: '' };
  const opus = models.filter((model) => /opus/i.test(model.id ?? ''));
  return { models: opus, notice: '⚠ no compatible models returned — showing all Opus-class options' };
}

function searchable(model, query) {
  const needle = query.toLowerCase();
  return [model.id, model.name, model.display_name, model.description].some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function readInput() {
  return new Promise((resolve) => process.stdin.once('data', (chunk) => resolve(chunk.toString())));
}

async function pickAdvisorModel(models, options) {
  const eligible = eligibleModels(models, options.mainModel);
  const sorted = [...eligible.models].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (options.list) return { ok: true, models: sorted, notice: eligible.notice };
  if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) return { ok: true, models: sorted, notice: eligible.notice };

  let query = '';
  let index = 0;
  let offset = 0;
  const visible = 12;
  const wasRaw = process.stdin.isRaw;
  const redraw = () => {
    const filtered = sorted.filter((model) => !query || searchable(model, query));
    index = Math.min(index, Math.max(0, filtered.length - 1));
    offset = Math.min(offset, Math.max(0, filtered.length - visible));
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(chalk.bold('  Select Claude Code advisor model\n\n'));
    if (eligible.notice) process.stdout.write(chalk.yellow(`  ${eligible.notice}\n\n`));
    process.stdout.write(`  Search: ${query || chalk.dim('(type to filter)')}\n\n`);
    for (let row = 0; row < Math.min(visible, filtered.length); row += 1) {
      const model = filtered[offset + row];
      process.stdout.write(`${offset + row === index ? chalk.cyan('  > ') : '    '}${model.id}${model.display_name ? chalk.dim(` — ${model.display_name}`) : ''}\n`);
    }
    if (!filtered.length) process.stdout.write(chalk.yellow('    No matching models\n'));
    process.stdout.write(chalk.dim('\n  ↑/↓ navigate  enter select  backspace edit  esc cancel\n'));
  };
  const restore = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
    process.stdin.pause();
    process.stdout.write('\x1b[2J\x1b[H');
  };
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    redraw();
    while (true) {
      const input = await readInput();
      if (input === '' || input === '' || input === '') return { ok: false, error: 'cancelled' };
      if (input === '\r' || input === '\n') {
        const filtered = sorted.filter((model) => !query || searchable(model, query));
        if (filtered[index]) return { ok: true, model: filtered[index].id, notice: eligible.notice };
      } else if (input === '') query = query.slice(0, -1);
      else if (input === '[A') index = Math.max(0, index - 1);
      else if (input === '[B') index += 1;
      else if (input.length === 1 && input >= ' ') query += input;
      const filtered = sorted.filter((model) => !query || searchable(model, query));
      index = Math.min(index, Math.max(0, filtered.length - 1));
      if (index >= offset + visible) offset = index - visible + 1;
      if (index < offset) offset = index;
      redraw();
    }
  } finally {
    restore();
  }
}

export { pickAdvisorModel };

export function showAdvisorHelp() {
  process.stdout.write(`\n  bizar advisor — Configure Claude Code's advisor tool\n\n  Usage:\n    bizar advisor [pick|show|clear|validate|disable] [--list] [--json] [--yes]\n\n  Subcommands:\n    pick       Search and select an advisor model (default)\n    show       Show the configured advisor and disabled state\n    clear      Remove advisorModel and the disable flag\n    validate   Validate the current main/advisor pairing\n    disable    Set CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1\n\n  Options:\n    --list     Dump eligible model IDs without the interactive picker\n    --json     Emit machine-readable output\n    --yes      Skip confirmation prompts\n\n  Settings: ~/.claude/settings.json or $CLAUDE_CONFIG_DIR/settings.json\n`);
}

function showAdvisor(settings, json) {
  const state = {
    advisorModel: settings.advisorModel ?? null,
    disabled: settings.env?.CLAUDE_CODE_DISABLE_ADVISOR_TOOL === '1',
  };
  if (json) process.stdout.write(`${JSON.stringify(state)}\n`);
  else if (state.disabled && state.advisorModel) process.stdout.write(chalk.yellow(`  Advisor disabled; disabled state wins over ${state.advisorModel}. Run bizar advisor clear to reset.\n`));
  else if (state.disabled) process.stdout.write(chalk.yellow('  Advisor disabled. Run bizar advisor clear to re-enable.\n'));
  else if (state.advisorModel) process.stdout.write(`  Advisor: ${state.advisorModel}\n`);
  else process.stdout.write('  No advisor configured. Run bizar advisor pick.\n');
  if (state.advisorModel && fableWarning(state.advisorModel) && !json) process.stdout.write(chalk.yellow(`  ${fableWarning(state.advisorModel)}\n`));
  return state;
}

export async function runAdvisor(args = []) {
  const options = parseAdvisorArgs(args);
  if (options.help) { showAdvisorHelp(); return { ok: true }; }
  if (isAgentContext()) {
    process.stderr.write(chalk.red('✗ bizar advisor is user-only and cannot run in agent context.\n'));
    return { ok: false, error: 'agent-context' };
  }
  const path = settingsPath();
  let settings;
  try { settings = readSettings(path); } catch (error) {
    process.stderr.write(chalk.red(`✗ Invalid JSON in ${path}: ${error.message}\n`));
    return { ok: false, error: 'invalid-settings' };
  }
  const baseUrl = settings.env?.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  if (isUnsupportedProvider(baseUrl)) {
    process.stderr.write(chalk.red(`✗ Advisor tool requires the Anthropic API. Detected provider: ${providerName(baseUrl)} (${baseUrl}). Disable this command on Bedrock/Vertex/Foundry.\n`));
    return { ok: false, error: 'unsupported-provider' };
  }
  const subcommand = options.subcommand;
  if (subcommand === 'show') return { ok: true, state: showAdvisor(settings, options.json) };
  if (subcommand === 'clear' || subcommand === 'disable') {
    const next = updateAdvisorSettings(settings, { action: subcommand });
    writeSettings(path, next);
    process.stdout.write(chalk.green(`✓ Advisor ${subcommand === 'clear' ? 'configuration cleared' : 'disabled'} in ${path}\n`));
    return { ok: true, settings: next };
  }
  if (subcommand === 'validate') {
    const main = resolveMainModel(settings);
    const advisor = settings.advisorModel;
    const result = main && advisor ? validateAdvisorPairing(main, advisor) : { verdict: 'missing-model', accepted: [] };
    if (options.json) process.stdout.write(`${JSON.stringify({ main, advisor, ...result })}\n`);
    else process.stdout.write(`  Main: ${main ?? '(unknown)'}\n  Advisor: ${advisor ?? '(unset)'}\n  Verdict: ${result.verdict}\n`);
    return { ok: result.verdict === 'ok' || result.verdict === 'unknown-main', result };
  }
  const models = await fetchAdvisorEndpointModels(baseUrl, settings.env?.ANTHROPIC_AUTH_TOKEN, settings.env?.ANTHROPIC_API_KEY).catch((error) => {
    process.stderr.write(chalk.red(`✗ Could not fetch advisor models: ${error.message}\n`));
    return null;
  });
  if (!models) return { ok: false, error: 'models-fetch' };
  const picked = await pickAdvisorModel(models, { ...options, mainModel: resolveMainModel(settings) });
  if (!picked.ok) return picked;
  if (options.list || options.json || picked.model === undefined) {
    const output = options.json ? { models: picked.models.map((model) => model.id), notice: picked.notice } : picked.models.map((model) => model.id);
    process.stdout.write(`${JSON.stringify(output, null, options.json ? 2 : 0)}\n`);
    return { ok: true, models: picked.models, notice: picked.notice };
  }
  if (!options.yes) {
    process.stdout.write(`  Selected ${picked.model}. Write to settings? [y/N] `);
    const answer = await readInput();
    if (!/^y(?:es)?$/i.test(answer.trim())) return { ok: false, error: 'cancelled' };
  }
  const next = updateAdvisorSettings(settings, { action: 'pick', model: picked.model });
  writeSettings(path, next);
  process.stdout.write(chalk.green(`✓ Advisor set to ${picked.model}\n`));
  const warning = fableWarning(picked.model);
  if (warning) process.stdout.write(chalk.yellow(`${warning}\n`));
  return { ok: true, model: picked.model, settings: next };
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'advisor') return false;
  if (isHelpRequest) showAdvisorHelp();
  else await runAdvisor(args);
  return true;
}
