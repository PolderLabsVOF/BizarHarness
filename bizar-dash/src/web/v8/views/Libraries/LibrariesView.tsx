import { useEffect, useState, useCallback } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { LibraryGrid, LibraryItem, type LibraryItemProps, type LibraryStatus } from '../../ui/index.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
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

const CHANGE_EVENTS: Record<LibraryKind, readonly string[]> = {
  skills: ['skills:change', 'agents:change'] as const,
  mcps: ['mcps:change', 'agents:change'] as const,
  hooks: ['hooks:change', 'agents:change'] as const,
};
// Stable hook count: always register listeners for all possible events,
// filter inside the handler so kind navigation never changes hook order.
const ALL_EVENTS = ['skills:change', 'mcps:change', 'hooks:change', 'agents:change'] as const;

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

  // Force a re-fetch when the matching change event fires. Hook count
  // is fixed (ALL_EVENTS.length) so navigating between kinds can't trip
  // React's "Rendered fewer hooks than expected" runtime guard.
  const events = CHANGE_EVENTS[kind];
  const handler = useCallback((): void => setBust((n) => n + 1), []);
  for (const evt of ALL_EVENTS) {
    useWsMessage(evt, events.includes(evt) ? handler : () => {});
  }

  useEffect(() => {
    if (bust > 0) res.refetch();
  }, [bust, res]);

  const items: LibraryItemProps[] = (res.data?.skills || res.data?.items || [])
    .map(mapItem)
    .reduce<LibraryItemProps[]>((acc, item) => {
      if (!acc.some((existing) => existing.name === item.name)) acc.push(item);
      return acc;
    }, []);

  return (
    <Stack gap={5} data-testid={`${kind}-view`}>
      <ViewHeader title={KIND_LABEL[kind]} description={KIND_DESCRIPTION[kind]} />
      {res.loading ? (
        <Skeleton style={{ height: 240 }} />
      ) : res.error && items.length === 0 ? (
        <ErrorState
          block
          title={`Couldn't load ${KIND_LABEL[kind].toLowerCase()}`}
          description="The library endpoint failed. Retry to refetch."
          error={res.error}
          onRetry={() => void res.refetch()}
          testid={`libraries-${kind}-error`}
        />
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