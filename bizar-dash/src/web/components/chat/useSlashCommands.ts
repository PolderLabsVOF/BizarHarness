// src/components/chat/useSlashCommands.ts — filter slash-command suggestions from mods.

import { useMemo, useState } from 'react';
import type { Mod, Snapshot } from '../../lib/types';

export type SlashCommand = { cmd: string; desc: string; mod?: string };

const BUILTIN_COMMANDS: SlashCommand[] = [
  { cmd: '/visual-plan [on|off|status]', desc: 'Toggle or view visual plan mode' },
  { cmd: '/plan new <slug> [template]', desc: 'Create a new plan' },
  { cmd: '/plan list', desc: 'List all plans' },
  { cmd: '/plan open <slug>', desc: 'Open a plan in the viewer' },
  { cmd: '/plan status <slug> <status>', desc: 'Set plan status' },
  { cmd: '/plan get <slug>', desc: 'Fetch plan canvas' },
  { cmd: '/plan add <slug> --title T --type kind', desc: 'Add element to a plan' },
  { cmd: '/plan update <slug> <id>', desc: 'Update a plan element' },
  { cmd: '/plan delete <slug> <id>', desc: 'Delete a plan element' },
  { cmd: '/plan comment <slug> [id] "text"', desc: 'Add a comment' },
  { cmd: '/plan comments <slug> [id]', desc: 'Read plan comments' },
  { cmd: '/bizar', desc: 'Launch Bizar dashboard' },
  { cmd: '/bizar <args>', desc: 'Route via Bizar menu' },
  { cmd: '/audit', desc: 'Run security audit' },
  { cmd: '/explain <q>', desc: 'Read-only code Q&A' },
  { cmd: '/init', desc: 'Initialize .bizar/ in this project' },
  { cmd: '/learn', desc: 'Extract patterns from session' },
  { cmd: '/pr-review', desc: 'PR review' },
  { cmd: '/help | /commands', desc: 'Show all Bizar commands' },
];

export function useSlashCommands(snapshot: Snapshot) {
  const [query, setQuery] = useState('');

  const allCommands = useMemo<SlashCommand[]>(() => [
    ...BUILTIN_COMMANDS,
    ...(snapshot.mods || []).flatMap((m: Mod) =>
      m.entry?.command ? [{ cmd: `/${m.id}`, desc: m.description || m.name, mod: m.id }] : [],
    ),
  ], [snapshot.mods]);

  const suggestions = useMemo(() => {
    if (!query.startsWith('/') || query.includes(' ')) return [];
    const q = query.toLowerCase();
    return allCommands.filter((c) => c.cmd.toLowerCase().startsWith(q)).slice(0, 6);
  }, [query, allCommands]);

  return { allCommands, suggestions, setQuery };
}