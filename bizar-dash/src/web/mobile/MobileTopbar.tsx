// src/mobile/MobileTopbar.tsx — compact top bar for mobile.
import { Search, MoreVertical } from 'lucide-react';
import type { Snapshot } from '../lib/types';

type Props = {
  activeTab: string;
  snapshot: Snapshot | null;
  onSearch: () => void;
};

export function MobileTopbar({ activeTab, snapshot, onSearch }: Props) {
  const tabLabels: Record<string, string> = {
    activity: 'Activity',
    chat: 'Chat',
    tasks: 'Tasks',
    settings: 'Settings',
    more: 'More',
  };

  return (
    <header className="mobile-topbar">
      <div className="mobile-topbar-left">
        <span className="mobile-logo">ᛒ</span>
        <span className="mobile-title">{tabLabels[activeTab] || 'Bizar'}</span>
      </div>
      <div className="mobile-topbar-right">
        <button
          className="mobile-icon-btn"
          onClick={onSearch}
          aria-label="Search"
        >
          <Search size={20} />
        </button>
      </div>
    </header>
  );
}
