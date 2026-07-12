// src/mobile/components/MobileListItem.tsx — reusable list row for mobile.
import { type ComponentType } from 'react';
import { cx } from '../../ui/utils/cx';

type Props = {
  icon?: ComponentType<{ size?: number }>;
  title: string;
  meta?: string;
  badge?: string | React.ReactNode;
  badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'accent';
  onClick?: () => void;
  arrow?: boolean;
  className?: string;
  status?: string;
};

export function MobileListItem({
  icon: Icon,
  title,
  meta,
  badge,
  badgeVariant = 'default',
  onClick,
  arrow,
  className,
  status,
}: Props) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { type: 'button' as const } : {})}
      className={cx('mobile-list-item', onClick && 'mobile-list-item-interactive', className)}
      onClick={onClick}
    >
      {Icon && (
        <div className="mobile-list-icon">
          <Icon size={16} />
        </div>
      )}
      {status && (
        <div className="mobile-list-status-dot" data-status={status} />
      )}
      <div className="mobile-list-content">
        <span className="mobile-list-title">{title}</span>
        {meta && <span className="mobile-list-meta">{meta}</span>}
      </div>
      {badge && (
        <span className={cx('mobile-list-badge', badgeVariant !== 'default' && `badge-${badgeVariant}`)}>
          {badge}
        </span>
      )}
      {arrow && <ChevronRight size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
    </Tag>
  );
}

function ChevronRight({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
