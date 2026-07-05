// src/views/Skills.tsx — v4.0.0 skills browser: scans all local SKILL.md sources.
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Search,
  RefreshCw,
  ExternalLink,
  XCircle,
  BookOpen,
  Folder,
  Users,
  Package,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type Skill = {
  name: string;
  description: string;
  source: 'shipped' | 'user' | 'project';
  path: string;
  body?: string;
};

type Tab = { id: 'all' | 'shipped' | 'user' | 'project'; label: string; icon: typeof Sparkles };

const TABS: Tab[] = [
  { id: 'all',     label: 'All',     icon: Sparkles   },
  { id: 'shipped', label: 'Shipped', icon: Package    },
  { id: 'user',    label: 'User',    icon: Users      },
  { id: 'project', label: 'Project', icon: Folder     },
];

const SOURCE_LABEL: Record<string, string> = {
  shipped: 'Shipped',
  user:    'User',
  project: 'Project',
};

const SOURCE_ICON: Record<string, typeof Package> = {
  shipped: Package,
  user:    Users,
  project: Folder,
};

export function Skills({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [skills, setSkills]       = useState<Skill[]>([]);
  const [counts, setCounts]       = useState({ shipped: 0, user: 0, project: 0, all: 0 });
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab]  = useState<'all' | 'shipped' | 'user' | 'project'>('all');
  const [searchQ, setSearchQ]     = useState('');
  const [searchResults, setSearchResults] = useState<Skill[] | null>(null);
  const [searching, setSearching] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ skills: Skill[]; counts: Record<string, number> }>('/skills');
      setSkills(d.skills || []);
      setCounts({ shipped: d.counts?.shipped ?? 0, user: d.counts?.user ?? 0, project: d.counts?.project ?? 0, all: (d.skills || []).length });
    } catch (err) {
      toast.error(`Skills load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const d = await api.get<{ results: Skill[] }>(
          `/skills/search?q=${encodeURIComponent(searchQ.trim())}`,
        );
        setSearchResults(d.results || []);
      } catch (err) {
        toast.error(`Search failed: ${(err as Error).message}`);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(id);
  }, [searchQ]);

  const displayed = useMemo<Skill[]>(() => {
    if (searchResults !== null) return searchResults;
    if (activeTab === 'all') return skills;
    return skills.filter((s) => s.source === activeTab);
  }, [skills, activeTab, searchResults]);

  const onRefresh = async () => {
    try {
      await api.post('/skills/refresh', {});
      toast.success('Skills refreshed.');
      await reload();
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    }
  };

  const onShowDetail = async (skill: Skill) => {
    try {
      const full = await api.get<Skill>(
        `/skills/${encodeURIComponent(skill.source)}/${encodeURIComponent(skill.name)}`,
      );
      modal.open({
        title: full.name,
        width: 640,
        children: (
          <div className="skill-detail">
            <div className="skill-detail-meta">
              <span className="skill-source-badge" data-source={full.source}>
                {SOURCE_LABEL[full.source] || full.source}
              </span>
              <code className="mono text-sm muted">{full.path}</code>
            </div>
            {full.description && (
              <p className="skill-detail-desc">{full.description}</p>
            )}
            {full.body && (
              <div className="skill-detail-body">
                <pre className="skill-body-pre">{full.body}</pre>
              </div>
            )}
          </div>
        ),
        footer: (
          <Button variant="ghost" onClick={() => modal.close()}>Close</Button>
        ),
      });
    } catch {
      // Fallback: show what we already have
      modal.open({
        title: skill.name,
        width: 560,
        children: (
          <div className="skill-detail">
            <div className="skill-detail-meta">
              <span className="skill-source-badge" data-source={skill.source}>
                {SOURCE_LABEL[skill.source] || skill.source}
              </span>
              <code className="mono text-sm muted">{skill.path}</code>
            </div>
            {skill.description && (
              <p className="skill-detail-desc">{skill.description}</p>
            )}
          </div>
        ),
        footer: (
          <Button variant="ghost" onClick={() => modal.close()}>Close</Button>
        ),
      });
    }
  };

  return (
    <div className="view view-skills">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Sparkles size={18} /> Skills
          </h2>
          <p className="view-subtitle">
            Browse all available skills — shipped, user, and project-local.
          </p>
        </div>
        <div className="view-actions">
          <div className="search-input">
            <Search size={14} />
            <input
              className="input"
              type="text"
              placeholder="Search skills…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => setSearchQ('')}
              >
                <XCircle size={12} />
              </button>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      {/* ── Source tabs ────────────────────────────────────────────────── */}
      {!searchQ.trim() && (
        <div className="skills-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const count = tab.id === 'all'
              ? counts.all
              : counts[tab.id as keyof typeof counts] ?? 0;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn('skills-tab', activeTab === tab.id && 'skills-tab-active')}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
                <span className="skills-tab-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Search results ───────────────────────────────────────────── */}
      {searchQ.trim() && (
        <section className="skills-section">
          <h3 className="skills-section-title">
            <Search size={14} /> Search results
            {searching && <Spinner size="sm" />}
          </h3>
          {searching ? (
            <div className="skills-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skill-card skill-card-skeleton" />
              ))}
            </div>
          ) : searchResults && searchResults.length === 0 ? (
            <EmptyState
              icon={<Search size={28} />}
              title="No matches"
              message={`No skills match "${searchQ}".`}
            />
          ) : (
            <div className="skills-grid">
              {(searchResults || []).map((s, i) => (
                <SkillCard
                  key={`search-${i}`}
                  skill={s}
                  onShow={() => onShowDetail(s)}
                  searchQ={searchQ}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Skills grid (tab view) ───────────────────────────────────── */}
      {!searchQ.trim() && (
        <section className="skills-section">
          {loading ? (
            <div className="view-loading"><Spinner size="lg" /></div>
          ) : displayed.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={28} />}
              title="No skills here"
              message={
                activeTab === 'all'
                  ? 'No skills found. Install skills with the skills CLI or add SKILL.md files to a skills directory.'
                  : `No skills in the ${SOURCE_LABEL[activeTab]} tab.`
              }
            />
          ) : (
            <div className="skills-grid">
              {displayed.map((s, i) => (
                <SkillCard
                  key={`${s.source}-${s.name}-${i}`}
                  skill={s}
                  onShow={() => onShowDetail(s)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Footer ────────────────────────────────────────────────────── */}
      {!searchQ.trim() && (
        <footer className="view-footer">
          <span className="text-sm muted">
            Skills are discovered from{' '}
            <code>~/.opencode/skills/</code>,{' '}
            <code>~/.agents/skills/</code>,{' '}
            <code>bizar-dash/skills/</code>, and project-local directories.
          </span>
        </footer>
      )}
    </div>
  );
}

// ── SkillCard ─────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onShow,
  searchQ = '',
}: {
  skill: Skill;
  onShow: () => void;
  searchQ?: string;
}) {
  const Icon = SOURCE_ICON[skill.source] || Package;
  const desc = skill.description
    ? skill.description.length > 200
      ? skill.description.slice(0, 200) + '…'
      : skill.description
    : 'No description.';

  return (
    <Card variant="elevated" interactive className="skill-card">
      <div className="skill-card-head">
        <div
          className="skill-card-icon"
          style={{ background: `color-mix(in srgb, var(--accent) 12%, transparent)` }}
        >
          <Icon size={18} />
        </div>
        <div className="skill-card-title-area">
          <div className="skill-card-title">
            {highlightMatch(skill.name, searchQ)}
          </div>
          <span className="skill-source-badge" data-source={skill.source}>
            {SOURCE_LABEL[skill.source] || skill.source}
          </span>
        </div>
      </div>
      <p className="skill-card-desc">{desc}</p>
      <div className="skill-card-actions">
        <Button variant="ghost" size="sm" onClick={onShow}>
          <ExternalLink size={12} /> View
        </Button>
      </div>
    </Card>
  );
}

/** Simple substring highlight — wraps matched term in <mark>. */
function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q.trim()) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="skill-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
