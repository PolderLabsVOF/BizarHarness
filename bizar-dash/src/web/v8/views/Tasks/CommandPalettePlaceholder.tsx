import { useEffect } from 'react';
import { Portal } from '../../ui/primitives/Portal.js';
import { Box } from '../../ui/primitives/Box.js';
import { Stack } from '../../ui/primitives/Stack.js';
import { Search } from 'lucide-react';

/**
 * CommandPalettePlaceholder — Sprint S1 stand-in for the Cmd+K palette.
 * Real palette (cmdk) ships in Sprint S4.
 *
 * For now: a simple modal with an input. Closes on Escape and on click
 * outside the panel.
 */
export interface CommandPalettePlaceholderProps {
  onClose: () => void;
}

export function CommandPalettePlaceholder({ onClose }: CommandPalettePlaceholderProps): JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      <Box
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'oklch(0 0 0 / 0.40)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '15vh',
          zIndex: 'var(--z-modal)',
        }}
      >
        <Box
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 640,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--surface-popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-4)',
            overflow: 'hidden',
          }}
        >
          <Stack gap={0}>
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <Search size={16} aria-hidden="true" style={{ color: 'var(--fg-muted)' }} />
              <input
                autoFocus
                placeholder="Type a command, page, or setting…"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 0,
                  outline: 0,
                  fontSize: 'var(--fs-14)',
                  color: 'var(--fg)',
                }}
              />
              <Box
                as="kbd"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-12)',
                  color: 'var(--fg-muted)',
                }}
              >
                esc
              </Box>
            </Box>
            <Box
              style={{
                padding: 'var(--space-6) var(--space-4)',
                color: 'var(--fg-muted)',
                fontSize: 'var(--fs-13)',
                textAlign: 'center',
              }}
            >
              Command palette (cmdk) ships in Sprint S4.
            </Box>
          </Stack>
        </Box>
      </Box>
    </Portal>
  );
}