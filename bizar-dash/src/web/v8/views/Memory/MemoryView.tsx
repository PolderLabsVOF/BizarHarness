import { useMemo, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { MemoryVault, type MemoryEntry, type MemoryScope } from '../../ui/memory/MemoryVault.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Brain } from 'lucide-react';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Chip } from '../../ui/data/Chip.js';
import { useFetch } from '../../data/useFetch.js';

/**
 * MemoryView — Sprint S10. Pulls `/api/memory` (Bizar memory entries).
 * Click a chip to scope the view (Project / Global / All).
 */

interface MemoryResponse {
  entries?: Array<{
    id?: string;
    content?: string;
    tags?: string[];
    scope?: 'project' | 'global';
    updatedAt?: string | number;
  }>;
  count?: number;
}

function toEntry(e: NonNullable<MemoryResponse['entries']>[number]): MemoryEntry {
  return {
    id: e.id || '',
    content: e.content || '',
    tags: e.tags || [],
    scope: (e.scope || 'project') as MemoryScope,
    updatedAt:
      typeof e.updatedAt === 'number'
        ? new Date(e.updatedAt).toLocaleString()
        : e.updatedAt || '',
  };
}

export function MemoryView(): JSX.Element {
  const mem = useFetch<MemoryResponse>('/api/memory');
  const [scope, setScope] = useState<MemoryScope | 'all'>('all');

  const entries = useMemo<MemoryEntry[]>(() => {
    const list = (mem.data?.entries || []).map(toEntry);
    if (scope === 'all') return list;
    return list.filter((e) => e.scope === scope);
  }, [mem.data, scope]);

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Memory"
        description="Cross-session notes. Project memos live in the repo; global memos live on the user."
      />
      <Inline gap={2}>
        {(['all', 'project', 'global'] as const).map((s) => (
          <Chip key={s} selected={scope === s} onClick={() => setScope(s)}>
            {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'Global'}
          </Chip>
        ))}
      </Inline>
      {mem.loading ? (
        <Skeleton style={{ height: 240 }} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Brain size={32} aria-hidden />}
          title="No memory entries"
          description="Memos land here once they are written via the memory tools."
        />
      ) : (
        <MemoryVault entries={entries} />
      )}
    </Stack>
  );
}