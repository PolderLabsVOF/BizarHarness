// src/web/components/agents/LiveAgentsPanel.tsx
//
// F-040 — Live Agents panel. Top-of-page surface inside the Agents
// view that shows currently-running agents with full lifecycle
// controls: send follow-up, view transcript, kill.
//
// Subscribes to the WS bus for `claude:tool-use`,
// `claude:session-activity`, and `claude:session-ended` events
// emitted by the claude-session-watcher. Polls
// `/api/agents/active` every 3s as a fallback when the WS is
// disconnected so the panel never goes stale.

import { useEffect, useMemo, useState } from 'react';
import { Activity, MessageSquare, Eye, ZapOff, RefreshCw, Bot } from 'lucide-react';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Spinner } from '../Spinner';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { api } from '../../lib/api';
import { Ws } from '../../lib/ws';
import { cn, formatRelative, truncate } from '../../lib/utils';
import type { WsMessage } from '../../lib/types';

type LiveAgent = {
  name: string;
  status: string;
  currentTaskId?: string | null;
  currentTaskStartedAt?: number;
  lastSeen?: number;
  heartbeat?: number;
  lastTask?: { id: string; finishedAt: number; status: string } | null;
  lastError?: { ts: number; message: string } | null;
  isStuck?: boolean;
  /** Filled by WS events as they arrive. */
  lastToolName?: string;
  lastToolTs?: number;
  sourceSessionId?: string;
};

type Props = {
  /** Optional callback to switch to a chat transcript for an agent. */
  onOpenTranscript?: (sessionId: string) => void;
};

const POLL_INTERVAL_MS = 3_000;
const TOOL_NAME_PREVIEW = 32;

function truncateTaskId(tid: string | null | undefined, max = 12): string {
  if (!tid) return '—';
  if (tid.length <= max) return tid;
  return `${tid.slice(0, max)}…`;
}

function formatOnTask(startedAt: number | undefined): string {
  if (!startedAt) return '—';
  const ms = Date.now() - startedAt;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function LiveAgentsPanel({ onOpenTranscript }: Props) {
  const toast = useToast();
  const [active, setActive] = useState<LiveAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingKill, setPendingKill] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await api.get<{ active: LiveAgent[] }>('/agents/active');
      setActive((prev) => mergeAgents(prev, r.active || []));
    } catch (err) {
      // Don't toast on poll failures — they're noisy. Log only.
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + poll fallback.
  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // WS events: fold live tool-use / session-ended into the panel state.
  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg: WsMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'claude:tool-use') {
        setActive((prev) => upsertAgent(prev, {
          name: msg.agentName || 'claude',
          status: 'working',
          currentTaskId: `agent:${msg.sessionId}:${msg.toolUseId}`,
          currentTaskStartedAt: msg.ts,
          heartbeat: msg.ts,
          lastSeen: msg.ts,
          lastToolName: msg.name,
          lastToolTs: msg.ts,
          sourceSessionId: msg.sessionId,
        }));
      } else if (msg.type === 'claude:session-activity' && msg.agentName) {
        setActive((prev) => upsertAgent(prev, {
          name: msg.agentName as string,
          status: 'working',
          heartbeat: msg.lastTs,
          lastSeen: msg.lastTs,
          lastToolName: msg.lastToolName,
          lastToolTs: msg.lastTs,
          sourceSessionId: msg.sessionId,
        }));
      } else if (msg.type === 'claude:session-ended') {
        // Drop agents tied to this session — they finished.
        setActive((prev) => prev.filter((a) => a.sourceSessionId !== msg.sessionId));
      } else if (msg.type === 'agent:status') {
        const a = (msg as unknown as { agent?: LiveAgent }).agent;
        if (a && a.name) {
          if (a.status === 'idle') {
            setActive((prev) => prev.filter((x) => x.name !== a.name));
          } else {
            setActive((prev) => upsertAgent(prev, { ...a }));
          }
        }
      } else if (msg.type === 'agent:killed' || msg.type === 'agent:restarted') {
        const a = (msg as unknown as { agent?: { name: string } }).agent;
        if (a && a.name) {
          setActive((prev) => prev.filter((x) => x.name !== a.name));
        }
      }
    });
    return () => {
      try { off(); } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    };
  }, []);

  const sortedActive = useMemo(
    () => [...active].sort((a, b) => (b.heartbeat || 0) - (a.heartbeat || 0)),
    [active],
  );

  const onFollowUp = async (a: LiveAgent) => {
    const message = window.prompt(`Send follow-up to ${a.name}:`);
    if (!message || !message.trim()) return;
    try {
      await api.post(`/agents/${encodeURIComponent(a.name)}/steer`, {
        message,
        sessionId: a.sourceSessionId,
      });
      toast.success(`Steered ${a.name}.`);
    } catch (err) {
      toast.error(`Steer failed: ${(err as Error).message}`);
    }
  };

  const onKill = async (a: LiveAgent) => {
    if (!window.confirm(`Kill ${a.name}${a.sourceSessionId ? ` (session ${a.sourceSessionId.slice(0, 12)}…)` : ''}?`)) return;
    setPendingKill(a.name);
    try {
      const r = await api.post<{ ok: boolean; note?: string }>(
        `/agents/${encodeURIComponent(a.name)}/kill`,
        { sessionId: a.sourceSessionId },
      );
      if (r.ok && !r.note) toast.success(`${a.name} killed.`);
      else if (r.note === 'no_live_session') toast.warning(`${a.name} had no live session — marked idle.`);
      else toast.success(`${a.name} killed.`);
      setActive((prev) => prev.filter((x) => x.name !== a.name));
    } catch (err) {
      toast.error(`Kill failed: ${(err as Error).message}`);
    } finally {
      setPendingKill(null);
    }
  };

  const onViewTranscript = (a: LiveAgent) => {
    if (!a.sourceSessionId) {
      toast.warning(`${a.name} has no session linked yet.`);
      return;
    }
    if (onOpenTranscript) {
      onOpenTranscript(a.sourceSessionId);
      return;
    }
    // Fallback: navigate via location.href to the chat view.
    try {
      window.location.href = `/chat?session=${encodeURIComponent(a.sourceSessionId)}`;
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="live-agents-panel" aria-label="Live agents">
      <header className="live-agents-head">
        <div className="live-agents-title">
          <Activity size={16} />
          <h3>Live Agents</h3>
          <span className="live-agents-count" title={`${sortedActive.length} agent(s) currently running`}>
            {sortedActive.length}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={reload}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </header>

      {loading && sortedActive.length === 0 ? (
        <div className="view-loading"><Spinner size="md" /></div>
      ) : sortedActive.length === 0 ? (
        <EmptyState
          icon={<Bot size={28} />}
          title="No live agents"
          message="When a Claude Code Agent tool fires, it will appear here in real time."
        />
      ) : (
        <div className="live-agents-grid">
          {sortedActive.map((a) => (
            <article
              key={a.name}
              className={cn(
                'live-agent-card',
                a.status === 'working' && 'is-working',
                a.isStuck && 'is-stuck',
              )}
            >
              <div className="live-agent-head">
                <div className="live-agent-name">
                  <Bot size={14} />
                  <strong>{a.name}</strong>
                </div>
                <StatusBadge
                  kind={a.isStuck ? 'error' : a.status === 'working' ? 'info' : a.status === 'error' ? 'error' : 'neutral'}
                  dot
                >
                  {a.isStuck ? 'stuck' : a.status}
                </StatusBadge>
              </div>
              <dl className="live-agent-meta">
                <div>
                  <dt>Task</dt>
                  <dd className="mono" title={a.currentTaskId || ''}>
                    {truncateTaskId(a.currentTaskId)}
                  </dd>
                </div>
                <div>
                  <dt>On task</dt>
                  <dd className="tabular-nums">{formatOnTask(a.currentTaskStartedAt)}</dd>
                </div>
                <div>
                  <dt>Last tool</dt>
                  <dd className="mono" title={a.lastToolName || ''}>
                    {truncate(a.lastToolName || '—', TOOL_NAME_PREVIEW)}
                  </dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd className="tabular-nums">{a.lastSeen ? formatRelative(a.lastSeen) : '—'}</dd>
                </div>
              </dl>
              {a.lastError && (
                <p className="live-agent-error">
                  Last error: <code className="mono">{truncate(a.lastError.message, 80)}</code>
                </p>
              )}
              <div className="live-agent-actions">
                <Button variant="primary" size="sm" onClick={() => onFollowUp(a)} disabled={pendingKill === a.name}>
                  <MessageSquare size={12} /> Send follow-up
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onViewTranscript(a)} disabled={pendingKill === a.name}>
                  <Eye size={12} /> View transcript
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onKill(a)}
                  disabled={pendingKill === a.name}
                  title="Kill the running Claude session for this agent"
                >
                  <ZapOff size={12} /> {pendingKill === a.name ? 'Killing…' : 'Kill'}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function upsertAgent(list: LiveAgent[], incoming: Partial<LiveAgent> & { name: string }): LiveAgent[] {
  const idx = list.findIndex((a) => a.name === incoming.name);
  const next: LiveAgent = {
    ...(list[idx] || { name: incoming.name, status: 'idle' }),
    ...incoming,
  };
  if (idx === -1) return [next, ...list];
  const out = list.slice();
  out[idx] = next;
  return out;
}

function mergeAgents(prev: LiveAgent[], fresh: LiveAgent[]): LiveAgent[] {
  // Drop agents that have disappeared from the server (e.g. status
  // flipped to idle). Preserve richer WS-only fields (lastToolName,
  // sourceSessionId) for any agent still present.
  const freshByName = new Map(fresh.map((a) => [a.name, a]));
  const out: LiveAgent[] = [];
  const seen = new Set<string>();
  for (const p of prev) {
    const f = freshByName.get(p.name);
    if (f) {
      out.push({ ...p, ...f });
      seen.add(p.name);
    }
    // If an agent vanished from /active (went idle), drop it after
    // a 5s grace period. We don't drop immediately — the server
    // poll is the source of truth but a single slow tick shouldn't
    // wipe a card.
  }
  for (const f of fresh) {
    if (!seen.has(f.name)) out.push(f);
  }
  return out;
}