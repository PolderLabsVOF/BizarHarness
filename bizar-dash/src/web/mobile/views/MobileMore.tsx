// src/mobile/views/MobileMore.tsx — real navigation hub: Plans, Agents, Skills, Mods, Schedules, History, Config.
import { useState } from 'react';
import { Bot, FileText, Sliders, Clock, History, Settings, ChevronRight, Search } from 'lucide-react';
import type { Snapshot } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
  onNavigate: (id: string) => void;
};

export function MobileMore({ snapshot, onNavigate }: Props) {
  const [search, setSearch] = useState('');

  const entries = [
    {
      id: 'plans',
      icon: FileText,
      label: 'Plans',
      count: snapshot.plans?.length || 0,
      desc: 'Visual plans with elements & comments',
    },
    {
      id: 'agents',
      icon: Bot,
      label: 'Agents',
      count: snapshot.agents?.length || 0,
      desc: 'The Norse pantheon',
    },
    {
      id: 'skills',
      icon: Sliders,
      label: 'Skills',
      count: snapshot.mods?.length || 0,
      desc: 'Agent capabilities & tools',
    },
    {
      id: 'mods',
      icon: Sliders,
      label: 'Mods',
      count: snapshot.mods?.length || 0,
      desc: 'Installed modifications',
    },
    {
      id: 'schedules',
      icon: Clock,
      label: 'Schedules',
      count: snapshot.schedules?.length || 0,
      desc: 'Cron jobs & automated tasks',
    },
    {
      id: 'history',
      icon: History,
      label: 'History',
      count: null,
      desc: 'Past sessions & outputs',
    },
    {
      id: 'config',
      icon: Settings,
      label: 'Config',
      count: null,
      desc: 'Key-value configuration editor',
    },
  ];

  const filtered = search.trim()
    ? entries.filter((e) => e.label.toLowerCase().includes(search.toLowerCase()) || e.desc.toLowerCase().includes(search.toLowerCase()))
    : entries;

  return (
    <div className="mobile-view">
      {/* Search */}
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      {/* Nav entries */}
      <div className="mobile-card-list">
        {filtered.map((entry) => {
          const Icon = entry.icon;
          return (
            <div
              key={entry.id}
              className="mobile-more-nav-item"
              onClick={() => onNavigate(entry.id)}
            >
              <div className="mobile-more-nav-icon">
                <Icon size={20} />
              </div>
              <div className="mobile-more-nav-content">
                <span className="mobile-more-nav-label">
                  {entry.label}
                  {entry.count != null && (
                    <span className="mobile-more-nav-count">{entry.count}</span>
                  )}
                </span>
                <span className="mobile-more-nav-desc">{entry.desc}</span>
              </div>
              <ChevronRight size={16} className="mobile-more-nav-arrow" />
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mobile-more-footer">
        <a href="/?desktop=1" className="mobile-more-link">
          Switch to Desktop <ChevronRight size={14} />
        </a>
      </div>
    </div>
  );
}
