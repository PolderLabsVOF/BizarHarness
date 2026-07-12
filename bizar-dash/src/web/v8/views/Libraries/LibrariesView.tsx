import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { LibraryGrid, LibraryItem, type LibraryItemProps } from '../../ui/index.js';

/**
 * LibrariesView — generic view that any one of Skills / MCPs / Hooks
 * uses. Pass the kind + items list; the surface is identical.
 */

export type LibraryKind = 'skills' | 'mcps' | 'hooks';

const KIND_LABEL: Record<LibraryKind, string> = {
  skills: 'Skills',
  mcps: 'MCPs',
  hooks: 'Hooks',
};

const KIND_DESCRIPTION: Record<LibraryKind, string> = {
  skills: 'Bizar skill packs. Auto-loaded by name or dispatched via the Skill tool.',
  mcps: 'MCP server registrations under `.claude/mcp.json`.',
  hooks: 'Executable hook scripts (PreToolUse / PostToolUse / SessionStart / SessionEnd).',
};

export interface LibrariesViewProps {
  kind: LibraryKind;
  items: readonly LibraryItemProps[];
}

export function LibrariesView(props: LibrariesViewProps): JSX.Element {
  const { kind, items } = props;
  return (
    <Stack gap={5}>
      <ViewHeader title={KIND_LABEL[kind]} description={KIND_DESCRIPTION[kind]} />
      <LibraryGrid>
        {items.map((item) => (
          <LibraryItem key={item.id} {...item} />
        ))}
      </LibraryGrid>
    </Stack>
  );
}