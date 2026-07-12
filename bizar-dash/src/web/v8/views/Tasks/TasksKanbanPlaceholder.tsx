import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Box } from '../../ui/primitives/Box.js';
import { CheckSquare } from 'lucide-react';

/**
 * TasksKanbanPlaceholder — Sprint S1 stand-in for the Tasks / Kanban view.
 *
 * Full Kanban surface (Sprint S5) replaces this. For F-043 (Foundation)
 * this exists only to prove the shell renders and the route works.
 */
export function TasksKanbanPlaceholder(): JSX.Element {
  return (
    <Stack gap={4}>
      <Inline align="center" gap={3}>
        <CheckSquare size={20} aria-hidden="true" />
        <h1 style={{ fontSize: 'var(--fs-24)', fontWeight: 600 }}>Tasks › Kanban</h1>
        <Box
          style={{
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            padding: '2px 8px',
            background: 'var(--surface-1)',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          47
        </Box>
      </Inline>

      <Box
        style={{
          fontSize: 'var(--fs-13)',
          color: 'var(--fg-muted)',
        }}
      >
        Kanban board surface ships in Sprint S5. The shell, tokens, primitives,
        and theme system are live and working.
      </Box>

      <Box
        style={{
          padding: 'var(--space-6)',
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <Stack gap={2}>
          <strong style={{ fontSize: 'var(--fs-14)' }}>Foundation milestone (F-043) ✓</strong>
          <ul style={{ paddingLeft: 'var(--space-4)', color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
            <li>tokens.css — light + dark + system</li>
            <li>reset.css + globals.css</li>
            <li>10 primitives (Box, Stack, Inline, Cluster, Grid, Center, Separator, ScrollArea, Portal, VisuallyHidden)</li>
            <li>ThemeProvider + DensityProvider + ThemeToggle</li>
            <li>Topbar, Sidebar (collapsible), AppShell, StatusBar</li>
          </ul>
        </Stack>
      </Box>
    </Stack>
  );
}