/** Short Bizar aliases for OpenKan plans and PRD goals. */
import { OpenKanError, runOpenKanOk } from '../openkan.mjs';

function usage(name) {
  const resource = name === 'goals' ? 'prd' : 'plan';
  process.stdout.write(`\n  bizar ${name} — compatibility alias for OpenKan ${resource}\n\n  Usage: ok ${resource} <args...>\n  Run \`ok ${resource} --help\` for the canonical OpenKan surface.\n`);
}

export async function run(name, args, isHelpRequest) {
  if (!['plan', 'goals'].includes(name)) return false;
  if (isHelpRequest || args.length === 0 || ['--help', '-h', 'help'].includes(args[0])) {
    usage(name);
    return true;
  }
  try {
    const result = runOpenKanOk([name === 'goals' ? 'prd' : 'plan', ...args]);
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
