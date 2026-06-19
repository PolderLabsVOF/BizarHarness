// src/views/Skills.tsx — v3.1.0 skills registry: installed + search.
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Search,
  RefreshCw,
  Download,
  Power,
  PowerOff,
  Code,
  Layers,
  Wrench,
  FlaskConical,
  Palette,
  Brain,
  Map as MapIcon,
  GitBranch,
  Book,
  CheckCircle2,
  XCircle,
  Tag as TagIcon,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
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
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  source: string;
  path?: string | null;
  installed?: boolean;
  enabled?: boolean;
  mock?: boolean;
  installCmd?: string;
};

const ICONS: Record<string, typeof Sparkles> = {
  all: Sparkles,
  languages: Code,
  frameworks: Layers,
  tools: Wrench,
  testing: FlaskConical,
  design: Palette,
  reasoning: Brain,
  planning: MapIcon,
  gitops: GitBranch,
  docs: Book,
};

export function Skills({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string; icon: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Skill[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ skills: Skill[]; categories: { id: string; label: string; icon: string }[] }>('/skills');
      setSkills(d.skills || []);
      setCategories(d.categories || []);
    } catch (err) {
      toast.error(`Skills load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // Debounce search.
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const d = await api.get<{ results: Skill[] }>(`/skills/search?q=${encodeURIComponent(searchQ.trim())}`);
        setSearchResults(d.results || []);
      } catch (err) {
        toast.error(`Search failed: ${(err as Error).message}`);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(id);
  }, [searchQ, toast]);

  const filteredInstalled = useMemo(() => {
    let out = skills;
    if (activeCategory !== 'all') {
      out = out.filter((s) => (s.category || 'tools') === activeCategory);
    }
    return out;
  }, [skills, activeCategory]);

  const onInstall = async (s: Skill) => {
    if (!confirm(`Install skill "${s.name}"?\n\n${s.installCmd || `skills add ${s.id}`}`)) return;
    setInstalling(s.id);
    try {
      await api.post('/skills/install', { name: s.name, source: s.id });
      toast.success(`Installed ${s.name}.`);
      setSearchResults((cur) => cur?.filter((x) => x.id !== s.id) || cur);
      await reload();
    } catch (err) {
      toast.error(`Install failed: ${(err as Error).message}`);
    } finally {
      setInstalling(null);
    }
  };

  const onToggle = async (s: Skill) => {
    try {
      if (s.enabled !== false) {
        await api.post(`/skills/${encodeURIComponent(s.id)}/disable`);
        toast.success(`Disabled ${s.name}.`);
      } else {
        await api.post(`/skills/${encodeURIComponent(s.id)}/enable`);
        toast.success(`Enabled ${s.name}.`);
      }
      await reload();
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`);
    }
  };

  const onShowDetails = (s: Skill) => {
    let content: React.ReactNode;
    content = (
      <div className="skill-detail">
        <p className="muted text-sm mono skill-detail-source">{s.source}</p>
        <p className="skill-detail-desc">{s.description || 'No description.'}</p>
        <div className="skill-detail-meta">
          <span><strong>Category:</strong> {s.category}</span>
          <span><strong>Version:</strong> <code>{s.version}</code></span>
          {s.path && <span><strong>Path:</strong> <code>{s.path}</code></span>}
        </div>
        {s.tags && s.tags.length > 0 && (
          <div className="skill-detail-tags">
            {s.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}
        {s.installCmd && (
          <div>
            <label className="field-label">Install command</label>
            <pre className="skill-detail-cmd mono">{s.installCmd}</pre>
          </div>
        )}
      </div>
    );
    modal.open({
      title: s.name,
      width: 560,
      children: content,
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Close</Button>
          {!s.installed && (
            <Button variant="primary" onClick={() => { modal.close(); onInstall(s); }} loading={installing === s.id}>
              <Download size={12} /> Install
            </Button>
          )}
        </div>
      ),
    });
  };

  return (
    <div className="view view-skills">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Sparkles size={18} /> Skills
          </h2>
          <p className="view-subtitle">
            Installed skills + browse the registry. Powered by the <code>skills</code> CLI.
          </p>
        </div>
        <div className="view-actions">
          <div className="search-input">
            <Search size={14} />
            <input
              className="input"
              type="text"
              placeholder="Browse new skills…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => setSearchQ('')}
                title="Clear"
              >
                <XCircle size={12} />
              </button>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      <div className="skills-categories">
        {categories.map((c) => {
          const Icon = ICONS[c.id] || Sparkles;
          return (
            <button
              key={c.id}
              type="button"
              className={cn('skill-category', activeCategory === c.id && 'skill-category-active')}
              onClick={() => setActiveCategory(c.id)}
            >
              <Icon size={14} />
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

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
              {(searchResults || []).map((s) => (
                <SkillCard
                  key={`search-${s.id}`}
                  skill={s}
                  onShow={() => onShowDetails(s)}
                  onInstall={() => onInstall(s)}
                  installing={installing === s.id}
                  installed={!!skills.find((x) => x.id === s.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="skills-section">
        <h3 className="skills-section-title">
          <CheckCircle2 size={14} /> Installed ({filteredInstalled.length})
        </h3>
        {loading ? (
          <div className="view-loading"><Spinner size="lg" /></div>
        ) : filteredInstalled.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={28} />}
            title="No skills in this category"
            message="Browse the registry above to install new skills."
            action={
              <Button variant="primary" size="sm" onClick={() => setActiveCategory('all')}>
                Show all
              </Button>
            }
          />
        ) : (
          <div className="skills-grid">
            {filteredInstalled.map((s) => (
              <SkillCard
                key={s.id}
                skill={s}
                onShow={() => onShowDetails(s)}
                onToggle={() => onToggle(s)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SkillCard({
  skill,
  onShow,
  onInstall,
  onToggle,
  installing,
  installed,
}: {
  skill: Skill;
  onShow: () => void;
  onInstall?: () => void;
  onToggle?: () => void;
  installing?: boolean;
  installed?: boolean;
}) {
  const Icon = ICONS[skill.category] || Sparkles;
  const enabled = skill.enabled !== false;
  return (
    <Card variant="elevated" interactive className={cn('skill-card', !enabled && 'skill-card-disabled')}>
      <div className="skill-card-head">
        <div className="skill-card-icon" style={{ background: `color-mix(in srgb, var(--accent) 12%, transparent)` }}>
          <Icon size={18} />
        </div>
        <div className="skill-card-title-area">
          <div className="skill-card-title">{skill.name}</div>
          <div className="skill-card-source mono">{skill.source}</div>
        </div>
        {installed ? (
          <StatusBadge kind={enabled ? 'success' : 'neutral'}>
            {enabled ? 'on' : 'off'}
          </StatusBadge>
        ) : (
          <StatusBadge kind="accent">new</StatusBadge>
        )}
      </div>
      <p className="skill-card-desc">{skill.description || 'No description.'}</p>
      <div className="skill-card-meta">
        <span className="mono text-sm">v{skill.version}</span>
        {skill.category && <span className="text-sm muted">{skill.category}</span>}
        {skill.tags && skill.tags.length > 0 && skill.tags.slice(0, 3).map((t) => (
          <span key={t} className="skill-card-tag">{t}</span>
        ))}
      </div>
      <div className="skill-card-actions">
        <Button variant="ghost" size="sm" onClick={onShow}>
          <ExternalLink size={12} /> Details
        </Button>
        {installed && onToggle && (
          <Button
            variant={enabled ? 'ghost' : 'secondary'}
            size="sm"
            onClick={onToggle}
            title={enabled ? 'Disable' : 'Enable'}
          >
            {enabled ? <PowerOff size={12} /> : <Power size={12} />}
            {enabled ? 'Disable' : 'Enable'}
          </Button>
        )}
        {!installed && onInstall && (
          <Button
            variant="primary"
            size="sm"
            onClick={onInstall}
            loading={installing}
          >
            <Download size={12} /> Install
          </Button>
        )}
      </div>
    </Card>
  );
}
