// src/views/Agents.tsx — editable agent grid with CRUD modal.
import { useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw, Pencil, Trash2, Play, Save, X } from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { formatRelative, truncate } from '../lib/utils';
import type { Agent, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const TOOL_OPTIONS = ['bash', 'read', 'edit', 'write', 'webfetch', 'websearch', 'task', 'glob', 'grep'];
const MODELS = [
  'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-5-haiku',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'minimax/MiniMax-M3',
  'minimax/MiniMax-M2.7',
];

export function Agents({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [agents, setAgents] = useState<Agent[]>(snapshot.agents || []);
  const [loading, setLoading] = useState(!snapshot.agents);

  useEffect(() => {
    if (snapshot.agents?.length || snapshot.agents) {
      setAgents(snapshot.agents || []);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.agents]);

  const reload = async () => {
    try {
      const d = await api.get<{ agents: Agent[] }>('/agents');
      setAgents(d.agents || []);
    } catch (err) {
      toast.error(`Agents load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const sorted = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const onCreate = () => {
    let nameEl: HTMLInputElement | null = null;
    let descEl: HTMLTextAreaElement | null = null;
    let modelEl: HTMLSelectElement | null = null;
    let modeEl: HTMLSelectElement | null = null;
    let colorEl: HTMLInputElement | null = null;
    let promptEl: HTMLTextAreaElement | null = null;
    let toolsContainer: HTMLDivElement | null = null;

    modal.open({
      title: 'New agent',
      width: 640,
      children: (
        <div className="agent-form">
          <label className="field-label">Name (a-z, 0-9, dashes)</label>
          <input
            ref={(el) => (nameEl = el)}
            className="input"
            type="text"
            placeholder="my-agent"
            autoFocus
          />
          <label className="field-label">Description</label>
          <input
            ref={(el) => { descEl = el as unknown as HTMLTextAreaElement | null; }}
            className="input"
            type="text"
            placeholder="What does this agent do?"
          />
          <div className="task-form-row">
            <div className="task-form-field">
              <label className="field-label">Model</label>
              <select ref={(el) => (modelEl = el)} className="select" defaultValue="">
                <option value="">(provider default)</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field">
              <label className="field-label">Mode</label>
              <select ref={(el) => (modeEl = el)} className="select" defaultValue="subagent">
                <option value="primary">primary</option>
                <option value="subagent">subagent</option>
                <option value="all">all</option>
              </select>
            </div>
            <div className="task-form-field" style={{ flex: '0 0 80px' }}>
              <label className="field-label">Color</label>
              <input ref={(el) => (colorEl = el)} className="input" type="color" defaultValue="#8b5cf6" />
            </div>
          </div>
          <label className="field-label">Tools</label>
          <div ref={(el) => (toolsContainer = el)} className="agent-tools">
            {TOOL_OPTIONS.map((t) => (
              <label key={t} className="checkbox-row">
                <input type="checkbox" value={t} />
                <span>{t}</span>
              </label>
            ))}
          </div>
          <label className="field-label">System prompt</label>
          <textarea
            ref={(el) => (promptEl = el)}
            className="textarea"
            rows={6}
            placeholder="You are a..."
          />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const name = (nameEl?.value || '').trim();
              if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(name)) {
                toast.warning('Invalid name (a-z, 0-9, dashes).');
                return;
              }
              const tools: string[] = [];
              if (toolsContainer) {
                toolsContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach((cb) => {
                  tools.push(cb.value);
                });
              }
              try {
                const created = await api.post<Agent>('/agents', {
                  name,
                  description: (descEl?.value || '').trim(),
                  model: modelEl?.value || '',
                  mode: modeEl?.value || 'subagent',
                  color: colorEl?.value || '',
                  tools,
                  prompt: promptEl?.value || '',
                });
                setAgents((cur) => [...cur, created]);
                toast.success('Agent created.');
                modal.close();
                await refreshSnapshot();
              } catch (err) {
                toast.error(`Create failed: ${(err as Error).message}`);
              }
            }}
          >
            <Save size={12} /> Create
          </Button>
        </div>
      ),
    });
  };

  const onEdit = async (a: Agent) => {
    let descEl: HTMLTextAreaElement | null = null;
    let modelEl: HTMLSelectElement | null = null;
    let modeEl: HTMLSelectElement | null = null;
    let colorEl: HTMLInputElement | null = null;
    let promptEl: HTMLTextAreaElement | null = null;
    let toolsContainer: HTMLDivElement | null = null;
    try {
      const full = await api.get<Agent>(`/agents/${encodeURIComponent(a.name)}`);
      modal.open({
        title: `Edit ${a.name}`,
        width: 640,
        children: (
          <div className="agent-form">
            <div className="muted">
              File: <code>{full.path}</code>
            </div>
            <label className="field-label">Description</label>
            <input
              ref={(el) => { descEl = el as unknown as HTMLTextAreaElement | null; }}
              className="input"
              type="text"
              defaultValue={full.description}
            />
            <div className="task-form-row">
              <div className="task-form-field">
                <label className="field-label">Model</label>
                <select ref={(el) => (modelEl = el)} className="select" defaultValue={full.model}>
                  <option value="">(provider default)</option>
                  {MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="task-form-field">
                <label className="field-label">Mode</label>
                <select ref={(el) => (modeEl = el)} className="select" defaultValue={full.mode || 'subagent'}>
                  <option value="primary">primary</option>
                  <option value="subagent">subagent</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div className="task-form-field" style={{ flex: '0 0 80px' }}>
                <label className="field-label">Color</label>
                <input ref={(el) => (colorEl = el)} className="input" type="color" defaultValue={full.color || '#8b5cf6'} />
              </div>
            </div>
            <label className="field-label">Tools</label>
            <div ref={(el) => (toolsContainer = el)} className="agent-tools">
              {TOOL_OPTIONS.map((t) => (
                <label key={t} className="checkbox-row">
                  <input type="checkbox" value={t} defaultChecked={full.tools?.includes(t)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
            <label className="field-label">System prompt</label>
            <textarea
              ref={(el) => (promptEl = el)}
              className="textarea"
              rows={8}
              defaultValue={full.prompt || ''}
            />
          </div>
        ),
        footer: (
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const tools: string[] = [];
                if (toolsContainer) {
                  toolsContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach((cb) => {
                    tools.push(cb.value);
                  });
                }
                try {
                  const updated = await api.put<Agent>(
                    `/agents/${encodeURIComponent(a.name)}`,
                    {
                      description: (descEl?.value || '').trim(),
                      model: modelEl?.value || '',
                      mode: modeEl?.value || 'subagent',
                      color: colorEl?.value || '',
                      tools,
                      prompt: promptEl?.value || '',
                    },
                  );
                  setAgents((cur) => cur.map((x) => (x.name === a.name ? updated : x)));
                  toast.success('Agent saved.');
                  modal.close();
                  await refreshSnapshot();
                } catch (err) {
                  toast.error(`Save failed: ${(err as Error).message}`);
                }
              }}
            >
              <Save size={12} /> Save
            </Button>
          </div>
        ),
      });
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (a: Agent) => {
    if (!confirm(`Delete agent "${a.name}"? This removes ${a.path}.`)) return;
    try {
      await api.del(`/agents/${encodeURIComponent(a.name)}`);
      setAgents((cur) => cur.filter((x) => x.name !== a.name));
      toast.success('Agent deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onInvoke = async (a: Agent) => {
    let promptEl: HTMLTextAreaElement | null = null;
    modal.open({
      title: `Invoke ${a.name}`,
      children: (
        <div className="invoke-form">
          <p className="muted invoke-form-meta mono">{a.model || '—'} · {a.path}</p>
          <p className="invoke-form-desc">{a.description}</p>
          <label className="field-label" htmlFor="invoke-prompt">Prompt</label>
          <textarea
            ref={(el) => (promptEl = el)}
            id="invoke-prompt"
            className="textarea"
            rows={5}
            placeholder="What should this agent do?"
            autoFocus
          />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const prompt = (promptEl?.value || '').trim();
              if (!prompt) {
                toast.warning('Prompt is required.');
                return;
              }
              try {
                await api.post(`/agents/${encodeURIComponent(a.name)}/invoke`, { prompt });
                toast.success(`Invoked ${a.name}.`);
                modal.close();
              } catch (err) {
                toast.error(`Invoke failed: ${(err as Error).message}`);
              }
            }}
          >
            <Play size={14} /> Invoke
          </Button>
        </div>
      ),
    });
  };

  return (
    <div className="view view-agents">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Bot size={18} /> Agents ({sorted.length})
          </h2>
          <p className="view-subtitle">
            The Norse pantheon — click <kbd>Edit</kbd> to modify or <kbd>Invoke</kbd> to dispatch.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} /> New agent
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="view-loading"><Spinner size="lg" /></div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Bot size={32} />}
          title="No agents found"
          message="Run bizar in the terminal to install Bizar."
        />
      ) : (
        <div className="agent-grid">
          {sorted.map((a) => (
            <Card key={a.name} variant="elevated" interactive className="agent-card">
              <div className="agent-card-head">
                <div className="agent-card-name">{a.name}</div>
                <StatusBadge kind={a.mode === 'primary' ? 'accent' : 'neutral'}>
                  {a.mode || 'agent'}
                </StatusBadge>
              </div>
              <p className="agent-card-desc">{truncate(a.description, 200)}</p>
              <div className="agent-card-meta">
                <span className="mono" title={a.model || ''}>
                  {a.model || '—'}
                </span>
                <span className="tabular-nums muted">{formatRelative(a.mtime)}</span>
              </div>
              <div className="agent-card-actions">
                <Button variant="primary" size="sm" onClick={() => onInvoke(a)}>
                  <Play size={12} /> Invoke
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
                  <Pencil size={12} /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(a)}>
                  <Trash2 size={12} /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
