/** OpenKan task-claim shortcut replacing the feature_list.json claim bridge. */
import { OpenKanError, runOpenKanOk } from '../openkan.mjs';

function help() {
  process.stdout.write(`
  bizar claim — claim an OpenKan task lease

  Usage:
    bizar claim <task-id> [--who <agent>] [--lease-ms <ms>]
    bizar claim release <task-id> [--who <agent>]
    bizar claim heartbeat <task-id> [--who <agent>] [--lease-ms <ms>]
    bizar claim list [--status <status>] [--json]

  Claims are OpenKan .ok locks, not feature_list.json annotations. Use
  \`bizar task update\` for status transitions and \`bizar goals\` for PRDs.
`);
}

function owner(args) {
  const i = args.findIndex((arg) => arg === '--who' || arg === '--owner');
  const equals = args.find((arg) => arg.startsWith('--who=') || arg.startsWith('--owner='));
  return equals ? equals.slice(equals.indexOf('=') + 1) : i >= 0 ? args[i + 1] : process.env.BIZAR_AGENT_ID || process.env.USER || 'agent';
}
function withoutWho(args) {
  return args.filter((arg, index) => !['--who', '--owner'].includes(arg) && args[index - 1] !== '--who' && args[index - 1] !== '--owner' && !arg.startsWith('--who=') && !arg.startsWith('--owner='));
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'claim') return false;
  if (isHelpRequest || args.length === 0 || ['--help', '-h', 'help'].includes(args[0])) { help(); return true; }
  const [subcommand, taskId] = args;
  const agent = owner(args);
  try {
    let command;
    if (subcommand === 'list' || subcommand === 'ls') command = ['task', 'list', ...args.slice(1)];
    else if (subcommand === 'release' || subcommand === 'heartbeat') {
      if (!taskId) { help(); process.exitCode = 2; return true; }
      command = ['task', subcommand, taskId, '--owner', agent, ...withoutWho(args.slice(2))];
    } else {
      command = ['task', 'claim', subcommand, '--owner', agent, ...withoutWho(args.slice(1))];
    }
    const result = runOpenKanOk(command);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (!result.ok) process.exitCode = result.status || 1;
  } catch (error) {
    const prefix = error instanceof OpenKanError ? error.code : 'OPENKAN_ERROR';
    process.stderr.write(`  ✗ ${prefix}: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
  return true;
}
