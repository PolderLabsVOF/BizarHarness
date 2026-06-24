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
 * The "view" subcommand is the headline feature: it gives the user
 * one terminal window with all running agents visible at once via
 * tmux splits. This is the antidote to "is the agent doing
 * anything?" — you can SEE them all working in parallel.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

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
  if (!which('tmux')) return [];
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

function which(cmd) {
  try {
    const out = execFileSync('which', [cmd], { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
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
 * Build a tmux "control session" that splits into N panes, each
 * showing the log of one running agent. The session name is fixed
 * (`bgr_view`) so subsequent `bizar bg view` calls reuse it.
 */
function buildTmuxControlSession() {
  const all = readAllBgInstances();
  const tmux = listBgrTmuxSessions();
  const running = all.filter(
    (e) =>
      (e.data.status === 'running' || e.data.status === 'pending') &&
      e.data.sessionId &&
      tmux.includes(tmuxSessionForSessionId(e.data.sessionId)),
  );

  if (running.length === 0) {
    return { ok: false, reason: 'no-running-agents' };
  }

  // 1. Create a fresh control session (or replace the existing one).
  try {
    execFileSync('tmux', ['kill-session', '-t', 'bgr_view'], { stdio: 'pipe' });
  } catch {
    // didn't exist
  }
  execFileSync('tmux', [
    'new-session', '-d', '-s', 'bgr_view',
    '-x', '220', '-y', '50',
  ], { stdio: 'pipe' });

  // 2. For each running agent after the first, split the pane
  //    and attach a tail in the new pane.
  for (let i = 1; i < running.length; i++) {
    const splitCmd = i % 2 === 1 ? 'split-window -h -t bgr_view' : 'split-window -v -t bgr_view';
    execFileSync('tmux', splitCmd.split(' '), { stdio: 'pipe' });
  }
  // Apply tiled layout for a clean grid.
  execFileSync('tmux', ['select-layout', '-t', 'bgr_view', 'tiled'], { stdio: 'pipe' });

  // 3. Send a label + tail command to each pane.
  for (let i = 0; i < running.length; i++) {
    const r = running[i];
    const tmuxName = tmuxSessionForSessionId(r.data.sessionId);
    const logPath = r.data.logPath || join(homedir(), '.cache', 'bizar', 'logs', `${r.data.sessionId}.log`);
    const header = `echo "═══ ${r.data.agent} │ ${r.data.instanceId} │ ${tmuxName} ═══"; tail -n 200 -F "${logPath}"`;
    // Use send-keys so the echo+tail are sent in sequence, then Enter
    // to run them. Target the pane by index in the bgr_view session.
    execFileSync('tmux', [
      'send-keys', '-t', `bgr_view:0.${i}`,
      header, 'Enter',
    ], { stdio: 'pipe' });
  }

  return { ok: true, count: running.length, session: 'bgr_view' };
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
      if (which(c.cmd)) {
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
      if (which(c.cmd)) {
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

async function runView() {
  if (!which('tmux')) {
    console.log(chalk.red('\n  ✗ tmux is not installed. Install it and retry.'));
    console.log(chalk.dim('    macOS:  brew install tmux'));
    console.log(chalk.dim('    Linux:  apt-get install tmux  (or your distro equivalent)'));
    console.log(chalk.dim('    Windows: choco install tmux\n'));
    return 1;
  }

  const build = buildTmuxControlSession();
  if (!build.ok) {
    if (build.reason === 'no-running-agents') {
      console.log(chalk.dim('\n  No running background agents to view.\n'));
      console.log(chalk.dim('  Spawn one with `bizar_spawn_background` (Odin) or via the dashboard,\n'));
      console.log(chalk.dim('  then re-run this command.\n'));
      return 1;
    }
    console.log(chalk.red(`\n  ✗ Failed to build control session: ${build.error || build.reason}\n`));
    return 1;
  }

  console.log(chalk.green(`\n  ✓ Built tmux control session with ${build.count} pane(s)\n`));
  const open = openTerminalAttached(build.session);
  if (open.ok) {
    console.log(chalk.green(`  ✓ Opened ${open.terminal} attached to tmux session "${build.session}"\n`));
    console.log(chalk.dim(`  Tip: \`tmux attach -t ${build.session}\` from any terminal.\n`));
  } else {
    console.log(chalk.yellow(`  ⚠ Could not open a terminal window: ${open.error}\n`));
    console.log(chalk.dim('  Run one of the following in a terminal you can see:\n'));
    console.log(chalk.cyan(`    tmux attach -t ${build.session}\n`));
  }
  return 0;
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
    tmux session (\`bgr_view\`) with one pane per running agent, then
    opens a new OS terminal window attached to it. You can see all
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
