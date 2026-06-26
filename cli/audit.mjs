import chalk from 'chalk';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { opencodeConfigDir } from './utils.mjs';

const CONFIG_DIR = opencodeConfigDir();

export async function runAudit() {
  console.log(chalk.bold.hex('#ef4444')('\n  ⚔  BIZARHARNESS AUDIT ⚔\n'));
  console.log(chalk.dim('  Scanning agent configuration for security and correctness issues...\n'));

  const agentsDir = join(CONFIG_DIR, 'agents');
  if (!existsSync(agentsDir)) {
    console.log(chalk.yellow('  ✗ No agents directory found at', agentsDir));
    return;
  }

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  let totalIssues = 0;
  let totalWarnings = 0;

  const issues = [];
  const warnings = [];

  for (const file of files) {
    const content = readFileSync(join(agentsDir, file), 'utf-8');
    const path = `agents/${file}`;
    const lines = content.split('\n');

    // Check 1: Dangerous bash permissions on review-only agents
    if (file.includes('forseti') || file.includes('semble-search')) {
      if (content.includes('bash: allow')) {
        issues.push({ path, severity: 'HIGH', msg: 'Review-only agent has bash permission' });
      }
      if (content.includes('edit: allow')) {
        issues.push({ path, severity: 'HIGH', msg: 'Review-only agent has edit permission — should be edit: deny' });
      }
    }

    // Check 2: Frigg should never have edit/write
    if (file.includes('frigg')) {
      if (content.includes('edit: allow')) {
        issues.push({ path, severity: 'HIGH', msg: 'Read-only Q&A agent (Frigg) has edit permission' });
      }
      if (content.includes('write: allow')) {
        issues.push({ path, severity: 'HIGH', msg: 'Read-only Q&A agent (Frigg) has write permission' });
      }
    }

    // Check 3: Odin should have minimal permissions
    if (file.includes('odin')) {
      const dangerousForOdin = ['bash', 'edit', 'write', 'glob', 'grep', 'question'];
      for (const tool of dangerousForOdin) {
        if (content.includes(`${tool}: allow`)) {
          issues.push({ path, severity: 'HIGH', msg: `Odin has ${tool} permission but should be pure router` });
        }
      }
    }

    // Check 4: API keys in agent descriptions or content
    const apiKeyPatterns = [
      /sk-[a-zA-Z0-9]{20,}/g,
      /api[-_]?key['":]?\s*['"][a-zA-Z0-9_\-]{16,}/gi,
      /AIza[0-9A-Za-z\-_]{35}/g,
    ];
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of apiKeyPatterns) {
        const matches = lines[i].match(pattern);
        if (matches) {
          issues.push({ path, severity: 'CRITICAL', line: i + 1, msg: 'Possible API key exposed in agent content' });
        }
      }
    }

    // Check 5: Model validation
    const modelMatch = content.match(/^model:\s*(.+)$/m);
    if (modelMatch) {
      const model = modelMatch[1].trim();
      const validModels = [
        'opencode/deepseek-v4-flash-free',
        'minimax/MiniMax-M2.7',
        'minimax/MiniMax-M3',
      ];
      if (!validModels.includes(model)) {
        warnings.push({ path, severity: 'WARN', msg: `Unknown model: ${model}` });
      }
    }

    // Check 6: Missing model field
    if (!content.includes('model:')) {
      warnings.push({ path, severity: 'WARN', msg: 'Missing model field' });
    }

    // Check 7: Missing description
    if (!content.includes('description:')) {
      warnings.push({ path, severity: 'WARN', msg: 'Missing description field' });
    }
  }

  // Check 8: AGENTS.md exists
  const agentsMd = join(CONFIG_DIR, 'AGENTS.md');
  if (!existsSync(agentsMd)) {
    issues.push({ path: 'AGENTS.md', severity: 'HIGH', msg: 'AGENTS.md routing table not found' });
  }

  // Check 9: Rules directory
  const rulesDir = join(CONFIG_DIR, 'rules');
  if (!existsSync(rulesDir)) {
    warnings.push({ path: 'rules/', severity: 'WARN', msg: 'Rules directory not found' });
  }

  // Print results
  for (const item of issues) {
    totalIssues++;
    const icon = item.severity === 'CRITICAL' ? '🔥' : '⚠';
    const color = item.severity === 'CRITICAL' ? chalk.red : item.severity === 'HIGH' ? chalk.hex('#f59e0b') : chalk.yellow;
    console.log(`  ${icon} ${color(item.severity.padEnd(8))} ${chalk.dim(item.path)}${item.line ? chalk.dim(`:${item.line}`) : ''}`);
    console.log(chalk.dim(`     ${item.msg}`));
  }

  for (const item of warnings) {
    totalWarnings++;
    console.log(`  ⓘ  ${chalk.cyan('INFO'.padEnd(8))} ${chalk.dim(item.path)}`);
    console.log(chalk.dim(`     ${item.msg}`));
  }

  console.log();
  if (totalIssues === 0 && totalWarnings === 0) {
    console.log(chalk.green('  ✓ No issues found. Configuration looks clean.\n'));
  } else {
    console.log(chalk[totalIssues > 0 ? 'red' : 'yellow'](
      `  Found ${totalIssues} issue(s) and ${totalWarnings} warning(s).\n`
    ));
  }

  const score = Math.max(0, Math.round(100 - (totalIssues * 15 + totalWarnings * 5)));
  const scoreColor = score >= 90 ? chalk.green : score >= 70 ? chalk.hex('#f59e0b') : chalk.red;
  console.log(chalk.bold(`  Security Score: ${scoreColor(`${score}/100`)}\n`));

  return { issues, warnings, score, totalIssues, totalWarnings };
}
