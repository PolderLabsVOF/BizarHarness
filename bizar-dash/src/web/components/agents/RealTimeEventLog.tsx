// src/web/components/agents/RealTimeEventLog.tsx — streaming event ticker.
//
// v6.4.0 — F-036 (Goal Planner UI). Subscribes to ws.ts for ALL
// events and renders a color-coded ticker. Bounded ring buffer so
// a runaway server can't fill memory.
import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Ws } from '../../lib/ws';
import { Card, CardTitle, CardMeta } from '../Card';
import { Tag } from '../Tag';

const MAX_ROWS = 500;

type EventRow = {
  id: string;
  ts: number;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error' | 'control';
  preview: string;
};

function severityFor(type: string): EventRow['severity'] {
  if (type.startsWith('goal:')) return 'success';
  if (type.startsWith('task:')) return 'info';
  if (type.includes('error') || type.includes('fail')) return 'error';
  if (type.includes('stuck') || type.includes('blocked') || type.includes('warn')) return 'warning';
  if (type === 'ping' || type === 'pong' || type === 'refresh') return 'control';
  return 'info';
}

function previewOf(type: string, payload: Record<string, unknown> | undefined): string {
  if (!payload) return type;
  const keys = Object.keys(payload).slice(0, 3);
  return keys.map((k) => `${k}=${shortVal(payload[k])}`).join(' ') || type;
}

function shortVal(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'string') return v.length > 20 ? `"${v.slice(0, 20)}…"` : `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return `{${Object.keys(v).length}}`;
  return String(v);
}

export function RealTimeEventLog() {
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg) => {
      const m = msg as { type?: string; ts?: number } & Record<string, unknown>;
      const t = m.type;
      if (!t) return;
      const ts = Number(m.ts) || Date.now();
      const row: EventRow = {
        id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
        ts,
        type: t,
        severity: severityFor(t),
        preview: previewOf(t, m as Record<string, unknown>),
      };
      setRows((prev) => {
        const next = [...prev, row];
        return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
      });
    });
    return () => {
      off();
      ws.close();
    };
  }, []);

  const summary = useMemo(() => {
    const counts: Record<EventRow['severity'], number> = {
      info: 0,
      success: 0,
      warning: 0,
      error: 0,
      control: 0,
    };
    for (const r of rows) counts[r.severity] += 1;
    return counts;
  }, [rows]);

  return (
    <Card className="event-log" data-testid="event-log">
      <div className="event-log-header">
        <CardTitle>
          <Activity size={14} aria-hidden /> Real-time events
        </CardTitle>
        <Tag variant="neutral" data-testid="event-log-count">{rows.length}</Tag>
      </div>
      <CardMeta>Live WebSocket event ticker · bounded to {MAX_ROWS} rows</CardMeta>
      <div className="event-log-summary" data-testid="event-log-summary">
        <Tag variant="info">info {summary.info}</Tag>
        <Tag variant="success">success {summary.success}</Tag>
        <Tag variant="warning">warning {summary.warning}</Tag>
        <Tag variant="error">error {summary.error}</Tag>
        <Tag variant="neutral">control {summary.control}</Tag>
      </div>
      <ul className="event-log-list" data-testid="event-log-list">
        {rows.length === 0 && (
          <li className="event-log-empty" data-testid="event-log-empty">
            No events yet. Events will stream here as the server emits them.
          </li>
        )}
        {rows.slice().reverse().map((row) => (
          <li
            key={row.id}
            className={`event-log-row is-${row.severity}`}
            data-testid="event-log-row"
            data-severity={row.severity}
          >
            <time className="event-log-time" dateTime={new Date(row.ts).toISOString()}>
              {new Date(row.ts).toLocaleTimeString()}
            </time>
            <code className="event-log-type">{row.type}</code>
            <span className="event-log-preview">{row.preview}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default RealTimeEventLog;