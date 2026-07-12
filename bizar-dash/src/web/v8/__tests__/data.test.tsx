/**
 * Data layer tests — Card, Badge, Chip, Avatar, StatTile, Sparkline,
 * BarList, Timeline, Accordion, ViewHeader, Table, Kbd.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Badge,
  Chip,
  Avatar,
  StatTile,
  StatGrid,
  Sparkline,
  BarList,
  Timeline,
  Accordion,
  AccordionItem,
  ViewHeader,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Kbd,
} from '../ui/index.js';

describe('Card', () => {
  it('renders with default variant', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.querySelector('.v8-card--default')).toBeInTheDocument();
  });

  it('renders header, body, footer', () => {
    render(
      <Card>
        <CardHeader title="Title" description="Subtitle" action={<button>Action</button>} />
        <CardBody>Body</CardBody>
        <CardFooter>
          <button>Save</button>
        </CardFooter>
      </Card>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Subtitle')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('renders interactive cursor when interactive=true', () => {
    const { container } = render(<Card interactive>x</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.style.cursor).toBe('pointer');
  });
});

describe('Badge', () => {
  it('renders tone and dot', () => {
    render(
      <Badge tone="success" dot>
        Active
      </Badge>,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('Chip', () => {
  it('renders children and supports remove handler', async () => {
    let removed = false;
    render(<Chip onRemove={() => { removed = true; }}>filter</Chip>);
    expect(screen.getByText('filter')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(removed).toBe(true);
  });

  it('renders selected state', () => {
    const { container } = render(<Chip selected>x</Chip>);
    expect(container.querySelector('.is-selected')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('derives initials from name when no src', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByLabelText('Ada Lovelace')).toHaveTextContent('AL');
  });

  it('respects explicit initials override', () => {
    render(<Avatar name="Ada Lovelace" initials="AD" />);
    expect(screen.getByLabelText('Ada Lovelace')).toHaveTextContent('AD');
  });

  it('renders image when src provided', () => {
    const { container } = render(<Avatar name="Ada" src="https://example.com/a.png" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/a.png');
  });
});

describe('StatTile', () => {
  it('renders label and value', () => {
    render(<StatTile label="Active tasks" value={42} />);
    expect(screen.getByText('Active tasks')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders delta with trend arrow', () => {
    const { container } = render(
      <StatTile label="x" value={10} delta="+5%" trend="up" />,
    );
    expect(screen.getByText('+5%')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows em-dash when loading', () => {
    render(<StatTile label="x" value={10} loading />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('StatGrid', () => {
  it('renders children in a grid', () => {
    const { container } = render(
      <StatGrid cols={3}>
        <StatTile label="A" value={1} />
        <StatTile label="B" value={2} />
        <StatTile label="C" value={3} />
      </StatGrid>,
    );
    expect(container.querySelector('.v8-stat-grid')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an SVG with a path for > 1 data points', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
  });

  it('renders no paths when only 1 data point', () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container.querySelector('svg')?.querySelector('path')).toBeNull();
  });
});

describe('BarList', () => {
  it('renders items with values', () => {
    render(
      <BarList
        items={[
          { id: 'a', label: 'Alpha', value: 30 },
          { id: 'b', label: 'Beta', value: 70 },
        ]}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });
});

describe('Timeline', () => {
  it('renders ordered list with items', () => {
    render(
      <Timeline
        items={[
          { id: '1', title: 'Started', tone: 'info', meta: '2m ago' },
          { id: '2', title: 'Built', description: 'tests', tone: 'success' },
          { id: '3', title: 'Shipped', tone: 'accent' },
        ]}
      />,
    );
    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('tests')).toBeInTheDocument();
  });
});

describe('Accordion', () => {
  it('expands item on trigger click', async () => {
    render(
      <Accordion type="single" defaultValue="a">
        <AccordionItem value="a" title="Group A">
          Content A
        </AccordionItem>
        <AccordionItem value="b" title="Group B">
          Content B
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText('Content A')).toBeInTheDocument();
    expect(screen.queryByText('Content B')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /group b/i }));
    expect(await screen.findByText('Content B')).toBeInTheDocument();
  });
});

describe('ViewHeader', () => {
  it('renders title, description, and action', () => {
    render(
      <ViewHeader
        title="Tasks"
        description="All work across the org"
        action={<button>New task</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByText(/all work across the org/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });

  it('renders breadcrumb when provided', () => {
    render(
      <ViewHeader
        title="Task #42"
        breadcrumb={[{ label: 'Tasks', onClick: () => {} }, { label: 'Task #42' }]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByText('Tasks')).toBeInTheDocument();
    expect(within(nav).getByText('Task #42')).toBeInTheDocument();
  });
});

describe('Table', () => {
  it('renders rows and headers', () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader align="right">Count</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Alpha</TableCell>
            <TableCell align="right">12</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('applies selected styling', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow selected>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(container.querySelector('.v8-table__row.is-selected')).toBeInTheDocument();
  });
});

describe('Kbd', () => {
  it('renders the key label', () => {
    render(<Kbd>⌘ K</Kbd>);
    expect(screen.getByText('⌘ K')).toBeInTheDocument();
  });
});

// re-export to avoid an extra import in the ViewHeader test
function within(el: HTMLElement) {
  return {
    getByText: (text: string | RegExp) => {
      const nodes = Array.from(el.querySelectorAll('*')).filter((n) => {
        const t = (n.textContent ?? '').trim();
        return typeof text === 'string' ? t === text : text.test(t);
      });
      const first = nodes[0];
      if (!first) throw new Error(`No match for ${text}`);
      return first;
    },
  };
}