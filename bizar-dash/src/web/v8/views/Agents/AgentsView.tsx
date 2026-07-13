import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { AgentCard, type AgentCardProps, type AgentStatus } from '../../ui/agents/AgentCard.js';
import { AgentDetail } from '../../ui/agents/AgentDetail.js';
import { Chip } from '../../ui/data/Chip.js';
import { Banner } from '../../ui/feedback/Banner.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Input } from '../../ui/controls/Input.js';
import { Button } from '../../ui/controls/Button.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { BizarAgent, CCAgent, WsMessage } from '../../data/types.js';
import { AlertTriangle, Bot, Cpu, Plus } from 'lucide-react';
import { AgentHierarchy } from './AgentHierarchy.js';

const SOURCE_STORAGE_KEY = 'bizar.agents.sourceFilter';
const SOURCE_LABELS = {
  all: 'All',
  bizar: 'Bizar',
  'claude-code': 'Claude Code',
} as const;
type SourceFilter = keyof typeof SOURCE_LABELS;
const VALID_SOURCES = Object.keys(SOURCE_LABELS) as SourceFilter[];

function readPersistedSource(): SourceFilter {
  if (typeof localStorage === 'undefined') return 'all';
  const v = localStorage.getItem(SOURCE_STORAGE_KEY);
  return VALID_SOURCES.includes(v as SourceFilter) ? (v as SourceFilter) : 'all';
}

/**
 * AgentsView — Sprint S10. Unified Bizar + Claude Code agents.
 *
 * Two REST calls (Bizar agents from `/api/agents`, CC from
 * `/api/cc-agents`) merged into a single grid. A `source` filter
 * chip switches between `bizar | claude-code | all`. Live updates
 * via `agents:change` and `agent:status` WS events.
 */

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
    // v9.4.0 — pass real metrics for the new AgentCard strip. The old
    // `tpmHistory` field was dead because AgentCard only renders the
    // sparkline when `length > 1` and we always passed a single point.
    tasksSucceeded: typeof a.tasksSucceeded === 'number' ? a.tasksSucceeded : undefined,
    tasksTotal: typeof a.tasksTotal === 'number' ? a.tasksTotal : undefined,
    successRate: typeof a.successRate === 'number' ? a.successRate : undefined,
    lastSeenMs: typeof a.lastSeen === 'number' && a.lastSeen > 0 ? a.lastSeen : undefined,
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
    // CC agents don't expose successRate/tasksSucceeded — only messageCount.
    // Skip the metric strip for them; the badge + lastActivity carry the
    // signal.
    badges: [a.cwd?.split('/').slice(-2).join('/') || ''].filter(Boolean),
  };
}

export function AgentsView(): JSX.Element {
  const bizar = useFetch<{ agents?: BizarAgent[] }>('/api/agents');
  const cc = useFetch<{ agents?: CCAgent[]; error?: string }>('/api/cc-agents');
  const stuck = useFetch<{ stuck?: BizarAgent[] }>('/api/agents/stuck');
  const [source, setSource] = useState<SourceFilter>(readPersistedSource);
  const [mode, setMode] = useState<'roster' | 'hierarchy'>('roster');
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SOURCE_STORAGE_KEY, source);
  }, [source]);
  const [bizarList, setBizarList] = useState<BizarAgent[]>([]);
  const [ccList, setCCList] = useState<CCAgent[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<{ name: string; role: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const saveCreate = async (): Promise<void> => {
    if (createDraft === null || !createDraft.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await fetchJson('/api/agents', { method: 'POST', body: { name: createDraft.name.trim(), role: createDraft.role.trim() || 'agent' } });
      setCreateDraft(null);
      bizar.refetch();
    } catch (err) {
      setCreateError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

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
        actions={
          <Button variant="primary" onClick={() => setCreateDraft({ name: '', role: '' })} data-testid="agent-create-open">
            <Plus size={14} aria-hidden /> New agent
          </Button>
        }
      />
      {(stuck.data?.stuck ?? []).length > 0 && (
        <Banner
          tone="warning"
          data-testid="agents-stuck-banner"
          action={
            <Button variant="secondary" size="sm" onClick={() => setMode('hierarchy')}>
              View details
            </Button>
          }
        >
          <Inline align="center" gap={2}>
            <AlertTriangle size={14} aria-hidden style={{ color: 'var(--warning)' }} />
            <span>
              {(stuck.data?.stuck ?? []).length} agent{stuck.data && stuck.data.stuck && stuck.data.stuck.length === 1 ? '' : 's'} stuck (no heartbeat &gt;5m)
            </span>
          </Inline>
        </Banner>
      )}
      <Inline align="center" justify="between" wrap gap={2}>
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
        <Inline gap={2}>
          <Chip
            data-testid="agents-mode-roster"
            selected={mode === 'roster'}
            onClick={() => setMode('roster')}
          >
            Roster
          </Chip>
          <Chip
            data-testid="agents-mode-hierarchy"
            selected={mode === 'hierarchy'}
            onClick={() => setMode('hierarchy')}
          >
            Hierarchy
          </Chip>
        </Inline>
      </Inline>
      {mode === 'hierarchy' ? (
        <AgentHierarchy />
      ) : cards.length === 0 && (bizar.loading || cc.loading) ? (
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
        const ccSource = sel.source === 'claude-code' ? ccList.find((a) => sel.id === `cc:${a.sessionId || a.id}`) : undefined;
        const bzSource = sel.source === 'bizar' ? bizarList.find((a) => sel.id === `bizar:${a.name}`) : undefined;
        return (
          <AgentDetail
            agentId={sel.id}
            name={sel.name}
            role={sel.role}
            status={sel.status}
            currentTask={sel.currentTask}
            startedAt={ccSource?.startedAt ?? bzSource?.lastSeen}
            messageCount={ccSource?.messageCount}
            lastMessageSnippet={ccSource?.lastMessageSnippet}
            successRate={bzSource?.successRate}
            tasksTotal={bzSource?.tasksTotal}
            open={openId !== null}
            onOpenChange={(o) => { if (!o) setOpenId(null); }}
          />
        );
      })()}

      {/* v9.2.0 — create-agent Sheet. Closes the audit-flagged "no way
          to add a new agent" HIGH gap. */}
      <Sheet open={createDraft !== null} onOpenChange={(o) => { if (!o) setCreateDraft(null); }}>
        <SheetContent side="right" title="New agent">
          {createDraft !== null && (
            <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
              <Stack gap={2}>
                <label htmlFor="agent-create-name" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Name</label>
                <Input
                  id="agent-create-name"
                  value={createDraft.name}
                  onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
                  placeholder="e.g. frigg"
                  disabled={creating}
                  data-testid="agent-create-name"
                />
              </Stack>
              <Stack gap={2}>
                <label htmlFor="agent-create-role" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Role (optional)</label>
                <Input
                  id="agent-create-role"
                  value={createDraft.role}
                  onChange={(e) => setCreateDraft({ ...createDraft, role: e.target.value })}
                  placeholder="e.g. code-review"
                  disabled={creating}
                  data-testid="agent-create-role"
                />
              </Stack>
              {createError !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{createError}</span>}
              <Inline gap={2}>
                <Button variant="primary" onClick={() => { void saveCreate(); }} disabled={creating || !createDraft.name.trim()} data-testid="agent-create-submit">
                  Create agent
                </Button>
                <Button variant="ghost" onClick={() => setCreateDraft(null)} disabled={creating}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          )}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}