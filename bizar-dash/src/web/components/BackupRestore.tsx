// src/web/components/BackupRestore.tsx — v4.8.0 Backup/restore card for Settings.

import React, { useEffect, useState, useCallback } from 'react';
import { Download, Upload, Trash2, RefreshCw, CheckCircle, AlertCircle, Archive } from 'lucide-react';
import { Button } from './Button';
import { Card, CardTitle, CardMeta } from './Card';
import { useModal } from './Modal';
import { useToast } from './Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

type BackupEntry = {
  path: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  sizeFormatted: string;
  manifest: {
    version?: string;
    createdAt?: string;
    label?: string;
    paths?: string[];
  } | null;
};

type RestoreResult = {
  ok: boolean;
  restored: string[];
  skipped: string[];
  errors: string[];
};

function RestoreDialog({
  backup,
  onClose,
}: {
  backup: BackupEntry;
  onClose: () => void;
}) {
  const toast = useToast();
  const [dryRun, setDryRun] = useState(true);
  const [strategy, setStrategy] = useState<'overwrite' | 'merge' | 'skip'>('merge');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const doRestore = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await api.post<RestoreResult>('/backup/restore', {
        backupPath: backup.path,
        dryRun,
        conflictStrategy: strategy,
      });
      setResult(r);
      if (!r.ok && r.errors.length > 0) {
        toast.error(`Restore completed with errors.`);
      } else if (r.ok && !dryRun) {
        toast.success('Restore complete.');
        onClose();
      }
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {backup.manifest && (
        <div style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)' }}>
          <p><strong>Created:</strong> {new Date(backup.createdAt).toLocaleString()}</p>
          <p><strong>Version:</strong> {backup.manifest.version || 'unknown'}</p>
          <p><strong>Contents:</strong> {backup.manifest.paths?.join(', ') || 'unknown'}</p>
          {backup.manifest.label && <p><strong>Label:</strong> {backup.manifest.label}</p>}
        </div>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => setDryRun(e.target.checked)}
        />
        <span>Dry-run (preview only — no files will be modified)</span>
      </label>

      <div className="field">
        <label className="field-label">Conflict strategy</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {(['overwrite', 'merge', 'skip'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={cn('theme-card', strategy === s && 'theme-card-active')}
              onClick={() => setStrategy(s)}
            >
              <span className="theme-card-label" style={{ fontSize: 12 }}>
                {s === 'overwrite' ? 'Replace all' : s === 'merge' ? 'Merge (newer wins)' : 'Skip existing'}
              </span>
            </button>
          ))}
        </div>
        <p className="field-help">
          {strategy === 'overwrite' && 'Replace every file in the backup — existing files will be overwritten.'}
          {strategy === 'merge' && 'Copy newer files from backup over existing files. Existing files are kept if they are newer.'}
          {strategy === 'skip' && 'Only create files that don\'t already exist. Existing files are never modified.'}
        </p>
      </div>

      {result && (
        <div style={{ fontSize: 12, padding: 12, background: 'var(--surface-2, #161b22)', borderRadius: 8 }}>
          {result.restored.length > 0 && (
            <p style={{ color: 'var(--success, #3fb950)' }}>
              <CheckCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
              Restored: {result.restored.join(', ')}
            </p>
          )}
          {result.skipped.length > 0 && (
            <p style={{ color: 'var(--text-muted, #8b949e)' }}>
              Skipped: {result.skipped.join(', ')}
            </p>
          )}
          {result.errors.length > 0 && (
            <p style={{ color: 'var(--error, #f85149)' }}>
              <AlertCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
              Errors: {result.errors.join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={loading}
          onClick={doRestore}
        >
          {loading ? <span className="btn-spinner" /> : null}
          {dryRun ? 'Preview restore' : 'Restore'}
        </Button>
      </div>
    </div>
  );
}

export function BackupRestoreCard() {
  const toast = useToast();
  const modal = useModal();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ ok: boolean; backups: BackupEntry[] }>('/backup/list');
      setBackups(r.backups || []);
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const onCreate = async () => {
    setCreating(true);
    try {
      const r = await api.post<{ ok: boolean; path: string; sizeBytes: number; durationMs: number }>('/backup/create', {
        label: label.trim() || null,
      });
      if (r.ok) {
        toast.success('Backup created.');
        setLabel('');
        await loadBackups();
      } else {
        toast.error('Backup failed.');
      }
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const onVerify = async (backup: BackupEntry) => {
    try {
      const r = await api.post<{ ok: boolean; issues: string[] }>('/backup/verify', {
        backupPath: backup.path,
      });
      if (r.ok) {
        toast.success('Backup is valid.');
      } else {
        toast.error(`Backup has issues: ${r.issues.join(', ')}`);
      }
    } catch (err) {
      toast.error(`Verify failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (backup: BackupEntry) => {
    if (!confirm(`Delete backup?\n\n${backup.path}\n\nThis cannot be undone.`)) return;
    try {
      const encoded = encodeURIComponent(backup.path);
      await api.del(`/backup/${encoded}`);
      toast.success('Backup deleted.');
      await loadBackups();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onRestore = (backup: BackupEntry) => {
    modal.open({
      title: `Restore backup`,
      children: <RestoreDialog backup={backup} onClose={() => modal.close()} />,
      width: 520,
    });
  };

  const recent = backups.slice(0, 10);

  return (
    <Card id="settings-backup" data-section="backup">
      <CardTitle><Archive size={14} /> Backup &amp; Restore</CardTitle>
      <CardMeta>
        Snapshot your BizarHarness config, memory, and usage logs.
        Backups are stored under <code>~/.local/share/bizar/backups/</code>.
      </CardMeta>

      {/* Create backup */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
          <label className="field-label" htmlFor="backup-label" style={{ fontSize: 12 }}>
            Label <span className="muted">(optional)</span>
          </label>
          <input
            id="backup-label"
            type="text"
            className="input"
            placeholder="e.g. before-upgrade"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCreate(); }}
            style={{ fontSize: 13 }}
          />
        </div>
        <Button variant="primary" onClick={onCreate} disabled={creating}>
          {creating ? <span className="btn-spinner" /> : <Download size={14} />}
          {creating ? 'Creating…' : 'Create backup'}
        </Button>
      </div>

      {/* Backup list */}
      {loading ? (
        <div className="muted" style={{ fontSize: 12, padding: '12px 0' }}>Loading backups…</div>
      ) : recent.length === 0 ? (
        <div className="muted" style={{ fontSize: 12, padding: '12px 0' }}>
          No backups yet. Create one to protect your configuration.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recent.map((b) => (
            <div
              key={b.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border, #30363d)',
                background: 'var(--surface-2, #161b22)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)' }}>
                  {new Date(b.createdAt).toLocaleString()} · {b.sizeFormatted}
                  {b.manifest?.label && <> · <em>{b.manifest.label}</em></>}
                  {b.manifest?.version && <> · v{b.manifest.version}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRestore(b)}
                  title="Restore from this backup"
                >
                  <Upload size={12} /> Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onVerify(b)}
                  title="Verify backup integrity"
                >
                  <RefreshCw size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(b)}
                  title="Delete this backup"
                  style={{ color: 'var(--error, #f85149)' }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
          {backups.length > 10 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', textAlign: 'center', padding: '4px 0' }}>
              + {backups.length - 10} older backup{backups.length - 10 === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
