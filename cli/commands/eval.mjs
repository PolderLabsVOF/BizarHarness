/**
 * cli/commands/eval.mjs
 *
 * v5.0.0 — Eval framework CLI.
 *
 * Subcommands:
 *   bizar eval list [--limit N]              List recent runs
 *   bizar eval run <suite-path> [--concurrency N] [--agent thor]  Run a suite
 *   bizar eval show <run-id>                Show run details
 *   bizar eval diff <run-id-1> <run-id-2>  Compare two runs
 *   bizar eval init <path>                  Scaffold a new fixture template
 *   bizar eval validate <fixture-path>     Validate fixture JSON
 */
import chalk from 'chalk';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// Mirror `readDashboardConn` from clip.mjs / minimax.mjs / usage.mjs.
function readDashboardConn() {
  const cfgDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
  const portPath = join(cfgDir, 'dashboard.port');
  const secretPath = join(cfgDir, 'dashboard.secret');
  const port = existsSync(portPath)
    ? parseInt(readFileSync(portPath, 'utf8').trim(), 10)
    : 4321;
  const secret = existsSync(secretPath)
    ? readFileSync(secretPath, 'utf8').trim()
    : '';
  return {
    port: Number.isFinite(port) && port > 0 ? port : 4321,
    secret,
  };
}

const HOME = homedir();
const TEMPLATES_DIR = join(HOME, '.config', 'bizar', 'templates', 'eval-fixtures');

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

async function apiPost(path, body = {}) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

// ── Help ──────────────────────────────────────────────────────────────────────

export function showEvalHelp() {
  console.log(`
  bizar eval — Evaluate AI agent outputs against golden fixtures

  Usage:
    bizar eval list [--limit N]                   List recent runs (default limit 20)
    bizar eval run <suite-path> [--concurrency N] [--agent thor]
                                                    Run a fixture suite
    bizar eval show <run-id>                     Show run details + results
    bizar eval diff <run-id-1> <run-id-2>        Diff two runs
    bizar eval init <path>                       Scaffold a new fixture template
    bizar eval validate <fixture-path>            Validate fixture JSON

  Examples:
    bizar eval list
    bizar eval run ./templates/eval-fixtures
    bizar eval show run_2026-07-05
    bizar eval diff run_2026-07-05 run_2026-07-04
  `);
}

// ── Subcommand handlers ────────────────────────────────────────────────────────

async function listRuns(args) {
  const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '20', 10);
  const data = await apiGet(`/api/eval/runs?limit=${limit}`);
  if (!data.runs || data.runs.length === 0) {
    console.log('  No eval runs found.');
    return;
  }
  console.log('');
  console.log(chalk.bold('  Recent Eval Runs'));
  console.log('');
  for (const run of data.runs) {
    const date = new Date(run.startedAt).toLocaleString();
    const passPct = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
    const ok = run.failed === 0;
    console.log(`  ${chalk[ok ? 'green' : 'red']('●')} ${chalk.bold(run.id)}`);
    console.log(`    ${date}  ${run.passed}/${run.total} passed (${passPct}%)  [${run.suitePath}]`);
    console.log('');
  }
}

async function runSuite(args) {
  const positional = args.filter((a) => !a.startsWith('-'));
  const suitePath = positional[0];
  if (!suitePath) {
    console.error(chalk.red('  Error: suite-path is required'));
    console.error('  Usage: bizar eval run <suite-path> [--concurrency N] [--agent thor]');
    process.exit(1);
  }

  const concurrency = parseInt(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);
  const agent = args.find((a) => a.startsWith('--agent='))?.split('=')[1] || 'thor';

  console.log(chalk.bold(`  Running eval suite: ${suitePath}`));
  console.log(`  Concurrency: ${concurrency}  Agent: ${agent}`);
  console.log('');

  try {
    const result = await apiPost('/api/eval/run', { suitePath, concurrency, agent });
    const passPct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
    console.log('');
    if (result.failed === 0) {
      console.log(chalk.green(`  ✓ All ${result.total} fixtures passed (${passPct}%)`));
    } else {
      console.log(chalk.red(`  ✗ ${result.failed}/${result.total} fixtures failed (${passPct}% passed)`));
      // Print failures
      for (const r of result.results) {
        if (!r.ok) {
          console.log('');
          console.log(`  ${chalk.red('✗')} ${chalk.bold(r.fixtureId)}`);
          for (const c of r.checks) {
            if (!c.ok) {
              console.log(`    ${chalk.red('  FAIL')} ${c.kind}: ${c.message}`);
            }
          }
        }
      }
    }
    console.log('');
    console.log(`  Run ID: ${result.id}`);
    console.log(`  Duration: ${result.finishedAt && result.startedAt ? Math.round((new Date(result.finishedAt) - new Date(result.startedAt)) / 1000) + 's' : '—'}`);
    console.log('');
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to run suite: ${err.message}`));
    process.exit(1);
  }
}

async function showRun(runId) {
  if (!runId) {
    console.error(chalk.red('  Error: run-id is required'));
    console.error('  Usage: bizar eval show <run-id>');
    process.exit(1);
  }
  try {
    const result = await apiGet(`/api/eval/runs/${encodeURIComponent(runId)}`);
    console.log('');
    console.log(chalk.bold(`  Eval Run: ${result.id}`));
    console.log('');
    console.log(`  Suite:   ${result.suitePath}`);
    console.log(`  Started:  ${new Date(result.startedAt).toLocaleString()}`);
    console.log(`  Finished: ${new Date(result.finishedAt).toLocaleString()}`);
    console.log(`  Result:  ${chalk[result.failed === 0 ? 'green' : 'red'](`${result.passed}/${result.total} passed`)}`);
    console.log('');
    console.log(chalk.bold('  Results:'));
    console.log('');
    for (const r of result.results) {
      const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
      const latency = r.latencyMs ? `${Math.round(r.latencyMs)}ms` : '—';
      console.log(`  ${icon} ${chalk.bold(r.fixtureId)}  [${latency}]`);
      if (!r.ok) {
        for (const c of r.checks) {
          if (!c.ok) {
            console.log(`      ${chalk.red('FAIL')} ${c.kind}: ${c.message}`);
          }
        }
      }
    }
    console.log('');
  } catch (err) {
    if (err.message.includes('404')) {
      console.error(chalk.red(`  Error: run ${runId} not found`));
    } else {
      console.error(chalk.red(`  ✗ Failed to show run: ${err.message}`));
    }
    process.exit(1);
  }
}

async function diffRuns(args) {
  const [id1, id2] = args;
  if (!id1 || !id2) {
    console.error(chalk.red('  Error: two run IDs are required'));
    console.error('  Usage: bizar eval diff <run-id-1> <run-id-2>');
    process.exit(1);
  }
  try {
    const diff = await apiGet(`/api/eval/runs/${encodeURIComponent(id1)}/compare/${encodeURIComponent(id2)}`);
    console.log('');
    console.log(chalk.bold(`  Diff: ${id1} vs ${id2}`));
    console.log('');

    if (diff.improved?.length > 0) {
      console.log(chalk.green('  Improved:'));
      for (const item of diff.improved) {
        console.log(`    ${chalk.green('↑')} ${item.fixtureId}  (was ${item.run1Ok ? 'pass' : 'fail'}, now ${item.run2Ok ? 'pass' : 'fail'})`);
      }
      console.log('');
    }

    if (diff.regressed?.length > 0) {
      console.log(chalk.red('  Regressed:'));
      for (const item of diff.regressed) {
        console.log(`    ${chalk.red('↓')} ${item.fixtureId}  (was ${item.run1Ok ? 'pass' : 'fail'}, now ${item.run2Ok ? 'pass' : 'fail'})`);
      }
      console.log('');
    }

    if (diff.unchanged?.length > 0) {
      console.log(chalk.dim('  Unchanged:'));
      for (const item of diff.unchanged) {
        console.log(`    ${chalk.dim('→')} ${item.fixtureId}  (${item.run1Ok ? 'pass' : 'fail'})`);
      }
      console.log('');
    }

    if (diff.improved?.length === 0 && diff.regressed?.length === 0 && diff.unchanged?.length === 0) {
      console.log('  No fixtures to compare.');
      console.log('');
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to diff runs: ${err.message}`));
    process.exit(1);
  }
}

function initFixture(path) {
  if (!path) {
    console.error(chalk.red('  Error: path is required'));
    console.error('  Usage: bizar eval init <path>');
    process.exit(1);
  }
  mkdirSync(path, { recursive: true });

  const template = {
    id: 'my-fixture-id',
    name: 'My Fixture',
    description: 'Describe what this fixture verifies',
    agent: 'thor',
    prompt: 'What should the agent do?',
    expected: {
      contains: ['expected output fragment'],
      notContains: ['unexpected output fragment'],
      regex: ['expected regex pattern'],
      jsonSchema: null,
      maxTokens: 2000,
      maxLatencyMs: 30000,
    },
    tags: ['smoke', 'my-tag'],
  };

  const fixturePath = join(path, 'my-fixture.json');
  writeFileSync(fixturePath, JSON.stringify(template, null, 2) + '\n', 'utf8');

  const readmeContent = `# Eval Fixtures

  This directory contains fixture definitions for the BizarHarness eval framework.

  ## Structure

  Each \`.json\` file is a fixture with:
  - \`id\` — unique identifier
  - \`name\` — human-readable name
  - \`description\` — what the fixture verifies
  - \`agent\` — agent to use (thor, tyr, etc.)
  - \`prompt\` — the prompt to send
  - \`expected\` — validation rules (contains, notContains, regex, jsonSchema, maxTokens, maxLatencyMs)
  - \`tags\` — optional tags for filtering

  ## Running

  \`\`\`bash
  bizar eval run ./path/to/fixtures
  \`\`\`
  `;
  const readmePath = join(path, 'README.md');
  writeFileSync(readmePath, readmeContent, 'utf8');

  console.log(chalk.green(`  ✓ Fixture scaffold created at ${path}`));
  console.log(`  Created: ${fixturePath}`);
  console.log(`  Created: ${readmePath}`);
  console.log('');
}

function validateFixture(path) {
  if (!path) {
    console.error(chalk.red('  Error: fixture path is required'));
    console.error('  Usage: bizar eval validate <fixture-path>');
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(chalk.red(`  ✗ File not found: ${path}`));
    process.exit(1);
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const fixture = JSON.parse(raw);

    // Validate required fields
    const required = ['id', 'name', 'description', 'agent', 'prompt', 'expected'];
    const missing = required.filter((f) => !fixture[f]);
    if (missing.length > 0) {
      console.error(chalk.red(`  ✗ Validation failed. Missing required fields: ${missing.join(', ')}`));
      process.exit(1);
    }

    // Validate expected shape
    const expected = fixture.expected;
    if (typeof expected !== 'object') {
      console.error(chalk.red('  ✗ Validation failed: expected must be an object'));
      process.exit(1);
    }

    console.log(chalk.green(`  ✓ Fixture is valid: ${fixture.id}`));
    console.log('');
    console.log(`  ID:          ${fixture.id}`);
    console.log(`  Name:        ${fixture.name}`);
    console.log(`  Agent:       ${fixture.agent}`);
    console.log(`  Tags:        ${fixture.tags?.join(', ') || 'none'}`);
    console.log(`  Max Tokens:  ${expected.maxTokens ?? 'unlimited'}`);
    console.log(`  Max Latency: ${expected.maxLatencyMs ? `${expected.maxLatencyMs}ms` : 'unlimited'}`);
    console.log(`  Contains:    ${expected.contains?.length ?? 0} patterns`);
    console.log(`  Not Contains: ${expected.notContains?.length ?? 0} patterns`);
    console.log(`  Regex:       ${expected.regex?.length ?? 0} patterns`);
    console.log(`  JSON Schema: ${expected.jsonSchema ? 'yes' : 'no'}`);
    console.log('');
  } catch (err) {
    if (err.message.includes('JSON')) {
      console.error(chalk.red(`  ✗ Invalid JSON: ${err.message}`));
    } else {
      console.error(chalk.red(`  ✗ Validation failed: ${err.message}`));
    }
    process.exit(1);
  }
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  const sub = args[0];
  const subArgs = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h' || isHelpRequest) {
    showEvalHelp();
    return;
  }

  switch (sub) {
    case 'list':
      await listRuns(subArgs);
      break;
    case 'run':
      await runSuite(subArgs);
      break;
    case 'show':
      await showRun(subArgs[0]);
      break;
    case 'diff':
      await diffRuns(subArgs);
      break;
    case 'init':
      initFixture(subArgs[0]);
      break;
    case 'validate':
      validateFixture(subArgs[0]);
      break;
    default:
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showEvalHelp();
      process.exit(1);
  }
}
