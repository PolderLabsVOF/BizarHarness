import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { MemoryVault, type MemoryEntry } from '../../ui/memory/MemoryVault.js';

/**
 * MemoryView — the durable cross-session memos the harness writes down.
 */

const ENTRIES: MemoryEntry[] = [
  {
    id: 'm1',
    content: 'The dashboard rewrite lives in v8 tree under `bizar-dash/src/web/v8/`. Sprint boundaries: S1..S9 (per PLAN.md).',
    tags: ['dashboard', 'rewrite', 'sprint'],
    scope: 'project',
    updatedAt: 'Just now',
  },
  {
    id: 'm2',
    content: 'User prefers OKLch tokens, minimal visual flair, and token-driven styling only. No hardcoded hex anywhere in the v8 tree.',
    tags: ['preferences', 'design'],
    scope: 'global',
    updatedAt: '3 days ago',
  },
  {
    id: 'm3',
    content: 'Pre-existing test failures in `tests/a11y/forms.test.tsx` predate v8 work — do not chase them in this branch.',
    tags: ['tests', 'a11y'],
    scope: 'project',
    updatedAt: '1 week ago',
  },
  {
    id: 'm4',
    content: 'WIP=1 rule: only one feature active at a time per `feature_list.json`.',
    tags: ['process'],
    scope: 'project',
    updatedAt: '2 weeks ago',
  },
];

export function MemoryView(): JSX.Element {
  return (
    <Stack gap={5}>
      <ViewHeader
        title="Memory"
        description="Cross-session notes. Project memos live in the repo; global memos live on the user."
      />
      <MemoryVault entries={ENTRIES} empty={<div>No memos yet.</div>} />
    </Stack>
  );
}