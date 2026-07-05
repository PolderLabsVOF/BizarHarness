// src/web/views/memory/VaultFromClipboardPanel.tsx — v5.0.0
//
// Memory tab panel for pasting content directly into the vault.
// Accepts URL + title + content text, saves via /api/clipboard/save.

import { useState } from 'react';
import { Clipboard, Loader2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardTitle } from '../../components/Card';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';

type Props = {
  refreshKey: number;
};

export function VaultFromClipboardPanel({ refreshKey: _refreshKey }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('Content is required');
      return;
    }
    setSaving(true);
    try {
      const r = await api.post<{ ok: boolean; notePath: string }>('/clipboard/save', {
        url: url.trim() || undefined,
        title: title.trim() || undefined,
        content: content,
        savedAt: new Date().toISOString(),
      });
      if (r.ok) {
        toast.success(`Saved to ${r.notePath}`);
        setUrl('');
        setTitle('');
        setContent('');
      }
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="memory-panel-content">
      <Card variant="outlined" className="memory-panel-card">
        <div className="memory-panel-body">
          <div className="vault-clipboard-panel">
            <div className="vault-clipboard-header">
              <Clipboard size={16} />
              <span>Paste Content</span>
            </div>

            <label className="field-label" htmlFor="clip-url">URL (optional)</label>
            <input
              id="clip-url"
              type="text"
              className="input"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />

            <label className="field-label" htmlFor="clip-title" style={{ marginTop: 10 }}>Title (optional)</label>
            <input
              id="clip-title"
              type="text"
              className="input"
              placeholder="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label className="field-label" htmlFor="clip-content" style={{ marginTop: 10 }}>Content *</label>
            <textarea
              id="clip-content"
              className="input vault-clipboard-textarea mono text-sm"
              rows={12}
              placeholder="Paste or type content to save to your vault…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            <div className="vault-clipboard-actions" style={{ marginTop: 12 }}>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !content.trim()}>
                {saving && <Loader2 size={12} className="spinner" />}
                Save to Vault
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
