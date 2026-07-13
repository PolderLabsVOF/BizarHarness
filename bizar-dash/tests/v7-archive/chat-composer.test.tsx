import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatComposer } from '../src/web/components/chat/ChatComposer';

// Mock the enhancePrompt API
vi.mock('../src/web/lib/api', () => ({
  enhancePrompt: vi.fn().mockResolvedValue('enhanced prompt'),
}));

// Mock lucide-react — use importOriginal to preserve all real icons,
// then override only the ones we need to stub
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    Send: () => <svg data-testid="send-icon" />,
    Paperclip: () => <svg data-testid="paperclip-icon" />,
    X: () => <svg data-testid="x-icon" />,
    Sparkles: () => <svg data-testid="sparkles-icon" />,
    Bot: () => <svg data-testid="bot-icon" />,
    ChevronDown: () => <svg data-testid="chevron-down-icon" />,
  };
});

function makeProps() {
  return {
    agent: 'test-agent',
    setAgent: vi.fn(),
    model: 'test-model',
    setModel: vi.fn(),
    text: '',
    setText: vi.fn(),
    sending: false,
    onSend: vi.fn(),
    attachments: [] as string[],
    setAttachments: vi.fn(),
    suggestions: [] as Array<{ cmd: string; desc: string }>,
    onPickSuggestion: vi.fn(),
    agents: [{ name: 'test-agent' }],
    onAttach: vi.fn(),
  };
}

describe('ChatComposer sizing', () => {
  it('renders a textarea inside the composer', () => {
    render(<ChatComposer {...makeProps()} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
  });

  it('composer pill exists with the correct class', () => {
    const { container } = render(<ChatComposer {...makeProps()} />);
    const pill = container.querySelector('.chat-composer-pill');
    expect(pill).not.toBeNull();
  });

  it('send button exists with correct class', () => {
    const { container } = render(<ChatComposer {...makeProps()} />);
    const sendBtn = container.querySelector('.chat-send-btn');
    expect(sendBtn).not.toBeNull();
  });

  it('textarea starts with rows=1 for compact single-line appearance', () => {
    render(<ChatComposer {...makeProps()} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.getAttribute('rows')).toBe('1');
  });
});

describe('ChatComposer auto-grow', () => {
  it('setText is called on each keystroke (controlled component)', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ChatComposer {...props} />);
    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    // user.type fires input events which trigger onChange → setText
    await user.type(textarea, 'hello');
    // setText is called for each character in a controlled component
    expect(props.setText.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('empty state shows send message placeholder', () => {
    render(<ChatComposer {...makeProps()} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', 'Send a message…');
  });

  it('sending state shows sending placeholder', () => {
    const props = makeProps();
    props.sending = true;
    render(<ChatComposer {...props} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', 'Sending…');
  });
});

describe('ChatComposer interactions', () => {
  it('calls onSend when send button is clicked', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<ChatComposer {...props} />);
    // Simulate typing: update the text prop as a real state would
    props.text = 'hello world';
    rerender(<ChatComposer {...props} />);
    const sendBtn = document.querySelector('.chat-send-btn') as HTMLButtonElement;
    await user.click(sendBtn);
    expect(props.onSend).toHaveBeenCalled();
  });

  it('does not call onSend when textarea is empty', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ChatComposer {...props} />);
    const sendBtn = document.querySelector('.chat-send-btn') as HTMLButtonElement;
    await user.click(sendBtn);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('setText is called on input change', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ChatComposer {...props} />);
    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('typed text');
    // For controlled components, setText is called per-keystroke.
    // Verify it was called multiple times (once per character)
    expect(props.setText.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('textarea is disabled while sending', () => {
    const props = makeProps();
    props.sending = true;
    render(<ChatComposer {...props} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });
});
