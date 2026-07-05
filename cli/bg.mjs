#!/usr/bin/env node
/**
 * cli/bg.mjs
 *
 * v3.11.1 — `bizar bg` (background agent) CLI.
 *
 * Manages and inspects background agents spawned by the opencode
 * plugin (plugins/bizar/src/tools/bg-spawn.ts) and the dashboard
 * (bizar-dash/src/server/task-delegator.mjs).
 *
 * Subcommands:
 *   list               List all running background agents
 *   status <id>        Show status of a specific agent
 *   view               Open a desktop window with tmux splits of all running agents
 *   kill <id>          Kill a running agent
 *   logs <id>          Tail the agent's log file
 *
 * The "view" subcommand (v3.22) is the headline feature: it creates a
 * tmux control session (`bizar-bg-view`) with one pane per running
 * agent (each pane attached to the agent's own tmux session, tiled).
 * This is the antidote to "is the agent doing anything?" — you can
 * SEE them all working in parallel.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { whichPath } from './utils.mjs';

const BG_DIRS = [
  join(homedir(), '.cache', 'bizar', 'bg'),
  join(homedir(), '.config', 'opencode', 'bg'),
  join(homedir(), '.bizar', 'bg'),
];

/**
 * Read every bg state file. Returns an array of { file, data }.
 * Fields:
 *   instanceId, sessionId, projectId, worktree, agent, parentAgent,
 *   status, startedAt, lastActivityAt, toolCallCount, promptPreview,
 *   taskId, mainTaskId, dispatchPending, error
 */
function readAllBgInstances() {
  const out = [];
  for (const dir of BG_DIRS) {
    if (!existsSync(dir)) continue;
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const full = join(dir, f);
        const st = statSync(full);
        const data = JSON.parse(readFileSync(full, 'utf8'));
        out.push({ file: full, data, _mtime: st.mtimeMs });
      } catch {
        /* skip corrupt */
      }
    }
  }
  out.sort((a, b) => (b.data.startedAt || b._mtime || 0) - (a.data.startedAt || a._mtime || 0));
  return out;
}

/**
 * Map an opencode sessionId to the tmux session name used by
 * task-delegator.mjs: `bgr_<first 16 chars of sessionId>`.
 */
function tmuxSessionForSessionId(sessionId) {
  if (!sessionId) return null;
  return `bgr_${sessionId.slice(0, 16)}`;
}

/**
 * List tmux sessions matching the bgr_ prefix.
 */
function listBgrTmuxSessions() {
  if (!whichPath('tmux')) return [];
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('bgr_') && l !== 'bgr_view');
  } catch {
    // tmux returns exit 1 if no server is running
    return [];
  }
}

// --- Subcommand handlers ---------------------------------------------------

async function runList() {
  const all = readAllBgInstances();
  const tmux = listBgrTmuxSessions();
  if (all.length === 0) {
    console.log(chalk.dim('\n  No background agents found.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Background agents (${all.length}):\n`));
  const rows = all.map((e) => {
    const d = e.data;
    return {
      instanceId: d.instanceId,
      sessionId: d.sessionId,
      agent: d.agent,
      status: d.status,
      taskId: d.taskId || '-',
      preview: (d.promptPreview || '').slice(0, 40),
      tmux: d.sessionId ? tmuxSessionForSessionId(d.sessionId) : '-',
      tmuxAlive: d.sessionId ? tmux.includes(tmuxSessionForSessionId(d.sessionId)) : false,
    };
  });

  // Pretty print
  const idW = Math.max(10, ...rows.map((r) => r.instanceId.length));
  const agentW = Math.max(6, ...rows.map((r) => r.agent.length));
  const statusW = Math.max(6, ...rows.map((r) => r.status.length));
  const tmuxW = Math.max(20, ...rows.map((r) => r.tmux.length));

  for (const r of rows) {
    const statusColor = r.status === 'running' || r.status === 'pending'
      ? chalk.green
      : r.status === 'failed' || r.status === 'timed_out'
      ? chalk.red
      : r.status === 'killed'
      ? chalk.yellow
      : chalk.gray;
    const tmuxTag = r.tmuxAlive ? chalk.green(r.tmux) : chalk.dim(r.tmux);
    console.log(
      '  ' +
        r.instanceId.padEnd(idW) +
        '  ' +
        r.agent.padEnd(agentW) +
        '  ' +
        statusColor(r.status.padEnd(statusW)) +
        '  ' +
        tmuxTag.padEnd(tmuxW + (r.tmuxAlive ? 0 : 10)) +
        '  ' +
        chalk.dim(r.preview),
    );
  }
  console.log(chalk.dim(`\n  tmux sessions tracked: ${tmux.length}\n`));
  console.log(chalk.dim('  Run `bizar bg view` to open all running agents in one window.\n'));
}

async function runStatus(instanceId) {
  const all = readAllBgInstances();
  const found = all.find((e) => e.data.instanceId === instanceId || e.data.sessionId?.includes(instanceId));
  if (!found) {
    console.log(chalk.red(`\n  ✗ No bg instance matches "${instanceId}"\n`));
    return 1;
  }
  const d = found.data;
  console.log(chalk.bold(`\n  Background agent: ${d.instanceId}\n`));
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue;
    console.log('  ' + chalk.dim(k.padEnd(18)) + JSON.stringify(v));
  }
  if (d.sessionId) {
    const tmuxName = tmuxSessionForSessionId(d.sessionId);
    console.log(chalk.dim('\n  tmux:'));
    try {
      execFileSync('tmux', ['has-session', '-t', tmuxName], { stdio: 'pipe' });
      console.log(`    ${chalk.green('●')} ${tmuxName} (running — \`tmux attach -t ${tmuxName}\` to view)`);
    } catch {
      console.log(`    ${chalk.dim('○')} ${tmuxName} (not running)`);
    }
  }
  console.log();
  return 0;
}

async function runLogs(instanceId) {
  const all = readAllBgInstances();
  const found = all.find((e) => e.data.instanceId === instanceId || e.data.sessionId?.includes(instanceId));
  if (!found) {
    console.log(chalk.red(`\n  ✗ No bg instance matches "${instanceId}"\n`));
    return 1;
  }
  const logPath = found.data.logPath;
  if (!logPath || !existsSync(logPath)) {
    console.log(chalk.red(`\n  ✗ Log file not found: ${logPath}\n`));
    return 1;
  }
  console.log(chalk.dim(`  Tailing ${logPath} (Ctrl-C to exit)\n`));
  const child = spawn('tail', ['-n', '50', '-F', logPath], { stdio: 'inherit' });
  return new Promise((resolve) => {
    child.on('exit', () => resolve(0));
  });
}

async function runKill(instanceId) {
  const all = readAllBgInstances();
  const found = all.find((e) => e.data.instanceId === instanceId || e.data.sessionId?.includes(instanceId));
  if (!found) {
    console.log(chalk.red(`\n  ✗ No bg instance matches "${instanceId}"\n`));
    return 1;
  }
  const d = found.data;
  // 1. Kill the tmux session if alive.
  if (d.sessionId) {
    const tmuxName = tmuxSessionForSessionId(d.sessionId);
    try {
      execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'pipe' });
      console.log(chalk.green(`  ✓ Killed tmux session ${tmuxName}`));
    } catch {
      // not running
    }
  }
  // 2. Mark the bg state file as killed.
  try {
    const updated = { ...d, status: 'killed', completedAt: Date.now(), error: 'killed via bizar bg kill' };
    const fs = await import('node:fs');
    fs.writeFileSync(found.file, JSON.stringify(updated, null, 2), 'utf8');
    console.log(chalk.green(`  ✓ Marked ${d.instanceId} as killed`));
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Could not update state file: ${err.message}`));
  }
  // 3. Try to kill the process (Bun/Node subprocess).
  if (d.processId && Number.isInteger(d.processId)) {
    try {
      process.kill(d.processId, 'SIGTERM');
      console.log(chalk.green(`  ✓ Sent SIGTERM to pid ${d.processId}`));
    } catch (err) {
      console.log(chalk.dim(`  (could not signal pid ${d.processId}: ${err.message})`));
    }
  }
  console.log();
  return 0;
}

// --- view ----------------------------------------------------------------

/**
 * View subcommand (v3.22):
 *   - Detects tmux. If missing, prints per-instance `bizar bg logs <id>`
 *     fallback instructions and exits 0.
 *   - Creates a fresh tmux control session `bizar-bg-view` with one pane
 *     per running instance, each pane running `tmux attach -t <session>`.
 *   - Caps at 16 panes (beyond that, tmux tiled layout degrades).
 *   - Zero running instances → prints "no running agents" and exits 0.
 */

async function runView() {
  const all = readAllBgInstances();
  const tmuxSessions = listBgrTmuxSessions();
  const running = all.filter(
    (e) => e.data.status === 'running' || e.data.status === 'pending',
  );

  // Zero running agents — not an error.
  if (running.length === 0) {
    console.log(chalk.dim('\n  No running background agents.\n'));
    return 0;
  }

  // Tmux presence check. If missing, print fallback instructions and exit 0
  // (not an error — the operator can still use per-instance logs).
  if (!whichPath('tmux')) {
    console.log(chalk.yellow('\n  ⚠ tmux is not installed on this host.\n'));
    console.log(chalk.dim('  You can inspect individual agents via:\n'));
    for (const r of running) {
      console.log(chalk.cyan(`    bizar bg logs ${r.data.instanceId}`));
    }
    console.log();
    return 0;
  }

  // Filter to instances that actually have a live tmux session.
  const active = running.filter(
    (e) =>
      e.data.sessionId &&
      tmuxSessions.includes(tmuxSessionForSessionId(e.data.sessionId)),
  );

  if (active.length === 0) {
    console.log(chalk.dim('\n  No agents with active tmux sessions found.\n'));
    console.log(chalk.dim('  State files exist but no tmux sessions are running.\n'));
    console.log(chalk.dim('  Run `bizar bg list` to inspect state.\n'));
    return 0;
  }

  // Cap at 16 panes — beyond that, tiled layout is unusable.
  const capped = active.slice(0, 16);
  const overflow = active.length - capped.length;

  // Kill any stale bizar-bg-view session, then create a fresh one.
  try {
    execFileSync('tmux', ['kill-session', '-t', 'bizar-bg-view'], { stdio: 'pipe' });
  } catch {
    /* didn't exist */
  }
  execFileSync('tmux', [
    'new-session', '-d', '-s', 'bizar-bg-view',
    '-x', '220', '-y', '50',
  ], { stdio: 'pipe' });

  // Pane 0 → first instance
  const firstSession = tmuxSessionForSessionId(capped[0].data.sessionId);
  execFileSync('tmux', [
    'send-keys', '-t', 'bizar-bg-view:0.0',
    `tmux attach -t ${firstSession}`, 'Enter',
  ], { stdio: 'pipe' });

  // Split for remaining instances (2..N)
  for (let i = 1; i < capped.length; i++) {
    execFileSync('tmux', ['split-window', '-v', '-t', 'bizar-bg-view'], { stdio: 'pipe' });
    const sessionName = tmuxSessionForSessionId(capped[i].data.sessionId);
    execFileSync('tmux', [
      'send-keys', '-t', `bizar-bg-view:0.${i}`,
      `tmux attach -t ${sessionName}`, 'Enter',
    ], { stdio: 'pipe' });
  }

  // Tiled layout for a clean grid.
  execFileSync('tmux', ['select-layout', '-t', 'bizar-bg-view', 'tiled'], { stdio: 'pipe' });

  console.log(chalk.green(`\n  ✓ Built tmux view session with ${capped.length} pane(s)\n`));

  if (overflow > 0) {
    console.log(chalk.yellow(`  ⚠ ${overflow} more agent(s) not shown (16-pane cap):\n`));
    for (const r of active.slice(16)) {
      const sn = tmuxSessionForSessionId(r.data.sessionId);
      console.log(chalk.dim(`    bizar bg logs ${r.data.instanceId}  —  tmux attach -t ${sn}`));
    }
    console.log();
  }

  // Open an OS terminal window attached to the control session.
  const open = openTerminalAttached('bizar-bg-view');
  if (open.ok) {
    console.log(chalk.green(`  ✓ Opened ${open.terminal} attached to "bizar-bg-view"\n`));
    console.log(chalk.dim('  Tip: `tmux attach -t bizar-bg-view` from any terminal.\n'));
  } else {
    console.log(chalk.yellow(`  ⚠ Could not open terminal: ${open.error}\n`));
    console.log(chalk.dim('  Run in a terminal you can see:\n'));
    console.log(chalk.cyan(`    tmux attach -t bizar-bg-view\n`));
  }

  return 0;
}

/**
 * Open a new OS terminal window attached to the given tmux session.
 * Cross-platform: macOS (osascript/Terminal.app), Linux
 * (gnome-terminal / konsole / xterm).
 */
function openTerminalAttached(tmuxSession) {
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: use AppleScript to open Terminal.app
    const script = `tell application "Terminal" to do script "tmux attach -t ${tmuxSession}"; activate application "Terminal"`;
    try {
      execFileSync('osascript', ['-e', script], { stdio: 'pipe' });
      return { ok: true, terminal: 'Terminal.app' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  if (platform === 'linux') {
    // Try a few terminal emulators in order of preference.
    const candidates = [
      { cmd: 'gnome-terminal', args: ['--', 'tmux', 'attach', '-t', tmuxSession] },
      { cmd: 'konsole', args: ['-e', `tmux attach -t ${tmuxSession}`] },
      { cmd: 'xterm', args: ['-e', `tmux attach -t ${tmuxSession}`] },
      { cmd: 'x-terminal-emulator', args: ['-e', `tmux attach -t ${tmuxSession}`] },
    ];
    for (const c of candidates) {
      if (whichPath(c.cmd)) {
        try {
          spawn(c.cmd, c.args, { detached: true, stdio: 'ignore' }).unref();
          return { ok: true, terminal: c.cmd };
        } catch (err) {
          // try next
        }
      }
    }
    return { ok: false, error: 'no terminal emulator found (tried gnome-terminal, konsole, xterm, x-terminal-emulator)' };
  }

  if (platform === 'win32') {
    // Windows: use Windows Terminal if available, else cmd.exe
    const candidates = [
      { cmd: 'wt.exe', args: ['-e', `tmux attach -t ${tmuxSession}`] },
      { cmd: 'cmd', args: ['/c', 'start', 'tmux', 'attach', '-t', tmuxSession] },
    ];
    for (const c of candidates) {
      if (whichPath(c.cmd)) {
        try {
          spawn(c.cmd, c.args, { detached: true, stdio: 'ignore' }).unref();
          return { ok: true, terminal: c.cmd };
        } catch {
          // try next
        }
      }
    }
    return { ok: false, error: 'no terminal found (tried wt.exe, cmd)' };
  }

  return { ok: false, error: `unsupported platform: ${platform}` };
}



// --- Help ----------------------------------------------------------------

function showHelp() {
  console.log(`
  bizar bg — Manage background agents

  Usage:
    bizar bg list               List all background agents (running, pending, done, failed)
    bizar bg status <id>         Show details of a specific agent
    bizar bg view                Open a desktop window with tmux splits of all running agents
    bizar bg kill <id>           Kill a running agent and its tmux session
    bizar bg logs <id>           Tail the agent's log file

  Description:
    "background agents" are opencode run subprocesses spawned by the
    plugin's bizar_spawn_background tool or by the dashboard's task
    delegator. Each gets its own tmux session (named bgr_<sessionId16>)
    and a log file (default ~/.cache/bizar/logs/<sessionId>.log).

    The \`view\` subcommand is the headline feature: it creates a new
    tmux session (\`bizar-bg-view\`) with one pane per running agent,
    each pane attached to the agent's own tmux session (tiled layout),
    then opens a new OS terminal window attached to it. You can see all
    your agents working in parallel at a glance.
  `);
}

// --- Main ----------------------------------------------------------------

export async function runBg(sub, rest) {
  sub = sub || 'list';
  if (sub === '--help' || sub === '-h') {
    showHelp();
    return 0;
  }
  switch (sub) {
    case 'list':
    case 'ls':
      return runList();
    case 'status':
      return runStatus(rest[0]);
    case 'view':
    case 'watch':
      return runView();
    case 'kill':
      return runKill(rest[0]);
    case 'logs':
    case 'log':
    case 'tail':
      return runLogs(rest[0]);
    case 'help':
      showHelp();
      return 0;
    default:
      console.log(chalk.red(`\n  ✗ Unknown bg subcommand: ${sub}\n`));
      showHelp();
      return 1;
  }
}
