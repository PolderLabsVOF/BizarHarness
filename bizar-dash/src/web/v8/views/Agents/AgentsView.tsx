import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { AgentCard, type AgentCardProps, type AgentStatus } from '../../ui/agents/AgentCard.js';
import { AgentDetail } from '../../ui/agents/AgentDetail.js';
import { Chip } from '../../ui/data/Chip.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { BizarAgent, CCAgent, WsMessage } from '../../data/types.js';
import { Bot, Cpu } from 'lucide-react';

/**
 * AgentsView — Sprint S10. Unified Bizar + Claude Code agents.
 *
 * Two REST calls (Bizar agents from `/api/agents`, CC from
 * `/api/cc-agents`) merged into a single grid. A `source` filter
 * chip switches between `bizar | claude-code | all`. Live updates
 * via `agents:change` and `agent:status` WS events.
 */

const SOURCE_LABELS = {
  all: 'All',
  bizar: 'Bizar',
  'claude-code': 'Claude Code',
} as const;
type SourceFilter = keyof typeof SOURCE_LABELS;

function mapBizar(a: BizarAgent): AgentCardProps {
  const raw = (a.status || 'idle').toLowerCase();
  const status: AgentStatus =
    raw === 'busy' || raw === 'working' ? 'busy' :
    raw === 'error' || raw === 'stuck' ? 'error' :
    raw === 'paused' ? 'paused' : 'idle';
  return {
    id: `bizar:${a.name}`,
    name: a.name,
    role: a.role || a.category || a.mode || 'agent',
    status,
    currentTask: a.currentTaskId ? `Task ${a.currentTaskId}` : undefined,
    lastActivity: a.lastSeen ? new Date(a.lastSeen).toLocaleTimeString() : undefined,
    tasksToday: a.tasksTotal || 0,
    tpmHistory: [],
    badges: a.tags || [],
  };
}

function mapCC(a: CCAgent): AgentCardProps {
  const raw = (a.status || a.state || 'idle').toLowerCase();
  const status: AgentStatus =
    raw === 'busy' || raw === 'working' ? 'busy' :
    raw === 'error' ? 'error' :
    raw === 'paused' ? 'paused' : 'idle';
  return {
    id: `cc:${a.sessionId || a.id}`,
    name: a.name || a.sessionId?.slice(0, 8) || 'unknown',
    role: a.kind === 'background' ? 'CC background' : 'CC interactive',
    status,
    currentTask: a.lastMessageSnippet || undefined,
    lastActivity: a.lastMessageAt ? new Date(a.lastMessageAt).toLocaleTimeString() : (a.startedAt ? new Date(a.startedAt).toLocaleTimeString() : undefined),
    tasksToday: a.messageCount || 0,
    tpmHistory: [],
    badges: [a.cwd?.split('/').slice(-2).join('/') || ''].filter(Boolean),
  };
}

export function AgentsView(): JSX.Element {
  const bizar = useFetch<{ agents?: BizarAgent[] }>('/api/agents');
  const cc = useFetch<{ agents?: CCAgent[]; error?: string }>('/api/cc-agents');
  const [source, setSource] = useState<SourceFilter>('all');
  const [bizarList, setBizarList] = useState<BizarAgent[]>([]);
  const [ccList, setCCList] = useState<CCAgent[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized && bizar.data?.agents !== undefined && cc.data?.agents !== undefined) {
      setInitialized(true);
      setBizarList(bizar.data.agents);
      setCCList(cc.data.agents);
    }
  }, [bizar.data, cc.data, initialized]);

  const onAgentsChange = useCallback(() => {
    // Bust both caches; the next mount will re-fetch (cheap because
    // the dashboard views are lazy-mounted).
    bizar.refetch();
    cc.refetch();
  }, [bizar, cc]);
  useWsMessage('agents:change', onAgentsChange);

  const onAgentStatus = useCallback((msg: WsMessage) => {
    if (msg.type !== 'agent:status') return;
    const a = (msg as Extract<WsMessage, { type: 'agent:status' }>).agent;
    if (!a || !a.name) return;
    setBizarList((prev) => {
      const idx = prev.findIndex((x) => x.name === a.name);
      if (idx === -1) return [...prev, a];
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], ...a };
      return copy;
    });
  }, []);
  useWsMessage('agent:status', onAgentStatus);

  const cards = useMemo(() => {
    const out: Array<AgentCardProps & { source: 'bizar' | 'claude-code' }> = [];
    if (source !== 'claude-code') {
      for (const a of bizarList) out.push({ ...mapBizar(a), source: 'bizar' });
    }
    if (source !== 'bizar') {
      for (const a of ccList) out.push({ ...mapCC(a), source: 'claude-code' });
    }
    return out;
  }, [bizarList, ccList, source]);

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Agents"
        description="Bizar agents (frontmatter-driven) and Claude Code background agents."
      />
      <Inline gap={2}>
        {(['all', 'bizar', 'claude-code'] as SourceFilter[]).map((id) => (
          <Chip
            key={id}
            selected={source === id}
            onClick={() => setSource(id)}
          >
            {id === 'bizar' ? <Bot size={12} aria-hidden /> : id === 'claude-code' ? <Cpu size={12} aria-hidden /> : null}{' '}
            {SOURCE_LABELS[id]}
          </Chip>
        ))}
      </Inline>
      {cards.length === 0 && (bizar.loading || cc.loading) ? (
        <Grid cols={3}>
          <Skeleton style={{ height: 140 }} />
          <Skeleton style={{ height: 140 }} />
          <Skeleton style={{ height: 140 }} />
        </Grid>
      ) : cards.length === 0 ? (
        <span style={{ color: 'var(--fg-muted)' }}>
          No agents yet. Run <code>/loop</code> or spawn one via the command palette.
        </span>
      ) : (
        <Grid cols={3}>
          {cards.map((c) => (
            <AgentCard key={c.id} {...c} onOpen={() => setOpenId(c.id)} />
          ))}
        </Grid>
      )}

      {openId !== null && (() => {
        const sel = cards.find((c) => c.id === openId);
        if (!sel) return null;
        return (
          <AgentDetail
            agentId={sel.id}
            name={sel.name}
            role={sel.role}
            status={sel.status}
            currentTask={sel.currentTask}
            open={openId !== null}
            onOpenChange={(o) => { if (!o) setOpenId(null); }}
          />
        );
      })()}
    </Stack>
  );
}