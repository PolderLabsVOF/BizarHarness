// src/web/views/SpawnAgentModal.tsx — modal form to spawn a background
// agent directly from the dashboard. Calls POST /api/background,
// tracks the resulting instanceId, and on success closes the modal
// while the parent navigates to the new instance's detail view.
//
// Fields mirror the API body shape:
//   agent       (string, required) — agent name
//   prompt      (string, required) — initial prompt
//   model       (string, optional) — "providerID/modelID"
//   timeoutMs   (number, slider)   — 1min..4h, default 5min
//   persistent  (boolean, toggle)  — auto-restart on failure
//   tags        (string[], optional)
import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type AgentOption = { name: string; description?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (instanceId: string) => void;
  /** Available agents for the dropdown. Defaults to a small static set. */
  agents?: AgentOption[];
};

const DEFAULT_AGENTS: AgentOption[] = [
  { name: 'mimir', description: 'Deep research & codebase exploration' },
  { name: 'frigg', description: 'Read-only codebase Q&A' },
  { name: 'thor', description: 'Moderate-complexity implementation' },
  { name: 'tyr', description: 'Complex feature implementation' },
  { name: 'heimdall', description: 'Quick edits & simple tasks' },
  { name: 'odin', description: 'Primary router agent' },
];

const TIMEOUT_PRESETS = [
  { label: '1 min', value: 60_000 },
  { label: '5 min', value: 300_000 },
  { label: '15 min', value: 900_000 },
  { label: '30 min', value: 1_800_000 },
  { label: '1 hr', value: 3_600_000 },
  { label: '4 hr', value: 14_400_000 },
];

export function SpawnAgentModal({ open, onClose, onCreated, agents = DEFAULT_AGENTS }: Props) {
  const toast = useToast();
  const [agent, setAgent] = useState<string>(agents[0]?.name || 'mimir');
  const [prompt, setPrompt] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [timeoutMs, setTimeoutMs] = useState<number>(300_000);
  const [persistent, setPersistent] = useState<boolean>(false);
  const [tagsRaw, setTagsRaw] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError('Prompt is required.');
      return;
    }
    setSubmitting(true);
    try {
      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const body = {
        agent,
        prompt,
        ...(model.trim() ? { model: model.trim() } : {}),
        timeoutMs,
        persistent,
        maxRestarts: 3,
        ...(tags.length > 0 ? { tags } : {}),
      };
      const res = await api.post<{
        instanceId: string;
        status: string;
        sessionId?: string;
        error?: string;
        message?: string;
      }>('/background', body);
      if (res?.error) {
        throw new Error(res.message || res.error);
      }
      toast.success(`Spawned ${agent} (${res.instanceId.slice(0, 14)}…)`);
      onCreated?.(res.instanceId);
      // Reset the form for next time.
      setPrompt('');
      setModel('');
      setPersistent(false);
      setTagsRaw('');
      onClose();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to spawn.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card spawn-modal">
        <div className="spawn-modal-header">
          <h3>
            <Plus size={18} /> Spawn background agent
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <X size={14} />
          </Button>
        </div>
        <form onSubmit={onSubmit} className="spawn-modal-body">
          <label className="field">
            <span className="field-label">Agent</span>
            <select
              className="field-input"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              required
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}{a.description ? ` — ${a.description}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Initial prompt</span>
            <textarea
              className="field-input spawn-modal-textarea"
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What do you want this agent to do?"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Model (optional)</span>
            <input
              type="text"
              className="field-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="providerID/modelID (leave blank for agent default)"
            />
          </label>

          <div className="field">
            <span className="field-label">Timeout</span>
            <div className="spawn-modal-timeouts">
              {TIMEOUT_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={
                    'spawn-modal-timeout-pill' +
                    (p.value === timeoutMs ? ' spawn-modal-timeout-pill-active' : '')
                  }
                  onClick={() => setTimeoutMs(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={60_000}
              max={14_400_000}
              step={60_000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="spawn-modal-slider"
            />
            <span className="muted">{(timeoutMs / 60_000).toFixed(0)} min</span>
          </div>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={persistent}
              onChange={(e) => setPersistent(e.target.checked)}
            />
            <span>Persistent — auto-restart on terminal failure (max 3 attempts)</span>
          </label>

          <label className="field">
            <span className="field-label">Tags (optional, comma-separated)</span>
            <input
              type="text"
              className="field-input"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="e.g. refactor, urgent"
            />
          </label>

          {error && <div className="spawn-modal-error">{error}</div>}

          <div className="spawn-modal-actions">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Spawning…' : 'Spawn agent'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
