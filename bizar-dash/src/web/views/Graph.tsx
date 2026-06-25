// src/views/Graph.tsx — v3.15.0: interactive knowledge-graph viewer.
//
// Embeds .bizar/graph/graph.html (graphify's vis-network visualization)
// via an iframe with srcDoc so the HTML runs in our origin with full
// DOM access — that lets us poll a few stats out of the iframe for the
// surrounding chrome (community count, current selection, etc.) without
// needing a cross-origin postMessage protocol.
//
// Build flow:
//   1. GET /api/graph/status → { exists, nodes, edges, ... }
//   2. If !exists → show empty state with a "Build" button.
//   3. POST /api/graph/build → { jobId } → poll /api/graph/build/:jobId/status
//      until status === 'done' || 'failed'.
//   4. Reload the iframe from /api/graph/html on success.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Network,
  RefreshCw,
  AlertTriangle,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import type { Snapshot, Settings } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type GraphStatus = {
  exists: boolean;
  graphDir?: string;
  graphJsonPath?: string;
  htmlPath?: string;
  reportPath?: string;
  nodes?: number;
  edges?: number;
  communities?: number;
  lastBuilt?: string;
  sizeBytes?: number;
  hasHtml?: boolean;
  hasReport?: boolean;
  buildJobs?: Array<{
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    exitCode: number | null;
  }>;
};

type BuildJob = {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logPath?: string;
};

export function Graph({ refreshSnapshot }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<BuildJob | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<GraphStatus>('/graph/status');
      setStatus(s);
    } catch (err) {
      console.error('Graph status fetch failed', err);
      toast.error(`Failed to fetch graph status: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll active build job until done / failed, then reload status.
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const j = await api.get<BuildJob>(`/graph/build/${activeJob.id}/status`);
        if (cancelled) return;
        if (j.status !== 'running') {
          setActiveJob(j);
          if (j.status === 'done') {
            toast.success(`Graph built (${j.exitCode === 0 ? 'ok' : `exit=${j.exitCode}`}). Reloading view…`);
            await refresh();
            setIframeKey((k) => k + 1);
          } else {
            toast.error(`Graph build failed (exit=${j.exitCode ?? '?'}). See log: ${j.logPath ?? '<unknown>'}`);
          }
          return;
        }
      } catch (err) {
        console.error('Job status poll failed', err);
      }
      timer = setTimeout(tick, 2000);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJob, refresh, toast]);

  const startBuild = useCallback(async () => {
    try {
      const r = await api.post<{ jobId: string; logPath?: string }>('/graph/build', {});
      setActiveJob({
        id: r.jobId,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        logPath: r.logPath,
      });
      toast.info(`Build started (job ${r.jobId}). This can take 30-120s on first run.`);
    } catch (err) {
      toast.error(`Failed to start build: ${(err as Error).message}`);
    }
  }, [toast]);

  const reload = useCallback(() => {
    setIframeKey((k) => k + 1);
    refresh();
  }, [refresh]);

  if (loading && !status) {
    return (
      <div className="view-container">
        <div className="view-loading">
          <Spinner />
          <span className="muted">Loading graph status…</span>
        </div>
      </div>
    );
  }

  const hasGraph = status?.exists && status?.hasHtml;
  const building = activeJob?.status === 'running';

  return (
    <div className="view-container view-graph">
      <div className="view-header">
        <div className="view-title-group">
          <Network size={20} />
          <h2 className="view-title">Knowledge Graph</h2>
          {status?.exists && (
            <span className="muted small">
              {status.nodes?.toLocaleString() ?? 0} nodes ·{' '}
              {status.edges?.toLocaleString() ?? 0} edges ·{' '}
              {status.communities?.toLocaleString() ?? 0} communities
            </span>
          )}
        </div>
        <div className="view-header-actions">
          {status?.hasReport && (
            <a
              href={api.urlWithToken('/graph/report')}
              target="_blank"
              rel="noreferrer"
              className="icon-btn"
              title="Open GRAPH_REPORT.md in new tab"
            >
              <FileText size={16} />
            </a>
          )}
          {status?.exists && (
            <a
              href={api.urlWithToken('/graph/html')}
              target="_blank"
              rel="noreferrer"
              className="icon-btn"
              title="Open graph.html in new tab"
            >
              <ExternalLink size={16} />
            </a>
          )}
          <Button
            onClick={status?.exists ? reload : startBuild}
            disabled={building}
            variant={status?.exists ? 'ghost' : 'primary'}
          >
            {building ? (
              <>
                <Spinner size="sm" /> Building…
              </>
            ) : status?.exists ? (
              <>
                <RefreshCw size={14} /> Rebuild
              </>
            ) : (
              <>
                <Network size={14} /> Build graph
              </>
            )}
          </Button>
        </div>
      </div>

      {building && (
        <div className="graph-building-banner">
          <Spinner size="sm" />
          <span>
            Building graph (job <code>{activeJob?.id}</code>)… this typically
            takes 30-120s on first run. The view will refresh automatically when
            done.
          </span>
        </div>
      )}

      {!hasGraph && !building && (
        <Card>
          <CardTitle>No graph yet</CardTitle>
          <CardMeta>
            <p>
              Bizar's knowledge graph (powered by{' '}
              <a
                href="https://github.com/safishamsi/graphify"
                target="_blank"
                rel="noreferrer"
              >
                graphify
              </a>
              ) builds a structural map of your project — modules, functions,
              types, imports, call sites — and renders it as an interactive
              visualization.
            </p>
            <p>
              Without an LLM API key, Bizar runs in code-only mode (extracts the
              AST via tree-sitter; no docs/papers/images semantic step). With{' '}
              <code>GEMINI_API_KEY</code> / <code>OPENAI_API_KEY</code> /{' '}
              <code>ANTHROPIC_API_KEY</code> / etc., it adds LLM-powered
              relationship extraction across docs and code.
            </p>
            <div className="graph-empty-actions">
              <Button onClick={startBuild} variant="primary">
                Build graph
              </Button>
              {status?.graphDir && (
                <span className="muted small">
                  Output dir: <code>{status.graphDir}</code>
                </span>
              )}
            </div>
          </CardMeta>
        </Card>
      )}

      {hasGraph && (
        <div className="graph-iframe-wrap">
          <iframe
            key={iframeKey}
            ref={iframeRef}
            title="Knowledge graph"
            className="graph-iframe"
            src={api.urlWithToken('/graph/html')}
          />
        </div>
      )}

      {status?.lastBuilt && hasGraph && (
        <div className="graph-meta muted small">
          Last built {new Date(status.lastBuilt).toLocaleString()} ·{' '}
          {(status.sizeBytes ?? 0 / 1024).toLocaleString()} KB
        </div>
      )}
    </div>
  );
}