// Glyphs block vocabulary — renders MDX blocks from plan.mdx

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Diamond,
  FileCode2,
  Info,
  Minus,
  StickyNote,
  XCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RichTextProps {
  id: string;
  children: string;
}

export function RichText({ id, children }: RichTextProps) {
  return (
    <div
      id={id}
      data-block-id={id}
      className={cn('glyph-richtext')}
      style={proseStyle}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export interface CalloutProps {
  id: string;
  tone?: 'info' | 'warn' | 'success' | 'danger';
  children: string;
}

const CALLOUT_TONE: Record<NonNullable<CalloutProps['tone']>, {
  bg: string; border: string; fg: string; icon: typeof Info; label: string;
}> = {
  info:    { bg: 'var(--info-soft, rgba(96, 165, 250, 0.12))',  border: 'var(--info)',    fg: 'var(--info)',    icon: Info,            label: 'Note' },
  warn:    { bg: 'var(--warning-soft, rgba(251, 191, 36, 0.15))', border: 'var(--warning)', fg: 'var(--warning)', icon: AlertTriangle,  label: 'Warning' },
  success: { bg: 'var(--success-soft, rgba(52, 211, 153, 0.15))', border: 'var(--success)', fg: 'var(--success)', icon: CheckCircle2,   label: 'Success' },
  danger:  { bg: 'var(--error-soft, rgba(248, 113, 113, 0.12))',  border: 'var(--error)',   fg: 'var(--error)',   icon: XCircle,        label: 'Danger' },
};

export function Callout({ id, tone = 'info', children }: CalloutProps) {
  const t = CALLOUT_TONE[tone];
  const Icon = t.icon;
  return (
    <div
      id={id}
      data-block-id={id}
      className={cn('glyph-callout', `glyph-callout-${tone}`)}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        margin: '12px 0',
        borderLeft: `3px solid ${t.border}`,
        background: t.bg,
        borderRadius: 8,
        color: 'var(--text)',
      }}
      role={tone === 'danger' || tone === 'warn' ? 'alert' : undefined}
    >
      <div style={{ flexShrink: 0, color: t.fg, paddingTop: 2 }}>
        <Icon size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: t.fg, marginBottom: 4 }}>
          {t.label}
        </div>
        <div className="glyph-richtext" style={{ ...proseStyle, fontSize: 14 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}
export interface ChecklistProps {
  id: string;
  items: ChecklistItem[];
}

export function Checklist({ id, items }: ChecklistProps) {
  return (
    <ul
      id={id}
      data-block-id={id}
      className="glyph-checklist"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: '12px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {items.map((item) => (
        <li
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            fontSize: 14,
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              marginTop: 1,
              width: 16,
              height: 16,
              borderRadius: 4,
              border: `1.5px solid ${item.checked ? 'var(--success)' : 'var(--border-strong)'}`,
              background: item.checked ? 'var(--success)' : 'transparent',
              color: 'var(--bg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {item.checked ? <Check size={12} strokeWidth={3} /> : null}
          </span>
          <span style={{
            color: item.checked ? 'var(--text-dim)' : 'var(--text)',
            textDecoration: item.checked ? 'line-through' : 'none',
            wordBreak: 'break-word',
          }}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface TableProps {
  id: string;
  columns: string[];
  rows: string[][];
}

export function Table({ id, columns, rows }: TableProps) {
  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-table-wrap"
      style={{
        margin: '12px 0',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'auto',
        background: 'var(--bg-elev)',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border-strong)',
                  background: 'var(--bg)',
                  color: 'var(--text-dim)',
                  fontWeight: 600,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop: ri === 0 ? 'none' : '1px solid var(--border)' }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: '8px 12px',
                    color: 'var(--text)',
                    verticalAlign: 'top',
                    wordBreak: 'break-word',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface CodeTab {
  id: string;
  label: string;
  language: string;
  code: string;
  caption?: string;
}
export interface CodeTabsProps {
  id: string;
  tabs: CodeTab[];
}

export function CodeTabs({ id, tabs }: CodeTabsProps) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '');
  const active = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );

  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-codetabs"
      style={{
        margin: '12px 0',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-elev)',
      }}
    >
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 2,
          padding: 4,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
        }}
      >
        {tabs.map((t) => {
          const selected = t.id === active?.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(t.id)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: selected ? 'var(--bg-elev)' : 'transparent',
                color: selected ? 'var(--text-strong)' : 'var(--text-dim)',
                boxShadow: selected ? '0 0 0 1px var(--border)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{t.label}</span>
              {t.language && (
                <span style={{ marginLeft: 6, color: 'var(--text-dim)', fontSize: 11 }}>
                  {t.language}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <>
          <pre
            style={{
              margin: 0,
              padding: 14,
              overflowX: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--text)',
              background: 'var(--bg-elev)',
            }}
          >
            <code>{active.code}</code>
          </pre>
          {active.caption && (
            <div
              style={{
                padding: '8px 14px',
                borderTop: '1px solid var(--border)',
                fontSize: 12,
                color: 'var(--text-dim)',
                background: 'var(--bg)',
              }}
            >
              {active.caption}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface DecisionOption {
  id: string;
  label: string;
  detail: string;
  recommended?: boolean;
}
export interface DecisionProps {
  id: string;
  title?: string;
  question?: string;
  options: DecisionOption[];
}

export function Decision({ id, title, question, options }: DecisionProps) {
  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-decision"
      style={{
        margin: '16px 0',
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-elev)',
      }}
    >
      {title && (
        <h3 style={{ margin: 0, marginBottom: 4, fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </h3>
      )}
      {question && (
        <p style={{ margin: 0, marginBottom: 12, fontSize: 13, color: 'var(--text-dim)' }}>
          {question}
        </p>
      )}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {options.map((opt) => {
          const isRec = !!opt.recommended;
          return (
            <div
              key={opt.id}
              style={{
                position: 'relative',
                padding: 12,
                borderRadius: 8,
                border: isRec ? '2px solid var(--success)' : '1px solid var(--border)',
                background: isRec ? 'var(--success-soft)' : 'var(--bg)',
              }}
            >
              {isRec && (
                <span
                  style={{
                    position: 'absolute',
                    top: -10,
                    right: 10,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--bg)',
                    background: 'var(--success)',
                    borderRadius: 999,
                  }}
                >
                  Recommended
                </span>
              )}
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)', marginBottom: 4 }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {opt.detail}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface OpenQuestion {
  id: string;
  label: string;
  kind: 'choice' | 'text' | 'multi';
  options?: string[];
}
export interface OpenQuestionsProps {
  id: string;
  questions: OpenQuestion[];
}

export function OpenQuestions({ id, questions }: OpenQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  function setAnswer(qid: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-openquestions"
      style={{
        margin: '16px 0',
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
        Open questions
      </div>
      {questions.map((q) => (
        <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor={`oq-${q.id}`}
            style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}
          >
            {q.label}
          </label>
          {q.kind === 'choice' && (
            <select
              id={`oq-${q.id}`}
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              style={inputStyle}
            >
              <option value="">— select —</option>
              {(q.options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {q.kind === 'text' && (
            <input
              id={`oq-${q.id}`}
              type="text"
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              style={inputStyle}
            />
          )}
          {q.kind === 'multi' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(q.options ?? []).map((opt) => {
                const current = (answers[q.id] as string[]) ?? [];
                const checked = current.includes(opt);
                return (
                  <label
                    key={opt}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--text)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? current.filter((o) => o !== opt)
                          : [...current, opt];
                        setAnswer(q.id, next);
                      }}
                    />
                    <span>{opt}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

export interface FileTreeEntry {
  path: string;
  change: 'added' | 'modified' | 'removed' | 'renamed';
  note?: string;
}
export interface FileTreeProps {
  id: string;
  title?: string;
  entries: FileTreeEntry[];
}

const FILE_CHANGE: Record<FileTreeEntry['change'], { bg: string; fg: string; label: string }> = {
  added:    { bg: 'var(--success-soft)', fg: 'var(--success)', label: 'A' },
  modified: { bg: 'var(--info-soft, rgba(96, 165, 250, 0.12))', fg: 'var(--info)', label: 'M' },
  removed:  { bg: 'var(--error-soft)', fg: 'var(--error)', label: 'D' },
  renamed:  { bg: 'rgba(139, 92, 246, 0.15)', fg: 'var(--accent)', label: 'R' },
};

export function FileTree({ id, title, entries }: FileTreeProps) {
  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-filetree"
      style={{
        margin: '12px 0',
        padding: title ? 14 : 8,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-elev)',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map((e) => {
          const t = FILE_CHANGE[e.change];
          return (
            <li
              key={e.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '5px 8px',
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span
                aria-label={e.change}
                title={e.change}
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 18,
                  borderRadius: 4,
                  background: t.bg,
                  color: t.fg,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                  wordBreak: 'break-all',
                  flex: 1,
                }}
              >
                {e.path}
              </span>
              {e.note && (
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {e.note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface DiffProps {
  id: string;
  filename?: string;
  language?: string;
  mode?: 'split' | 'unified';
  before: string;
  after: string;
}

export function Diff({ id, filename, language, mode = 'unified', before, after }: DiffProps) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <FileCode2 size={14} />
      <span style={{ color: 'var(--text)' }}>{filename ?? 'diff'}</span>
      {language && <span>· {language}</span>}
      <span style={{ marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {mode}
      </span>
    </div>
  );

  const codeStyle: React.CSSProperties = {
    margin: 0,
    padding: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    lineHeight: 1.55,
    color: 'var(--text)',
    background: 'var(--bg-elev)',
  };

  const lineRow = (sign: string, content: string, kind: 'del' | 'add' | 'ctx') => {
    const colors: Record<typeof kind, string> = {
      del: 'var(--error-soft)',
      add: 'var(--success-soft)',
      ctx: 'transparent',
    };
    const signColor: Record<typeof kind, string> = {
      del: 'var(--error)',
      add: 'var(--success)',
      ctx: 'var(--text-dim)',
    };
    return (
      <div
        style={{
          display: 'flex',
          padding: '0 12px',
          background: colors[kind],
        }}
      >
        <span style={{ width: 18, color: signColor[kind], userSelect: 'none', flexShrink: 0 }}>{sign}</span>
        <span style={{ whiteSpace: 'pre', flex: 1, overflowX: 'auto' }}>{content || ' '}</span>
      </div>
    );
  };

  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-diff"
      style={{
        margin: '12px 0',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-elev)',
      }}
    >
      {header}
      {mode === 'unified' ? (
        <pre style={codeStyle}>
          {beforeLines.map((l, i) => (
            <div key={`b${i}`}>{lineRow('-', l, 'del')}</div>
          ))}
          {afterLines.map((l, i) => (
            <div key={`a${i}`}>{lineRow('+', l, 'add')}</div>
          ))}
        </pre>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <pre style={{ ...codeStyle, borderRight: '1px solid var(--border)' }}>
            {beforeLines.map((l, i) => (
              <div key={i}>{lineRow('-', l, 'del')}</div>
            ))}
          </pre>
          <pre style={codeStyle}>
            {afterLines.map((l, i) => (
              <div key={i}>{lineRow('+', l, 'add')}</div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

export interface StatProps {
  id: string;
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  hint?: string;
}

const TREND_STYLE: Record<NonNullable<StatProps['trend']>, { fg: string; Icon: typeof Minus; label: string }> = {
  up:   { fg: 'var(--success)', Icon: ChevronDown, label: 'trending up' },
  down: { fg: 'var(--error)',   Icon: ChevronDown, label: 'trending down' },
  flat: { fg: 'var(--text-dim)', Icon: Minus,      label: 'flat' },
};

export function Stat({ id, label, value, trend, hint }: StatProps) {
  const t = trend ? TREND_STYLE[trend] : null;
  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-stat"
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-strong)' }}>
          {value}
        </span>
        {t && (
          <span
            aria-label={t.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: t.fg,
              transform: t.Icon === ChevronDown && trend === 'up' ? 'rotate(180deg)' : undefined,
            }}
          >
            <t.Icon size={14} />
          </span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export interface WorkflowStep {
  id: string;
  label: string;
  type: 'task' | 'decision' | 'note';
}
export interface WorkflowConnection {
  from: string;
  to: string;
  label?: string;
}
export interface WorkflowProps {
  id: string;
  steps: WorkflowStep[];
  connections?: WorkflowConnection[];
}

const STEP_COLORS: Record<WorkflowStep['type'], { stroke: string; fill: string; fg: string }> = {
  task:     { stroke: 'var(--info)',    fill: 'var(--bg-elev)', fg: 'var(--text)' },
  decision: { stroke: 'var(--warning)', fill: 'var(--bg-elev)', fg: 'var(--text)' },
  note:     { stroke: 'var(--border-strong)', fill: 'var(--bg)', fg: 'var(--text-dim)' },
};

const BOX_W = 160;
const BOX_H = 56;
const GAP_X = 60;
const GAP_Y = 80;

export function Workflow({ id, steps, connections = [] }: WorkflowProps) {
  if (steps.length === 0) {
    return (
      <div id={id} data-block-id={id} className="glyph-workflow">
        <Empty id={id} />
      </div>
    );
  }

  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const layout = layoutSteps(steps);

  const cols = Math.max(...layout.map((p) => p.col)) + 1;
  const rows = Math.max(...layout.map((p) => p.row)) + 1;
  const width = cols * (BOX_W + GAP_X) + GAP_X;
  const height = rows * (BOX_H + GAP_Y) + GAP_Y;

  function nodeCenter(stepId: string): { x: number; y: number } | null {
    const step = byId.get(stepId);
    if (!step) return null;
    const pos = layout.find((p) => p.id === stepId);
    if (!pos) return null;
    return {
      x: GAP_X + pos.col * (BOX_W + GAP_X) + BOX_W / 2,
      y: GAP_Y + pos.row * (BOX_H + GAP_Y) + BOX_H / 2,
    };
  }

  return (
    <div
      id={id}
      data-block-id={id}
      className="glyph-workflow"
      style={{
        margin: '12px 0',
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-elev)',
        overflow: 'auto',
      }}
    >
      <svg
        role="img"
        aria-label="Workflow diagram"
        width={width}
        height={height}
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <defs>
          <marker
            id={`arrow-${id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-dim)" />
          </marker>
        </defs>

        {connections.map((c, i) => {
          const from = nodeCenter(c.from);
          const to = nodeCenter(c.to);
          if (!from || !to) return null;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const fromX = dx >= 0 ? from.x + BOX_W / 2 : from.x - BOX_W / 2;
          const toX = dx >= 0 ? to.x - BOX_W / 2 : to.x + BOX_W / 2;
          const fromY = dy >= 0 ? from.y + BOX_H / 2 : from.y - BOX_H / 2;
          const toY = dy >= 0 ? to.y - BOX_H / 2 : to.y + BOX_H / 2;
          const midX = (fromX + toX) / 2;
          const midY = (fromY + toY) / 2;
          return (
            <g key={i}>
              <line
                x1={fromX}
                y1={fromY}
                x2={toX}
                y2={toY}
                stroke="var(--text-dim)"
                strokeWidth={1.5}
                markerEnd={`url(#arrow-${id})`}
              />
              {c.label && (
                <text
                  x={midX}
                  y={midY - 4}
                  fontSize={10}
                  fill="var(--text-dim)"
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                >
                  {c.label}
                </text>
              )}
            </g>
          );
        })}

        {steps.map((s) => {
          const pos = layout.find((p) => p.id === s.id);
          if (!pos) return null;
          const x = GAP_X + pos.col * (BOX_W + GAP_X);
          const y = GAP_Y + pos.row * (BOX_H + GAP_Y);
          const c = STEP_COLORS[s.type];
          if (s.type === 'decision') {
            const cx = x + BOX_W / 2;
            const cy = y + BOX_H / 2;
            const points = [
              [cx, y],
              [x + BOX_W, cy],
              [cx, y + BOX_H],
              [x, cy],
            ]
              .map((p) => p.join(','))
              .join(' ');
            return (
              <g key={s.id}>
                <polygon
                  points={points}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={2}
                />
                <foreignObject x={x + 8} y={cy - 14} width={BOX_W - 16} height={28}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      fontSize: 12,
                      color: c.fg,
                      textAlign: 'center',
                      lineHeight: 1.2,
                      fontStyle: 'italic',
                      height: '100%',
                    }}
                  >
                    <Diamond size={11} />
                    {s.label}
                  </div>
                </foreignObject>
              </g>
            );
          }
          const isNote = s.type === 'note';
          return (
            <g key={s.id}>
              <rect
                x={x}
                y={y}
                width={BOX_W}
                height={BOX_H}
                rx={8}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={isNote ? 1 : 2}
                strokeDasharray={isNote ? '4 3' : undefined}
              />
              <foreignObject x={x + 6} y={y + 6} width={BOX_W - 12} height={BOX_H - 12}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: c.fg,
                    textAlign: 'center',
                    lineHeight: 1.25,
                    fontStyle: isNote ? 'italic' : 'normal',
                    height: '100%',
                  }}
                >
                  {isNote && <StickyNote size={11} />}
                  {s.label}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Empty({ id }: { id: string }) {
  return (
    <div
      id={id}
      style={{
        padding: 20,
        textAlign: 'center',
        color: 'var(--text-dim)',
        fontSize: 13,
      }}
    >
      No workflow steps.
    </div>
  );
}

type LayoutPos = { id: string; col: number; row: number };

function layoutSteps(steps: WorkflowStep[]): LayoutPos[] {
  if (steps.length === 0) return [];
  return steps.map((s, i) => ({ id: s.id, col: i, row: 0 }));
}

const proseStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--text)',
};

// ─── Mockup ─────────────────────────────────────────────────────────────────

export interface MockupProps {
  id: string;
  title?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  html: string;
}

export function Mockup({ id, title, x, y, w, h, html }: MockupProps) {
  return (
    <figure
      id={id}
      data-block-id={id}
      className="glyph-mockup"
      style={{ width: w, minHeight: h }}
    >
      {title && <figcaption className="glyph-mockup-title">{title}</figcaption>}
      <div className="glyph-mockup-frame">
        <div className="glyph-mockup-chrome">
          <span />
          <span />
          <span />
        </div>
        <div
          className="glyph-mockup-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </figure>
  );
}
