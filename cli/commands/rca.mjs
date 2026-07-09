#!/usr/bin/env node
/**
 * cli/commands/rca.mjs
 *
 * v6.2.3 — `bizar rca <github-issue-url> [prompt]`
 *
 * Adapted from the Cline CLI sample "GitHub Issue RCA"
 * (https://docs.cline.bot/cli/samples/). Analyzes a GitHub issue
 * using Cline CLI and outputs a root-cause report.
 *
 * Equivalent shell script:
 *   cline --auto-approve true --json "$PROMPT: $ISSUE_URL" | \
 *     jq -r 'select(.type == "agent_event" and .event.type == "done") | .event.text' | \
 *     sed 's/\\n/\n/g'
 *
 * This implementation:
 *   1. Spawns `gh issue view` to fetch the issue body
 *   2. Spawns `cline --auto-approve true --json` with the issue content + prompt
 *   3. Streams the analysis to stdout as plain text
 *
 * Requirements: gh CLI, jq, cline on PATH
 */
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { existsSync } from 'node:fs';

const DEFAULT_PROMPT = 'What is the root cause of this issue?';

export function showRcaHelp() {
  console.log(`
  bizar rca — Analyze a GitHub issue with Cline CLI (root-cause analysis)

  Usage:
    bizar rca <github-issue-url> [prompt]
    bizar rca --help

  Examples:
    bizar rca https://github.com/owner/repo/issues/123
    bizar rca https://github.com/owner/repo/issues/456 "What is the security impact?"
    bizar rca https://github.com/owner/repo/issues/789 "What are the migration steps?"

  Description:
    Fetches the GitHub issue via \`gh issue view\`, then asks Cline
    CLI to analyze it with the given prompt. Outputs a structured
    root-cause report. Based on the official Cline CLI sample.

  Requirements:
    - \`gh\` CLI installed and authenticated
    - \`jq\` installed
    - \`cline\` on PATH
  `);
}

function which(bin) {
  // Lightweight `which` — works on Linux + macOS.
  const path = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of path.split(sep)) {
    const full = dir.endsWith('/') || dir.endsWith('\\') ? dir + bin : dir + '/' + bin;
    if (existsSync(full)) return full;
  }
  return null;
}

function checkPrereqs() {
  const missing = [];
  if (!which('gh')) missing.push('gh (GitHub CLI)');
  if (!which('jq')) missing.push('jq');
  if (!which('cline')) missing.push('cline');
  if (missing.length > 0) {
    console.error(chalk.red(`\n  ✗ Missing prerequisites: ${missing.join(', ')}`));
    console.error(chalk.dim('    Install them first, then re-run.'));
    return false;
  }
  return true;
}

function spawnSyncCapture(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      ...opts,
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited with code ${code}`));
    });
  });
}

function spawnStreaming(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

function extractFinalText(jsonl) {
  // Stream of NDJSON lines. Pull the last "agent_event" with type "done"
  // and return its text. Falls back to concatenating all "say" events.
  const lines = jsonl.split('\n').filter(Boolean);
  let finalText = null;
  const seen = [];
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'agent_event' && evt.event?.type === 'done' && evt.event?.text) {
        finalText = evt.event.text;
      } else if (evt.type === 'say' && evt.text) {
        seen.push(evt.text);
      }
    } catch { /* skip malformed line */ }
  }
  if (finalText) return finalText.replace(/\\n/g, '\n');
  if (seen.length > 0) return seen.join('\n').replace(/\\n/g, '\n');
  return null;
}

export async function runRca(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    showRcaHelp();
    return;
  }
  if (args.length === 0) {
    showRcaHelp();
    process.exit(2);
  }
  const issueUrl = args[0];
  const prompt = args[1] || DEFAULT_PROMPT;

  if (!checkPrereqs()) process.exit(1);

  // Validate URL shape
  if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(issueUrl)) {
    console.error(chalk.red(`\n  ✗ Not a GitHub issue URL: ${issueUrl}`));
    console.error(chalk.dim('    Expected: https://github.com/<owner>/<repo>/issues/<n>'));
    process.exit(2);
  }

  console.log(chalk.cyan(`\n  🔍 Fetching ${issueUrl} ...\n`));

  // 1. Fetch the issue via gh CLI
  let issueText;
  try {
    issueText = await spawnSyncCapture('gh', [
      'issue', 'view', issueUrl, '--json', 'title,body,labels,comments',
    ]);
  } catch (err) {
    console.error(chalk.red(`  ✗ gh issue view failed: ${err.message}`));
    process.exit(1);
  }
  console.log(chalk.dim(`  (${issueText.length} chars of issue context)\n`));

  // 2. Spawn Cline with the issue + prompt
  const clinePrompt = `${prompt}\n\nGitHub issue: ${issueUrl}\n\nIssue context:\n${issueText}`;

  console.log(chalk.cyan(`  🤖 Asking Cline to analyze: "${prompt}"\n`));

  // We capture Cline's stdout so we can extract the final text and
  // re-emit it cleanly.
  const child = spawn('cline', [
    '--auto-approve', 'true',
    '--json',
    clinePrompt,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  let clineStdout = '';
  child.stdout.on('data', (chunk) => { clineStdout += chunk.toString('utf8'); });

  const code = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c ?? 0));
  });

  // 3. Extract and print the final analysis
  const finalText = extractFinalText(clineStdout);
  if (finalText) {
    console.log('\n' + chalk.bold.cyan('  ─── Root-Cause Analysis ─────────────────────────────────') + '\n');
    console.log(finalText);
    console.log('\n' + chalk.bold.cyan('  ─────────────────────────────────────────────────────────────') + '\n');
  } else if (code === 0) {
    console.log(chalk.dim('  (Cline returned 0 but no final text was found in --json output.)'));
    console.log(chalk.dim('  Try running again without --json for verbose output.'));
  }

  process.exit(code);
}

// ── run() entry point (used by bin.mjs dispatcher) ─────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'rca') return false;
  await runRca(args);
  return true;
}