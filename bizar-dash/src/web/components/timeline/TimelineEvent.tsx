// src/web/components/timeline/TimelineEvent.tsx — single-row renderer.
//
// v6.6.0 — F-042. Reusable across the Timeline view's group sections.
// Color-coded by type, with an icon + relative timestamp + actor + summary.
// Click → routes the user to the relevant view (Tasks, Goals, Agents, ...).

import type { ReactNode } from 'react';
import {
  GitCommit,
  Terminal,
  Bot,
  CheckSquare,
  Target,
  FileEdit,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TimelineEvent as TimelineEventT } from '../../lib/types';

function iconFor(type: string): LucideIcon {
  switch (type) {
    case 'commit': return GitCommit;
    case 'hook': return Terminal;
    case 'agent': return Bot;
    case 'task': return CheckSquare;
    case 'goal': return Target;
    case 'file': return FileEdit;
    default: return Terminal;
  }
}

function severityClass(event: TimelineEventT): string {
  const t = event.type;
  const s = event.subType || '';
  if (s.includes('error') || s.includes('fail') || s.includes('stuck')) return 'is-error';
  if (s.includes('completed') || s.includes('done') || s.includes('commit')) return 'is-success';
  if (s.includes('warning') || s.includes('blocked')) return 'is-warning';
  if (t === 'task' && (s === 'task-created' || s === 'task-completed')) return 'is-success';
  if (t === 'goal' && s === 'goal-archived') return 'is-warning';
  if (t === 'agent' && s === 'agent-tool-use') return 'is-info';
  return 'is-info';
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso || '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleString();
}

export type TimelineEventProps = {
  event: TimelineEventT;
  onClick?: (event: TimelineEventT) => void;
  /** When true, renders the absolute timestamp instead of relative. */
  showAbsolute?: boolean;
};

export function TimelineEvent({ event, onClick, showAbsolute = false }: TimelineEventProps): ReactNode {
  const Icon = iconFor(event.type);
  const sev = severityClass(event);
  return (
    <li
      className={cn('timeline-row', sev)}
      data-testid="timeline-row"
      data-type={event.type}
      data-subtype={event.subType}
    >
      <button
        type="button"
        className="timeline-row-btn"
        onClick={onClick ? () => onClick(event) : undefined}
        title={event.summary}
      >
        <span className={cn('timeline-row-icon', `is-${event.type}`)} aria-hidden>
          <Icon size={14} />
        </span>
        <time className="timeline-row-time" dateTime={event.ts}>
          {showAbsolute ? new Date(event.ts).toLocaleString() : formatRelative(event.ts)}
        </time>
        <span className="timeline-row-actor">
          {event.actor?.name || (event.actor?.kind === 'system' ? 'system' : event.actor?.kind || '')}
        </span>
        <span className="timeline-row-type">{event.type}/{event.subType}</span>
        <span className="timeline-row-summary">{event.summary}</span>
      </button>
    </li>
  );
}

export default TimelineEvent;
