import { type ReactNode } from 'react';
import { Activity, Zap } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { Avatar } from '../data/Avatar.js';
import { Badge } from '../data/Badge.js';
import { Sparkline } from '../data/Sparkline.js';

/**
 * AgentCard — agent tile for the Agents roster.
 *
 * Per PLAN.md, agents are the orchestrator's running entities. Each card
 * shows: name, status (idle/busy/error), role (description), last activity,
 * token usage sparkline, current task title.
 */

export type AgentStatus = 'idle' | 'busy' | 'error' | 'paused';

export interface AgentCardProps {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  /** Last activity label ("2m ago", "Just now"). */
  lastActivity?: string;
  /** Tokens-per-minute sparkline data (last 20 buckets). */
  tpmHistory?: readonly number[];
  /** Current task the agent is working on. */
  currentTask?: string;
  /** Number of tasks completed in the last 24h. */
  tasksToday?: number;
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

export function AgentCard(props: AgentCardProps) {
  const {
    name,
    role,
    status,
    lastActivity,
    tpmHistory,
    currentTask,
    tasksToday,
    onOpen,
    badges,
    className,
  } = props;

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
      {tpmHistory !== undefined && tpmHistory.length > 1 && (
        <div style={{ marginTop: 'var(--space-1)' }}>
          <Sparkline
            data={tpmHistory}
            width={240}
            height={28}
            stroke={STATUS_FG[status]}
          />
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