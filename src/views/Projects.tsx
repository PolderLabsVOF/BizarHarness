// src/views/Projects.tsx — discovered projects + activate.
import { useEffect, useMemo, useState } from 'react';
import { Folder, RefreshCw, FolderOpen } from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatRelative } from '../lib/utils';
import type { Project, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

export function Projects({ snapshot }: Props) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>(snapshot.projects || []);
  const [loading, setLoading] = useState(!snapshot.projects);

  useEffect(() => {
    if (snapshot.projects?.length) {
      setProjects(snapshot.projects);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ projects: Project[] }>('/projects')
      .then((d) => {
        if (!cancelled) {
          setProjects(d.projects || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          toast.error(`Could not load projects: ${(err as Error).message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.projects, toast]);

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return b.mtime - a.mtime;
      }),
    [projects],
  );

  const refresh = async () => {
    try {
      const d = await api.get<{ projects: Project[] }>('/projects');
      setProjects(d.projects || []);
      toast.info('Projects refreshed.', 1500);
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    }
  };

  const activate = async (name: string) => {
    try {
      await api.post(`/projects/${encodeURIComponent(name)}/activate`);
      toast.success(
        `Activated "${name}". Restart the TUI in that directory to fully switch.`,
      );
      await refresh();
    } catch (err) {
      toast.error(`Activate failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view view-projects">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Folder size={18} /> Projects ({projects.length})
          </h2>
          <p className="view-subtitle">
            Discovered from .bizar/PROJECT.md markers in cwd and ~/Projects.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="view-loading">
          <Spinner size="lg" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={32} />}
          title="No projects found"
          message={
            <>
              No <code>.bizar/PROJECT.md</code> files in cwd or <code>~/Projects</code>.
            </>
          }
        />
      ) : (
        <div className="project-grid">
          {sorted.map((p) => (
            <Card
              key={p.path}
              variant="elevated"
              className={cn('project-card', p.active && 'project-card-active')}
            >
              <div className="project-card-head">
                <CardTitle>{p.name}</CardTitle>
                {p.active && <StatusBadge kind="accent">active</StatusBadge>}
              </div>
              <div className="project-card-path mono" title={p.path}>
                {p.path}
              </div>
              <CardMeta>
                {p.projectMdSize
                  ? `PROJECT.md: ${p.projectMdSize} bytes`
                  : 'no PROJECT.md'}
                {p.hindsightCount > 0 && ` · .hindsight: ${p.hindsightCount}`}
                {' · '}accessed {formatRelative(p.mtime)}
              </CardMeta>
              <div className="project-card-actions">
                <Button
                  variant={p.active ? 'ghost' : 'primary'}
                  size="sm"
                  disabled={p.active}
                  onClick={() => activate(p.name)}
                >
                  <FolderOpen size={12} /> Activate
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
