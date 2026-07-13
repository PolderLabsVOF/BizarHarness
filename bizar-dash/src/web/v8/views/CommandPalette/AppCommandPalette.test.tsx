import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../../ui/theme/DensityProvider.js';
import { AppCommandPalette } from './AppCommandPalette.js';

/**
 * AppCommandPalette — the ⌘K palette with three scopes:
 *   Navigation, Actions, Settings.
 *
 * The underlying `cmdk` primitive filters items by typed value; we don't
 * need to type to exercise selection, but typing "Tasks" narrows the
 * list to the matching Navigation item.
 *
 * The Dialog mounts a portal; @testing-library queries reach into the
 * portal transparently.
 */

function PaletteHarness(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
}): JSX.Element {
  return (
    <ThemeProvider defaultMode="light">
      <DensityProvider>
        <AppCommandPalette
          open={props.open}
          onOpenChange={props.onOpenChange}
          onNavigate={props.onNavigate}
        />
      </DensityProvider>
    </ThemeProvider>
  );
}

// `cmdk` calls `scrollIntoView` on the highlighted item whenever the user
// types. jsdom doesn't implement it natively, so we stub a no-op on the
// prototype before every test. The real implementation behaves no
// differently for the assertions we make here.
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

describe('AppCommandPalette', () => {
  it('renders the three scope headings when open', () => {
    const onNavigate = vi.fn();
    render(
      <PaletteHarness
        open
        onOpenChange={() => undefined}
        onNavigate={onNavigate}
      />,
    );
    // Scope to the dialog portal — the sidebar also renders
    // "Navigation" as a section heading outside the palette.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    const headings = Array.from(dialog.querySelectorAll('[cmdk-group-heading]')).map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(['Navigation', 'Actions', 'Agents', 'Tasks', 'Settings']);
  });

  it('typing Tasks narrows to the Tasks nav item and Enter calls onNavigate("tasks")', async () => {
    const onNavigate = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PaletteHarness
        open
        onOpenChange={onOpenChange}
        onNavigate={onNavigate}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Type a command/i), 'Tasks');
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('tasks');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Toggle theme calls onNavigate("__theme")', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <PaletteHarness
        open
        onOpenChange={() => undefined}
        onNavigate={onNavigate}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Type a command/i), 'Toggle theme');
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('__theme');
  });

  it('Selecting a Settings item routes to settings + scrolls to section', async () => {
    const onNavigate = vi.fn();
    const onOpenChange = vi.fn();
    const scrollSpy = vi.fn();
    const user = userEvent.setup();
    // Stub scrollIntoView on the prototype so the rAF callback finds it.
    Element.prototype.scrollIntoView = scrollSpy;
    // Provide a section element for the palette to find after mount.
    const section = document.createElement('section');
    section.id = 'density';
    document.body.appendChild(section);

    render(
      <PaletteHarness
        open
        onOpenChange={onOpenChange}
        onNavigate={onNavigate}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Type a command/i), 'Settings · Density');
    await user.keyboard('{Enter}');
    // Setting navigation triggers onNavigate('settings') and closes palette.
    expect(onNavigate).toHaveBeenCalledWith('settings');
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Flush the rAF scheduled by handleSelect.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scrollSpy).toHaveBeenCalled();

    document.body.removeChild(section);
  });

  it('renders the ⌘, shortcut hint on the Settings nav item', () => {
    render(
      <PaletteHarness
        open
        onOpenChange={() => undefined}
        onNavigate={() => undefined}
      />,
    );
    expect(screen.getByText('⌘,')).toBeInTheDocument();
  });
});
