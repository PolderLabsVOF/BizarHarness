import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Palette } from 'lucide-react';
import { SettingsSection } from '../ui/settings/SettingsSection';
import { SettingsRow } from '../ui/settings/SettingsRow';
import { SettingsNav } from '../ui/settings/SettingsNav';

describe('SettingsSection', () => {
  it('renders title, description, and body content', () => {
    render(
      <SettingsSection id="theme" title="Theme" description="Light or dark mode.">
        <div>Body content</div>
      </SettingsSection>,
    );
    expect(screen.getByRole('heading', { level: 2, name: /Theme/i })).toBeInTheDocument();
    expect(screen.getByText(/Light or dark mode\./i)).toBeInTheDocument();
    expect(screen.getByText(/Body content/i)).toBeInTheDocument();
  });

  it('wires aria-labelledby to the title id', () => {
    const { container } = render(
      <SettingsSection id="density" title="Density">
        <div>x</div>
      </SettingsSection>,
    );
    const section = container.querySelector('section#density');
    expect(section?.getAttribute('aria-labelledby')).toBe('density-title');
    expect(container.querySelector('#density-title')).not.toBeNull();
  });

  it('renders the icon and headerActions when provided', () => {
    render(
      <SettingsSection
        id="theme"
        title="Theme"
        icon={<Palette size={14} aria-hidden="true" />}
        headerActions={<button type="button">Reset</button>}
      >
        <div>body</div>
      </SettingsSection>,
    );
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});

describe('SettingsRow', () => {
  it('renders label, description, and control', () => {
    const { container } = render(
      <SettingsRow
        id="theme-mode"
        label="Mode"
        description="Light or dark."
        control={<select><option>Light</option></select>}
      />,
    );
    expect(container.querySelector('label[for="theme-mode"]')).not.toBeNull();
    expect(container.textContent).toContain('Mode');
    expect(container.textContent).toContain('Light or dark.');
  });

  it('marks the row as disabled when disabled=true', () => {
    const { container } = render(
      <SettingsRow id="r" label="L" disabled control={<button>x</button>} />,
    );
    const row = container.querySelector('.v8-settings-row');
    expect(row?.getAttribute('aria-disabled')).toBe('true');
    expect(row?.getAttribute('data-disabled')).not.toBeNull();
  });
});

describe('SettingsNav', () => {
  const items = [
    { id: 'general', title: 'General' },
    { id: 'theme', title: 'Theme', icon: <Palette size={14} aria-hidden="true" /> },
    { id: 'plugins', title: 'Plugins' },
  ];

  it('renders every nav item', () => {
    render(<SettingsNav items={items} />);
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    expect(screen.getByText(/theme/i)).toBeInTheDocument();
    expect(screen.getByText(/plugins/i)).toBeInTheDocument();
  });

  it('marks the active item with aria-current', () => {
    render(<SettingsNav items={items} activeId="theme" />);
    const active = screen.getByRole('button', { name: /theme/i });
    expect(active.getAttribute('aria-current')).toBe('true');
  });

  it('invokes onSelect with the item id', async () => {
    const onSelect = vi.fn();
    render(<SettingsNav items={items} onSelect={onSelect} />);
    await userEvent.click(screen.getByText(/plugins/i));
    expect(onSelect).toHaveBeenCalledWith('plugins');
  });
});