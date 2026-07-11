// src/web/components/agents/CommunicationLog.tsx — inter-agent message bus trace.
//
// v6.4.0 — F-036 (Goal Planner UI). Subscribes to ws.ts for any
// event whose type starts with `agent:` and renders the last 200
// messages with color coding by type. Bounded virtual-list window
// so a runaway stream can't blow up the page.
import { useEffect, useState } from 'react';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { Ws } from '../../lib/ws';
import { Card, CardTitle, CardMeta } from '../Card';
import { Tag } from '../Tag';

const MAX_ROWS = 200;

type Entry = {
  id: string;
  ts: number;
  from: string;
  to: string;
  message: string;
  kind: 'info' | 'request' | 'success' | 'warning' | 'error' | 'status' | 'restarted' | 'stuck' | 'message';
  raw: unknown;
};

function classify(t: string): Entry['kind'] {
  if (t === 'agent:status') return 'status';
  if (t === 'agent:restarted') return 'restarted';
  if (t === 'agent:stuck') return 'stuck';
  if (t === 'agent:message') return 'message';
  return 'info';
}

function deriveEntry(t: string, payload: Record<string, unknown> | undefined, ts: number): Entry {
  const kind = classify(t);
  const id = `${ts}-${Math.random().toString(36).slice(2, 7)}`;
  if (t === 'agent:message') {
    const m = (payload?.message || payload) as Record<string, unknown>;
    return {
      id,
      ts,
      from: String(m?.from || 'unknown'),
      to: String(m?.to || 'unknown'),
      message: String(m?.text || m?.message || JSON.stringify(m).slice(0, 160)),
      kind,
      raw: payload,
    };
  }
  const agent = (payload?.agent || payload) as Record<string, unknown>;
  const name = String(agent?.name || 'agent');
  return {
    id,
    ts,
    from: name,
    to: kind === 'stuck' ? 'orchestrator' : 'broadcast',
    message: `${t} ${agent?.status ? `→ ${agent.status}` : ''}`.trim(),
    kind,
    raw: payload,
  };
}

interface Props {
  /** Override the max row count (default 200). */
  maxRows?: number;
}

export function CommunicationLog({ maxRows = MAX_ROWS }: Props) {
  const [rows, setRows] = useState<Entry[]>([]);

  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg) => {
      const t = (msg as { type?: string }).type;
      if (!t || !t.startsWith('agent:')) return;
      const m = msg as { type: string; ts?: number } & Record<string, unknown>;
      const ts = Number(m.ts) || Date.now();
      setRows((prev) => {
        const next = [...prev, deriveEntry(t, m as Record<string, unknown>, ts)];
        return next.length > maxRows ? next.slice(next.length - maxRows) : next;
      });
    });
    return () => {
      off();
      ws.close();
    };
  }, [maxRows]);

  return (
    <Card className="comm-log" data-testid="communication-log">
      <div className="comm-log-header">
        <CardTitle>
          <MessageSquare size={14} aria-hidden /> Communication log
        </CardTitle>
        <Tag variant="neutral" data-testid="communication-log-count">{rows.length}</Tag>
      </div>
      <CardMeta>Inter-agent message bus trace · bounded to {maxRows} rows</CardMeta>
      <ul className="comm-log-list" data-testid="communication-log-list">
        {rows.length === 0 && (
          <li className="comm-log-empty" data-testid="communication-log-empty">
            No agent messages yet. Stream will appear here live.
          </li>
        )}
        {rows.slice().reverse().map((row) => (
          <li
            key={row.id}
            className={`comm-log-row is-${row.kind}`}
            data-testid="communication-log-row"
            data-kind={row.kind}
          >
            <div className="comm-log-row-meta">
              <span className="comm-log-from">{row.from}</span>
              <ArrowRight size={12} aria-hidden />
              <span className="comm-log-to">{row.to}</span>
              <Tag variant="neutral" className={`comm-log-kind is-${row.kind}`}>{row.kind}</Tag>
              <time className="comm-log-time" dateTime={new Date(row.ts).toISOString()}>
                {new Date(row.ts).toLocaleTimeString()}
              </time>
            </div>
            <div className="comm-log-message">{row.message}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default CommunicationLog;