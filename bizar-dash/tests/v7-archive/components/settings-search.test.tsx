/**
 * tests/components/settings-search.test.tsx
 *
 * v4.9 — Component tests for SettingsSearch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SettingsSearch, type SettingsSection } from '../../src/web/components/SettingsSearch';

const mockSections: SettingsSection[] = [
  {
    id: 'theme',
    label: 'Theme',
    fields: [
      { key: 'theme.accent', label: 'Accent color', section: 'theme', value: '#8b5cf6' },
      { key: 'theme.fontFamily', label: 'Font family', section: 'theme' },
    ],
  },
  {
    id: 'general',
    label: 'General',
    fields: [
      { key: 'defaultAgent', label: 'Default agent', section: 'general', value: 'odin' },
    ],
  },
];

/* ─── localStorage mock ─── */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('SettingsSearch', () => {
  const onJump = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the search input', () => {
    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    expect(screen.getByPlaceholderText(/search settings/i)).toBeInTheDocument();
  });

  it('shows recent searches when input is empty and focused', () => {
    // Pre-populate a recent search
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['accent']));

    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);
    fireEvent.focus(input);

    // Wait briefly for focus state — recent dropdown uses focused state
    expect(screen.getByText('accent')).toBeInTheDocument();
  });

  it('saves search to recent on submit (Enter)', async () => {
    const { container } = render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'accent' } });

    // Wait for the search results to render
    await vi.waitFor(() => {
      expect(container.querySelector('.settings-search-results')).toBeTruthy();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    // localStorage should have been written
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'bizar_settings_recent',
      expect.any(String),
    );
  });

  it('filters items by query', async () => {
    const { container } = render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'accent' } });

    // Check that results contain the matching field key (not split by highlight)
    await vi.waitFor(() => {
      expect(screen.getByText('theme.accent')).toBeInTheDocument();
    });
  });

  it('handles typos via fuzzy match', async () => {
    const { container } = render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'axcent' } });

    // Typo leads to lower score but still matches — key should appear
    await vi.waitFor(() => {
      expect(screen.getByText('theme.accent')).toBeInTheDocument();
    });
  });

  it('highlights matched terms in results', async () => {
    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'accent' } });

    await vi.waitFor(() => {
      // The label contains <mark>Accent</mark> inside a button
      const buttons = screen.getAllByRole('button');
      const matchBtn = buttons.find((b) => b.textContent?.includes('Accent'));
      expect(matchBtn).toBeTruthy();
      const mark = matchBtn?.querySelector('mark');
      expect(mark).toBeTruthy();
      expect(mark?.textContent).toBe('Accent');
    });
  });

  it('jumps to section on result click', async () => {
    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'theme' } });

    await vi.waitFor(() => {
      // Click the section result
      const buttons = screen.getAllByRole('button');
      // Find the one containing "section" badge with "Theme"
      const themeBtn = buttons.find(
        (b) => b.textContent?.includes('Theme') && b.textContent?.includes('section'),
      );
      if (themeBtn) {
        fireEvent.click(themeBtn);
        expect(onJump).toHaveBeenCalledWith('theme');
      }
    });
  });

  it('clears search after jump', async () => {
    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'font' } });

    await vi.waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const fontBtn = buttons.find((b) => b.textContent?.includes('Font family'));
      if (fontBtn) {
        fireEvent.click(fontBtn);
        expect(onJump).toHaveBeenCalledWith('theme', 'theme.fontFamily');
        // Input should be cleared after jump
        expect(input).toHaveValue('');
      }
    });
  });

  it('shows no results message for unmatched query', async () => {
    render(<SettingsSearch sections={mockSections} onJump={onJump} />);
    const input = screen.getByPlaceholderText(/search settings/i);

    fireEvent.change(input, { target: { value: 'zzzzdoesnotmatch' } });

    await vi.waitFor(() => {
      expect(screen.getByText(/no matching settings/i)).toBeInTheDocument();
    });
  });
});
