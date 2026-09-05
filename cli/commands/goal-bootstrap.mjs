/**
 * Retired compatibility alias. OpenKan PRDs replace Bizar's former
 * feature-list/ultragoal bootstrap machinery.
 */
import { OpenKanError, runOpenKanOk } from '../openkan.mjs';

function usage() {
  process.stdout.write(`
  bizar goal-bootstrap — retired compatibility alias

  OpenKan PRDs are Bizar's default durable goal system.
  Use: bizar goals list | bizar goals add <title> | bizar goals update <id> ...
`);
}

export async function run(subargs = []) {
  if (subargs.length === 0 || ['--help', '-h', 'help'].includes(subargs[0])) {
    usage();
    return 0;
  }
  try {
    const result = runOpenKanOk(['prd', ...subargs]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.ok ? 0 : result.status || 1;
  } catch (error) {
    const code = error instanceof OpenKanError ? error.code : 'OPENKAN_ERROR';
    process.stderr.write(`goal-bootstrap: ${code}: ${error.message || String(error)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) run(process.argv.slice(2)).then((code) => process.exit(code));
