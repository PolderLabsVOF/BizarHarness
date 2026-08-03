import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfigDir } from './utils.mjs';

const CONFIG_DIR = claudeConfigDir();

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  return match?.[1] || '';
}

export async function runAudit() {
  // F-146 — machine-readable JSON branch for `bizar_audit` MCP tool.
  // Must short-circuit BEFORE any human-formatted console output so the
  // tool result is pure JSON.
  const jsonMode = process.argv.includes('--json');

  const emit = (line) => { if (!jsonMode) console.log(line); };
  if (!jsonMode) emit(chalk.bold.cyan('\n  BIZARHARNESS AGENT AUDIT\n'));
  const agentsDir = join(CONFIG_DIR, 'agents');
  if (!existsSync(agentsDir)) {
    const result = { issues: [{ path: agentsDir, severity: 'HIGH', msg: 'agents directory missing' }], warnings: [], score: 0 };
    emit(chalk.red(`  ✗ No agents directory found at ${agentsDir}`));
    if (jsonMode) process.stdout.write(JSON.stringify(result));
    return result;
  }

  const issues = [];
  const warnings = [];
  const files = readdirSync(agentsDir).filter((file) => file.endsWith('.md'));
  for (const file of files) {
    const path = join(agentsDir, file);
    const text = readFileSync(path, 'utf8');
    const meta = frontmatter(text);
    if (!meta) issues.push({ path, severity: 'HIGH', msg: 'missing YAML frontmatter' });
    for (const field of ['name:', 'description:', 'tools:', 'model:']) {
      if (!meta.includes(field)) warnings.push({ path, severity: 'WARN', msg: `missing ${field.slice(0, -1)} field` });
    }
    if (/(?:sk-[A-Za-z0-9_-]{20,}|api[-_]?key\s*[:=]\s*["'][^"']{12,})/i.test(text)) {
      issues.push({ path, severity: 'CRITICAL', msg: 'possible embedded credential' });
    }

    const tools = meta.match(/^tools:\s*(.+)$/m)?.[1] || '';
    if (file === 'office-manager.md' && /\b(?:Bash|Edit|Write)\b/.test(tools)) {
      issues.push({ path, severity: 'HIGH', msg: 'primary router has execution tools' });
    }
    if (['qa-reviewer.md', 'research-analyst.md'].includes(file) && /\b(?:Edit|Write)\b/.test(tools)) {
      issues.push({ path, severity: 'HIGH', msg: 'read-only reviewer has mutation tools' });
    }
  }

  for (const item of issues) emit(chalk.red(`  ✗ ${item.severity} ${item.path}: ${item.msg}`));
  for (const item of warnings) emit(chalk.yellow(`  ⚠ ${item.path}: ${item.msg}`));
  const score = Math.max(0, 100 - issues.length * 15 - warnings.length * 3);
  emit(`\n  Security score: ${score}/100 (${files.length} agents)\n`);
  const result = { issues, warnings, score, totalIssues: issues.length, totalWarnings: warnings.length };
  if (jsonMode) process.stdout.write(JSON.stringify(result));
  return result;
}