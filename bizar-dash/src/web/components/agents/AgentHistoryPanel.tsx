// src/web/components/agents/AgentHistoryPanel.tsx
//
// F-040 — Per-agent history panel. Renders a collapsible section per
// agent with recent invocations (from the hook-log JSONL) and the
// Claude sessions those invocations are linked to. Clicking a session
// navigates to /chat?session=<id>.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History, ExternalLink, Bot } from 'lucide-react';
import { Spinner } from '../Spinner';
import { api } from '../../lib/api';
import { cn, formatRelative, truncate } from '../../lib/utils';

type HistoryItem = {
  ts: string;
  sessionId?: string | null;
  agentName: string;
  promptPreview?: string;
  source?: string;
};

type SessionItem = {
  sessionId: string;
  count: number;
  firstTs?: string;
  lastTs?: string;
  lastPrompt?: string;
};

type Props = {
  agentNames: string[];
  defaultOpen?: boolean;
  maxPerAgent?: number;
};

const DEFAULT_LIMIT = 20;

export function AgentHistoryPanel({ agentNames, defaultOpen = false, maxPerAgent = DEFAULT_LIMIT }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});
  const [sessions, setSessions] = useState<Record<string, SessionItem[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState(defaultOpen);

  const sortedNames = useMemo(
    () => [...agentNames].sort((a, b) => a.localeCompare(b)),
    [agentNames],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      for (const name of sortedNames) {
        if (cancelled) return;
        if (history[name] || loading[name]) continue;
        setLoading((cur) => ({ ...cur, [name]: true }));
        try {
          const [h, s] = await Promise.all([
            api.get<{ history: HistoryItem[] }>(`/agents/${encodeURIComponent(name)}/history?limit=${maxPerAgent}`),
            api.get<{ sessions: SessionItem[] }>(`/agents/${encodeURIComponent(name)}/sessions`),
          ]);
          if (cancelled) return;
          setHistory((cur) => ({ ...cur, [name]: h.history || [] }));
          setSessions((cur) => ({ ...cur, [name]: s.sessions || [] }));
        } catch {
          if (cancelled) return;
          setHistory((cur) => ({ ...cur, [name]: [] }));
          setSessions((cur) => ({ ...cur, [name]: [] }));
        } finally {
          if (!cancelled) setLoading((cur) => ({ ...cur, [name]: false }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, sortedNames, maxPerAgent]);

  if (sortedNames.length === 0) return null;

  return (
    <section className="agent-history-panel" aria-label="Agent history">
      <header className="agent-history-head">
        <button
          type="button"
          className="agent-history-toggle"
          onClick={() => setEnabled((v) => !v)}
          aria-expanded={enabled}
        >
          {enabled ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={14} />
          <strong>Agent history</strong>
          <span className="muted">({sortedNames.length} agent{sortedNames.length === 1 ? '' : 's'})</span>
        </button>
      </header>

      {enabled && (
        <div className="agent-history-list">
          {sortedNames.map((name) => {
            const isOpen = !!open[name];
            const items = history[name] || [];
            const sess = sessions[name] || [];
            return (
              <article key={name} className="agent-history-row">
                <button
                  type="button"
                  className="agent-history-row-head"
                  onClick={() => setOpen((cur) => ({ ...cur, [name]: !cur[name] }))}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Bot size={12} />
                  <strong>{name}</strong>
                  <span className="muted tabular-nums">
                    {items.length} invocation{items.length === 1 ? '' : 's'}
                    {sess.length > 0 ? ` · ${sess.length} session${sess.length === 1 ? '' : 's'}` : ''}
                  </span>
                </button>
                {isOpen && (
                  <div className="agent-history-body">
                    {loading[name] ? (
                      <div className="agent-history-loading"><Spinner size="sm" /></div>
                    ) : items.length === 0 ? (
                      <p className="muted agent-history-empty">No invocations recorded yet.</p>
                    ) : (
                      <>
                        {sess.length > 0 && (
                          <div className="agent-history-sessions">
                            <h5>Sessions</h5>
                            <ul>
                              {sess.slice(0, 8).map((s) => (
                                <li key={s.sessionId} className={cn('agent-history-session')}>
                                  <a
                                    href={`/chat?session=${encodeURIComponent(s.sessionId)}`}
                                    className="mono agent-history-session-link"
                                    title={s.sessionId}
                                  >
                                    {truncate(s.sessionId, 18)}
                                  </a>
                                  <ExternalLink size={10} aria-hidden />
                                  <span className="muted tabular-nums">{s.count}×</span>
                                  {s.lastTs && (
                                    <span className="muted tabular-nums">{formatRelative(s.lastTs)}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="agent-history-invocations">
                          <h5>Recent activity</h5>
                          <ul>
                            {items.slice(0, maxPerAgent).map((it, i) => (
                              <li key={`${it.ts}-${i}`} className="agent-history-item">
                                <span className="tabular-nums muted">
                                  {it.ts ? formatRelative(it.ts) : '—'}
                                </span>
                                {it.sessionId ? (
                                  <a
                                    href={`/chat?session=${encodeURIComponent(it.sessionId)}`}
                                    className="mono agent-history-session-link"
                                    title={it.sessionId}
                                  >
                                    {truncate(it.sessionId, 12)}
                                  </a>
                                ) : (
                                  <span className="muted">no session</span>
                                )}
                                <span className="agent-history-prompt" title={it.promptPreview || ''}>
                                  {truncate(it.promptPreview || '(no prompt captured)', 120)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}