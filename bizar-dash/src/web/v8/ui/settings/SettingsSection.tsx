import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * SettingsSection — a titled, optionally-described section of the Settings
 * page.
 *
 * PLAN.md §Settings declares 16 sections; SettingsSection is the shell
 * they all use. The body is a free slot so each section composes its own
 * option rows (SettingsRow) and sub-sections.
 */

export interface SettingsSectionProps extends HTMLAttributes<HTMLElement> {
  id: string;
  title: string;
  /** One-sentence summary of what this section controls. */
  description?: string;
  /** Optional icon (lucide). */
  icon?: ReactNode;
  /** Section body — SettingsRow, sub-sections, etc. */
  children?: ReactNode;
  /** Right-aligned header slot (e.g. "Restore defaults" button). */
  headerActions?: ReactNode;
}

export const SettingsSection = forwardRef<HTMLElement, SettingsSectionProps>(function SettingsSection(
  props,
  ref,
) {
  const { id, title, description, icon, children, headerActions, className, ...rest } = props;
  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx('v8-settings-section', className)}
      style={{
        padding: 'var(--space-5) var(--space-6)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}
      {...rest}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', minWidth: 0 }}>
          {icon !== undefined && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <h2
              id={`${id}-title`}
              style={{
                fontSize: 'var(--fs-15)',
                fontWeight: 600,
                color: 'var(--fg)',
                lineHeight: 'var(--lh-snug)',
                margin: 0,
              }}
            >
              {title}
            </h2>
            {description !== undefined && (
              <p
                style={{
                  fontSize: 'var(--fs-13)',
                  color: 'var(--fg-muted)',
                  margin: '4px 0 0 0',
                  lineHeight: 'var(--lh-snug)',
                }}
              >
                {description}
              </p>
            )}
          </div>
        </div>
        {headerActions !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
            {headerActions}
          </div>
        )}
      </header>
      <div className="v8-settings-section__body">{children}</div>
    </section>
  );
});