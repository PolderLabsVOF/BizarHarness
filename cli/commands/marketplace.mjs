/**
 * cli/commands/marketplace.mjs
 *
 * v5.0.0 — Thin alias for `bizar marketplace <subcommand>` that
 * forwards to the plugin command. Keeps the historical marketplace
 * name alive for users who learned it first.
 *
 *   bizar marketplace search <query>   → bizar plugin search <query>
 *   bizar marketplace install <id>     → bizar plugin install <id>
 *   bizar marketplace list             → bizar plugin list
 *   bizar marketplace                  → bizar plugin list
 *
 * Anything else falls through to `plugin help` so the user gets the
 * full subcommand reference.
 */
import chalk from 'chalk';
import { runPluginCommand, showPluginHelp } from './plugin.mjs';

export function showMarketplaceHelp() {
  console.log(`
  bizar marketplace — Browse and install plugins from the public marketplace

  Usage:
    bizar marketplace                    List installed plugins
    bizar marketplace list               Same as \`bizar plugin list\`
    bizar marketplace search <query>     Same as \`bizar plugin search <query>\`
    bizar marketplace install <id>       Same as \`bizar plugin install <id>\`

  Description:
    The marketplace is the public registry of plugins hosted at
    ${process.env.BIZAR_REGISTRY_URL ||
      'https://raw.githubusercontent.com/DrB0rk/bizar-plugins/main/registry.json'}.

    This command is a thin alias for the \`plugin\` command — run
    \`bizar plugin --help\` for the full surface (config, update, invoke, ...).
  `);
}

export async function runMarketplaceCommand(marketplaceArgs) {
  const sub = marketplaceArgs[0];
  if (!sub || sub === '--help' || sub === '-h') {
    showMarketplaceHelp();
    return;
  }
  // Only a handful of subcommands are aliased — everything else falls
  // through to the plugin command's help so the user isn't confused
  // by a half-implemented alias.
  const aliased = new Set(['search', 'install', 'list']);
  if (!aliased.has(sub)) {
    console.error(chalk.red(`  ✗ Unknown marketplace subcommand: ${sub}`));
    console.error(chalk.dim('  marketplace is an alias for `plugin`; try one of:'));
    console.error(chalk.dim('    marketplace search <query>'));
    console.error(chalk.dim('    marketplace install <id>'));
    console.error(chalk.dim('    marketplace list'));
    console.error(chalk.dim('  or run `bizar plugin --help` for the full surface'));
    showPluginHelp();
    process.exit(1);
  }
  await runPluginCommand(marketplaceArgs);
}

export async function run(name, args, isHelpRequest) {
  await runMarketplaceCommand(args);
}