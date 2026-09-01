/**
 * GitHub issue root-cause analysis through Claude Code print mode.
 *
 * The analysis runs in plan permission mode: it may inspect the trusted
 * repository but cannot mutate it. `gh issue view` supplies authoritative
 * issue metadata before Claude is invoked.
 */
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';

export function parseIssueUrl(value) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/.exec(value || '');
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: match[3] };
}

export function showRcaHelp() {
  console.log(`
  bizar rca — Analyze a GitHub issue with Claude Code

  Usage:
    bizar rca <github-issue-url> [focus]

  The command fetches issue metadata with gh, then runs Claude Code in
  non-interactive plan mode. It performs no repository mutation.
  Requirements: gh and claude on PATH.
  `);
}

function available(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
  return probe.status === 0;
}

export function buildRcaPrompt(issue, focus = '') {
  return [
    'Perform a root-cause analysis for the following GitHub issue.',
    'Inspect the current repository as needed. Do not modify files.',
    'Return: symptoms, evidence, ranked hypotheses, likely root cause, affected files, repair plan, and verification plan.',
    focus ? `Additional focus: ${focus}` : '',
    'Issue JSON:',
    issue,
  ].filter(Boolean).join('\n\n');
}

export async function runRca(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    showRcaHelp();
    return { ok: true };
  }
  const [url, ...focusParts] = args;
  const parsed = parseIssueUrl(url);
  if (!parsed) {
    console.error(chalk.red('  ✗ Expected https://github.com/<owner>/<repo>/issues/<number>'));
    return { ok: false, error: 'invalid issue URL' };
  }
  const missing = ['gh', 'claude'].filter((command) => !available(command));
  if (missing.length) {
    console.error(chalk.red(`  ✗ Missing required command(s): ${missing.join(', ')}`));
    return { ok: false, error: `missing ${missing.join(', ')}` };
  }

  const issueResult = spawnSync('gh', [
    'issue', 'view', parsed.number,
    '--repo', `${parsed.owner}/${parsed.repo}`,
    '--json', 'number,title,body,state,labels,assignees,author,url',
  ], { encoding: 'utf8', timeout: 30_000 });
  if (issueResult.status !== 0) {
    const error = (issueResult.stderr || issueResult.stdout || 'gh issue view failed').trim();
    console.error(chalk.red(`  ✗ ${error}`));
    return { ok: false, error };
  }

  const prompt = buildRcaPrompt(issueResult.stdout, focusParts.join(' '));
  const analysis = spawnSync('claude', [
    '-p',
    '--permission-mode', 'plan',
    '--output-format', 'text',
    '--no-session-persistence',
    prompt,
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 10 * 60_000 });
  if (analysis.status !== 0) {
    const error = (analysis.stderr || analysis.stdout || `claude exited ${analysis.status}`).trim();
    console.error(chalk.red(`  ✗ ${error}`));
    return { ok: false, error };
  }
  process.stdout.write(analysis.stdout);
  return { ok: true, output: analysis.stdout };
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'rca') return false;
  if (isHelpRequest) showRcaHelp();
  else {
    const result = await runRca(args);
    if (!result.ok) process.exitCode = 1;
  }
  return true;
}
