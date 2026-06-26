// src/views/ModView.tsx — render an installed mod's view (iframe or TSX tab).
//
// Mounted as a top-level tab in App.tsx when a mod contributes a view via
// `entry.view` or `web/index.html`. Mods become first-class nav items
// alongside Overview, Chat, Mods, etc.

import { Suspense, lazy, useEffect, useState } from 'react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ExternalLink, Globe, LayoutTemplate, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

export type ModView = {
  id: string;
  modId: string;
  kind: 'iframe' | 'tab';
  label: string;
  description?: string;
  path?: string;
  icon?: string;
  component?: string | null;
};

type Props = {
  /** Mod view id, e.g. 'graphify:web'. */
  viewId: string;
  /** Force a refresh of the iframe key — bumped when the user clicks Reload. */
  reloadKey?: number;
  /** Currently active tab id — kept on the Props surface so the parent
   * (App.tsx) doesn't have to know which props the mod view consumes. */
  activeTab?: string;
  setActiveTab: (id: string) => void;
};

export function ModView({ viewId, reloadKey, setActiveTab }: Props) {
  const toast = useToast();
  const [view, setView] = useState<ModView | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeReload, setIframeReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ views: ModView[] }>('/mods/views');
        if (cancelled) return;
        const found = (r.views || []).find((v) => v.id === viewId);
        setView(found || null);
      } catch (err) {
        toast.error(`Failed to load mod view: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewId, toast]);

  if (loading) {
    return <EmptyState title="Loading mod view…" />;
  }

  if (!view) {
    return (
      <EmptyState
        title="Mod view not found"
        message={`No view with id "${viewId}" is currently installed.`}
        action={<Button onClick={() => setActiveTab('mods')} variant="primary" size="sm">
          Open Mods
        </Button>}
      />
    );
  }

  // Iframe view: embed the mod's web/index.html in the dashboard.
  if (view.kind === 'iframe') {
    const src = `/api/mods/${view.modId}/web/index.html?t=${iframeReload + (reloadKey || 0)}`;
    return (
      <div className="mod-view-iframe-pane">
        <div className="mod-view-iframe-header">
          <span className="mod-view-iframe-label">
            <Globe size={14} />
            {view.label}
            <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>by {view.modId}</span>
          </span>
          <div className="mod-view-iframe-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIframeReload((n) => n + 1)}
              title="Reload this view"
            >
              <RefreshCw size={11} /> Reload
            </Button>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <iframe
          key={iframeReload + (reloadKey || 0)}
          src={src}
          className="mod-view-iframe"
          title={view.label}
        />
      </div>
    );
  }

  // v3.20.5 — Tab view (React component shipped with the mod). The
  // component is dynamically imported from /api/mods/<id>/views/<file>.
  // Mods ship a pre-built ES module (default export = React component).
  // If the registry declared a component path, we lazy-load it.
  if (view.component) {
    // Capture the narrowed values into locals so the lazy() closure
    // doesn't have to re-check nullability through `view`.
    const componentPath: string = view.component;
    const modId: string = view.modId;
    const ModComponent = lazy(() =>
      import(
        /* @vite-ignore */
        `/api/mods/${encodeURIComponent(modId)}/views/${encodeURIComponent(componentPath)}`
      ).then((m) => ({ default: m.default ?? (() => null) })),
    );
    return (
      <div className="mod-view-tab-pane">
        <div className="mod-view-iframe-header">
          <span className="mod-view-iframe-label">
            <LayoutTemplate size={14} />
            {view.label}
            <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>by {view.modId}</span>
          </span>
        </div>
        <div className="mod-view-tab-body">
          <ErrorBoundary modId={view.modId} component={view.component}>
            <Suspense fallback={<div style={{ padding: 24 }}><Spinner size="md" /> <span className="muted">Loading mod view…</span></div>}>
              <ModComponent />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Tab kind with no component path — show a placeholder.
  return (
    <Card>
      <CardTitle>
        <LayoutTemplate size={14} /> {view.label}
      </CardTitle>
      <CardMeta>by {view.modId}</CardMeta>
      {view.description && <p className="muted" style={{ marginTop: 8 }}>{view.description}</p>}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        This mod declared a tab view but did not provide a component path in views/registry.json.
        Add a <code>component</code> field (e.g. <code>"MyView.js"</code>) and ship the file under <code>views/</code>.
      </p>
      <div style={{ marginTop: 12 }}>
        <Button variant="secondary" size="sm" onClick={() => setActiveTab('mods')}>
          Open Mods page
        </Button>
      </div>
    </Card>
  );
}

/**
 * Minimal error boundary for dynamically imported mod views. Catches
 * a failure to load the module (404, syntax error in the mod's code,
 * React.render-time throw) and renders a clean fallback instead of
 * crashing the dashboard shell.
 */
import { Component as ReactComponent, type ReactNode } from 'react';

class ErrorBoundary extends ReactComponent<
  { children: ReactNode; modId: string; component: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch() {
    /* swallow — error surfaced via state */
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="mod-view-error">
          <AlertTriangle size={16} />
          <strong>Failed to render mod view</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {this.props.modId} → {this.props.component}: {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
