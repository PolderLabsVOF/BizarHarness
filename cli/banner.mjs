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

export function showBanner() {
  console.clear();
  console.log(chalk.hex('#6366f1').bold(RUNE_HELM));
  console.log(chalk.hex('#a855f7')('    Norse Pantheon Agent System for opencode'));
  console.log();
  console.log(chalk.dim('    11 agents · 4 cost tiers · per-project Hindsight memory · RTK · Semble · Skills CLI'));
  console.log();
}

export function showPantheon() {
  console.log(chalk.hex('#312e81')(PANTHEON));
}

export function sectionHeading(text) {
  const line = chalk.hex('#6366f1').bold(` ── ${text} ──`);
  console.log();
  console.log(line);
  console.log();
}
