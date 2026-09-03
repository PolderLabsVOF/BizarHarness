/**
 * cli/install/paths.mjs
 *
 * Single source of truth for all install paths. Replaces hard-coded
 * path literals scattered throughout the install flow.
 */

import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeConfigDir } from '../config-paths.mjs';

/** Resolve the Claude Code config directory.
 *   1. `process.env.CLAUDE_CONFIG_DIR`
 *   2. `$HOME/.claude`
 */
export function resolveClaudeDir() {
  return resolveClaudeConfigDir();
}

const HOME = homedir();
const CLAUDE_DIR = resolveClaudeDir();
const BIZAR_HOME = process.env.BIZAR_HOME
  || join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'bizar');

/** The Bizar runtime state directory (not under ~/.claude/). */
export { BIZAR_HOME };

/** Standard Claude Code subdirectories under CLAUDE_DIR. */
export const PATHS = {
  claudeDir:     CLAUDE_DIR,
  agentsDir:     join(CLAUDE_DIR, 'agents'),
  skillsDir:     join(CLAUDE_DIR, 'skills'),
  commandsDir:   join(CLAUDE_DIR, 'commands'),
  hooksDir:      join(CLAUDE_DIR, 'hooks'),
  settingsFile:  join(CLAUDE_DIR, 'settings.json'),
  bizarHome:     BIZAR_HOME,
  loopsDir:      join(BIZAR_HOME, 'loops'),
  installMarker: join(BIZAR_HOME, 'installed.json'),
};

/**
 * Render the install-location card to the console.
 * @param {{ dryRun?: boolean, force?: boolean }} [_opts]
 */
export function printInstallLocations(_opts = {}) {
  const G = chalk.green;
  const dim = chalk.dim;

  console.log();
  console.log(chalk.bold('┌─ BizarHarness will install to ─────────────────────────────────────┐'));
  console.log(chalk.bold('│') + ' '.repeat(68) + chalk.bold('│'));
  console.log(chalk.bold('│') + `  Claude Code config     ${PATHS.claudeDir}`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    ├─ agents/          bundled agents`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    ├─ skills/          bundled skill packs`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    ├─ commands/        slash commands`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    ├─ hooks/           PreToolUse, PostToolUse, …`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    └─ settings.json    scoped permissions + hooks + MCP`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + ' '.repeat(68) + chalk.bold('│'));
  console.log(chalk.bold('│') + `  Bizar runtime state   ${PATHS.bizarHome}`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    ├─ loops/           autonomous loop state`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + `    └─ installed.json   install manifest (version, hash)`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('│') + ' '.repeat(68) + chalk.bold('│'));
  console.log(chalk.bold('│') + `  Override with: ${dim('CLAUDE_CONFIG_DIR=/path/to/dir')}`.padEnd(69) + chalk.bold('│'));
  console.log(chalk.bold('└──────────────────────────────────────────────────────────────────────┘'));
  console.log();
}
