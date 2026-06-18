// src/components/Topbar.tsx — header with brand, tab nav, ws status.

import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  Map,
  Folder,
  CheckSquare,
  Settings2,
  Sliders,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { WsStatus } from '../lib/types';

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'plans', label: 'Plans', icon: Map },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'config', label: 'Config', icon: Settings2 },
  { id: 'settings', label: 'Settings', icon: Sliders },
];

export type TopbarProps = {
  activeTab: string;
  onTabChange: (id: string) => void;
  wsStatus: WsStatus;
  version: string;
  rightSlot?: ReactNode;
};

export function Topbar({
  activeTab,
  onTabChange,
  wsStatus,
  version,
  rightSlot,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo" aria-hidden>
          🪩
        </span>
        <span className="brand-title">Bizar</span>
        <span className="brand-version">{version}</span>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn('tab', active && 'tab-active')}
              onClick={() => onTabChange(tab.id)}
              title={`${tab.label} (${TABS.findIndex((t) => t.id === tab.id) + 1})`}
            >
              <Icon size={14} className="tab-icon" />
              <span className="tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="topbar-right">
        {rightSlot}
        <div className={cn('ws-status', `ws-${wsStatus}`)} title={`WebSocket: ${wsStatus}`}>
          <span className="ws-dot" />
          <span className="ws-label">{wsStatus}</span>
        </div>
      </div>
    </header>
  );
}
