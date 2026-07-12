// src/views/Agents.tsx — Agent roster view (Wave 3 redesign).
//
// Wave 3 migrates the legacy card-grid agent roster to the Bizar design
// system: a split-pane layout with a sortable DataTable on the left and a
// detail Panel on the right that surfaces the selected agent's metadata,
// actions (Edit / Delete / Restart) and system prompt. Modals still use the
// legacy Modal component (the design-system Dialog will land in a later
// wave), and the public function signature, export name, API paths, and
// WS event subscriptions remain unchanged so callers and the server are
// not disturbed by this UI-only refactor.
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Play,
  Save,
  RotateCw,
  CircleAlert,
} from 'lucide-react';
import { Button } from '../components/Button';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { formatRelative, truncate } from '../lib/utils';
import type { Agent, Settings, Snapshot } from '../lib/types';

// Design-system consumers — Wave 3 first real view to use them.
import { Stack, Inline, Box } from '../ui/primitives';
import {
  DataTable,
  KeyValueList,
  EmptyState,
  LoadingState,
  type DataTableColumn,
  type KeyValueItem,
} from '../ui/data';
import { Button as UIButton } from '../ui/controls';
import { Badge, StatusDot } from '../ui/feedback';
import { Panel } from '../ui/layout';
import { cx } from '../ui/utils/cx';

import '../styles/agents-redesign.css';

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
  'openrouter/minimax/minimax-m3',
  'openrouter/minimax/minimax-m2.7',
];

// Default agent swatch — the only place in the dashboard where a
// literal hex appears. HTML <input type="color"> requires CSS Color
// Module Level 3 hex format (no `oklch()`, no `var(--token)`). Keep
// this in sync with --default-agent-swatch in ui/styles/tokens.css;
// the token is what every CSS-side swatch reads, this is just the
// native color-input seed value.
const DEFAULT_AGENT_SWATCH_HEX = '#8b5cf6';

const CATEGORIES = [
  { id: 'reasoning', label: 'Reasoning', variant: 'accent' as const },
  { id: 'code', label: 'Code', variant: 'info' as const },
  { id: 'design', label: 'Design', variant: 'success' as const },
  { id: 'planning', label: 'Planning', variant: 'warning' as const },
  { id: 'gitops', label: 'GitOps', variant: 'danger' as const },
  { id: 'analysis', label: 'Analysis', variant: 'neutral' as const },
];

function categoryMeta(cat: string | undefined): { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' } {
  if (!cat) return { label: '—', variant: 'neutral' };
  const found = CATEGORIES.find((c) => c.id === cat);
  return found
    ? { label: found.label, variant: found.variant }
    : { label: cat, variant: 'neutral' };
}

type StatusKind = 'idle' | 'working' | 'error' | 'stuck';

function statusKind(agent: Agent): StatusKind {
  if (agent.isStuck) return 'stuck';
  const s = (agent.status || 'idle') as string;
  if (s === 'working') return 'working';
  if (s === 'error') return 'error';
  return 'idle';
}

function statusLabel(kind: StatusKind): string {
  if (kind === 'stuck') return 'stuck';
  return kind;
}

function statusDotVariant(kind: StatusKind): 'neutral' | 'info' | 'danger' {
  if (kind === 'working') return 'info';
  if (kind === 'error' || kind === 'stuck') return 'danger';
  return 'neutral';
}

function lastSeenTs(agent: Agent): number | undefined {
  // The Agent type exposes `lastSeen` (legacy) and a future `lastSeenAt`.
  // Either is acceptable; missing fields render as "—".
  const a = agent as unknown as { lastSeenAt?: number };
  return a.lastSeenAt ?? agent.lastSeen;
}

function tagsToString(tags: string[] | undefined, max = 4): string {
  if (!tags || tags.length === 0) return '—';
  const shown = tags.slice(0, max).join(', ');
  return tags.length > max ? `${shown} +${tags.length - max}` : shown;
}

export function Agents({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [agents, setAgents] = useState<Agent[]>(snapshot.agents || []);
  const [loading, setLoading] = useState(!snapshot.agents);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    setAgents(snapshot.agents || []);
    setLoading(!snapshot.agents);
  }, [snapshot.agents]);

  // If the selected agent disappears from the list (deleted elsewhere, WS
  // swap), clear the selection so the detail panel reverts to the placeholder.
  useEffect(() => {
    if (selectedName && !agents.some((a) => a.name === selectedName)) {
      setSelectedName(null);
    }
  }, [agents, selectedName]);

  const reload = async (): Promise<void> => {
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
      out = out.filter((a) =>
        categoryFilter === '__none__'
          ? !(a.category || '')
          : (a.category || '') === categoryFilter,
      );
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

  const hasLastSeen = sorted.some((a) => typeof lastSeenTs(a) === 'number');

  const selected = useMemo(
    () => sorted.find((a) => a.name === selectedName) || null,
    [sorted, selectedName],
  );

  // ─── Handlers (modal flows kept on the legacy Modal) ───────────────────

  const onCreate = (): void => {
    let nameEl: HTMLInputElement | null = null;
    let descEl: HTMLInputElement | null = null;
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
          <label className="field-label" htmlFor="agent-new-name">Name (a-z, 0-9, dashes)</label>
          <input
            id="agent-new-name"
            ref={(el) => (nameEl = el)}
            className="input"
            type="text"
            placeholder="my-agent"
            autoFocus
          />
          <label className="field-label" htmlFor="agent-new-desc">Description</label>
          <input
            id="agent-new-desc"
            ref={(el) => { descEl = el; }}
            className="input"
            type="text"
            placeholder="What does this agent do?"
          />
          <div className="task-form-row">
            <div className="task-form-field">
              <label className="field-label" htmlFor="agent-new-model">Model</label>
              <select id="agent-new-model" ref={(el) => (modelEl = el)} className="select" defaultValue="">
                <option value="">(provider default)</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field">
              <label className="field-label" htmlFor="agent-new-mode">Mode</label>
              <select id="agent-new-mode" ref={(el) => (modeEl = el)} className="select" defaultValue="subagent">
                <option value="primary">primary</option>
                <option value="subagent">subagent</option>
                <option value="all">all</option>
              </select>
            </div>
            <div className="task-form-field" style={{ flex: '0 0 80px' }}>
              <label className="field-label" htmlFor="agent-new-color">Color</label>
              <input id="agent-new-color" ref={(el) => (colorEl = el)} className="input" type="color" defaultValue={DEFAULT_AGENT_SWATCH_HEX} />
            </div>
          </div>
          <div className="task-form-row">
            <div className="task-form-field" style={{ flex: 1 }}>
              <label className="field-label" htmlFor="agent-new-category">Category</label>
              <select id="agent-new-category" ref={(el) => (categoryEl = el)} className="select" defaultValue="">
                <option value="">(none)</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field" style={{ flex: 2 }}>
              <label className="field-label" htmlFor="agent-new-tags">Tags (comma-separated)</label>
              <input id="agent-new-tags" ref={(el) => (tagsEl = el)} className="input" type="text" placeholder="reasoning, code, planning" />
            </div>
          </div>
          <fieldset>
            <legend className="field-label" style={{ padding: 0 }}>Tools</legend>
            <div ref={(el) => (toolsContainer = el)} className="agent-tools">
              {TOOL_OPTIONS.map((t) => (
                <label key={t} className="checkbox-row">
                  <input type="checkbox" value={t} aria-label={t} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field-label" htmlFor="agent-new-prompt">System prompt</label>
          <textarea
            id="agent-new-prompt"
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
                setSelectedName(created.name);
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

  const onEdit = async (a: Agent): Promise<void> => {
    let descEl: HTMLInputElement | null = null;
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
            <label className="field-label" htmlFor="agent-edit-desc">Description</label>
            <input
              id="agent-edit-desc"
              ref={(el) => { descEl = el; }}
              className="input"
              type="text"
              defaultValue={full.description}
            />
            <div className="task-form-row">
              <div className="task-form-field">
                <label className="field-label" htmlFor="agent-edit-model">Model</label>
                <select id="agent-edit-model" ref={(el) => (modelEl = el)} className="select" defaultValue={full.model}>
                  <option value="">(provider default)</option>
                  {MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="task-form-field">
                <label className="field-label" htmlFor="agent-edit-mode">Mode</label>
                <select id="agent-edit-mode" ref={(el) => (modeEl = el)} className="select" defaultValue={full.mode || 'subagent'}>
                  <option value="primary">primary</option>
                  <option value="subagent">subagent</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div className="task-form-field" style={{ flex: '0 0 80px' }}>
                <label className="field-label" htmlFor="agent-edit-color">Color</label>
                <input id="agent-edit-color" ref={(el) => (colorEl = el)} className="input" type="color" defaultValue={full.color || DEFAULT_AGENT_SWATCH_HEX} />
              </div>
            </div>
            <div className="task-form-row">
              <div className="task-form-field" style={{ flex: 1 }}>
                <label className="field-label" htmlFor="agent-edit-category">Category</label>
                <select id="agent-edit-category" ref={(el) => (categoryEl = el)} className="select" defaultValue={full.category || ''}>
                  <option value="">(none)</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="task-form-field" style={{ flex: 2 }}>
                <label className="field-label" htmlFor="agent-edit-tags">Tags (comma-separated)</label>
                <input
                  id="agent-edit-tags"
                  ref={(el) => (tagsEl = el)}
                  className="input"
                  type="text"
                  defaultValue={(full.tags || []).join(', ')}
                />
              </div>
            </div>
            <fieldset>
              <legend className="field-label" style={{ padding: 0 }}>Tools</legend>
              <div ref={(el) => (toolsContainer = el)} className="agent-tools">
                {TOOL_OPTIONS.map((t) => (
                  <label key={t} className="checkbox-row">
                    <input type="checkbox" value={t} aria-label={t} defaultChecked={full.tools?.includes(t)} />
                    <span>{t}</span>
                  </label>
              ))}
              </div>
            </fieldset>
            <label className="field-label" htmlFor="agent-edit-prompt">System prompt</label>
            <textarea
              id="agent-edit-prompt"
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

  const onDelete = async (a: Agent): Promise<void> => {
    if (!confirm(`Delete agent "${a.name}"? This removes ${a.path}.`)) return;
    try {
      await api.del(`/agents/${encodeURIComponent(a.name)}`);
      setAgents((cur) => cur.filter((x) => x.name !== a.name));
      toast.success('Agent deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onInvoke = (a: Agent): void => {
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

  const onRestart = async (a: Agent): Promise<void> => {
    try {
      const updated = await api.post<Agent>(`/agents/${encodeURIComponent(a.name)}/restart`);
      setAgents((cur) => cur.map((x) => (x.name === a.name ? updated : x)));
      toast.success(`${a.name} restarted.`);
    } catch (err) {
      toast.error(`Restart failed: ${(err as Error).message}`);
    }
  };

  const onSetStatus = async (a: Agent, status: 'idle' | 'working' | 'error'): Promise<void> => {
    try {
      const updated = await api.post<Agent>(`/agents/${encodeURIComponent(a.name)}/status`, { status });
      setAgents((cur) => cur.map((x) => (x.name === a.name ? updated : x)));
    } catch (err) {
      toast.error(`Status update failed: ${(err as Error).message}`);
    }
  };

  // ─── Table column definitions ──────────────────────────────────────────

  type Col = DataTableColumn<Agent>;

  const columns: Col[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      accessor: (a) => a.name,
      render: (a) => (
        <span className="agents-name-cell">
          <span
            className={cx(
              'agents-name-cell__swatch',
              !a.color && 'agents-name-cell__swatch--empty',
            )}
            style={a.color ? { background: a.color } : undefined}
            aria-hidden="true"
          />
          {a.name}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      accessor: (a) => statusKind(a),
      render: (a) => {
        const kind = statusKind(a);
        return (
          <span className="agents-status-cell">
            <StatusDot
              variant={statusDotVariant(kind)}
              size="sm"
              pulse={kind === 'stuck'}
              label={statusLabel(kind)}
            />
            <span
              className={cx(
                'agents-status-cell__label',
                kind === 'stuck' && 'agents-status-cell__label--stuck',
              )}
            >
              {statusLabel(kind)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      accessor: (a) => a.category || '',
      render: (a) => {
        const meta = categoryMeta(a.category);
        if (!a.category) return <span className="muted">—</span>;
        return (
          <span className="agents-category-cell">
            <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
          </span>
        );
      },
    },
    {
      key: 'tags',
      header: 'Tags',
      accessor: (a) => (a.tags || []).join(','),
      render: (a) => (
        <span className="agents-tags-cell" title={(a.tags || []).join(', ')}>
          {tagsToString(a.tags)}
        </span>
      ),
    },
  ];

  if (hasLastSeen) {
    columns.push({
      key: 'lastSeen',
      header: 'Last seen',
      sortable: true,
      accessor: (a) => lastSeenTs(a) || 0,
      render: (a) => {
        const ts = lastSeenTs(a);
        return <span className="muted tabular-nums">{ts ? formatRelative(ts) : '—'}</span>;
      },
    });
  }

  // ─── Detail panel ─────────────────────────────────────────────────────

  function renderDetailBody(): React.JSX.Element {
    if (!selected) {
      return (
        <div className="agents-detail__placeholder">
          <span className="agents-detail__placeholder-icon" aria-hidden="true">
            <Bot size={28} />
          </span>
          <span className="agents-detail__placeholder-title">No agent selected</span>
          <span>Pick a row from the table to see its metadata, actions, and prompt.</span>
        </div>
      );
    }

    const a = selected;
    const kind = statusKind(a);
    const catMeta = categoryMeta(a.category);
    const canRestart = a.isStuck || a.status === 'working' || a.status === 'error';

    const metaItems: KeyValueItem[] = [
      {
        key: 'status',
        label: 'Status',
        value: (
          <span className="agents-status-cell">
            <StatusDot
              variant={statusDotVariant(kind)}
              size="sm"
              pulse={kind === 'stuck'}
              label={statusLabel(kind)}
            />
            <span className="agents-status-cell__label">{statusLabel(kind)}</span>
          </span>
        ),
      },
      {
        key: 'category',
        label: 'Category',
        value: a.category
          ? <Badge variant={catMeta.variant} size="sm">{catMeta.label}</Badge>
          : <span className="muted">—</span>,
      },
      {
        key: 'tags',
        label: 'Tags',
        value: a.tags && a.tags.length > 0 ? (
          <Inline gap={1} className="agents-detail__tags">
            {a.tags.map((t) => (
              <Badge key={t} variant="neutral" size="sm">{t}</Badge>
            ))}
          </Inline>
        ) : <span className="muted">—</span>,
      },
      {
        key: 'tools',
        label: 'Tools',
        value: a.tools && a.tools.length > 0 ? (
          <Inline gap={1} className="agents-detail__tools">
            {a.tools.map((t) => (
              <Badge key={t} variant="info" size="sm">{t}</Badge>
            ))}
          </Inline>
        ) : <span className="muted">—</span>,
      },
      {
        key: 'model',
        label: 'Model',
        mono: true,
        copyable: true,
        value: a.model || '—',
      },
      {
        key: 'mode',
        label: 'Mode',
        value: a.mode || 'subagent',
      },
      {
        key: 'color',
        label: 'Color',
        value: a.color ? (
          <Inline gap={2} align="center">
            <span
              className="agents-detail__name-swatch"
              style={{ background: a.color }}
              aria-hidden="true"
            />
            <code className="mono">{a.color}</code>
          </Inline>
        ) : <span className="muted">—</span>,
      },
      {
        key: 'description',
        label: 'Description',
        value: a.description
          ? <div className="agents-detail__description">{truncate(a.description, 600)}</div>
          : <span className="muted">—</span>,
      },
    ];

    if (typeof lastSeenTs(a) === 'number') {
      metaItems.push({
        key: 'lastSeen',
        label: 'Last seen',
        mono: true,
        value: formatRelative(lastSeenTs(a) as number),
      });
    }

    if (a.lastError?.message) {
      metaItems.push({
        key: 'lastError',
        label: 'Last error',
        value: (
          <div className="agents-detail__error">{a.lastError.message}</div>
        ),
      });
    }

    return (
      <Stack gap={4} className="agents-detail__meta">
        <KeyValueList items={metaItems} orientation="horizontal" />

        <Box className="agents-detail__prompt">
          <span className="agents-detail__prompt-label">System prompt</span>
          {a.prompt ? (
            <pre className="agents-detail__prompt-body">{a.prompt}</pre>
          ) : (
            <span className="agents-detail__prompt-empty">No prompt configured.</span>
          )}
        </Box>

        <Inline gap={2} wrap className="agents-detail__actions">
          <UIButton
            variant="secondary"
            size="sm"
            icon={<Pencil size={12} />}
            onClick={() => onEdit(a)}
            aria-label={`Edit ${a.name}`}
            data-testid={`agents-detail-edit-${a.name}`}
          >
            Edit
          </UIButton>
          <UIButton
            variant="secondary"
            size="sm"
            icon={<Play size={12} />}
            onClick={() => onInvoke(a)}
            aria-label={`Invoke ${a.name}`}
            data-testid={`agents-detail-invoke-${a.name}`}
          >
            Invoke
          </UIButton>
          {canRestart && (
            <UIButton
              variant="ghost"
              size="sm"
              icon={<RotateCw size={12} />}
              onClick={() => onRestart(a)}
              aria-label={`Restart ${a.name}`}
              data-testid={`agents-detail-restart-${a.name}`}
            >
              Restart
            </UIButton>
          )}
          <UIButton
            variant="danger"
            size="sm"
            icon={<Trash2 size={12} />}
            onClick={() => onDelete(a)}
            aria-label={`Delete ${a.name}`}
            data-testid={`agents-detail-delete-${a.name}`}
          >
            Delete
          </UIButton>
        </Inline>

        {a.isStuck && (
          <Inline gap={2} align="center" className="agents-detail__error">
            <CircleAlert size={12} />
            <span>
              Agent is stuck — restart to reset state.
            </span>
          </Inline>
        )}
      </Stack>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
    { value: '__none__', label: '(no category)' },
  ];

  return (
    <div className="agents-redesign" data-testid="agents-view">
      <header className="agents-redesign__header">
        <div className="agents-redesign__header-text">
          <h2 className="agents-redesign__title">
            <Bot size={18} aria-hidden="true" />
            <span>Agents</span>
            <span className="agents-redesign__title-count" data-testid="agents-count">
              ({sorted.length})
            </span>
          </h2>
          <p className="agents-redesign__subtitle">
            The Norse pantheon — pick a row to inspect, <kbd>Edit</kbd> to modify, <kbd>Invoke</kbd> to dispatch.
          </p>
        </div>
        <div className="agents-redesign__controls">
          <span className="agents-redesign__control" style={{ minWidth: 180 }}>
            <label htmlFor="agents-search" className="vh">Search agents</label>
            <input
              id="agents-search"
              className="input"
              type="search"
              placeholder="Search name, description, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search agents"
              data-testid="agents-search"
            />
          </span>
          <span className="agents-redesign__control" style={{ minWidth: 180 }}>
            <label htmlFor="agents-category-filter" className="vh">Filter by category</label>
            <select
              id="agents-category-filter"
              className="select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              data-testid="agents-category-filter"
            >
              {categoryOptions.map((opt) => (
                <option key={opt.value || '__all__'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </span>
          <UIButton
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={12} />}
            onClick={reload}
            aria-label="Refresh"
            data-testid="agents-refresh"
          >
            Refresh
          </UIButton>
          <UIButton
            variant="primary"
            size="sm"
            icon={<Plus size={12} />}
            onClick={onCreate}
            aria-label="New agent"
            data-testid="agents-new"
          >
            New agent
          </UIButton>
        </div>
      </header>

      <div className="agents-redesign__body">
        <Box className="agents-roster">
          {loading ? (
            <LoadingState label="Loading agents…" rows={3} />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Bot size={32} />}
              title="No agents found"
              description={
                agents.length === 0
                  ? 'Run bizar in the terminal to install Bizar.'
                  : 'No agents match the current filters — try clearing the search or category.'
              }
              action={
                agents.length === 0
                  ? undefined
                  : {
                      label: 'Clear filters',
                      onClick: () => {
                        setSearch('');
                        setCategoryFilter('');
                      },
                    }
              }
            />
          ) : (
            <div className="agents-roster__table" data-testid="agents-table">
              <DataTable<Agent>
                columns={columns}
                data={sorted}
                rowKey={(a) => a.name}
                compact
                onRowClick={(a) => setSelectedName(a.name)}
              />
            </div>
          )}
        </Box>

        <Panel
          title={
            selected ? (
              <span className="agents-detail__name">
                <span
                  className={cx(
                    'agents-detail__name-swatch',
                    !selected.color && 'agents-detail__name-swatch--empty',
                  )}
                  style={selected.color ? { background: selected.color } : undefined}
                  aria-hidden="true"
                />
                <span>{selected.name}</span>
              </span>
            ) : (
              'Agent detail'
            )
          }
          description={
            selected
              ? selected.path
              : 'Select an agent from the roster to see its metadata.'
          }
          padding={4}
          variant="outlined"
          className="agents-detail"
        >
          {renderDetailBody()}
        </Panel>
      </div>
    </div>
  );
}