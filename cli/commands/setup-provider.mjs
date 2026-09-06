/**
 * Configure Claude Code's provider environment in settings.json.
 *
 * Bizar does not maintain a parallel provider registry. Claude Code reads
 * ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and ANTHROPIC_MODEL directly.
 */
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function settingsPath() {
  const root = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(root, 'settings.json');
}

export function readSettings(path = settingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function redact(value) {
  if (!value) return '(unset)';
  return value.length <= 8 ? '********' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function parseProviderArgs(args = []) {
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list'),
    removeKey: args.includes('--remove-key'),
    gateway: valueFor('--gateway'),
    key: valueFor('--key'),
    model: valueFor('--model'),
  };
}

export function updateProviderSettings(current, options) {
  const next = { ...current, env: { ...(current.env || {}) } };
  if (options.gateway !== undefined) {
    next.env.ANTHROPIC_BASE_URL = options.gateway;
    // Legacy compatibility: drop any pre-existing router-URL mirror so the
    // install surface converges on a single provider URL.
    delete next.env.BIZAR_MODEL_ROUTER_URL;
  }
  if (options.key !== undefined) next.env.ANTHROPIC_AUTH_TOKEN = options.key;
  if (options.model !== undefined) next.env.ANTHROPIC_MODEL = options.model;
  if (options.removeKey) {
    delete next.env.ANTHROPIC_AUTH_TOKEN;
    delete next.env.ANTHROPIC_API_KEY;
  }
  return next;
}

export function showSetupProviderHelp() {
  console.log(`
  bizar setup-provider — Configure Claude Code provider environment

  Usage:
    bizar setup-provider --list
    bizar setup-provider --gateway <url> [--key <secret>] [--model <id>]
    bizar setup-provider --remove-key

  Writes only ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json).
  Existing settings, permissions, MCP servers, and hooks are preserved.
  Secrets are never printed.
  `);
}

export async function runSetupProvider(args = []) {
  const options = parseProviderArgs(args);
  if (options.help) {
    showSetupProviderHelp();
    return { ok: true };
  }

  const path = settingsPath();
  let current;
  try {
    current = readSettings(path);
  } catch (error) {
    console.error(chalk.red(`  ✗ Invalid JSON in ${path}: ${error.message}`));
    return { ok: false, error: error.message };
  }

  if (options.list) {
    console.log(`  Settings: ${path}`);
    console.log(`  Gateway: ${current.env?.ANTHROPIC_BASE_URL || '(Anthropic default)'}`);
    console.log(`  Model:   ${current.env?.ANTHROPIC_MODEL || '(Claude Code default)'}`);
    console.log(`  API key: ${redact(current.env?.ANTHROPIC_AUTH_TOKEN || current.env?.ANTHROPIC_API_KEY)}`);
    return { ok: true, path, settings: current };
  }

  if (!options.gateway && !options.key && !options.model && !options.removeKey) {
    showSetupProviderHelp();
    return { ok: false, error: 'no provider change requested' };
  }

  const next = updateProviderSettings(current, options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  console.log(chalk.green(`  ✓ Updated Claude Code provider settings at ${path}`));
  if (options.key) console.log(chalk.dim(`  API key: ${redact(options.key)}`));
  return { ok: true, path, settings: next };
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'setup-provider') return false;
  if (isHelpRequest) showSetupProviderHelp();
  else await runSetupProvider(args);
  return true;
}
