/**
 * cli/commands/memory.mjs
 *
 * Memory subcommand dispatcher — delegates to ../memory.mjs.
 */
import { runMemory } from '../memory.mjs';

export function showMemoryHelp() {
  console.log(`
  memory <subcommand>   Manage project memory (local-only or Git-shared Obsidian vault)
                        Subcommands: init, setup, status, link, unlink, write, pull, commit,
                        push, sync, reindex, conflicts, doctor
  `);
}

export async function run(name, args, isHelpRequest) {
  // Only show parent help if no subcommand given. If --help is for a
  // specific subcommand, pass it through so runMemory can show the
  // subcommand's own help (which includes "Usage:").
  if (!args[0]) {
    showMemoryHelp();
    return;
  }
  await runMemory(args[0], args.slice(1), { wantJson: false });
}
