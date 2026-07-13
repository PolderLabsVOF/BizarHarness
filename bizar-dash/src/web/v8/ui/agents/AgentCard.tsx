import { type ReactNode } from 'react';
import { Activity, Zap } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { Avatar } from '../data/Avatar.js';
import { Badge } from '../data/Badge.js';
import { ProgressBar } from '../data/ProgressBar.js';

/**
 * AgentCard — agent tile for the Agents roster.
 *
 * Per PLAN.md, agents are the orchestrator's running entities. Each card
 * shows: name, status (idle/busy/error), role, last activity, and a
 * three-row metrics strip (tasks succeeded/total, success rate, lastSeen).
 *
 * v9.4.0 S45 — replaced the dead single-point sparkline (line 140
 * guarded `tpmHistory.length > 1`, never true) with a data-driven
 * metric strip that always renders when the fields are supplied.
 */

export type AgentStatus = 'idle' | 'busy' | 'error' | 'paused';

export interface AgentCardProps {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  /** Last activity label ("2m ago", "Just now"). */
  lastActivity?: string;
  /** Current task the agent is working on. */
  currentTask?: string;
  /** Number of tasks completed in the last 24h. */
  tasksToday?: number;
  /** Tasks succeeded (numerator of the ProgressBar). */
  tasksSucceeded?: number;
  /** Tasks total (denominator of the ProgressBar). */
  tasksTotal?: number;
  /** Success rate as 0..1. Tones the badge: >=0.8 success, >=0.5 warning, else danger. */
  successRate?: number;
  /** Last-seen timestamp in ms-since-epoch. Rendered as relative duration. */
  lastSeenMs?: number;
  /** Click handler — opens agent detail. */
  onOpen?: () => void;
  /** Custom badges row (model, owner). */
  badges?: ReactNode;
  className?: string;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  busy: 'Busy',
  error: 'Error',
  paused: 'Paused',
};

const STATUS_TONE: Record<AgentStatus, 'success' | 'info' | 'danger' | 'neutral'> = {
  idle: 'neutral',
  busy: 'info',
  error: 'danger',
  paused: 'neutral',
};

const STATUS_FG: Record<AgentStatus, string> = {
  idle: 'var(--fg-subtle)',
  busy: 'var(--info)',
  error: 'var(--danger)',
  paused: 'var(--warning)',
};

/** relativeTime — "12s", "3m", "2h", "5d". Returns "—" for missing / future timestamps. */
function relativeTime(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  const delta = Math.max(0, Date.now() - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function successTone(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 0.8) return 'success';
  if (rate >= 0.5) return 'warning';
  return 'danger';
}

function lastSeenTone(ms: number | undefined): 'neutral' | 'danger' {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'neutral';
  const days = (Date.now() - ms) / 86_400_000;
  return days > 1 ? 'danger' : 'neutral';
}

export function AgentCard(props: AgentCardProps): JSX.Element {
  const {
    name,
    role,
    status,
    lastActivity,
    currentTask,
    tasksToday,
    tasksSucceeded,
    tasksTotal,
    successRate,
    lastSeenMs,
    onOpen,
    badges,
    className,
  } = props;

  const showMetrics =
    (typeof tasksSucceeded === 'number' && typeof tasksTotal === 'number') ||
    typeof successRate === 'number' ||
    typeof lastSeenMs === 'number';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('v8-agent-card', `v8-agent-card--${status}`, className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-4)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        transition: 'border-color var(--motion-fast) var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Avatar name={name} status={status === 'busy' ? 'busy' : status === 'error' ? 'busy' : status === 'idle' ? 'online' : 'away'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--fg)', lineHeight: 'var(--lh-snug)' }}>
            {name}
          </div>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>
            {role}
          </div>
        </div>
        <Badge tone={STATUS_TONE[status]} dot>
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      {currentTask !== undefined && (
        <div
          style={{
            fontSize: 'var(--fs-13)',
            color: 'var(--fg)',
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={currentTask}
        >
          {currentTask}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        {lastActivity !== undefined && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Activity size={12} aria-hidden="true" style={{ color: STATUS_FG[status] }} />
            {lastActivity}
          </span>
        )}
        {tasksToday !== undefined && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Zap size={12} aria-hidden="true" />
            {tasksToday} today
          </span>
        )}
      </div>
      {showMetrics && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {typeof tasksSucceeded === 'number' && typeof tasksTotal === 'number' && tasksTotal > 0 && (
            <div data-testid="agent-card-tasks" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  fontSize: 'var(--fs-12)',
                  color: 'var(--fg-muted)',
                }}
              >
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>tasks</span>
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
                  {tasksSucceeded} / {tasksTotal}
                </code>
              </div>
              <ProgressBar value={tasksSucceeded} max={tasksTotal} tone="accent" height={4} />
            </div>
          )}
          {typeof successRate === 'number' && (
            <div
              data-testid="agent-card-success"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                success
              </span>
              <Badge data-testid="agent-card-success-badge" tone={successTone(successRate)}>
                {Math.round(successRate * 100)}% success
              </Badge>
            </div>
          )}
          {typeof lastSeenMs === 'number' && (
            <div
              data-testid="agent-card-lastseen"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                last seen
              </span>
              <Badge data-testid="agent-card-lastseen-badge" tone={lastSeenTone(lastSeenMs)}>{relativeTime(lastSeenMs)}</Badge>
            </div>
          )}
        </div>
      )}
      {badges !== undefined && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{badges}</div>
      )}
      <style>{`
        .v8-agent-card:hover { border-color: var(--accent); }
      `}</style>
    </button>
  );
}