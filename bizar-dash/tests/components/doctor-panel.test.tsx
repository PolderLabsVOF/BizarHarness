// tests/components/doctor-panel.test.tsx — v6.0.0
//
// Tests for the reusable DoctorPanel component. Verifies:
//   - Renders the category title and check rows with status pills
//   - Empty state when no checks / info / children
//   - info list renders below checks
//   - children bypasses the default check-list render

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DoctorPanel } from '../../src/web/components/DoctorPanel';
import type { DoctorCheck } from '../../src/web/lib/types';

const checks: DoctorCheck[] = [
  { name: 'node', status: 'ok', message: 'v22.16.0 on linux/x64' },
  { name: 'memory', status: 'warn', message: 'rss 612.4 MB' },
  { name: 'opencode', status: 'fail', message: 'serve-info missing' },
];

describe('DoctorPanel', () => {
  it('renders the category title from defaults', () => {
    render(<DoctorPanel category="system" checks={checks} />);
    expect(screen.getByText('System health')).toBeInTheDocument();
  });

  it('renders one row per check, with name + message', () => {
    render(<DoctorPanel category="services" checks={checks} />);
    expect(screen.getByText('node')).toBeInTheDocument();
    expect(screen.getByText('memory')).toBeInTheDocument();
    expect(screen.getByText('opencode')).toBeInTheDocument();
    expect(screen.getByText('v22.16.0 on linux/x64')).toBeInTheDocument();
    expect(screen.getByText('rss 612.4 MB')).toBeInTheDocument();
    expect(screen.getByText('serve-info missing')).toBeInTheDocument();
  });

  it('renders the status pill text per row', () => {
    render(<DoctorPanel category="services" checks={checks} />);
    expect(screen.getAllByText('ok').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('warn').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('fail').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty state when no checks / info / children are passed', () => {
    render(<DoctorPanel category="errors" checks={[]} />);
    expect(screen.getByText('No recent errors')).toBeInTheDocument();
  });

  it('renders the info list when info rows are supplied', () => {
    render(
      <DoctorPanel
        category="counts"
        checks={[]}
        info={[
          { label: 'Tasks', value: 42 },
          { label: 'Mods', value: 5 },
        ]}
      />,
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Mods')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders children when provided, bypassing the default check-list', () => {
    render(
      <DoctorPanel category="actions" checks={[]}>
        <div data-testid="custom-child">Run Check</div>
      </DoctorPanel>,
    );
    expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('honors an explicit title override', () => {
    render(
      <DoctorPanel
        category="system"
        title="My custom title"
        checks={[]}
      />,
    );
    expect(screen.getByText('My custom title')).toBeInTheDocument();
    expect(screen.queryByText('System health')).not.toBeInTheDocument();
  });

  it('renders the meta string when supplied', () => {
    render(
      <DoctorPanel
        category="system"
        checks={[]}
        meta="linux/x64"
      />,
    );
    expect(screen.getByText('linux/x64')).toBeInTheDocument();
  });

  it('applies the category-specific class to the card', () => {
    const { container } = render(
      <DoctorPanel category="services" checks={checks} />,
    );
    const card = container.querySelector('.doctor-panel-services');
    expect(card).toBeInTheDocument();
  });
});