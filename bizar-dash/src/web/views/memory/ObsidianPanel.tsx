// src/web/views/memory/ObsidianPanel.tsx — vault browser + note CRUD + backlinks.
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  Loader2,
  Pencil,
  RefreshCw,
  Search as SearchIcon,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { useModal } from '../../components/Modal';
import { api } from '../../lib/api';
import { formatTime, formatRelative, cn } from '../../lib/utils';

type Note = {
  relPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  mtime: number;
  size: number;
  schemaValid: boolean;
};

type TreeNode = {
  name: string;
  path: string;
  type: 'folder' | 'note';
  size?: number;
  mtime?: number;
  children?: TreeNode[];
};

type Backlink = {
  fromRelPath: string;
  fromTitle: string;
  snippet: string;
  mtime: number;
};

type Props = { refreshKey: number };

export function ObsidianPanel({ refreshKey }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  const reload = async () => {
    setLoading(true);
    try {
      const [n, t] = await Promise.all([
        api.get<{ notes: Note[] }>('/memory/notes').catch(() => ({ notes: [] })),
        api.get<{ tree: TreeNode | null }>('/memory/obsidian/tree').catch(() => ({ tree: null })),
      ]);
      setNotes(n.notes || []);
      setTree(t.tree);
      if (selected && !n.notes?.find((x) => x.relPath === selected)) {
        setSelected(null);
        setBacklinks([]);
      }
    } catch (err) {
      toast.error(`Vault load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Debounced search
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ results: Array<{ relPath: string; snippet: string; score: number }> }>(
          `/memory/search?q=${encodeURIComponent(searchQ)}&limit=50`,
        );
        const pathSet = new Set((r.results || []).map((x) => x.relPath));
        setSearchResults(notes.filter((n) => pathSet.has(n.relPath)));
      } catch (err) {
        toast.error(`Search failed: ${(err as Error).message}`);
      } finally {
        setSearching(false);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [searchQ, notes, toast]);

  const onSelect = async (relPath: string) => {
    setSelected(relPath);
    try {
      const r = await api.get<{ backlinks: Backlink[] }>(
        `/memory/obsidian/backlinks?note=${encodeURIComponent(relPath)}`,
      );
      setBacklinks(r.backlinks || []);
    } catch {
      setBacklinks([]);
    }
  };

  const onCreate = () => {
    modal.open({
      title: 'New note',
      width: 720,
      children: (
        <NoteEditor
          mode="create"
          onSave={async (relPath, frontmatter, body) => {
            try {
              await api.post('/memory/notes', { path: relPath, frontmatter, body });
              toast.success(`Created ${relPath}.`);
              modal.close();
              await reload();
              onSelect(relPath);
            } catch (err) {
              toast.error(`Create failed: ${(err as Error).message}`);
            }
          }}
          onCancel={() => modal.close()}
        />
      ),
    });
  };

  const onEdit = async (relPath: string) => {
    try {
      const note = await api.get<Note>(`/memory/notes/${relPath.split('/').map(encodeURIComponent).join('/')}`);
      modal.open({
        title: `Edit ${relPath}`,
        width: 720,
        children: (
          <NoteEditor
            mode="edit"
            initial={{ relPath: note.relPath, frontmatter: note.frontmatter, body: note.body }}
            onSave={async (rp, frontmatter, body) => {
              try {
                await api.put(`/memory/notes/${rp.split('/').map(encodeURIComponent).join('/')}`, {
                  frontmatter, body,
                });
                toast.success(`Saved ${rp}.`);
                modal.close();
                await reload();
                onSelect(rp);
              } catch (err) {
                toast.error(`Save failed: ${(err as Error).message}`);
              }
            }}
            onCancel={() => modal.close()}
          />
        ),
      });
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (relPath: string) => {
    if (!confirm(`Delete ${relPath}? This cannot be undone.`)) return;
    try {
      await api.del(`/memory/notes/${relPath.split('/').map(encodeURIComponent).join('/')}`);
      toast.success(`Deleted ${relPath}.`);
      if (selected === relPath) setSelected(null);
      await reload();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.mtime - a.mtime);
  }, [notes]);

  const displayed = searchResults ?? sortedNotes;

  if (loading && !notes.length) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading vault…</p>
      </div>
    );
  }

  return (
    <div className="memory-panel-content memory-obsidian-grid">
      {/* ── Folder tree (left) ─────────────────────────────────────── */}
      <Card variant="outlined" className="memory-tree-card">
        <CardTitle>
          <Folder size={14} /> Folders
        </CardTitle>
        <CardMeta>{tree ? `${countFolders(tree)} folder(s)` : 'no vault'}</CardMeta>
        <div className="memory-tree-body">
          {tree ? <TreeView node={tree} depth={0} onSelect={onSelect} selected={selected} /> : null}
        </div>
      </Card>

      {/* ── Note list (center) ─────────────────────────────────────── */}
      <div className="memory-obsidian-list-col">
        <div className="memory-list-toolbar">
          <div className="search-input">
            <SearchIcon size={14} />
            <input
              type="text"
              className="input"
              placeholder="Search notes…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearchQ('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={onCreate}>
            <FilePlus size={12} /> New note
          </Button>
          <Button variant="ghost" size="sm" onClick={reload} title="Refresh">
            <RefreshCw size={12} />
          </Button>
        </div>
        {searching && <div className="muted text-sm">Searching…</div>}
        {displayed.length === 0 ? (
          <EmptyState
            icon={<FileText size={28} />}
            title="No notes"
            message={
              notes.length === 0
                ? 'No notes in this vault yet. Click "New note" to create one.'
                : `No notes match "${searchQ}".`
            }
          />
        ) : (
          <ul className="memory-note-list">
            {displayed.map((n) => (
              <li
                key={n.relPath}
                className={cn('memory-note-card', selected === n.relPath && 'memory-note-card-active')}
              >
                <button
                  type="button"
                  className="memory-note-card-main"
                  onClick={() => onSelect(n.relPath)}
                >
                  <div className="memory-note-card-title">
                    <FileText size={12} />
                    <span>{titleOf(n)}</span>
                  </div>
                  <div className="memory-note-card-meta">
                    <code className="muted">{n.relPath}</code>
                    <span className="muted">· {formatRelative(n.mtime)}</span>
                    {!n.schemaValid && <span className="memory-pill-warn">schema</span>}
                  </div>
                </button>
                <div className="memory-note-card-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onEdit(n.relPath)}
                    aria-label={`Edit ${n.relPath}`}
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onDelete(n.relPath)}
                    aria-label={`Delete ${n.relPath}`}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Detail pane (right) ────────────────────────────────────── */}
      <div className="memory-obsidian-detail-col">
        {selected ? (
          <NoteDetail relPath={selected} onClose={() => setSelected(null)} />
        ) : (
          <EmptyState
            icon={<FileText size={28} />}
            title="Pick a note"
            message="Select a note from the list to view its content, frontmatter, and backlinks."
          />
        )}
      </div>
    </div>
  );
}

// ── Tree view ─────────────────────────────────────────────────────────────

/**
 * Coerce a note's title to a renderable string. frontmatter.title is
 * `unknown` per the schema, so this guards against non-string values.
 */
function titleOf(n: Note): string {
  const t = n.frontmatter?.title;
  if (typeof t === 'string' && t.trim()) return t;
  return n.relPath.replace(/\.md$/i, '');
}

function TreeView({
  node,
  depth,
  onSelect,
  selected,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (path: string) => void;
  selected: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === 'note') {
    return (
      <button
        type="button"
        className={cn('memory-tree-node memory-tree-node-note', selected === node.path && 'memory-tree-node-active')}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onSelect(node.path)}
      >
        <FileText size={11} />
        <span>{node.name}</span>
      </button>
    );
  }
  return (
    <div className="memory-tree-folder">
      <button
        type="button"
        className="memory-tree-node memory-tree-node-folder"
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Folder size={11} />
        <span>{node.name || 'vault'}</span>
        {node.children && node.children.length > 0 && (
          <span className="muted text-xs">{node.children.length}</span>
        )}
      </button>
      {open && node.children && (
        <div className="memory-tree-children">
          {node.children.map((c, i) => (
            <TreeView key={`${c.path}-${i}`} node={c} depth={depth + 1} onSelect={onSelect} selected={selected} />
          ))}
        </div>
      )}
    </div>
  );
}

function countFolders(node: TreeNode): number {
  if (node.type === 'note') return 0;
  return 1 + (node.children || []).reduce((acc, c) => acc + countFolders(c), 0);
}

// ── Note detail ───────────────────────────────────────────────────────────

function NoteDetail({ relPath, onClose }: { relPath: string; onClose: () => void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [n, b] = await Promise.all([
          api.get<Note>(`/memory/notes/${relPath.split('/').map(encodeURIComponent).join('/')}`),
          api.get<{ backlinks: Backlink[] }>(`/memory/obsidian/backlinks?note=${encodeURIComponent(relPath)}`),
        ]);
        if (cancelled) return;
        setNote(n);
        setBacklinks(b.backlinks || []);
      } catch {
        if (!cancelled) setNote(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [relPath]);

  if (loading) {
    return (
      <div className="view-loading"><Spinner size="sm" /></div>
    );
  }
  if (!note) return <div className="muted">Note not found.</div>;

  const tags = Array.isArray(note.frontmatter?.tags) ? note.frontmatter.tags : [];
  const links = Array.isArray(note.frontmatter?.links) ? note.frontmatter.links : [];

  return (
    <div className="memory-note-detail">
      <div className="memory-note-detail-head">
        <h3>{titleOf(note)}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={12} />
        </button>
      </div>
      <div className="memory-note-detail-meta">
        <code>{relPath}</code>
        <span className="muted">· modified {formatTime(note.mtime)}</span>
      </div>
      {tags.length > 0 && (
        <div className="memory-tag-row">
          {tags.map((t, i) => (
            <span key={i} className="memory-tag">{String(t)}</span>
          ))}
        </div>
      )}
      <pre className="memory-note-body mono text-sm">{note.body}</pre>
      {backlinks.length > 0 && (
        <div className="memory-backlinks">
          <h4>Backlinks</h4>
          <ul>
            {backlinks.map((b) => (
              <li key={b.fromRelPath}>
                <code>{b.fromRelPath}</code>
                <p className="muted text-sm">{b.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {links.length > 0 && (
        <div className="memory-backlinks">
          <h4>Forward links</h4>
          <ul>
            {links.map((l, i) => (
              <li key={i}><code>{String(l)}</code></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Note editor modal body ────────────────────────────────────────────────

function NoteEditor({
  mode,
  initial,
  onSave,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: { relPath: string; frontmatter: Record<string, unknown>; body: string };
  onSave: (relPath: string, frontmatter: Record<string, unknown>, body: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [relPath, setRelPath] = useState(initial?.relPath || 'untitled.md');
  const [frontmatterYaml, setFrontmatterYaml] = useState(
    initial?.frontmatter ? yamlStringify(initial.frontmatter) : 'title: ""\ntags: []\n',
  );
  const [body, setBody] = useState(initial?.body || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const onSubmit = async () => {
    if (!relPath.endsWith('.md')) {
      toast.error('Path must end in .md');
      return;
    }
    let fm: Record<string, unknown>;
    try {
      fm = yamlParse(frontmatterYaml) || {};
    } catch (err) {
      toast.error(`Frontmatter parse failed: ${(err as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      await onSave(relPath, fm, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memory-editor-modal">
      <label className="field-label">Path</label>
      <input
        type="text"
        className="input mono"
        value={relPath}
        onChange={(e) => setRelPath(e.target.value)}
        disabled={mode === 'edit'}
        placeholder="notes/example.md"
      />
      <label className="field-label" style={{ marginTop: 12 }}>Frontmatter (YAML)</label>
      <textarea
        className="memory-editor-textarea mono text-sm"
        rows={6}
        value={frontmatterYaml}
        onChange={(e) => setFrontmatterYaml(e.target.value)}
      />
      <label className="field-label" style={{ marginTop: 12 }}>Body (Markdown)</label>
      <textarea
        className="memory-editor-textarea mono text-sm"
        rows={14}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="modal-footer-actions" style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={onSubmit} disabled={busy}>
          {busy && <Loader2 size={12} className="memory-spin" />}
          {mode === 'create' ? 'Create' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ── Tiny YAML helpers (avoid pulling a 100kB lib into the bundle) ────────

function yamlStringify(obj: Record<string, unknown>): string {
  // Best-effort: dump top-level scalar / list / nested-map fields.
  // Good enough for the note editor — the server re-validates anyway.
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlScalar(item)}`);
    } else if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        lines.push(`  ${kk}: ${yamlScalar(vv)}`);
      }
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function yamlScalar(v: unknown): string {
  if (typeof v === 'string') {
    if (/[:#\n"']/.test(v) || v === '') return JSON.stringify(v);
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function yamlParse(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = s.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, key, rest] = m;
    if (rest === '') {
      // Nested mapping or list follows.
      const block: Record<string, unknown> = {};
      const list: unknown[] = [];
      let isList = false;
      let isMap = false;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (!next.startsWith('  ')) break;
        if (next.startsWith('  - ')) {
          isList = true;
          list.push(parseScalar(next.slice(4)));
          i++;
        } else {
          isMap = true;
          const nm = next.match(/^  ([A-Za-z_][\w-]*):\s*(.*)$/);
          if (nm) {
            block[nm[1]] = parseScalar(nm[2]);
          }
          i++;
        }
      }
      out[key] = isList && !isMap ? list : (isMap ? block : {});
    } else {
      out[key] = parseScalar(rest);
    }
    i++;
  }
  return out;
}

function parseScalar(v: string): unknown {
  const t = v.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}