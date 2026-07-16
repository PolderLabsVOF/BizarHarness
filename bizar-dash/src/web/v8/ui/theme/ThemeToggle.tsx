import { AlignJustify, Monitor, Moon, Rows3, Sun } from 'lucide-react';
import { useTheme } from './useTheme.js';
import { useDensity } from './useDensity.js';
import { cx } from '../utils/cx.js';

/**
 * ThemeToggle — a single icon button that cycles light → dark → system.
 *
 * Shows the icon for the *current resolved* theme:
 *   - system → Monitor
 *   - light  → Sun
 *   - dark   → Moon
 *
 * Hover hint and a11y label change with the cycle target.
 *
 * Visual: matches IconButton ghost variant (defined separately once
 * controls/IconButton lands). For the foundation milestone this stays
 * inline so the shell renders without the full controls library.
 */

const RESOLVED_ICON = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const NEXT_LABEL = {
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
  system: 'Switch to light theme',
} as const;

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): JSX.Element {
  const { mode, resolved, cycle } = useTheme();
  // Show the icon for the *resolved* (actually applied) theme so the visual
  // matches what the user is seeing — Sun when light is active, Moon when
  // dark is active, Monitor when system is in effect.
  const Icon = RESOLVED_ICON[resolved];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={NEXT_LABEL[mode]}
      title={`${NEXT_LABEL[mode]} (currently: ${resolved})`}
      className={cx(
        'v8-theme-toggle',
        'inline-flex h-8 w-8 items-center justify-center',
        'rounded-[var(--radius-sm)]',
        'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-1)]',
        'transition-colors duration-[var(--motion-fast)]',
        className,
      )}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * DensityToggle — pill toggle for comfortable / compact.
 * Wired into the topbar settings cluster.
 */
export interface DensityToggleProps {
  className?: string;
}
export function DensityToggle({ className }: DensityToggleProps): JSX.Element {
  const { density, toggle } = useDensity();
  const isCozy = density === 'comfortable';
  const Icon = isCozy ? Rows3 : AlignJustify;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isCozy ? 'compact' : 'comfortable'} density`}
      title={`Density: ${density}`}
      data-density={density}
      className={cx(
        'v8-density-toggle',
        'inline-flex h-8 w-8 items-center justify-center',
        'rounded-[var(--radius-sm)]',
        'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-1)]',
        'transition-colors duration-[var(--motion-fast)]',
        className,
      )}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}