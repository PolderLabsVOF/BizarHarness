// src/components/PlanCreateDialog.tsx — Dialog for /plan new command.

import { useState } from 'react';
import { Button } from './Button';
import { api } from '../lib/api';

type PlanCreateDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

const KNOWN_TEMPLATES = [
  'blank',
  'feature-design',
  'bug-investigation',
  'decision-record',
  'horizontal',
  'vertical',
];

export function PlanCreateDialog({ data, onClose }: PlanCreateDialogProps) {
  const templates = (data?.templates as string[]) ?? KNOWN_TEMPLATES;
  const defaultTemplate = (data?.defaultTemplate as string) ?? 'blank';

  const [slug, setSlug] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(defaultTemplate);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!slug.trim()) {
      setError('Slug is required.');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
      setError('Invalid slug. Use lowercase letters, numbers, and hyphens. Must start with an alphanumeric character.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await api.post('/plans', { slug, template: selectedTemplate });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  return (
    <div>
      <p style={{ marginBottom: 16, color: 'var(--color-muted)', fontSize: 13 }}>
        Create a new visual plan. Plans are stored in <code>plans/</code> in your worktree.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label className="field-label" htmlFor="plan-slug">Plan slug</label>
        <input
          id="plan-slug"
          className="input"
          type="text"
          placeholder="e.g. my-feature"
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setError(null); }}
          autoFocus
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="field-label" htmlFor="plan-template">Template</label>
        <select
          id="plan-template"
          className="select"
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ marginBottom: 12, color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={creating || !slug.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
