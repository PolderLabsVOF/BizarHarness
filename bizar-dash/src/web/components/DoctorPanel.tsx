// src/components/DoctorPanel.tsx — v6.0.0 reusable Doctor panel.
//
// A Card-wrapped section of the Doctor page that renders a list of
// `DoctorCheck` rows with status pills, plus an optional info list
// (e.g. counts) below the checks. Each `category` carries a default
// icon and title so callers only need to pass the data.

import React from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  CircleDot,
  type LucideIcon,
  Server,
  Settings2,
  Wrench,
  Zap,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from './Card';
import { StatusBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import { cn } from '../lib/utils';
import type {
  DoctorCategory,
  DoctorCheck,
  DoctorPanelProps,
} from '../lib/types';

const CATEGORY_DEFAULTS: Record<
  DoctorCategory,
  { title: string; icon: LucideIcon; emptyTitle: string; emptyMessage: string }
> = {
  system: {
    title: 'System health',
    icon: Server,
    emptyTitle: 'No system checks',
    emptyMessage: 'System checks did not return any rows.',
  },
  services: {
    title: 'Services',
    icon: Zap,
    emptyTitle: 'No service probes',
    emptyMessage: 'Service probes did not return any rows.',
  },
  counts: {
    title: 'Counts',
    icon: Activity,
    emptyTitle: 'No counts',
    emptyMessage: 'No counts reported by the dashboard stores.',
  },
  errors: {
    title: 'Recent errors',
    icon: AlertOctagon,
    emptyTitle: 'No recent errors',
    emptyMessage: 'No error lines in the service log within the last hour.',
  },
  actions: {
    title: 'Actions',
    icon: Wrench,
    emptyTitle: 'No actions',
    emptyMessage: 'No actions available.',
  },
};

function statusIcon(status: DoctorCheck['status']) {
  if (status === 'ok') return CheckCircle2;
  if (status === 'warn') return CircleDot;
  return AlertOctagon;
}

function statusLabel(status: DoctorCheck['status']) {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  return 'fail';
}

/**
 * Reusable Doctor panel. Used by both the Doctor page and any future
 * settings sub-panels that want a consistent status-list render.
 *
 * When `children` is supplied, the default check-list render is
 * skipped — useful for the "Actions" category where the body is
 * a row of buttons, not a list of checks.
 */
export function DoctorPanel({
  category,
  title,
  icon,
  checks,
  info,
  meta,
  children,
  className,
}: DoctorPanelProps) {
  const def = CATEGORY_DEFAULTS[category];
  const Icon = icon ?? def.icon;
  const heading = title ?? def.title;
  const hasContent = checks.length > 0 || (info && info.length > 0) || children;
  return (
    <Card className={cn('doctor-panel', `doctor-panel-${category}`, className)}>
      <CardTitle>
        <Icon size={14} aria-hidden />
        <span>{heading}</span>
        {meta ? <span className="card-meta-inline muted">{meta}</span> : null}
      </CardTitle>
      {!hasContent ? (
        <EmptyState
          icon={<Icon size={28} aria-hidden />}
          title={def.emptyTitle}
          message={def.emptyMessage}
        />
      ) : (
        <div className="doctor-panel-body">
          {children}
          {checks.length > 0 ? (
            <ul className="doctor-check-list" role="list">
              {checks.map((c) => {
                const CheckIcon = statusIcon(c.status);
                return (
                  <li key={c.name} className={cn('doctor-check-row', `doctor-check-${c.status}`)}>
                    <span className="doctor-check-icon" aria-hidden>
                      <CheckIcon
                        size={14}
                        className={cn(
                          'doctor-check-icon-svg',
                          c.status === 'ok' && 'doctor-check-icon-ok',
                          c.status === 'warn' && 'doctor-check-icon-warn',
                          c.status === 'fail' && 'doctor-check-icon-fail',
                        )}
                      />
                    </span>
                    <span className="doctor-check-name mono">{c.name}</span>
                    <span className="doctor-check-message">{c.message}</span>
                    <StatusBadge kind={c.status} dot>
                      {statusLabel(c.status)}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {info && info.length > 0 ? (
            <dl className="doctor-info-list">
              {info.map((row) => (
                <React.Fragment key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className="tabular-nums">{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// Re-export the Settings icon so callers can override without an extra import.
export { Settings2 };