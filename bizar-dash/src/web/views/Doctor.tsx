// src/views/Doctor.tsx — v6.0.0 Doctor page.
//
// Full-page Doctor view: shows system health, service health, counts,
// recent errors, and action buttons. Refreshes every 30 seconds via
// the cheap `/api/doctor/health` endpoint and re-fetches the full
// snapshot on demand (initial mount, manual Refresh, or after a
// single-check POST so the operator sees the immediate result).
//
// The page deliberately leans on the existing Card component and the
// StatusBadge variants added in v6.0.0 (`ok`/`warn`/`fail`). Layout
// is a single column on narrow viewports, two columns on desktop —
// matching the rest of the dashboard's grid.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Download,
  FileText,
  RefreshCw,
  PlayCircle,
  Stethoscope,
  Clock,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { DoctorPanel } from '../components/DoctorPanel';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';
import type { DoctorSnapshot, DoctorCheck, Settings, Snapshot } from '../lib/types';

const REFRESH_INTERVAL_MS = 30_000;

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

function DoctorInner({
  setActiveTab,
}: Props) {
  const toast = useToast();
  const [data, setData] = useState<DoctorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const cancelledRef = useRef(false);

  const fetchSnapshot = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get<DoctorSnapshot>('/doctor');
      if (!cancelledRef.current) {
        setData(r);
        setLastFetched(Date.now());
        setLoading(false);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setLoading(false);
        toast.error(`Doctor refresh failed: ${(err as Error).message}`);
      }
    } finally {
      if (!cancelledRef.current) setRefreshing(false);
    }
  }, [toast]);

  // Initial fetch on mount
  useEffect(() => {
    cancelledRef.current = false;
    fetchSnapshot();
    return () => { cancelledRef.current = true; };
  }, [fetchSnapshot]);

  // 30s auto-refresh via the cheap health endpoint so the page
  // stays current without burning a full snapshot every tick. We
  // only trigger a full snapshot fetch if status changed.
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = async () => {
      try {
        const r = await api.get<{ status: string; issues: DoctorCheck[] }>('/doctor/health');
        setData((cur) => {
          if (!cur) return cur;
          if (cur.health.status !== r.status || cur.health.issues.length !== r.issues.length) {
            // Status changed — re-fetch the full snapshot
            fetchSnapshot();
          }
          return cur;
        });
      } catch { /* non-fatal */ }
    };
    const id = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchSnapshot]);

  const onRunCheck = async (checkName: string) => {
    try {
      const r = await api.post<DoctorCheck>('/doctor/check', { checkName });
      toast.info(`${r.name}: ${r.message}`, 4000);
      // Re-fetch so the panel reflects the fresh result
      await fetchSnapshot();
    } catch (err) {
      const apiErr = err as { status?: number; data?: { message?: string } };
      toast.error(`Check failed: ${apiErr.data?.message ?? (err as Error).message}`);
    }
  };

  const onExportJson = () => {
    if (!data) return;
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doctor-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  const onViewLogs = () => {
    // Logs live on the Settings → Activity Log surface (already
    // implemented). Set the tab and let the user browse.
    setActiveTab('settings');
  };

  const counts = data?.counts;
  const countsInfo = useMemo(() => {
    if (!counts) return [];
    return [
      { label: 'Tasks', value: counts.tasks },
      { label: 'Schedules', value: counts.schedules },
      { label: 'Mods', value: counts.mods },
      { label: 'Providers', value: counts.providers },
      { label: 'MCPs', value: counts.mcps },
      { label: 'Agents', value: counts.agents },
      { label: 'Projects', value: counts.projects },
      { label: 'Workspaces', value: counts.workspaces },
      { label: 'Voice notes', value: counts.voiceNotes },
      { label: 'Eval runs', value: counts.evalRuns },
      { label: 'Backups', value: counts.backups },
    ];
  }, [counts]);

  if (loading) {
    return (
      <div className="view view-doctor view-loading">
        <Spinner size="lg" />
        <p>Running health checks…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="view view-doctor">
        <Card>
          <CardTitle>
            <AlertOctagon size={14} /> Doctor unavailable
          </CardTitle>
          <CardMeta>Could not reach /api/doctor.</CardMeta>
          <div className="doctor-fallback-actions">
            <Button variant="primary" onClick={fetchSnapshot}>
              <RefreshCw size={12} /> Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const overall = data.health.status;
  const OverallIcon =
    overall === 'ok' ? CheckCircle2 : overall === 'warn' ? AlertTriangle : AlertOctagon;
  const overallLabel =
    overall === 'ok' ? 'Healthy' : overall === 'warn' ? 'Warning' : 'Failed';

  return (
    <div className="view view-doctor" data-overall={overall}>
      <div className="doctor-header">
        <div className="doctor-header-row">
          <div className="doctor-header-title">
            <Stethoscope size={20} aria-hidden />
            <h1>Doctor</h1>
          </div>
          <div className="doctor-header-status">
            <span className={cn('doctor-overall-pill', `doctor-overall-${overall}`)}>
              <OverallIcon size={14} aria-hidden />
              <span className="doctor-overall-label">{overallLabel}</span>
              <StatusBadge kind={overall} dot>
                {data.health.issues.length} issue{data.health.issues.length === 1 ? '' : 's'}
              </StatusBadge>
            </span>
          </div>
        </div>
        <div className="doctor-header-meta muted">
          <Clock size={12} aria-hidden />
          <span aria-live="polite" aria-atomic="true">
            v{data.bizarVersion} · {data.platform}/{data.arch} ·{' '}
            up {Math.floor(data.uptime)}s
            {lastFetched ? ` · refreshed ${formatTime(new Date(lastFetched))}` : ''}
          </span>
        </div>
      </div>

      <div className="doctor-grid">
        <DoctorPanel
          category="system"
          checks={data.checks.system}
          meta={`${data.platform}/${data.arch}`}
        />
        <DoctorPanel
          category="services"
          checks={data.checks.services}
          meta={
            data.services.opencode?.reachable
              ? `opencode on ${data.services.opencode.port ?? '?'}`
              : 'opencode not connected'
          }
        />
        <DoctorPanel
          category="counts"
          checks={[]}
          info={countsInfo}
          meta={counts?.activeProject ? `active: ${counts.activeProject}` : 'no active project'}
        />
        <Card className="doctor-errors-card">
          <CardTitle>
            <AlertOctagon size={14} aria-hidden />
            <span>Recent errors (last hour)</span>
            <span className="card-meta-inline muted">
              {data.recentErrors.length} line{data.recentErrors.length === 1 ? '' : 's'}
            </span>
          </CardTitle>
          {data.recentErrors.length === 0 ? (
            <div className="muted doctor-errors-empty">No errors in the last hour. Nice.</div>
          ) : (
            <ul className="doctor-errors-list" role="list">
              {data.recentErrors.map((e, idx) => (
                <li key={`${e.tsMs ?? idx}-${idx}`} className="doctor-error-row">
                  <span className="doctor-error-ts mono">
                    {e.ts ? formatTime(new Date(e.ts)) : '??:??:??'}
                  </span>
                  <span className="doctor-error-line mono">{e.line}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="doctor-actions-card">
          <CardTitle>
            <PlayCircle size={14} aria-hidden /> Actions
          </CardTitle>
          <CardMeta>Run a check, view logs, or export the snapshot.</CardMeta>
          <div className="doctor-actions-row">
            <Button variant="primary" onClick={fetchSnapshot} disabled={refreshing} aria-label="Refresh diagnostics">
              {refreshing ? <Spinner size="sm" /> : <RefreshCw size={12} />}
              {refreshing ? 'Running…' : 'Run Health Check Now'}
            </Button>
            <Button variant="secondary" onClick={onViewLogs}>
              <FileText size={12} /> View Full Logs
            </Button>
            <Button variant="secondary" onClick={onExportJson}>
              <Download size={12} /> Export Diagnostics as JSON
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAutoRefresh((v) => !v)}
              aria-label={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            >
              {autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            </Button>
          </div>
          {data.checks.services.some((c) => c.status !== 'ok') ||
          data.checks.config.some((c) => c.status !== 'ok') ? (
            <div className="doctor-actions-rerun">
              <span className="muted">Rerun a single check:</span>
              <div className="doctor-actions-rerun-row">
                {[
                  ...data.checks.services,
                  ...data.checks.config,
                ]
                  .filter((c) => c.status !== 'ok')
                  .map((c) => (
                    <Button
                      key={c.name}
                      variant="ghost"
                      size="sm"
                      onClick={() => onRunCheck(c.name)}
                      title={`Run check: ${c.name}`}
                    >
                      <PlayCircle size={10} /> {c.name}
                    </Button>
                  ))}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export const Doctor = React.memo(DoctorInner);