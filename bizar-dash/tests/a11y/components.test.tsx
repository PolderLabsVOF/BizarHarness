// tests/a11y/components.test.tsx — WCAG 2.2 AA accessibility for interactive components.
//
// Tests Toggle role/switch behavior, PluginCard button accessible names,
// PluginPermissions container label, and semantic structure.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toggle } from '../../src/web/components/Toggle';
import { PluginCard } from '../../src/web/components/PluginCard';
import { PluginPermissions } from '../../src/web/components/PluginPermissions';
import { ScheduleTemplateCard } from '../../src/web/components/ScheduleTemplateCard';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Assert every button in the container has an accessible name. */
function expectAllButtonsAccessible(container: HTMLElement) {
  const buttons = container.querySelectorAll('button');
  const offenders: string[] = [];
  buttons.forEach((el) => {
    const ariaLabel = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    const text = (el.textContent || '').trim();
    const title = el.getAttribute('title');
    if (!ariaLabel && !labelledBy && !text && !title) {
      offenders.push(`<button> has no accessible name`);
    }
  });
  expect(offenders, offenders.join('\n')).toEqual([]);
}

// ─── Toggle ────────────────────────────────────────────────────────────────

describe('Toggle — WCAG 4.4.2: role=switch + aria-checked', () => {
  it('has role="switch" on the input element', () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    const input = document.querySelector('input[type="checkbox"]');
    expect(input).toHaveAttribute('role', 'switch');
  });

  it('has aria-checked matching the checked prop', () => {
    const { rerender } = render(<Toggle checked={true} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    rerender(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('has a visible focus indicator via :focus-visible', () => {
    const { container } = render(<Toggle checked={false} onChange={() => {}} />);
    const input = container.querySelector('input');
    expect(input).toBeInTheDocument();
  });
});

// ─── PluginCard ─────────────────────────────────────────────────────────────

const FAKE_PLUGIN = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  permissions: ['net', 'fs'],
  enabled: true,
  invocations: 0,
  lastInvokedAt: null,
};

describe('PluginCard — WCAG 2.1.1: all buttons have accessible names', () => {
  it('the toggle has an accessible name via aria-label', () => {
    render(
      <PluginCard
        plugin={FAKE_PLUGIN}
        onToggle={() => {}}
        onUninstall={() => {}}
        onConfigure={() => {}}
      />,
    );
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-label', 'Toggle Test Plugin enabled');
  });

  it('the Configure button has an aria-label', () => {
    render(
      <PluginCard
        plugin={FAKE_PLUGIN}
        onToggle={() => {}}
        onUninstall={() => {}}
        onConfigure={() => {}}
      />,
    );
    const configureBtn = screen.getByRole('button', { name: /configure test plugin/i });
    expect(configureBtn).toBeInTheDocument();
  });

  it('the Uninstall button has an aria-label', () => {
    render(
      <PluginCard
        plugin={FAKE_PLUGIN}
        onToggle={() => {}}
        onUninstall={() => {}}
        onConfigure={() => {}}
      />,
    );
    const uninstallBtn = screen.getByRole('button', { name: /uninstall test plugin/i });
    expect(uninstallBtn).toBeInTheDocument();
  });

  it('all buttons inside the card have accessible names', () => {
    const { container } = render(
      <PluginCard
        plugin={FAKE_PLUGIN}
        onToggle={() => {}}
        onUninstall={() => {}}
        onConfigure={() => {}}
      />,
    );
    expectAllButtonsAccessible(container);
  });
});

// ─── PluginPermissions ──────────────────────────────────────────────────────

describe('PluginPermissions — WCAG 1.3.1: container has aria-label', () => {
  it('the permissions container has aria-label="Required permissions"', () => {
    render(<PluginPermissions permissions={['net', 'fs']} />);
    const container = document.querySelector('.plugin-permissions');
    expect(container).toHaveAttribute('aria-label', 'Required permissions');
  });
});

// ─── ScheduleTemplateCard ────────────────────────────────────────────────────

describe('ScheduleTemplateCard — WCAG 2.1.1: button has accessible name', () => {
  it('the Use this template button has an aria-label', () => {
    render(
      <ScheduleTemplateCard
        template={{
          id: 't1',
          name: 'Weekly Review',
          description: 'Run weekly review',
          type: 'cron',
          action: { type: 'agent', target: 'weekly-reviewer' },
        }}
        onUse={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /use template: weekly review/i });
    expect(btn).toBeInTheDocument();
  });
});
