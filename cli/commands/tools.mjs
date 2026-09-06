#!/usr/bin/env node
/**
 * cli/commands/tools.mjs
 *
 * `bizar tools` — inventory every Bizar surface installed at user level.
 *
 * Walks ~/.claude/{agents,skills,commands,hooks}/ plus the Bizar runtime
 * state under ~/.config/bizar/, then queries the SDK for the live MCP
 * tool set and prints everything grouped by surface. Also lists every
 * wired `bizar <cmd>` subcommand from this bin.mjs dispatcher.
 */

import chalk from 'chalk';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveClaudeConfigDir } from '../config-paths.mjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..', '..');
const CLAUDE_DIR = resolveClaudeConfigDir();

function listDir(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !ext || name.endsWith(ext)).sort();
}

function listEvents(hooksDir) {
  if (!existsSync(hooksDir)) return [];
  return listDir(hooksDir, '.mjs').concat(listDir(hooksDir, '.sh')).sort();
}

function listWiredCommands() {
  // Mirror bin.mjs dispatch — single source of truth lives in bin.mjs.
  // We parse the switch cases to avoid duplicating the list here.
  const binPath = resolve(__dirname, 'bin.mjs');
  const text = readFileSync(binPath, 'utf8');
  const match = text.match(/case '([a-z][a-z0-9-]*)':/g) || [];
  const names = match
    .map((line) => line.match(/case '([^']+)'/)?.[1])
    .filter(Boolean);
  return [...new Set(names)].sort();
}

async function listMcpTools() {
  try {
    const sdkPath = resolve(__dirname, '..', 'packages/sdk/dist/mcp/server.js');
    if (!existsSync(sdkPath)) return [];
    const mod = await import(sdkPath);
    const list = mod.BIZAR_TOOLS || mod.default?.BIZAR_TOOLS || [];
    return list.map((tool) => tool.name).sort();
  } catch {
    return [];
  }
}

export async function runTools(cmdArgs) {
  if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) {
    console.log(`
  bizar tools — list every installed Bizar surface.

  Usage:
    bizar tools [--json] [--user-level]

  Flags:
    --json        Emit machine-readable JSON.
    --user-level  Restrict enumeration to user-level (~/.claude/).
`);
    return;
  }

  const asJson = cmdArgs.includes('--json');

  const agents = listDir(join(CLAUDE_DIR, 'agents'), '.md');
  const commands = listDir(join(CLAUDE_DIR, 'commands'), '.md');
  const skills = listDir(join(CLAUDE_DIR, 'skills'));
  const hooks = listEvents(join(CLAUDE_DIR, 'hooks'));
  const wiredCommands = listWiredCommands();
  const mcpTools = await listMcpTools();

  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  const hasSettings = existsSync(settingsPath);

  const summary = {
    userLevel: CLAUDE_DIR,
    agents,
    commands,
    skills,
    hooks,
    wiredCommands,
    mcpTools,
    settings: { path: settingsPath, present: hasSettings },
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const section = (label, items) => {
    console.log(chalk.bold(`\n  ${label}`));
    if (!items.length) {
      console.log(chalk.dim('    (none)'));
      return;
    }
    for (const item of items) console.log(`    ${item}`);
  };

  console.log(chalk.bold.cyan(`\n  Bizar tools — installed at ${CLAUDE_DIR}`));
  section(`agents (${agents.length})`, agents.map((n) => n.replace(/\.md$/, '')));
  section(`commands (${commands.length})`, commands.map((n) => '/' + n.replace(/\.md$/, '')));
  section(`skills (${skills.length})`, skills);
  section(`hooks (${hooks.length})`, hooks);
  section(`mcp tools (${mcpTools.length})`, mcpTools);
  section(`wired bizar commands (${wiredCommands.length})`, wiredCommands.map((c) => 'bizar ' + c));
  console.log(chalk.bold('\n  settings'));
  console.log(`    ${hasSettings ? '✓' : '✗'} ${settingsPath}`);
  if (hasSettings) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const env = (parsed && parsed.env) || {};
      const aliases = {
        sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        fable: env.ANTHROPIC_DEFAULT_FABLE_MODEL,
      };
      console.log(chalk.bold('  alias map'));
      for (const [key, value] of Object.entries(aliases)) {
        console.log(`    ${key.padEnd(8)} → ${value || '(unset)'}`);
      }
      const model = parsed?.model;
      if (model) console.log(chalk.dim(`    default model: ${model}`));
    } catch { /* ignore malformed settings */ }
  }
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'tools') return false;
  await runTools(isHelpRequest ? ['--help'] : args);
  return true;
}
