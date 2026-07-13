// tests/a11y/forms.test.tsx — WCAG 2.1.1 / 3.3.1 form accessibility for Doctor and Schedules.
//
// Tests that all form inputs have accessible names (label, aria-label,
// or aria-labelledby), and that form errors and live regions are announced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Doctor } from '../../src/web/views/Doctor';
import { Schedules } from '../../src/web/views/Schedules';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Assert every input/select/textarea in the container has an accessible name. */
function expectAllInputsAccessible(container: HTMLElement) {
  const inputs = container.querySelectorAll('input, select, textarea');
  const offenders: string[] = [];
  inputs.forEach((el) => {
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
    if (!accessibleName && !labelledByLabel) {
      offenders.push(
        `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ''}${el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : ''}> has no accessible name`,
      );
    }
  });
  expect(offenders, offenders.join('\n')).toEqual([]);
}

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

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <ModalProvider>{ui}</ModalProvider>
    </ToastProvider>,
  );
}

// ─── Doctor ─────────────────────────────────────────────────────────────────

const FAKE_SNAPSHOT = {
  bizarreVersion: '99.0.0',
  platform: 'linux',
  arch: 'x64',
  uptime: 3600,
  tasks: 0,
  schedules: 0,
  mods: 0,
  providers: 0,
  mcps: 0,
  agents: 0,
  projects: 0,
  workspaces: 0,
  voiceNotes: 0,
  evalRuns: 0,
  backups: 0,
  activeProject: null,
};

const FAKE_SETTINGS = {};

describe('Doctor — WCAG 3.3.1: form inputs have accessible names + aria-live', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock the API to avoid real network calls
    vi.spyOn(require('../../src/web/lib/api'), 'api').mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        health: { status: 'ok', issues: [] },
        checks: { system: [], services: [], config: [], counts: [] },
        bizarreVersion: '99.0.0',
        platform: 'linux',
        arch: 'x64',
        uptime: 3600,
        counts: {},
        recentErrors: [],
      }),
      post: vi.fn().mockResolvedValue({ name: 'test', message: 'ok' }),
    }));
  });

  it('the "Run Health Check Now" button has aria-label="Refresh diagnostics"', async () => {
    renderWithProviders(
      <Doctor
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="doctor"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const btn = screen.getByRole('button', { name: /refresh diagnostics/i });
    expect(btn).toBeInTheDocument();
  });

  it('the auto-refresh toggle button has an accessible name', async () => {
    renderWithProviders(
      <Doctor
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="doctor"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    // The button shows "Pause auto-refresh" or "Resume auto-refresh"
    const btn = screen.getByRole('button', { name: /(pause|resume) auto-refresh/i });
    expect(btn).toBeInTheDocument();
  });

  it('header meta region has aria-live="polite"', async () => {
    renderWithProviders(
      <Doctor
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="doctor"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });
});

// ─── Schedules ───────────────────────────────────────────────────────────────

describe('Schedules — WCAG 3.3.1: all form inputs have accessible names', () => {
  it('the Refresh button has aria-label="Refresh schedules"', () => {
    renderWithProviders(
      <Schedules
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="schedules"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const btn = screen.getByRole('button', { name: /refresh schedules/i });
    expect(btn).toBeInTheDocument();
  });

  it('all visible inputs in the Schedules view have accessible names', () => {
    const { container } = renderWithProviders(
      <Schedules
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="schedules"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    expectAllInputsAccessible(container);
  });

  it('all visible buttons in the Schedules view have accessible names', () => {
    const { container } = renderWithProviders(
      <Schedules
        snapshot={FAKE_SNAPSHOT}
        settings={FAKE_SETTINGS}
        activeTab="schedules"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    expectAllButtonsAccessible(container);
  });
});
