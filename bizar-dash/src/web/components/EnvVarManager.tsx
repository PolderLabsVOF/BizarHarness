// src/web/components/EnvVarManager.tsx — manage BIZAR_* env vars from ~/.config/bizar/env.json
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Eye, EyeOff, RefreshCw, KeyRound, CheckCircle, X, Search, Download, Upload, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { useToast } from './Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export type EnvVarEntry = {
  name: string;
  value: string; // masked on GET, full on edit
  createdAt: string;
  source: string;
};

export type EnvVarGrouped = Record<string, EnvVarEntry[]>;

type Props = {
  onError?: (msg: string) => void;
};

export function EnvVarManager({ onError }: Props) {
  const toast = useToast();
  const [vars, setVars] = useState<EnvVarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which rows have the value revealed (edit mode shows real value)
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Currently editing name (null = none)
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // New var form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  // Bulk operations
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  // Search / filter
  const [searchQ, setSearchQ] = useState('');
  // Group by prefix (collapsed state)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<EnvVarEntry[]>('/env-vars');
      setVars(r);
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
      onError?.((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast, onError]);

  useEffect(() => { load(); }, [load]);

  const toggleReveal = (name: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = async () => {
    const name = newName.trim().toUpperCase();
    const value = newValue.trim();
    if (!name || !/^BIZAR_[A-Z0-9_]+$/.test(name)) {
      toast.warning('Name must match BIZAR_<NAME> (e.g. BIZAR_MINIMAX_KEY)');
      return;
    }
    if (!value) {
      toast.warning('Value is required.');
      return;
    }
    if (vars.some((v) => v.name === name)) {
      toast.warning(`${name} already exists.`);
      return;
    }
    setSaving(true);
    try {
      await api.post('/env-vars', { name, value });
      toast.success(`${name} created.`);
      setShowAdd(false);
      setNewName('');
      setNewValue('');
      await load();
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (v: EnvVarEntry) => {
    setEditing(v.name);
    setEditValue(v.value === v.value.replace(/\*/g, '') ? v.value : '');
    setRevealed((prev) => { const next = new Set(prev); next.add(v.name); return next; });
  };

  const handleUpdate = async (name: string) => {
    if (!editValue.trim()) {
      toast.warning('Value cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/env-vars/${encodeURIComponent(name)}`, { value: editValue.trim() });
      toast.success(`${name} updated.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await api.del(`/env-vars/${encodeURIComponent(name)}`);
      toast.success(`${name} deleted.`);
      await load();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  // ─── Bulk import ───────────────────────────────────────────────────────────
  const handleBulkImport = async () => {
    if (!bulkText.trim()) { toast.warning('Nothing to import.'); return; }
    setBulkImporting(true);
    try {
      const r = await api.post<{ ok: boolean; imported: number; skipped: number; errors: string[] }>('/env-vars/bulk-import', { envContent: bulkText });
      toast.success(`Imported ${r.imported}, skipped ${r.skipped}.`);
      if (r.errors.length > 0) {
        toast.warning(`${r.errors.length} lines had errors: ${r.errors.slice(0, 3).join('; ')}${r.errors.length > 3 ? '…' : ''}`);
      }
      setBulkText('');
      setShowBulk(false);
      await load();
    } catch (err) {
      toast.error(`Bulk import failed: ${(err as Error).message}`);
    } finally {
      setBulkImporting(false);
    }
  };

  // ─── Bulk export ───────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const r = await api.get<string>('/env-vars/export');
      // r is the raw text content
      const blob = new Blob([r as unknown as string], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.env';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported .env file.');
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  // ─── Group by prefix ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchQ.trim()) return vars;
    const q = searchQ.toLowerCase();
    return vars.filter((v) => v.name.toLowerCase().includes(q));
  }, [vars, searchQ]);

  const grouped = useMemo(() => {
    const groups: Record<string, EnvVarEntry[]> = {};
    for (const v of filtered) {
      const prefix = v.name.split('_')[0] + '_';
      (groups[prefix] ??= []).push(v);
    }
    return groups;
  }, [filtered]);

  const toggleGroup = (prefix: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const sortedGroupKeys = useMemo(() => {
    const known = ['BIZAR_', 'PROVIDER_', 'MODEL_', 'API_'];
    const keys = Object.keys(grouped).sort((a, b) => {
      const ai = known.indexOf(a); const bi = known.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return keys;
  }, [grouped]);

  if (loading) {
    return <div className="muted" style={{ padding: '16px 0', fontSize: 13 }}>Loading env vars…</div>;
  }

  const hasGroups = sortedGroupKeys.length > 1;
  const groupMode = hasGroups;

  return (
    <div className="env-var-manager">
      <div className="env-var-toolbar">
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={12} /> New variable
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowBulk((v) => !v)} className={showBulk ? 'active' : ''}>
          <Upload size={12} /> Bulk import
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExport} title="Export as .env">
          <Download size={12} /> Export
        </Button>
        <div className="env-var-search-wrap">
          <Search size={12} className="env-var-search-icon" />
          <input
            className="env-var-search input"
            placeholder="Filter…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={load} title="Reload">
          <RefreshCw size={12} />
        </Button>
      </div>

      {/* Bulk import panel */}
      {showBulk && (
        <div className="env-var-bulk-panel">
          <div className="env-var-bulk-header">
            <span>Paste <code>KEY=value</code> lines (one per line):</span>
            <Button variant="ghost" size="sm" onClick={() => setShowBulk(false)}><X size={12} /></Button>
          </div>
          <textarea
            className="input mono env-var-bulk-textarea"
            placeholder={"BIZAR_API_KEY=your-key-here\nPROVIDER_OPENAI_KEY=sk-...\nMODEL_KEY=gem-..."}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
          />
          <div className="env-var-bulk-footer">
            <Button variant="primary" size="sm" onClick={handleBulkImport} disabled={bulkImporting || !bulkText.trim()}>
              {bulkImporting ? 'Importing…' : 'Import'}
            </Button>
            <span className="muted" style={{ fontSize: 11 }}>
              Existing keys are skipped unless re-created individually. Invalid lines are reported.
            </span>
          </div>
        </div>
      )}

      {vars.length === 0 && !showAdd && (
        <div className="env-var-empty">
          <KeyRound size={20} />
          <span>No BIZAR_* env vars yet.</span>
          <span style={{ fontSize: 11 }}>Create one to store API keys securely.</span>
        </div>
      )}

      {/* New var form */}
      {showAdd && (
        <div className="env-var-add-form">
          <div className="env-var-add-row">
            <input
              className="input mono"
              style={{ width: 240 }}
              placeholder="BIZAR_NAME"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false); }}
              autoFocus
            />
            <input
              className="input mono"
              type="password"
              placeholder="value (API key, token, etc.)"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false); }}
            />
            <Button variant="primary" size="sm" onClick={handleAdd} disabled={saving}>
              <CheckCircle size={12} /> Create
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setNewName(''); setNewValue(''); }}>
              <X size={12} />
            </Button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
            Names must match <code>BIZAR_<var>NAME</var></code> (uppercase letters, digits, underscores).
          </p>
        </div>
      )}

      {/* Var list — grouped by prefix */}
      {filtered.length > 0 && (
        groupMode ? (
          <div className="env-var-groups">
            {sortedGroupKeys.map((prefix) => {
              const items = grouped[prefix];
              const isCollapsed = collapsed.has(prefix);
              return (
                <div key={prefix} className="env-var-group">
                  <button
                    type="button"
                    className="env-var-group-header"
                    onClick={() => toggleGroup(prefix)}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="env-var-group-prefix mono">{prefix}</span>
                    <span className="env-var-group-count muted">({items.length})</span>
                  </button>
                  {!isCollapsed && (
                    <div className="env-var-list">
                      {items.map((v) => (
                        <VarRow key={v.name} v={v} editing={editing} editValue={editValue}
                          isRevealed={revealed.has(v.name)}
                          onToggleReveal={toggleReveal} onStartEdit={startEdit}
                          onEditValueChange={setEditValue} onHandleUpdate={handleUpdate}
                          onCancelEdit={() => setEditing(null)} onDelete={handleDelete}
                          saving={saving} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="env-var-list">
            {filtered.map((v) => (
              <VarRow key={v.name} v={v} editing={editing} editValue={editValue}
                isRevealed={revealed.has(v.name)}
                onToggleReveal={toggleReveal} onStartEdit={startEdit}
                onEditValueChange={setEditValue} onHandleUpdate={handleUpdate}
                onCancelEdit={() => setEditing(null)} onDelete={handleDelete}
                saving={saving} />
            ))}
          </div>
        )
      )}

      {filtered.length === 0 && vars.length > 0 && (
        <div className="env-var-empty">
          <Search size={16} />
          <span>No env vars match "{searchQ}"</span>
        </div>
      )}
    </div>
  );
}

// ─── Individual var row (extracted for reuse in group mode) ───────────────────
type VarRowProps = {
  v: EnvVarEntry;
  editing: string | null;
  editValue: string;
  isRevealed: boolean;
  onToggleReveal: (name: string) => void;
  onStartEdit: (v: EnvVarEntry) => void;
  onEditValueChange: (v: string) => void;
  onHandleUpdate: (name: string) => void;
  onCancelEdit: () => void;
  onDelete: (name: string) => void;
  saving: boolean;
};

function VarRow({ v, editing, editValue, isRevealed, onToggleReveal, onStartEdit, onEditValueChange, onHandleUpdate, onCancelEdit, onDelete, saving }: VarRowProps) {
  const isEditing = editing === v.name;
  return (
    <div className={cn('env-var-row', isEditing && 'env-var-row-editing')}>
      <span className="env-var-name mono">{v.name}</span>
      {isEditing ? (
        <input
          className="input mono"
          type="password"
          style={{ flex: 1, minWidth: 200 }}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onHandleUpdate(v.name);
            if (e.key === 'Escape') onCancelEdit();
          }}
          autoFocus
        />
      ) : (
        <span className={cn('env-var-value mono', !isRevealed && 'env-var-value-masked')}>
          {v.value}
        </span>
      )}
      <span className="env-var-source muted">{v.source}</span>
      <div className="env-var-actions">
        {!isEditing && (
          <button type="button" className="icon-btn" title={isRevealed ? 'Hide' : 'Reveal'} onClick={() => onToggleReveal(v.name)}>
            {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
        {isEditing ? (
          <>
            <Button variant="primary" size="sm" onClick={() => onHandleUpdate(v.name)} disabled={saving}>Save</Button>
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
          </>
        ) : (
          <>
            <button type="button" className="icon-btn" title="Edit" onClick={() => onStartEdit(v)}>
              <Pencil size={12} />
            </button>
            <button type="button" className="icon-btn icon-btn-danger" title="Delete" onClick={() => onDelete(v.name)}>
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
