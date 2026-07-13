import { useEffect, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { LibraryGrid, LibraryItem, type LibraryItemProps, type LibraryStatus } from '../../ui/index.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { LibraryItem as LibItem } from '../../data/types.js';

/**
 * LibrariesView — Sprint S10. Generic Skills / MCPs / Hooks surface.
 *
 * The parent (`Router.tsx`) picks the data source per kind. This
 * view pulls live data from `/api/skills`, `/api/mcps`,
 * `/api/hooks` instead of seeded arrays.
 */

export type LibraryKind = 'skills' | 'mcps' | 'hooks';

const KIND_LABEL: Record<LibraryKind, string> = {
  skills: 'Skills',
  mcps: 'MCPs',
  hooks: 'Hooks',
};

const KIND_DESCRIPTION: Record<LibraryKind, string> = {
  skills: 'Bizar skill packs. Auto-loaded by name or dispatched via the Skill tool.',
  mcps: 'MCP server registrations under `.claude/settings.json` → `mcpServers`.',
  hooks: 'Executable hook scripts (PreToolUse / PostToolUse / SessionStart / SessionEnd).',
};

const ENDPOINT: Record<LibraryKind, string> = {
  skills: '/api/skills',
  mcps: '/api/skills?kind=mcps',
  hooks: '/api/skills?kind=hooks',
};

const CHANGE_EVENT: Record<LibraryKind, string[]> = {
  skills: ['skills:change', 'agents:change'],
  mcps: ['mcps:change', 'agents:change'],
  hooks: ['agents:change'],
};

function mapItem(it: LibItem): LibraryItemProps {
  const status: LibraryStatus =
    it.status === 'enabled' || it.status === 'disabled' || it.status === 'error'
      ? it.status
      : 'disabled';
  return {
    id: it.id,
    name: it.name,
    slug: it.slug ?? it.id,
    status,
    description: it.description,
    meta: it.meta,
  };
}

export interface LibrariesViewProps {
  kind: LibraryKind;
}

export function LibrariesView(props: LibrariesViewProps): JSX.Element {
  const { kind } = props;
  const url = ENDPOINT[kind];
  const res = useFetch<{ skills?: LibItem[]; items?: LibItem[]; count?: number }>(url);
  const [bust, setBust] = useState(0);

  // Force a re-fetch when the matching change event fires.
  const handler = (): void => setBust((n) => n + 1);
  for (const evt of CHANGE_EVENT[kind]) useWsMessage(evt, handler);

  useEffect(() => {
    if (bust > 0) res.refetch();
  }, [bust, res]);

  const items: LibraryItemProps[] = (res.data?.skills || res.data?.items || []).map(mapItem);

  return (
    <Stack gap={5}>
      <ViewHeader title={KIND_LABEL[kind]} description={KIND_DESCRIPTION[kind]} />
      {res.loading ? (
        <Skeleton style={{ height: 240 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<span>📚</span>}
          title={`No ${KIND_LABEL[kind].toLowerCase()} installed`}
          description={`${KIND_LABEL[kind]} appear here as soon as they are registered.`}
        />
      ) : (
        <LibraryGrid>
          {items.map((item) => (
            <LibraryItem key={item.id} {...item} />
          ))}
        </LibraryGrid>
      )}
    </Stack>
  );
}