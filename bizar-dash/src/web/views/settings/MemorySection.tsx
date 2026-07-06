// src/web/views/settings/MemorySection.tsx — memory vault + git config for Settings.
// v6.x — Vault path now loads from /api/memory/status (was hardcoded to '').
// We also surface a small "Initialise" button when the vault does not exist.
import React, { useEffect, useState } from 'react';
import { Brain, GitBranch, Loader2, Save, FolderInput } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';

type GitConfig = {
  remoteUrl?: string;
};

type GlobalConfig = {
  git?: GitConfig;
};

type MemoryStatus = {
  initialized: boolean;
  vaultRoot?: string | null;
  mode?: string | null;
};

export function MemorySection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initialising, setInitialising] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [vaultPath, setVaultPath] = useState<string>('');
  const [vaultInitialised, setVaultInitialised] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, statusRes] = await Promise.all([
          api.get<{ config: GlobalConfig; path?: string }>('/memory/config/global').catch(() => null),
          api.get<MemoryStatus>('/memory/status').catch(() => null),
        ]);
        if (cancelled) return;
        if (cfgRes) setRemoteUrl(cfgRes.config?.git?.remoteUrl || '');
        if (statusRes) {
          setVaultPath(statusRes.vaultRoot || '');
          setVaultInitialised(!!statusRes.initialized);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const onSave = async () => {
    setSaving(true);
    try {
      await api.put('/memory/config/global', { git: { remoteUrl } });
      toast.success('Memory config saved.');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onInitialise = async () => {
    setInitialising(true);
    try {
      await api.post('/memory/init', {});
      toast.success('Vault initialised.');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(`Initialise failed: ${(err as Error).message}`);
    } finally {
      setInitialising(false);
    }
  };

  return (
    <Card id="settings-memory" data-section="memory">
      <CardTitle><Brain size={14} /> Memory vault</CardTitle>
      <CardMeta>
        The vault lives at a default location on disk. Only the git remote URL
        needs to be configured to enable sync across machines.
      </CardMeta>

      {loading ? (
        <div className="flex-center" style={{ padding: 24 }}>
          <Spinner size="sm" />
        </div>
      ) : (
        <div className="settings-fields">
          <div className="field">
            <label className="field-label">
              <FolderInput size={12} style={{ display: 'inline', marginRight: 4 }} />
              Vault path
            </label>
            <div
              className="field-readonly mono"
              data-testid="settings-memory-vault-path"
              style={{ fontSize: 12, padding: '6px 0' }}
            >
              {vaultPath || <span className="muted">not initialised</span>}
              {vaultInitialised ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onInitialise}
                  disabled={initialising}
                  style={{ marginLeft: 12 }}
                >
                  {initialising ? <Loader2 size={12} className="memory-spin" /> : <FolderInput size={12} />}
                  Initialise
                </Button>
              )}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-memory-git-remote">
              <GitBranch size={12} style={{ display: 'inline', marginRight: 4 }} />
              Git remote URL
            </label>
            <input
              id="set-memory-git-remote"
              className="input mono"
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="git@github.com:org/repo.git"
            />
            <span className="field-hint">Leave empty to use local-only mode (no git sync).</span>
          </div>

          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? <Loader2 size={12} className="memory-spin" /> : <Save size={12} />}
              Save memory config
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
