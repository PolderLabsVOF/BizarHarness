/**
 * v8/views/Projects/ProjectsView.tsx — Sprint S39, v9.3.0.
 *
 * The project registry surface. Shows every registered project,
 * lets the user mark one active, add by path (Sheet form), and
 * remove (inline confirm). Two utility actions sit in the header:
 *   - Auto-detect: POST /api/projects/auto-detect (adds cwd)
 *   - Scan:        POST /api/projects/scan (walks the configured
 *                   dashboard.projectsDirectory and adds any new
 *                   roots it finds).
 *
 * Live refresh on the `project:change` WS event the server already
 * broadcasts from routes/projects.mjs.
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, RefreshCcw, ScanSearch, Sparkles, Trash2 } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { ListHeader } from '../../ui/data/ListHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetClose, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Badge } from '../../ui/data/Badge.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { Project, WsMessage } from '../../data/types.js';

interface ProjectsPayload {
  projects: Project[];
}

/** Returns true for internal harness/CI test project IDs. */
function isTestProject(p: Project): boolean {
  return (
    /^(bizar-(e2e|real-env|admin)|bh-(cold-boot|walk-proj))/.test(p.id) ||
    (p.name != null && p.name === p.id)
  );
}

export function ProjectsView(): JSX.Element {
  const payload = useFetch<ProjectsPayload>('/api/projects');
  const [adding, setAdding] = useState<boolean>(false);
  const [newPath, setNewPath] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showTestProjects, setShowTestProjects] = useState<boolean>(false);

  const allProjects = payload.data?.projects ?? [];
  const projects = showTestProjects ? allProjects : allProjects.filter((p) => !isTestProject(p));
  const activeId = projects.find((p) => p.active)?.id ?? null;

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);
  useWsMessage('project:change', refresh);

  const add = async (): Promise<void> => {
    const path = newPath.trim();
    if (!path || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson<Project>('/api/projects', {
        method: 'POST',
        body: { path, name: newName.trim() || null },
      });
      setNewPath('');
      setNewName('');
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}/activate`, { method: 'POST', body: {} });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const autoDetect = async (): Promise<void> => {
    setError(null);
    try {
      await fetchJson('/api/projects/auto-detect', { method: 'POST', body: {} });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const scan = async (): Promise<void> => {
    setError(null);
    try {
      await fetchJson('/api/projects/scan', { method: 'POST', body: {} });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="projects-view">
      <ViewHeader
        title="Projects"
        description="Registered project roots. One is active at a time — every active-project endpoint scopes to it."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="projects-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            {allProjects.some((p) => isTestProject(p)) && (
              <Button
                variant={showTestProjects ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setShowTestProjects((v) => !v)}
                data-testid="projects-toggle-test"
              >
                {showTestProjects ? 'Hide test projects' : 'Show test projects'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void scan()} data-testid="projects-scan">
              <ScanSearch size={14} aria-hidden /> Scan configured dir
            </Button>
            <Button variant="ghost" onClick={() => void autoDetect()} data-testid="projects-auto-detect">
              <Sparkles size={14} aria-hidden /> Auto-detect cwd
            </Button>
            <Button variant="ghost" onClick={() => void refresh()} data-testid="projects-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)} data-testid="projects-add">
              <FolderPlus size={14} aria-hidden /> Add project
            </Button>
          </Inline>
        }
      />
      <ListHeader title="Registered" count={projects.length} testid="projects-list-header" />

      <Card variant="default">
        <CardBody>
          {payload.loading && projects.length === 0 ? (
            <Stack gap={2}>
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
            </Stack>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<FolderPlus size={28} aria-hidden />}
              title="No projects yet"
              description="Add a path, auto-detect the server cwd, or scan the configured projects directory."
            />
          ) : (
            <Stack gap={2}>
              {projects.map((p) => {
                const isActive = p.id === activeId;
                const isConfirmingDelete = confirmDeleteId === p.id;
                return (
                  <div
                    key={p.id}
                    data-testid={`project-row-${p.id}`}
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: isActive ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={3}>
                      <Stack gap={1} style={{ minWidth: 0 }}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-13)' }}>
                            {p.name || p.path.split('/').pop() || p.id}
                          </strong>
                          {isActive && <Badge tone="success">Active</Badge>}
                        </Inline>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', overflowWrap: 'anywhere' }}>
                          {p.path}
                        </span>
                      </Stack>
                      <Inline gap={1}>
                        {!isActive && (
                          <Button variant="primary" onClick={() => void activate(p.id)} data-testid={`project-activate-${p.id}`}>
                            Activate
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmDeleteId((cur) => (cur === p.id ? null : p.id))}
                          data-testid={`project-delete-${p.id}`}
                          aria-label={`Remove project ${p.id}`}
                        >
                          <Trash2 size={14} aria-hidden /> Remove
                        </Button>
                      </Inline>
                    </Inline>
                    {isConfirmingDelete && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-2)' }}>
                        <Button variant="danger" onClick={() => void remove(p.id)} data-testid={`project-confirm-delete-${p.id}`}>
                          Confirm remove
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDeleteId(null)} data-testid={`project-cancel-delete-${p.id}`}>
                          Cancel
                        </Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" title="Add project" description="Register an existing directory as a project root.">
          <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Path</span>
              <Input
                placeholder="/absolute/path/to/project"
                value={newPath}
                data-testid="projects-add-path"
                onChange={(e) => setNewPath((e.target as HTMLInputElement).value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Display name (optional)</span>
              <Input
                placeholder="My project"
                value={newName}
                data-testid="projects-add-name"
                onChange={(e) => setNewName((e.target as HTMLInputElement).value)}
              />
            </label>
            <Inline justify="end" gap={2}>
              <SheetClose asChild>
                <Button variant="ghost" data-testid="projects-add-cancel">Cancel</Button>
              </SheetClose>
              <Button variant="primary" onClick={() => void add()} disabled={busy || newPath.trim() === ''} data-testid="projects-add-submit">
                Add
              </Button>
            </Inline>
          </Stack>
        </SheetContent>
      </Sheet>
    </Stack>
  );
}