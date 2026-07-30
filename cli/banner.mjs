import chalk from 'chalk';

const RUNE_HELM = `
    ██████╗ ██╗██╗  ██╗ █████╗ ██████╗
    ██╔══██╗██║██║  ██║██╔══██╗██╔══██╗
    ██████╔╝██║███████║███████║██████╔╝
    ██╔══██╗██║╚════██║██╔══██║██╔══██╗
    ██████╔╝██║     ██║██║  ██║██║  ██║
    ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
`;

export function showBanner() {
  console.clear();
  console.log(chalk.hex('#6366f1').bold(RUNE_HELM));
  console.log(chalk.hex('#a855f7')('    Guarded autonomous agent system for Claude Code'));
  console.log();
  console.log(chalk.dim('    16 agents · guarded autonomy · human approval gates · MCP · Skills CLI'));
  console.log();
}

export function showPantheon() {
  console.log(chalk.hex('#312e81')('    Claude Code agents · guarded workflows · explicit approval gates'));
}

export function sectionHeading(text) {
  const line = chalk.hex('#6366f1').bold(` ── ${text} ──`);
  console.log();
  console.log(line);
  console.log();
}
