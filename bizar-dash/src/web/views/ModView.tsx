// src/views/ModView.tsx — render an installed mod's view (iframe or placeholder).
//
// Mounted as a top-level tab in App.tsx when a mod contributes a view via
// `entry.view` or `web/index.html`. Mods become first-class nav items
// alongside Overview, Chat, Mods, etc.

import { useEffect, useState } from 'react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { ExternalLink, Globe, LayoutTemplate, RefreshCw } from 'lucide-react';
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
};

type Props = {
  /** Mod view id, e.g. 'graphify:web'. */
  viewId: string;
  /** Force a refresh of the iframe key — bumped when the user clicks Reload. */
  reloadKey?: number;
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
        description={`No view with id "${viewId}" is currently installed.`}
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

  // Tab view (TSX component shipped with the mod) — fallback to
  // placeholder. Future versions can dynamically import the component.
  return (
    <Card>
      <CardTitle>
        <LayoutTemplate size={14} /> {view.label}
      </CardTitle>
      <CardMeta>by {view.modId}</CardMeta>
      {view.description && <p className="muted" style={{ marginTop: 8 }}>{view.description}</p>}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        This mod declared a TSX tab view but dynamic component loading from mods is not yet wired in v3.20.x.
        See the mod's README for the manual way to access this surface, or open the Mods page to browse its files.
      </p>
      <div style={{ marginTop: 12 }}>
        <Button variant="secondary" size="sm" onClick={() => setActiveTab('mods')}>
          Open Mods page
        </Button>
      </div>
    </Card>
  );
}
