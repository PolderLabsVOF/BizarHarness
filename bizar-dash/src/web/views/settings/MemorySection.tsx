// src/web/views/settings/MemorySection.tsx — memory vault + git config for Settings.
import React, { useEffect, useState } from 'react';
import { Brain, GitBranch, Loader2, Save } from 'lucide-react';
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

export function MemorySection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [vaultPath] = useState<string>(''); // server-side default, not user-editable
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.get<{ config: GlobalConfig; path?: string }>('/memory/config/global')
      .then((r) => {
        setRemoteUrl(r.config?.git?.remoteUrl || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
            <label className="field-label">Vault path</label>
            <div className="field-readonly mono muted" style={{ fontSize: 12, padding: '6px 0' }}>
              {vaultPath || '~/.local/share/bizar/memory'}
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
