import chalk from 'chalk';

import {
  TASK_STATES,
  TaskLedger,
  TaskLedgerError,
  resolveTaskDatabase,
} from '../task-ledger.mjs';

function parseFlags(args) {
  const flags = { _: [], scopes: [], dependencies: [] };
  const valueFlags = new Set([
    '--db',
    '--title',
    '--scope',
    '--depends-on',
    '--priority',
    '--owner',
    '--workspace',
    '--lease-ms',
    '--state',
    '--evidence',
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (valueFlags.has(arg) && index + 1 < args.length) {
      const value = args[++index];
      if (arg === '--scope') flags.scopes.push(value);
      else if (arg === '--depends-on') flags.dependencies.push(value);
      else flags[arg.slice(2).replaceAll('-', '')] = value;
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [name, ...rest] = arg.split('=');
      const value = rest.join('=');
      if (name === '--scope') flags.scopes.push(value);
      else if (name === '--depends-on') flags.dependencies.push(value);
      else flags[name.slice(2).replaceAll('-', '')] = value;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function showHelp() {
  console.log(`
  bizar task — durable dependency, lease, workspace, and path coordination

  Usage:
    bizar task create <id> --title <text> [--scope <path|dir/**>] [--depends-on <id>]
    bizar task ready
    bizar task list [--state <state>]
    bizar task show <id>
    bizar task claim <id> --owner <agent> [--workspace <path>] [--lease-ms <ms>]
    bizar task heartbeat <id> --owner <agent> [--lease-ms <ms>]
    bizar task complete <id> --owner <agent> [--evidence <text>]
    bizar task sweep

  Task states:
    ${TASK_STATES.join(' | ')}

  Scope rules:
    Exact files use repository-relative paths such as package.json.
    Directories use an explicit glob such as packages/sdk/**.
    Active overlapping scopes cannot be claimed concurrently.

  Common flags:
    --db <path>       Override the Git-common task database
    --json            Emit machine-readable JSON
`);
}

function print(result, flags, summary) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (summary) {
    console.log(summary(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function requireArg(value, usage) {
  if (!value) throw new TaskLedgerError('USAGE', usage);
  return value;
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'task') return false;
  const flags = parseFlags(args);
  if (flags.help || isHelpRequest) {
    showHelp();
    return true;
  }

  const [subcommand, taskId] = flags._;
  if (!subcommand) {
    showHelp();
    return true;
  }

  const dbPath = resolveTaskDatabase(process.cwd(), flags.db);
  let ledger;
  try {
    ledger = new TaskLedger({ dbPath });
    if (subcommand === 'create') {
      requireArg(taskId, 'task create requires <id>');
      const task = ledger.createTask({
        id: taskId,
        title: flags.title || taskId,
        scopes: flags.scopes,
        dependencies: flags.dependencies,
        priority: flags.priority,
      });
      print(task, flags, (row) => chalk.green(`  ✓ Created task ${row.id}`));
      return true;
    }
    if (subcommand === 'ready') {
      const tasks = ledger.listReady();
      print({ count: tasks.length, tasks }, flags);
      return true;
    }
    if (subcommand === 'list' || subcommand === 'ls') {
      if (flags.state && !TASK_STATES.includes(flags.state)) {
        throw new TaskLedgerError('USAGE', `unknown task state: ${flags.state}`);
      }
      const tasks = ledger.listTasks({ state: flags.state });
      print({ count: tasks.length, tasks }, flags);
      return true;
    }
    if (subcommand === 'show' || subcommand === 'get') {
      print(ledger.getTask(requireArg(taskId, 'task show requires <id>')), flags);
      return true;
    }
    if (subcommand === 'claim') {
      const task = ledger.claimTask({
        taskId: requireArg(taskId, 'task claim requires <id>'),
        owner: flags.owner || process.env.BIZAR_AGENT_ID || process.env.USER,
        ownerSessionId: process.env.CLAUDE_SESSION_ID,
        workspace: flags.workspace || process.cwd(),
        leaseMs: flags.leasems,
      });
      print(task, flags, (row) =>
        chalk.green(`  ✓ Claimed ${row.id} for ${row.owner} until ${new Date(row.leaseExpiresAt).toISOString()}`));
      return true;
    }
    if (subcommand === 'heartbeat') {
      const task = ledger.heartbeatTask({
        taskId: requireArg(taskId, 'task heartbeat requires <id>'),
        owner: flags.owner || process.env.BIZAR_AGENT_ID || process.env.USER,
        leaseMs: flags.leasems,
      });
      print(task, flags, (row) => chalk.green(`  ✓ Renewed ${row.id}`));
      return true;
    }
    if (subcommand === 'complete') {
      const task = ledger.completeTask({
        taskId: requireArg(taskId, 'task complete requires <id>'),
        owner: flags.owner || process.env.BIZAR_AGENT_ID || process.env.USER,
        evidence: flags.evidence || '',
      });
      print(task, flags, (row) => chalk.green(`  ✓ Completed ${row.id}`));
      return true;
    }
    if (subcommand === 'sweep') {
      const expired = ledger.sweepExpiredLeases();
      print({ expired }, flags, (result) =>
        chalk.green(`  ✓ Recovered ${result.expired} expired task lease(s)`));
      return true;
    }

    throw new TaskLedgerError('USAGE', `unknown task subcommand: ${subcommand}`);
  } catch (error) {
    const code = error instanceof TaskLedgerError ? error.code : 'TASK_ERROR';
    console.error(chalk.red(`  ✗ ${code}: ${error.message || String(error)}`));
    process.exitCode = code === 'USAGE' ? 2 : 1;
    return true;
  } finally {
    try { ledger?.close(); } catch { /* command is exiting */ }
  }
}
