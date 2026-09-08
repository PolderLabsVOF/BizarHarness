/** Bizar task alias — OpenKan `.ok/` is the only live task store. */
import { OpenKanError, runOpenKanOk } from '../openkan.mjs';

function help() {
  process.stdout.write(`
  ok task — OpenKan-backed task lifecycle

  Usage:
    ok task add <title> [--owner agent] [--priority low|normal|high|urgent]
    ok task list [--status pending|in_progress|review|done|cancelled] [--json]
    ok task show <id> [--json]
    ok task claim <id> --owner <agent> [--lease-ms <ms>]
    ok task heartbeat <id> --owner <agent> [--lease-ms <ms>]
    ok task update <id> --status <status> [--evidence <text>]
    ok task complete <id> --owner <agent> --evidence <text>
    ok task cancel <id> --owner <agent> --reason <text>
    ok task release <id> --owner <agent>

  This is an exact convenience alias for \`ok task\`. OpenKan persists task
  state, scoped ownership, dependencies, evidence, plans, and goals under
  .ok/. Retired Bizar coordination storage is not consulted.
`);
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'task') return false;
  if (isHelpRequest || args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    help();
    return true;
  }
  try {
    const result = runOpenKanOk(['task', ...args]);
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
