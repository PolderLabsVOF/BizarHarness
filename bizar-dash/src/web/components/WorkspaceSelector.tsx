// src/web/components/WorkspaceSelector.tsx — v5.0.0 — dropdown to switch active workspace.
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Plus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './Button';

export type WorkspaceInfo = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  currentWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
};

// Keep a global ref of workspaces so sibling components can refresh
let _cachedWorkspaces: WorkspaceInfo[] = [];
const _listeners = new Set<(ws: WorkspaceInfo[]) => void>();

function notifyListeners() {
  _listeners.forEach((fn) => fn(_cachedWorkspaces));
}

export function useWorkspaceList() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(_cachedWorkspaces);

  useEffect(() => {
    _listeners.add(setWorkspaces);
    return () => { _listeners.delete(setWorkspaces); };
  }, []);

  return workspaces;
}

async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    const r = await api.get<{ workspaces: Array<{ workspace: { id: string; name: string }; role: string }> }>('/workspaces');
    const list = r.workspaces.map((w) => ({ id: w.workspace.id, name: w.workspace.name, role: w.role }));
    _cachedWorkspaces = list;
    notifyListeners();
    return list;
  } catch {
    return [];
  }
}

export function WorkspaceSelector({ currentWorkspaceId, onWorkspaceChange }: Props) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(_cachedWorkspaces);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Listen for global cache updates
  useEffect(() => {
    _listeners.add(setWorkspaces);
    return () => { _listeners.delete(setWorkspaces); };
  }, []);

  useEffect(() => {
    fetchWorkspaces().catch(() => undefined);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const current = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0];
  const canManage = current && (current.role === 'admin');

  const handleSelect = async (wsId: string) => {
    setOpen(false);
    if (wsId === currentWorkspaceId) return;
    onWorkspaceChange(wsId);
  };

  const handleRefresh = async () => {
    setLoading(true);
    await fetchWorkspaces();
    setLoading(false);
  };

  return (
    <div className="workspace-selector" ref={ref}>
      <button
        type="button"
        className={cn('workspace-selector-trigger', open && 'workspace-selector-open')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={current?.name || 'Select workspace'}
      >
        <Users size={14} />
        <span className="workspace-selector-label">{current?.name || 'Workspace'}</span>
        {canManage && <ChevronDown size={12} className={cn('workspace-selector-chevron', open && 'workspace-selector-chevron-open')} />}
      </button>

      {open && (
        <div className="workspace-selector-dropdown" role="menu">
          <div className="workspace-selector-header">
            <span className="workspace-selector-title">Workspaces</span>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={handleRefresh}
              loading={loading}
              title="Refresh workspaces"
            >
              <span style={{ transform: 'rotate(90deg)' }}>⟳</span>
            </Button>
          </div>

          <div className="workspace-selector-list">
            {workspaces.length === 0 && (
              <div className="workspace-selector-empty">No workspaces</div>
            )}
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className={cn('workspace-selector-item', ws.id === currentWorkspaceId && 'workspace-selector-item-active')}
                onClick={() => handleSelect(ws.id)}
                role="menuitem"
              >
                <span className="workspace-selector-item-name">{ws.name}</span>
                <span className={cn('workspace-selector-item-role', `role-${ws.role}`)}>{ws.role}</span>
                {ws.id === currentWorkspaceId && <Check size={12} className="workspace-selector-item-check" />}
              </button>
            ))}
          </div>

          <div className="workspace-selector-footer">
            <button
              type="button"
              className="workspace-selector-create"
              onClick={() => {
                setOpen(false);
                // Trigger creation flow — emit a custom event that Workspace.tsx listens for
                window.dispatchEvent(new CustomEvent('bizar:workspace:create'));
              }}
            >
              <Plus size={12} />
              New workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
