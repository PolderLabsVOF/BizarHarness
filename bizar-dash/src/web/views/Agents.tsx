// src/views/Agents.tsx — v3.1.0 agents with tags, categories, real-time status.
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Play,
  Save,
  X,
  RotateCw,
  Activity,
  Tag as TagIcon,
  Folder,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatRelative, truncate } from '../lib/utils';
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

const CATEGORIES = [
  { id: 'reasoning', label: 'Reasoning', color: 'var(--accent)' },
  { id: 'code', label: 'Code', color: 'var(--info)' },
  { id: 'design', label: 'Design', color: 'var(--success)' },
  { id: 'planning', label: 'Planning', color: 'var(--warning)' },
  { id: 'gitops', label: 'GitOps', color: 'var(--error)' },
  { id: 'analysis', label: 'Analysis', color: 'var(--text-dim)' },
];

function categoryColor(cat: string | undefined): string {
  return CATEGORIES.find((c) => c.id === cat)?.color || 'var(--text-dim)';
}

function StatusDot({ status, isStuck }: { status?: string; isStuck?: boolean }) {
  const color =
    isStuck ? 'var(--error)'
    : status === 'working' ? 'var(--info)'
    : status === 'error' ? 'var(--error)'
    : 'var(--text-dim)';
  return <span className="agent-status-dot" style={{ background: color }} />;
}

function StatusPill({ agent }: { agent: Agent }) {
  if (agent.isStuck) {
    return <StatusBadge kind="error" dot>stuck</StatusBadge>;
  }
  const status = agent.status || 'idle';
  if (status === 'working') return <StatusBadge kind="info" dot>working</StatusBadge>;
  if (status === 'error') return <StatusBadge kind="error" dot>error</StatusBadge>;
  return <StatusBadge kind="neutral" dot>idle</StatusBadge>;
}

export function Agents({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [agents, setAgents] = useState<Agent[]>(snapshot.agents || []);
  const [loading, setLoading] = useState(!snapshot.agents);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setAgents(snapshot.agents || []);
    setLoading(!snapshot.agents);
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

  const sorted = useMemo(() => {
    let out = [...agents];
    if (categoryFilter) {
      out = out.filter((a) => (a.category || '') === categoryFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, categoryFilter, search]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) for (const t of a.tags || []) set.add(t);
    return Array.from(set).sort();
  }, [agents]);

  const onCreate = () => {
    let nameEl: HTMLInputElement | null = null;
    let descEl: HTMLTextAreaElement | null = null;
    let modelEl: HTMLSelectElement | null = null;
    let modeEl: HTMLSelectElement | null = null;
    let colorEl: HTMLInputElement | null = null;
    let promptEl: HTMLTextAreaElement | null = null;
    let toolsContainer: HTMLDivElement | null = null;
    let tagsEl: HTMLInputElement | null = null;
    let categoryEl: HTMLSelectElement | null = null;

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
          <div className="task-form-row">
            <div className="task-form-field" style={{ flex: 1 }}>
              <label className="field-label">Category</label>
              <select ref={(el) => (categoryEl = el)} className="select" defaultValue="">
                <option value="">(none)</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field" style={{ flex: 2 }}>
              <label className="field-label">Tags (comma-separated)</label>
              <input ref={(el) => (tagsEl = el)} className="input" type="text" placeholder="reasoning, code, planning" />
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
              const tags = (tagsEl?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
              try {
                const created = await api.post<Agent>('/agents', {
                  name,
                  description: (descEl?.value || '').trim(),
                  model: modelEl?.value || '',
                  mode: modeEl?.value || 'subagent',
                  color: colorEl?.value || '',
                  tools,
                  tags,
                  category: categoryEl?.value || '',
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
    let tagsEl: HTMLInputElement | null = null;
    let categoryEl: HTMLSelectElement | null = null;
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
            <div className="task-form-row">
              <div className="task-form-field" style={{ flex: 1 }}>
                <label className="field-label">Category</label>
                <select ref={(el) => (categoryEl = el)} className="select" defaultValue={full.category || ''}>
                  <option value="">(none)</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="task-form-field" style={{ flex: 2 }}>
                <label className="field-label">Tags (comma-separated)</label>
                <input
                  ref={(el) => (tagsEl = el)}
                  className="input"
                  type="text"
                  defaultValue={(full.tags || []).join(', ')}
                />
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
                const tags = (tagsEl?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
                try {
                  const updated = await api.put<Agent>(
                    `/agents/${encodeURIComponent(a.name)}`,
                    {
                      description: (descEl?.value || '').trim(),
                      model: modelEl?.value || '',
                      mode: modeEl?.value || 'subagent',
                      color: colorEl?.value || '',
                      tools,
                      tags,
                      category: categoryEl?.value || '',
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

  const onRestart = async (a: Agent) => {
    try {
      const updated = await api.post<Agent>(`/agents/${encodeURIComponent(a.name)}/restart`);
      setAgents((cur) => cur.map((x) => (x.name === a.name ? updated : x)));
      toast.success(`${a.name} restarted.`);
    } catch (err) {
      toast.error(`Restart failed: ${(err as Error).message}`);
    }
  };

  const onSetStatus = async (a: Agent, status: 'idle' | 'working' | 'error') => {
    try {
      const updated = await api.post<Agent>(`/agents/${encodeURIComponent(a.name)}/status`, { status });
      setAgents((cur) => cur.map((x) => (x.name === a.name ? updated : x)));
    } catch (err) {
      toast.error(`Status update failed: ${(err as Error).message}`);
    }
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
          <div className="search-input">
            <input
              className="input"
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select select-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
            <option value="__none__">(no category)</option>
          </select>
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} /> New agent
          </Button>
        </div>
      </header>

      {allTags.length > 0 && (
        <div className="agent-tags-row">
          <TagIcon size={12} />
          {allTags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
      )}

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
            <AgentCard
              key={a.name}
              agent={a}
              onInvoke={() => onInvoke(a)}
              onEdit={() => onEdit(a)}
              onDelete={() => onDelete(a)}
              onRestart={() => onRestart(a)}
              onSetStatus={(s) => onSetStatus(a, s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onInvoke,
  onEdit,
  onDelete,
  onRestart,
  onSetStatus,
}: {
  agent: Agent;
  onInvoke: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestart: () => void;
  onSetStatus: (s: 'idle' | 'working' | 'error') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const catColor = categoryColor(agent.category);
  const isWorking = (agent.status === 'working' || !!agent.currentTaskId) && !agent.isStuck;
  return (
    <Card
      variant="elevated"
      interactive
      className={cn(
        'agent-card',
        isWorking && 'is-working',
        agent.isStuck && 'is-stuck',
      )}
    >
      <div className="agent-card-head">
        <div className="agent-card-name">
          <StatusDot status={agent.status} isStuck={agent.isStuck} />
          {agent.name}
        </div>
        <div className="agent-card-badges">
          {agent.category && (
            <span
              className="agent-card-category"
              style={{ background: `color-mix(in srgb, ${catColor} 18%, transparent)`, color: catColor }}
            >
              {agent.category}
            </span>
          )}
          <StatusPill agent={agent} />
        </div>
      </div>
      <p className="agent-card-desc">{truncate(agent.description, 200)}</p>
      <div className="agent-card-meta">
        <span className="mono" title={agent.model || ''}>
          {agent.model || '—'}
        </span>
        <span className="tabular-nums muted">{formatRelative(agent.mtime)}</span>
      </div>
      {agent.tags && agent.tags.length > 0 && (
        <div className="agent-card-tags">
          {agent.tags.map((t) => (
            <span key={t} className="agent-card-tag">{t}</span>
          ))}
        </div>
      )}
      {(isWorking || agent.lastTask) && (
        <div className="agent-card-activity">
          {agent.currentTaskId && (
            <div className="agent-card-row">
              <Activity size={12} />
              <span className="muted">Working on</span>
              <code className="mono">{agent.currentTaskId}</code>
            </div>
          )}
          {agent.lastTask && !agent.currentTaskId && (
            <div className="agent-card-row">
              <CheckCircle2 size={12} />
              <span className="muted">Last</span>
              <code className="mono">{agent.lastTask.id}</code>
              <span className="muted tabular-nums">{formatRelative(agent.lastTask.finishedAt)}</span>
            </div>
          )}
          {agent.tasksTotal != null && agent.tasksTotal > 0 && (
            <div className="agent-card-row">
              <Circle size={12} />
              <span className="muted">Success rate</span>
              <span className="tabular-nums">{Math.round((agent.successRate || 0) * 100)}%</span>
              <span className="muted tabular-nums">({agent.tasksSucceeded}/{agent.tasksTotal})</span>
            </div>
          )}
        </div>
      )}
      {agent.lastError && (
        <div className="agent-card-error">
          <AlertTriangle size={12} />
          <span className="muted">Last error: {agent.lastError.message}</span>
        </div>
      )}
      <div className="agent-card-actions">
        <Button variant="primary" size="sm" onClick={onInvoke}>
          <Play size={12} /> Invoke
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={12} /> Edit
        </Button>
        {(agent.isStuck || agent.status === 'working' || agent.status === 'error') && (
          <Button variant="ghost" size="sm" onClick={onRestart} title="Reset agent status">
            <RotateCw size={12} /> Restart
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 size={12} />
        </Button>
        <button
          type="button"
          className="icon-btn"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((v) => !v)}
          style={{ marginLeft: 'auto' }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="agent-card-expanded">
          <div className="agent-card-status-actions">
            <span className="muted text-sm">Set status:</span>
            <Button
              variant={agent.status === 'idle' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onSetStatus('idle')}
            >
              Idle
            </Button>
            <Button
              variant={agent.status === 'working' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onSetStatus('working')}
            >
              Working
            </Button>
            <Button
              variant={agent.status === 'error' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onSetStatus('error')}
            >
              Error
            </Button>
          </div>
          <div className="agent-card-meta">
            <Folder size={11} />
            <code className="mono agent-card-path">{agent.path}</code>
          </div>
        </div>
      )}
    </Card>
  );
}
