// src/components/chat/ChatRail.tsx — redesigned session rail (v3.22).
//
// Replaces the original SessionList. Layout follows the design HTML:
//   - sessions grouped by recency (Today / Yesterday / This week / Earlier)
//   - each row carries: status dot, title (with pin star), time + unread
//     badge, 3-dot menu trigger (hover-visible, top-right), and (when
//     active + has children) a collapse chevron (vertical-center,
//     right: 28px — to the LEFT of the 3-dot trigger so they never
//     overlap — see chat.css for the exact positioning).
//   - per-row 3-dot popover menu with three modes: main (rename/delete),
//     rename (inline input), confirm-delete (inline confirmation).
//   - active row hangs the agent orchestration tree below it (collapsed
//     by default on first click per FIX #1 — the user opens it via the
//     chevron).
//
// Props match the original SessionList so it can be swapped into
// Chat.tsx without any further wiring. The new props are optional and
// augment the rail with state + tree + menu behavior when supplied.

import { Fragment, useMemo, useRef, useState } from 'react';
import { Plus, ExternalLink } from 'lucide-react';
import type { ChatSession } from '../../lib/types';
import { EmptyState } from './EmptyState';
import { SessionRowMenu, type SessionMenuMode } from './SessionRowMenu';
import { SubAgentList } from './AgentTree';
import type { AgentTreeNode } from './AgentNode';

/* ------------------------------------------------------------------ *
 * Display-augmented session shape. The data coming from the API is
 * a bare `ChatSession`; the rail overlays optional display fields.
 * ------------------------------------------------------------------ */
export type SessionState = 'idle' | 'streaming' | 'awaiting';

export interface DisplaySession extends ChatSession {
  state?: SessionState;
  unread?: number;
  pinned?: boolean;
  /** HH:MM display string; defaults derived from mtime */
  time?: string;
  /** Agent name shown in the row subtitle / status dot */
  agent?: string;
  /** Sub-agent tree for this session (root may have children). */
  tree?: { root: AgentTreeNode };
}

interface Props {
  sessions: DisplaySession[];
  clineSessions?: DisplaySession[];
  activeSessionId: string;
  activeClineSessionId: string | null;
  activeProject: { name: string } | null;
  creating: boolean;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onSelectClineSession: (s: DisplaySession) => void;
  /** Optional: rename / delete handlers. When omitted, those buttons
   *  in the menu fall back to no-op + toast hint. */
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  /** Optional: group predicate. By default groups by day buckets. */
  groupBy?: (sessions: DisplaySession[]) => Record<string, DisplaySession[]>;
}

const DEFAULT_GROUPS = ['Today', 'Yesterday', 'This week', 'Earlier'];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayDiff(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function defaultGroupBy(sessions: DisplaySession[]): Record<string, DisplaySession[]> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: Record<string, DisplaySession[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Earlier: [],
  };

  for (const s of sessions) {
    const d = new Date(Number(s.mtime) || Date.now());
    if (isSameDay(d, now)) groups.Today.push(s);
    else if (isSameDay(d, yesterday)) groups.Yesterday.push(s);
    else if (dayDiff(now, d) < 7) groups['This week'].push(s);
    else groups.Earlier.push(s);
  }
  return groups;
}

function formatTime(mtime: number): string {
  const d = new Date(Number(mtime) || Date.now());
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function SessionStateIndicator({
  state,
  agent,
}: {
  state: SessionState;
  agent?: string;
}) {
  if (state === 'streaming') {
    return (
      <span
        className="session-state session-state-streaming"
        title={`${agent || 'Odin'} is typing…`}
      />
    );
  }
  if (state === 'awaiting') {
    return (
      <span
        className="session-state session-state-awaiting"
        title="Awaiting your reply"
        aria-hidden
      />
    );
  }
  if (state === 'idle') {
    return <span className="session-state session-state-idle" aria-hidden />;
  }
  return null;
}

export function ChatRail({
  sessions,
  clineSessions = [],
  activeSessionId,
  activeClineSessionId,
  activeProject,
  creating,
  onCreateSession,
  onSelectSession,
  onSelectClineSession,
  onRenameSession,
  onDeleteSession,
  groupBy,
}: Props) {
  const allSessions = useMemo<DisplaySession[]>(
    () => [...sessions, ...clineSessions],
    [sessions, clineSessions],
  );
  const sorted = useMemo(
    () => [...allSessions].sort((a, b) => Number(b.mtime ?? 0) - Number(a.mtime ?? 0)),
    [allSessions],
  );

  const grouped = useMemo(
    () => (groupBy ? groupBy(sorted) : defaultGroupBy(sorted)),
    [groupBy, sorted],
  );

  // FIX #1 — collapse-by-default for the active session's sub-agent
  // tree. State is per-session-id so toggling one session doesn't
  // reset the others.
  const [openTree, setOpenTree] = useState<Record<string, boolean>>({});
  const isTreeOpen = (id: string) => openTree[id] === true;

  // Per-row menu state (which session's menu is open + which mode).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<SessionMenuMode>('main');
  const [renameDraft, setRenameDraft] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const openMenuFor = (id: string, mode: SessionMenuMode = 'main') => {
    const row = rowRefs.current[id];
    if (!row) return;
    const target =
      mode === 'main'
        ? row
        : row.querySelector<HTMLElement>('.chat-rail-item-menu-trigger') ?? row;
    setMenuAnchor({ id, rect: target.getBoundingClientRect() });
    setOpenMenuId(id);
    setMenuMode(mode);
    if (mode === 'rename') {
      const s = [...sessions, ...clineSessions].find((x) => x.id === id);
      setRenameDraft(s?.title ?? s?.id ?? '');
    }
  };
  const closeMenu = () => {
    setOpenMenuId(null);
    setMenuMode('main');
    setRenameDraft('');
    setMenuAnchor(null);
  };

  const handleSelect = (s: DisplaySession) => {
    if (s.source === 'cline') {
      onSelectClineSession(s);
      return;
    }
    onSelectSession(s.id);
  };

  const handleConfirmRename = () => {
    if (!menuAnchor) return;
    const sid = menuAnchor.id;
    const next = renameDraft.trim();
    if (!next) {
      closeMenu();
      return;
    }
    onRenameSession?.(sid, next);
    closeMenu();
  };

  const handleConfirmDelete = () => {
    if (!menuAnchor) return;
    onDeleteSession?.(menuAnchor.id);
    closeMenu();
  };

  const orderedGroups: Array<[string, DisplaySession[]]> = groupBy
    ? Object.entries(grouped)
    : DEFAULT_GROUPS.filter((g) => grouped[g]?.length).map(
        (g) => [g, grouped[g]] as [string, DisplaySession[]],
      );

  return (
    <aside className="chat-rail">
      <div className="chat-rail-head">
        <button
          type="button"
          className="chat-new-btn"
          onClick={onCreateSession}
          disabled={creating || !activeProject}
          title={activeProject ? 'Create new session' : 'Pick a project first'}
          aria-label="Create new session"
        >
          <Plus size={14} aria-hidden />
          <span>{creating ? 'Creating…' : 'New session'}</span>
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="chat-sessions-empty">
          <EmptyState
            icon={<Plus size={20} aria-hidden />}
            title={activeProject ? 'No sessions yet' : 'No project'}
            message={
              activeProject
                ? 'Create your first session to start chatting.'
                : 'Pick a project in Overview to scope chat sessions.'
            }
          />
        </div>
      ) : (
        <div className="chat-rail-list">
          {orderedGroups.map(([group, items]) => (
            <div key={group} className="chat-rail-group">
              <div className="chat-rail-group-label">{group}</div>
              {items.map((s) => {
                const isCline = s.source === 'cline';
                const isActive = isCline
                  ? activeClineSessionId === s.id
                  : activeSessionId === s.id;
                const tree = s.tree;
                const hasChildren = !!(tree?.root?.children && tree.root.children.length > 0);
                const treeOpen = isTreeOpen(s.id);
                return (
                  <Fragment key={isCline ? `oc-${s.id}` : s.id}>
                    <div
                      ref={(el) => {
                        rowRefs.current[s.id] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      className={`chat-rail-item state-${s.state ?? 'idle'}${isActive ? ' active' : ''}`}
                      onClick={() => handleSelect(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(s);
                        }
                      }}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <SessionStateIndicator state={s.state ?? 'idle'} agent={s.agent} />
                      <div className="chat-rail-item-title">
                        {s.pinned && (
                          <span className="chat-rail-pin" aria-hidden>
                            ★
                          </span>
                        )}
                        {isCline && (
                          <ExternalLink
                            size={11}
                            style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                            aria-hidden
                          />
                        )}
                        <span className="chat-ellipsis">{s.title || s.id}</span>
                      </div>
                      <div className="chat-rail-item-meta">
                        <span className="chat-rail-item-meta-time">
                          {s.time ?? formatTime(s.mtime)}
                        </span>
                        {(s.unread ?? 0) > 0 && (
                          <span className="chat-rail-badge">{s.unread}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={`chat-rail-item-menu-trigger${openMenuId === s.id ? ' open' : ''}`}
                        aria-label={`Session options for ${s.title || s.id}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openMenuId === s.id) closeMenu();
                          else openMenuFor(s.id, 'main');
                        }}
                      >
                        <svg viewBox="0 0 14 14" aria-hidden>
                          <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                          <circle cx="11" cy="7" r="1.2" fill="currentColor" />
                        </svg>
                      </button>
                      {isActive && hasChildren && (
                        <button
                          type="button"
                          className={`chat-rail-tree-chevron${treeOpen ? ' open' : ''}`}
                          aria-label={treeOpen ? 'Collapse sub-agents' : 'Expand sub-agents'}
                          aria-expanded={treeOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenTree((cur) => ({ ...cur, [s.id]: !cur[s.id] }));
                          }}
                        >
                          <svg viewBox="0 0 10 10" aria-hidden>
                            <polyline points="3,1.5 7,5 3,8.5" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {isActive && hasChildren && treeOpen && tree?.root?.children && (
                      <SubAgentList children={tree.root.children} variant="rail" open />
                    )}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {openMenuId && menuAnchor && (
        <SessionRowMenu
          session={{
            id: menuAnchor.id,
            title:
              [...sessions, ...clineSessions].find((x) => x.id === menuAnchor.id)
                ?.title ?? menuAnchor.id,
          }}
          mode={menuMode}
          anchor={menuAnchor}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          onEdit={() => openMenuFor(openMenuId, 'rename')}
          onDeleteRequest={() => openMenuFor(openMenuId, 'confirm-delete')}
          onConfirmDelete={handleConfirmDelete}
          onConfirmRename={handleConfirmRename}
          onClose={closeMenu}
        />
      )}
    </aside>
  );
}