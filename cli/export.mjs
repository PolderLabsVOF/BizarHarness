import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { opencodeConfigDir } from './utils.mjs';

const HOME = homedir();
const CONFIG_DIR = opencodeConfigDir();

export async function runExport(target) {
  const validTargets = ['claude', 'cursor', 'opencode'];
  if (target && !validTargets.includes(target)) {
    console.log(chalk.red(`  Unknown target "${target}". Valid: ${validTargets.join(', ')}`));
    return;
  }

  const targets = target ? [target] : validTargets;

  for (const t of targets) {
    console.log(chalk.bold.hex('#6366f1')(`\n  Exporting to ${t}...\n`));
    try {
      await exportTo(t);
    } catch (error) {
      console.log(chalk.red(`  Export failed: ${error.message}`));
    }
  }
}

async function exportTo(target) {
  const agentsDir = join(CONFIG_DIR, 'agents');
  if (!existsSync(agentsDir)) {
    throw new Error(`No installed agents found at ${agentsDir}. Run \`bizar install\` first.`);
  }
  const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.md'));

  switch (target) {
    case 'claude': {
      const claudeDir = join(HOME, '.claude');
      mkdirSync(claudeDir, { recursive: true });

      // Copy agents to .claude/agents/
      const claudeAgentDir = join(claudeDir, 'agents');
      mkdirSync(claudeAgentDir, { recursive: true });
      for (const file of agentFiles) {
        const content = readFileSync(join(CONFIG_DIR, 'agents', file), 'utf-8');
        writeFileSync(join(claudeAgentDir, file), content);
      }
      console.log(chalk.green(`  ✓ ${agentFiles.length} agents → ${claudeAgentDir}`));

      // Copy rules
      const rulesDir = join(CONFIG_DIR, 'rules');
      if (existsSync(rulesDir)) {
        const claudeRulesDir = join(claudeDir, 'rules');
        mkdirSync(claudeRulesDir, { recursive: true });
        const rules = readdirSync(rulesDir).filter(f => f.endsWith('.md'));
        for (const file of rules) {
          const content = readFileSync(join(rulesDir, file), 'utf-8');
          writeFileSync(join(claudeRulesDir, file), content);
        }
        console.log(chalk.green(`  ✓ ${rules.length} rules → ${claudeRulesDir}`));
      }

      break;
    }

    case 'cursor': {
      const cursorDir = join(HOME, '.cursor');

      // Convert agents to .cursor/rules/ format
      const cursorRulesDir = join(cursorDir, 'rules');
      mkdirSync(cursorRulesDir, { recursive: true });

      for (const file of agentFiles) {
        const content = readFileSync(join(CONFIG_DIR, 'agents', file), 'utf-8');
        // Cursor uses YAML frontmatter .mdc files
        const name = file.replace('.md', '');
        const cursorContent = `---
description: ${name} agent from BizarHarness
globs: **/*
---
${content}
`;
        writeFileSync(join(cursorRulesDir, `${name}.mdc`), cursorContent);
      }
      console.log(chalk.green(`  ✓ ${agentFiles.length} agents → ${cursorRulesDir} (as .mdc rules)`));

      break;
    }

    case 'opencode': {
      console.log(chalk.dim('  Already configured for opencode. Run `bizar` for interactive setup.'));
      break;
    }
  }
}
