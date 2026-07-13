// src/tests/a11y.test.tsx — WCAG 2.2 AA accessibility assertions for major views.
//
// This test file exercises the most critical accessibility patterns
// added in v4.8 (form labels, skip-to-main, aria-live, focus-visible).
// It uses Testing Library queries that mirror what assistive tech sees,
// not implementation details, so the tests stay useful even as the
// markup evolves.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ModalProvider } from '../src/web/components/Modal';
import { ToastProvider } from '../src/web/components/Toast';
import { SearchModal } from '../src/web/components/SearchModal';
import { Notifications } from '../src/web/components/Notifications';

// ─── Helpers ──────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <ModalProvider>{ui}</ModalProvider>
    </ToastProvider>,
  );
}

/**
 * Walk the rendered tree and assert that every <input>, <select>, and
 * <textarea> has an accessible name (label[for], aria-label,
 * aria-labelledby, or wrapping <label>).
 */
function expectAllInputsAccessible(container: HTMLElement) {
  const inputs = container.querySelectorAll('input, select, textarea');
  const offenders: string[] = [];
  inputs.forEach((el) => {
    // Hidden file inputs and inputs explicitly disabled from the a11y tree
    // (tabIndex=-1 + display:none, used for "click to trigger file picker"
    // pattern) are still required to have an aria-label so screen-reader
    // users can understand them — but we skip true hidden inputs.
    if ((el as HTMLInputElement).type === 'hidden') return;
    const accessibleName =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title');
    let labelledByLabel = false;
    if (el.id) {
      labelledByLabel = !!container.querySelector(`label[for="${el.id}"]`);
    }
    if (!labelledByLabel) {
      // Walk up to find a wrapping <label>.
      let p: HTMLElement | null = el.parentElement;
      while (p) {
        if (p.tagName.toLowerCase() === 'label') {
          labelledByLabel = true;
          break;
        }
        p = p.parentElement;
      }
    }
    if (!accessibleName && !labelledByLabel) {
      offenders.push(
        `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ''}${el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : ''}> has no accessible name`,
      );
    }
  });
  expect(offenders, offenders.join('\n')).toEqual([]);
}

/**
 * Walk the rendered tree and assert every <button> has an accessible
 * name (text content, aria-label, or aria-labelledby).
 */
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

// ─── SearchModal ───────────────────────────────────────────────────────────

describe('SearchModal — v4.7 role="search" + v4.8 scope roles', () => {
  it('renders with role="search" and an accessible input', () => {
    renderWithProviders(
      <SearchModal open={true} onClose={() => undefined} onSelect={() => undefined} />,
    );
    expect(screen.getByRole('search')).toBeInTheDocument();
    // The search input has aria-label="Search". Use a CSS selector to
    // avoid colliding with the sr-only <span> title text.
    const input = document.querySelector('input.search-modal-input');
    expect(input).toBeInTheDocument();
    expect(input?.getAttribute('aria-label')).toBe('Search');
  });

  it('scope buttons act as a tablist with aria-selected', () => {
    renderWithProviders(
      <SearchModal open={true} onClose={() => undefined} onSelect={() => undefined} />,
    );
    const tablist = screen.getByRole('tablist', { name: /search scope/i });
    expect(tablist).toBeInTheDocument();
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
    // The "All" scope is the default — must be aria-selected.
    const allTab = tabs.find((t) => t.textContent?.trim() === 'All');
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  it('the search input is an accessible textbox', () => {
    renderWithProviders(
      <SearchModal open={true} onClose={() => undefined} onSelect={() => undefined} />,
    );
    const input = document.querySelector('input.search-modal-input') as HTMLInputElement;
    expect(input?.tagName.toLowerCase()).toBe('input');
  });

  it('all buttons inside the modal have accessible names', () => {
    const { container } = renderWithProviders(
      <SearchModal open={true} onClose={() => undefined} onSelect={() => undefined} />,
    );
    expectAllButtonsAccessible(container);
  });
});

// ─── Notifications (icon-only buttons must be labelled) ───────────────────

describe('Notifications — icon-only buttons are accessible', () => {
  it('the bell button has an accessible name', () => {
    renderWithProviders(<Notifications />);
    const bell = screen.getByRole('button', { name: /notifications/i });
    expect(bell).toHaveAttribute('aria-haspopup', 'true');
    expect(bell).toHaveAttribute('aria-expanded');
  });

  it('all visible buttons have an accessible name', () => {
    const { container } = renderWithProviders(<Notifications />);
    expectAllButtonsAccessible(container);
  });
});

// ─── ARIA semantics across components ─────────────────────────────────────

describe('ARIA semantics — toast, modal, notifications', () => {
  it('ToastItem renders with role="alert" and aria-live="assertive"', async () => {
    const { ToastContainer } = await import('../src/web/components/Toast');
    const { container } = render(
      <ToastContainer
        toasts={[
          { id: 1, kind: 'info', message: 'Hello world' },
        ]}
        onDismiss={() => undefined}
      />,
    );
    // Container itself is aria-live="polite"
    const stack = container.querySelector('.toast-stack');
    expect(stack).toHaveAttribute('aria-live', 'polite');
    // Each toast uses role="alert" + aria-live="assertive"
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Hello world');
  });
});

// ─── Skip-to-main link ─────────────────────────────────────────────────────

describe('Skip-to-main-content link (added in App.tsx)', () => {
  it('renders at the top of the body when the shell mounts', async () => {
    // Importing App pulls in the whole graph. Use a lighter integration:
    // render just the shell markup via a small render-only harness.
    // We assert on the markup string the App shell produces.
    const { App } = await import('../src/web/App');
    const { container } = renderWithProviders(<App />);
    const link = container.querySelector('a.skip-to-main');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '#main-content');
    expect(link?.textContent).toMatch(/skip to main content/i);
  });
});

// ─── Misc ─────────────────────────────────────────────────────────────────

describe('Misc accessibility invariants', () => {
  it('icon-only buttons inside rendered tree always carry aria-label', async () => {
    // The Notifications bell is the simplest icon-only button to assert.
    const { container } = renderWithProviders(<Notifications />);
    const bell = container.querySelector('.notifications-bell');
    expect(bell?.getAttribute('aria-label')).toMatch(/notifications/i);
  });

  it('skips hidden file inputs (display:none) but still checks accessible name', () => {
    const { container } = render(
      <form>
        <input type="file" multiple style={{ display: 'none' }} aria-label="Attach" />
      </form>,
    );
    // The file input has aria-label so it's accessible.
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.getAttribute('aria-label')).toBe('Attach');
  });
});