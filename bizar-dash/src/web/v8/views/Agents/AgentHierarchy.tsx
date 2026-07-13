import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Network } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { BizarAgent } from '../../data/types.js';

/**
 * AgentHierarchy — v9.4.0 S45.
 *
 * Reads `/api/agents/hierarchy` (returns `{ roots: Array<{ name, agent,
 * children }>, all: BizarAgent[] }` from `agents-store.mjs:230-251`).
 * Renders a collapsible tree where each node is a Bizar agent. Children
 * render indented beneath their parent. Live updates via `agents:change`
 * WS event triggers refetch.
 */

export interface HierarchyNode {
  name: string;
  agent: BizarAgent | null;
  children: HierarchyNode[];
}

interface HierarchyResponse {
  roots?: HierarchyNode[];
  all?: BizarAgent[];
}

function statusToTone(status: string | undefined): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  const s = (status || '').toLowerCase();
  if (s === 'busy' || s === 'working') return 'info';
  if (s === 'idle') return 'neutral';
  if (s === 'error' || s === 'stuck') return 'danger';
  if (s === 'paused') return 'warning';
  return 'neutral';
}

function statusLabel(status: string | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'working') return 'working';
  if (!s) return 'idle';
  return s;
}

function relativeMs(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  const delta = Math.max(0, Date.now() - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface NodeRowProps {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (name: string) => void;
}

function NodeRow({ node, depth, expanded, onToggle }: NodeRowProps): JSX.Element {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.name);
  const agent = node.agent;
  const tone = statusToTone(agent?.status);
  const status = statusLabel(agent?.status);
  return (
    <>
      <div
        data-testid={`agent-hierarchy-node-${node.name}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto auto',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          paddingLeft: `calc(var(--space-3) + ${depth * 24}px)`,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-1)',
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            data-testid={`agent-hierarchy-toggle-${node.name}`}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={() => onToggle(node.name)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-0)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          </button>
        ) : (
          <span aria-hidden style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-subtle)' }}>
            <GitBranch size={12} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg)' }}>{node.name}</div>
          {agent && (
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              {agent.role || agent.category || agent.mode || 'agent'}
              {agent.parent && agent.parent !== node.name && (
                <> · parent <code style={{ fontFamily: 'var(--font-mono)' }}>{agent.parent}</code></>
              )}
            </div>
          )}
        </div>
        {typeof agent?.lastSeen === 'number' && agent.lastSeen > 0 && (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            {relativeMs(agent.lastSeen)}
          </span>
        )}
        <Badge tone={tone} dot>{status}</Badge>
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <NodeRow key={child.name} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
      ))}
    </>
  );
}

export function AgentHierarchy(): JSX.Element {
  const data = useFetch<HierarchyResponse>('/api/agents/hierarchy');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Track which root names we auto-expanded on first load so subsequent
  // user toggles of those roots are honored.
  const [autoRoots, setAutoRoots] = useState<Set<string>>(() => new Set());

  const seenRoots = useMemo(() => data.data?.roots?.map((n) => n.name) ?? [], [data.data]);

  // On first successful load, auto-expand every root and remember the set so
  // a future toggle of a root is a real state change (no longer masked by
  // the auto-expand).
  if (autoRoots.size === 0 && seenRoots.length > 0) {
    setAutoRoots(new Set(seenRoots));
    setExpanded(new Set(seenRoots));
  }

  const onAgentsChange = useCallback(() => data.refetch(), [data]);
  useWsMessage('agents:change', onAgentsChange);

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  if (data.loading && !data.data) {
    return (
      <Stack gap={3}>
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
      </Stack>
    );
  }

  const roots = data.data?.roots ?? [];
  if (roots.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Network size={32} aria-hidden />}
            title="No hierarchy yet"
            description="Agents have no parent links in their frontmatter. Add `parent:` to an agent's .md frontmatter to nest it beneath another agent."
            data-testid="agent-hierarchy-empty"
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Stack gap={2}>
      <Inline align="center" justify="between">
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {roots.length} root agent{roots.length === 1 ? '' : 's'} · {data.data?.all?.length ?? 0} total
        </span>
      </Inline>
      <Stack gap={2}>
        {roots.map((root) => (
          <NodeRow key={root.name} node={root} depth={0} expanded={expanded} onToggle={toggle} />
        ))}
      </Stack>
    </Stack>
  );
}