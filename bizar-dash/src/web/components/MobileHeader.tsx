// src/web/components/MobileHeader.tsx — sticky top bar with menu, title, and actions.
import { Menu, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

type Props = {
  onMenuClick: () => void;
  scrolled: boolean;
  activeTab: string;
  onSettings?: (() => void) | null;
  onSearch?: () => void;
};

export function MobileHeader({ onMenuClick, scrolled, activeTab, onSettings, onSearch }: Props) {
  return (
    <header className={cn('mobile-header', scrolled && 'is-scrolled')}>
      <button
        onClick={onMenuClick}
        className="mobile-menu-btn"
        aria-label="Open menu"
        type="button"
      >
        <Menu size={20} />
      </button>

      <h1 className="mobile-header-title">
        {activeTab === 'settings' ? 'Settings' : 'Bizar'}
      </h1>

      {onSettings ? (
        <button
          onClick={onSettings}
          className="mobile-settings-exit"
          aria-label="Exit settings"
          type="button"
        >
          <X size={20} />
        </button>
      ) : (
        <button
          onClick={onSearch}
          className="mobile-search-btn"
          aria-label="Search"
          type="button"
        >
          <Search size={20} />
        </button>
      )}
    </header>
  );
}
