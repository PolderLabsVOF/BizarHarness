/**
 * cli/install/banner.mjs
 *
 * Banner, pantheon card, and section heading for the install flow.
 */

import chalk from 'chalk';

const RUNE_HELM = `
    ██████╗ ██╗██╗  ██╗ █████╗ ██████╗
    ██╔══██╗██║██║  ██║██╔══██╗██╔══██╗
    ██████╔╝██║███████║███████║██████╔╝
    ██╔══██╗██║╚════██║██╔══██║██╔══██╗
    ██████╔╝██║     ██║██║  ██║██║  ██║
    ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
`;

const PANTHEON = `
    ╔══════════════════════════════════════════╗
    ║                                          ║
    ║    ᛟ Odin     ᛗ Mimir    ᚹ Heimdall     ║
    ║    ᚱ Hermod   ᚦ Thor     ᛏ Tyr          ║
    ║    ᛉ Vidarr   ᚨ Forseti  ᛒ Baldr        ║
    ║                                          ║
    ╚══════════════════════════════════════════╝
`;

const TAGLINE = '14 agents · 6 cost tiers · dashboard · Obsidian vault long-term memory · Mods · Skills CLI';

export const palette = {
  primary: chalk.hex('#6366f1'),
  success: chalk.green,
  warn:    chalk.yellow,
  error:   chalk.red,
  dim:     chalk.dim,
};

/**
 * Print the Bizar mark + tagline.
 * @param {string} [version] - Optional version string to prepend.
 */
export function showBanner(version) {
  if (version) {
    console.log(chalk.bold.hex('#6366f1')(`\n  ⚡ BizarHarness v${version}\n`));
  } else {
    console.log(chalk.bold.hex('#6366f1')(RUNE_HELM));
    console.log(chalk.hex('#a855f7')('    Norse Pantheon Agent System for Claude Code'));
  }
  console.log();
  console.log(chalk.dim(`    ${TAGLINE}`));
  console.log();
}

/** Print the Norse pantheon card. */
export function showPantheon() {
  console.log(chalk.hex('#312e81')(PANTHEON));
}

/**
 * Print a section header divider.
 * @param {string} text - Section title.
 */
export function sectionHeading(text) {
  console.log();
  console.log(chalk.bold.hex('#6366f1')(` ── ${text} ──`));
  console.log();
}
