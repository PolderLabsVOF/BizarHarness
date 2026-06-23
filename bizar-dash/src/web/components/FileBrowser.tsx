// src/components/FileBrowser.tsx — Interactive directory browser with tree + flat pane.
// Replaces raw path text inputs in Add Project dialogs.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, Folder, File, RefreshCw, ArrowLeft, Home, AlertCircle, FolderPlus } from 'lucide-react';
import { api } from '../lib/api';
import type { DirectoryEntry, DirectoryListing, MkdirRequest, MkdirResponse } from '../lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileBrowserProps = {
  /** Currently selected directory (absolute path). */
  value: string;
  /** Fires when the user selects a directory. */
  onChange: (path: string) => void;
  /** Where the browser starts (default: homedir via GET /api/fs with no path). */
  initialPath?: string;
  /** If set, used as default initialPath and shown as a quick-jump chip. */
  projectsDirectory?: string;
  /** Label for the filesystem-root breadcrumb (default: "Home"). */
  rootLabel?: string;
  /** Scroll viewport height in px (default: 360). */
  height?: number;
};

// ─── Cache (LRU-ish, 200 entries max, 5-minute TTL) ───────────────────────────

const MAX_CACHE = 200;
const TTL_MS = 5 * 60 * 1000;

type CacheEntry = { data: DirectoryListing; ts: number };

const _cache = new Map<string, CacheEntry>();

function cacheGet(path: string): DirectoryListing | null {
  const entry = _cache.get(path);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { _cache.delete(path); return null; }
  return entry.data;
}

function cacheSet(path: string, data: DirectoryListing) {
  if (_cache.size >= MAX_CACHE) {
    // Evict oldest 50
    const oldest = [..._cache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 50)
      .map(([k]) => k);
    oldest.forEach((k) => _cache.delete(k));
  }
  _cache.set(path, { data, ts: Date.now() });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pathSegments(p: string): { label: string; path: string }[] {
  if (!p || p === '/') return [{ label: '/', path: '/' }];
  const parts = p.split('/').filter(Boolean);
  const result: { label: string; path: string }[] = [];
  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    accumulated += '/' + parts[i];
    result.push({ label: parts[i], path: accumulated });
  }
  return result;
}

function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * Validates a directory name against the same denylist the server enforces.
 * Returns an ok object or { ok: false, reason }.
 * Mirrors the validation in POST /api/fs/mkdir on the server side.
 */
export function validateDirName(name: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'Name cannot be empty.' };
  if (trimmed !== name) return { ok: false, reason: 'Name cannot have leading or trailing whitespace.' };
  if (trimmed === '.') return { ok: false, reason: "Name cannot be '.'." };
  if (trimmed === '..') return { ok: false, reason: "Name cannot be '..'." };
  if (trimmed.startsWith('-')) return { ok: false, reason: "Name cannot start with '-'." };
  if (trimmed.length > 255) return { ok: false, reason: 'Name cannot be longer than 255 characters.' };
  if (/[/\0:*?"<>|]/.test(trimmed)) {
    return { ok: false, reason: "Name cannot contain / \\ : * ? \" < > |" };
  }
  return { ok: true };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function FileBrowser({
  value,
  onChange,
  initialPath,
  projectsDirectory,
  rootLabel = 'Home',
  height = 360,
}: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>(
    initialPath ?? projectsDirectory ?? '',
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<number>(-1);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [childrenMap, setChildrenMap] = useState<Record<string, DirectoryEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const [mkdirLoading, setMkdirLoading] = useState(false);
  const mkdirInputRef = useRef<HTMLInputElement | null>(null);

  const fetchListing = useCallback(async (path: string): Promise<DirectoryListing | null> => {
    try {
      const cached = cacheGet(path);
      if (cached) return cached;
      const data = await api.get<DirectoryListing>('/fs?path=' + encodeURIComponent(path));
      cacheSet(path, data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<DirectoryListing>('/fs?path=' + encodeURIComponent(path));
      cacheSet(path, data);
      setListing(data);
      setSelectedRow(-1);
    } catch (err) {
      const msg = (err as { data?: { message?: string }; message?: string }).data?.message
        ?? (err as Error).message
        ?? 'Failed to load directory';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load current path on mount or when currentPath changes
  useEffect(() => {
    if (!currentPath) {
      // Default to homedir by fetching empty-path listing
      api.get<DirectoryListing>('/fs').then((data) => {
        cacheSet('', data);
        setListing(data);
        setCurrentPath(data.path);
        if (data.path !== value) onChange(data.path);
      }).catch(() => {
        setError('Could not determine home directory.');
        setLoading(false);
      });
    } else {
      load(currentPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Keep selected path in sync when value changes externally (e.g. breadcrumb click)
  useEffect(() => {
    if (value && value !== currentPath) {
      setCurrentPath(value);
    }
  }, [value]);

  const entries = listing ? sortEntries(listing.entries) : [];

  const dirs = entries.filter((e) => e.isDir);
  const allEntries = entries;

  // ─── Navigation helpers ──────────────────────────────────────────────────────

  const navigateInto = (entry: DirectoryEntry) => {
    if (!entry.isDir) return;
    setCurrentPath(entry.path);
    onChange(entry.path);
  };

  const navigateUp = () => {
    if (!listing?.parent) return;
    setCurrentPath(listing.parent);
    onChange(listing.parent);
  };

  const navigateTo = (path: string) => {
    if (path === currentPath) return;
    setCurrentPath(path);
    onChange(path);
  };

  const goHome = async () => {
    const home = await fetchListing('');
    if (home) {
      setCurrentPath(home.path);
      onChange(home.path);
    }
  };

  const goProjects = async () => {
    if (!projectsDirectory) return;
    const pd = await fetchListing(projectsDirectory);
    if (pd) {
      setCurrentPath(pd.path);
      onChange(pd.path);
    }
  };

  // ─── New folder ────────────────────────────────────────────────────────────

  // Open the inline mkdir input, focusing it on the next tick
  const openMkdir = () => {
    setMkdirOpen(true);
    setMkdirName('');
    setMkdirError(null);
    // Autofocus after the input renders
    setTimeout(() => mkdirInputRef.current?.focus(), 0);
  };

  const cancelMkdir = () => {
    setMkdirOpen(false);
    setMkdirName('');
    setMkdirError(null);
  };

  const submitMkdir = async () => {
    const v = validateDirName(mkdirName);
    if (!v.ok) {
      setMkdirError(v.reason);
      return;
    }
    setMkdirLoading(true);
    setMkdirError(null);
    try {
      const result = await api.post<MkdirResponse>('/fs/mkdir', {
        parent: currentPath,
        name: mkdirName.trim(),
      } as MkdirRequest);
      // Invalidate cache for the current path so the new folder appears
      _cache.delete(currentPath);
      await load(currentPath);
      // Select the new directory
      onChange(result.path);
      setMkdirOpen(false);
      setMkdirName('');
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; status?: number };
      if (apiErr.status === 409) {
        setMkdirError(`A folder named "${mkdirName.trim()}" already exists.`);
      } else {
        setMkdirError(
          apiErr.data?.message ??
          (err as Error).message ??
          'Failed to create folder.',
        );
      }
    } finally {
      setMkdirLoading(false);
    }
  };

  const handleMkdirKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitMkdir();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelMkdir();
    }
  };

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    // Lazy-load children when expanding
    if (!childrenMap[path]) {
      fetchListing(path).then((data) => {
        if (data) setChildrenMap((prev) => ({ ...prev, [path]: data.entries.filter((e) => e.isDir) }));
      });
    }
  };

  // ─── Keyboard handler ────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!listing) return;
    const dirs = allEntries.filter((x) => x.isDir);
    const files = allEntries.filter((x) => !x.isDir);
    const selectable = [...dirs, ...files];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedRow((r) => Math.min(r + 1, selectable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedRow((r) => Math.max(r - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const sel = selectable[selectedRow];
      if (sel) {
        if (e.key === 'Enter' && sel.isDir) navigateInto(sel);
        else if (!sel.isDir) { /* files are not selectable */ }
        else onChange(sel.path);
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      navigateUp();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const segments = pathSegments(listing?.path ?? currentPath ?? '/');
  const parentPath = listing?.parent;
  const canGoUp = parentPath !== null && parentPath !== undefined;

  const basename = currentPath.split('/').filter(Boolean).at(-1) ?? '/';

  return (
    <div className="file-browser" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Breadcrumb */}
      <div className="file-browser-breadcrumb" role="navigation" aria-label="Path breadcrumb">
        {segments.map((seg, i) => (
          <span key={seg.path} className="file-browser-breadcrumb-item">
            {i > 0 && <span className="file-browser-breadcrumb-sep" aria-hidden>/</span>}
            <button
              type="button"
              className="file-browser-breadcrumb-btn"
              onClick={() => navigateTo(seg.path)}
              title={seg.path}
            >
              {i === 0 ? (seg.path === '/' ? '/' : rootLabel) : seg.label}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className="file-browser-toolbar">
        <div className="file-browser-toolbar-left">
          <button
            type="button"
            className="file-browser-tool-btn"
            onClick={navigateUp}
            disabled={!canGoUp}
            title="Go up (Backspace)"
            aria-label="Go up one level"
          >
            <ArrowLeft size={13} />
          </button>

          <button
            type="button"
            className="file-browser-tool-btn"
            onClick={() => load(currentPath)}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>

          <button
            type="button"
            className="file-browser-tool-btn"
            onClick={openMkdir}
            title="New folder"
            aria-label="Create new folder"
          >
            <FolderPlus size={13} />
          </button>

          <div className="file-browser-chips">
            <button type="button" className="file-browser-chip" onClick={goHome}>
              <Home size={11} /> {rootLabel}
            </button>
            {projectsDirectory && (
              <button type="button" className="file-browser-chip" onClick={goProjects} title={projectsDirectory}>
                <FolderOpen size={11} /> {projectsDirectory.split('/').filter(Boolean).at(-1) ?? 'Projects'}
              </button>
            )}
          </div>
        </div>

        {mkdirOpen ? (
          <div className="file-browser-mkdir">
            <input
              ref={mkdirInputRef}
              type="text"
              className="file-browser-mkdir-input"
              placeholder="Folder name"
              value={mkdirName}
              onChange={(e) => {
                setMkdirName(e.target.value);
                setMkdirError(null);
              }}
              onKeyDown={handleMkdirKeyDown}
              aria-label="New folder name"
              aria-invalid={mkdirError ? 'true' : undefined}
              aria-describedby={mkdirError ? 'mkdir-error' : undefined}
              disabled={mkdirLoading}
              maxLength={255}
            />
            {mkdirError ? (
              <span id="mkdir-error" className="file-browser-mkdir-error" role="alert">
                {mkdirError}
              </span>
            ) : (
              <span className="file-browser-mkdir-hint">
                Enter to create, Esc to cancel
              </span>
            )}
          </div>
        ) : (
          <span className="file-browser-count-hint">
            {loading ? '…' : `${entries.length} in ${basename}`}
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="file-browser-error">
          <AlertCircle size={13} />
          <span>{error}</span>
          <button type="button" className="file-browser-retry" onClick={() => load(currentPath)}>
            Retry
          </button>
        </div>
      )}

      {/* Body: tree (left) + flat (right) */}
      <div className="file-browser-body" style={{ height }}>
        {/* Left: tree */}
        <div className="file-browser-pane file-browser-tree" aria-label="Folder tree">
          {loading && !listing ? (
            <TreeSkeleton />
          ) : (
            <TreeNode
              path={currentPath}
              entries={dirs}
              expanded={expanded}
              childrenMap={childrenMap}
              onToggle={toggleExpand}
              onNavigate={navigateInto}
              level={0}
            />
          )}
        </div>

        {/* Right: flat listing */}
        <div className="file-browser-pane file-browser-flat" aria-label="Directory contents">
          <div className="file-browser-flat-header">
            <span>Name</span>
            <span>Type</span>
          </div>

          {loading && !listing ? (
            <FlatSkeleton />
          ) : (
            <>
              {/* Truncation notice */}
              {listing?.truncated && (
                <div className="file-browser-truncated-banner" role="status">
                  Showing first 500 of {listing.totalEntries} entries.
                  Navigate into a subfolder to see more.
                </div>
              )}

              {allEntries.length === 0 ? (
                <div className="file-browser-empty">This folder is empty</div>
              ) : (
                <div className="file-browser-flat-list">
                  {allEntries.map((entry, idx) => {
                    const isDir = entry.isDir;
                    const isSelected = idx === selectedRow;
                    const isActive = entry.path === value;
                    return (
                      <div
                        key={entry.path}
                        role="option"
                        aria-selected={isActive}
                        className={[
                          'file-browser-row',
                          isDir ? 'file-browser-row--dir' : 'file-browser-row--file',
                          isSelected && 'file-browser-row--selected',
                          isActive && isDir && 'file-browser-row--active',
                          !isDir && 'file-browser-row--disabled',
                        ].filter(Boolean).join(' ')}
                        onClick={() => {
                          if (isDir) {
                            setSelectedRow(idx);
                            onChange(entry.path);
                          }
                        }}
                        onDoubleClick={() => {
                          if (isDir) navigateInto(entry);
                        }}
                        title={entry.path}
                      >
                        <span className="file-browser-row-icon">
                          {isDir ? <Folder size={13} /> : <File size={13} />}
                        </span>
                        <span className="file-browser-row-name">{entry.name}</span>
                        <span className="file-browser-row-type">
                          {isDir ? 'Folder' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div className="file-browser-footer-hint">
        Select a folder, then click Add. Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to confirm.
      </div>
    </div>
  );
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

function TreeNode({
  path,
  entries,
  expanded,
  childrenMap,
  onToggle,
  onNavigate,
  level,
}: {
  path: string;
  entries: DirectoryEntry[];
  expanded: Set<string>;
  childrenMap: Record<string, DirectoryEntry[]>;
  onToggle: (p: string) => void;
  onNavigate: (e: DirectoryEntry) => void;
  level: number;
}) {
  return (
    <ul className="file-browser-tree-list" role="group">
      {entries.map((entry) => {
        const isExpanded = expanded.has(entry.path);
        const kids = childrenMap[entry.path] ?? [];
        return (
          <li key={entry.path} className="file-browser-tree-node">
            <div
              className={[
                'file-browser-tree-row',
                isExpanded && 'file-browser-tree-row--expanded',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: `${level * 16 + 8}px` }}
            >
              <button
                type="button"
                className="file-browser-tree-toggle"
                onClick={(e) => { e.stopPropagation(); onToggle(entry.path); }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {kids.length > 0 || true ? (
                  isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
                ) : (
                  <span style={{ width: 11 }} />
                )}
              </button>

              <button
                type="button"
                className="file-browser-tree-name"
                onClick={() => onNavigate(entry)}
                title={entry.path}
              >
                <Folder size={12} />
                <span>{entry.name}</span>
              </button>
            </div>

            {isExpanded && kids.length > 0 && (
              <TreeNode
                path={entry.path}
                entries={kids}
                expanded={expanded}
                childrenMap={childrenMap}
                onToggle={onToggle}
                onNavigate={onNavigate}
                level={level + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function TreeSkeleton() {
  return (
    <div className="file-browser-skeleton-wrap">
      {[80, 60, 90, 55, 70].map((w, i) => (
        <div key={i} className="file-browser-skeleton-row" style={{ width: w }} />
      ))}
    </div>
  );
}

function FlatSkeleton() {
  return (
    <div className="file-browser-skeleton-wrap">
      {[60, 90, 70, 50, 80, 65].map((w, i) => (
        <div key={i} className="file-browser-skeleton-row" style={{ width: w }} />
      ))}
    </div>
  );
}
