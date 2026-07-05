// src/web/components/EnvVarManager.tsx — manage BIZAR_* env vars from ~/.config/bizar/env.json
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Eye, EyeOff, RefreshCw, KeyRound, CheckCircle, X } from 'lucide-react';
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

  if (loading) {
    return <div className="muted" style={{ padding: '16px 0', fontSize: 13 }}>Loading env vars…</div>;
  }

  return (
    <div className="env-var-manager">
      <div className="env-var-toolbar">
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={12} /> New variable
        </Button>
        <Button variant="ghost" size="sm" onClick={load} title="Reload">
          <RefreshCw size={12} />
        </Button>
      </div>

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

      {/* Var list */}
      {vars.length > 0 && (
        <div className="env-var-list">
          {vars.map((v) => {
            const isEditing = editing === v.name;
            const isRevealed = revealed.has(v.name);
            return (
              <div key={v.name} className={cn('env-var-row', isEditing && 'env-var-row-editing')}>
                <span className="env-var-name mono">{v.name}</span>
                {isEditing ? (
                  <input
                    className="input mono"
                    type="password"
                    style={{ flex: 1, minWidth: 200 }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdate(v.name);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span className={cn('env-var-value mono', !isRevealed && 'env-var-value-masked')}>
                    {isRevealed ? v.value : v.value}
                  </span>
                )}
                <span className="env-var-source muted">{v.source}</span>
                <div className="env-var-actions">
                  {!isEditing && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={isRevealed ? 'Hide' : 'Reveal'}
                      onClick={() => toggleReveal(v.name)}
                    >
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                  {isEditing ? (
                    <>
                      <Button variant="primary" size="sm" onClick={() => handleUpdate(v.name)} disabled={saving}>
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="icon-btn" title="Edit" onClick={() => startEdit(v)}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Delete" onClick={() => handleDelete(v.name)}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
