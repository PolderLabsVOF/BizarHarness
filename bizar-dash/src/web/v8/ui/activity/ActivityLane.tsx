import type { CSSProperties, ReactNode } from 'react';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { cx } from '../utils/cx.js';
import type { LucideIcon } from 'lucide-react';

/**
 * ActivityLane — vertical swimlane of activity events keyed to a single
 * actor (agent / system / user). Layout: sticky header + scrollable list.
 *
 * Used by `ActivityView` (inspired by patoles/agent-flow) to render one
 * column per actor. Width is fixed by the parent (default 320px) so lanes
 * read as discrete swimlanes.
 *
 * Visual conventions:
 *   - First 3 events keep `tone` icon + chip; overflow collapses into a
 *     inline `<details>` so the lane doesn't dominate the viewport.
 *   - Header tone chip uses `tone` for at-a-glance activity health.
 *
 * Event rows are fully clickable when `onEventClick` is set; the parent
 * owns the routing logic.
 */
export interface ActivityLaneEvent {
  id: string;
  title: string;
  description?: string;
  ts: number;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  icon?: LucideIcon;
  href?: string;
  kind?: string;
  agent?: string;
  actor?: string;
  slug?: string;
  raw?: unknown;
}

export interface ActivityLaneProps {
  /** Stable id for this lane — used as React key + DOM data-lane. */
  laneId: string;
  /** Display label (agent name, "system", etc). */
  label: string;
  /** Optional icon rendered next to the label in the header. */
  icon?: LucideIcon;
  /** Events belonging to this lane (newest first). */
  events: readonly ActivityLaneEvent[];
  /** When true the lane shows a skeleton in place of events. */
  loading?: boolean;
  /** Click-through handler; row becomes a real button when set. */
  onEventClick?: (event: ActivityLaneEvent) => void;
  /** Hide lanes whose events array is empty. */
  collapsible?: boolean;
  /** Optional right-side header content (count chip, tone, status). */
  trailing?: ReactNode;
  /** Lane width in CSS units (default `'320px'`). */
  width?: string | number;
  className?: string;
}

const TONE_VAR: Record<NonNullable<ActivityLaneEvent['tone']>, string> = {
  neutral: 'var(--fg-muted)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

function timeShort(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ActivityLane(props: ActivityLaneProps): JSX.Element {
  const {
    laneId,
    label,
    icon: Icon,
    events,
    loading = false,
    onEventClick,
    collapsible = false,
    trailing,
    width = '320px',
    className,
  } = props;

  const style: CSSProperties = {
    width,
    minWidth: width,
    maxWidth: width,
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle: CSSProperties = {
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '1px solid var(--border)',
    background: 'color-mix(in oklch, var(--surface-0) 70%, transparent)',
    backdropFilter: 'blur(6px)',
  };

  return (
    <section
      aria-label={`${label} activity`}
      data-lane-id={laneId}
      data-testid={`activity-lane-${laneId}`}
      className={cx('v8-activity-lane', className)}
      style={style}
    >
      <header style={headerStyle}>
        <Inline align="center" justify="between" gap={2} wrap>
          <Inline align="center" gap={2}>
            {Icon && <Icon size={14} aria-hidden style={{ color: 'var(--accent)' }} />}
            <strong style={{ fontSize: 'var(--fs-13)', color: 'var(--fg)' }}>{label}</strong>
          </Inline>
          <Inline align="center" gap={1}>
            {trailing}
            <span
              aria-label={`${events.length} events`}
              style={{
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {events.length}
            </span>
          </Inline>
        </Inline>
      </header>

      <Stack
        role="list"
        aria-label={`${label} events`}
        gap={1}
        style={{
          padding: 'var(--space-2)',
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
        }}
        data-testid={`activity-lane-list-${laneId}`}
      >
        {loading && events.length === 0 ? (
          <LaneSkeleton />
        ) : events.length === 0 ? (
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)', padding: 'var(--space-2)' }}>
            {collapsible ? '' : 'No events yet.'}
          </span>
        ) : (
          events.map((e) => {
            const tone = e.tone ?? 'neutral';
            const EventIcon = e.icon;
            const interactive = typeof onEventClick === 'function';
            const rowStyle: CSSProperties = {
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid transparent',
              background: interactive ? 'var(--surface-0)' : 'transparent',
              cursor: interactive ? 'pointer' : 'default',
              transition: 'border-color 120ms ease, background 120ms ease',
              textAlign: 'left',
            };
            const inner = (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-pill)',
                    background: `color-mix(in oklch, ${TONE_VAR[tone]} 18%, transparent)`,
                    color: TONE_VAR[tone],
                    flexShrink: 0,
                  }}
                >
                  {EventIcon ? <EventIcon size={12} aria-hidden /> : null}
                </span>
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <span
                    title={e.title}
                    style={{
                      fontSize: 'var(--fs-12)',
                      fontWeight: 500,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.title}
                  </span>
                  {e.description && (
                    <span
                      title={e.description}
                      style={{
                        fontSize: 'var(--fs-12)',
                        color: 'var(--fg-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.description}
                    </span>
                  )}
                </Stack>
                <span
                  style={{
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                    textAlign: 'right',
                  }}
                  title={new Date(e.ts).toISOString()}
                >
                  {timeShort(e.ts)}
                </span>
              </>
            );
            return interactive ? (
              <button
                type="button"
                key={e.id}
                role="listitem"
                data-activity-event-id={e.id}
                data-activity-kind={e.kind ?? ''}
                data-activity-slug={e.slug ?? ''}
                data-activity-href={e.href ?? ''}
                data-testid={`activity-event-${e.id}`}
                onClick={() => onEventClick?.(e)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onEventClick?.(e);
                  }
                }}
                style={rowStyle}
                aria-label={`Open ${e.title}`}
              >
                {inner}
              </button>
            ) : (
              <div
                key={e.id}
                role="listitem"
                data-activity-event-id={e.id}
                data-activity-kind={e.kind ?? ''}
                data-activity-slug={e.slug ?? ''}
                style={rowStyle}
              >
                {inner}
              </div>
            );
          })
        )}
      </Stack>

      {!loading && events.length > 0 && (
        <footer
          style={{
            padding: '4px var(--space-3)',
            borderTop: '1px solid var(--border)',
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>latest {relTime(events[0].ts)}</span>
          <span>{events.length === 1 ? '1 event' : `${events.length} events`}</span>
        </footer>
      )}
    </section>
  );
}

function LaneSkeleton(): JSX.Element {
  return (
    <Stack gap={1}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 36,
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in oklch, var(--fg-muted) 8%, transparent)',
          }}
        />
      ))}
    </Stack>
  );
}
