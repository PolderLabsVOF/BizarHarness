// dashboard/js/views/chat.js — chat history + send box.
import { escapeHTML, renderMarkdown, formatTime, debounce } from '../utils.js';

const SLASH_COMMANDS = [
  { cmd: '/plan new <slug>', desc: 'Create a new plan' },
  { cmd: '/plan list', desc: 'List plans' },
  { cmd: '/plan open <slug>', desc: 'Open a plan URL' },
  { cmd: '/plan status <slug> <status>', desc: 'Set plan status' },
  { cmd: '/visual-plan on|off', desc: 'Toggle visual plan mode' },
  { cmd: '/bizar', desc: 'Show Bizar menu / launch dashboard' },
  { cmd: '/audit', desc: 'Run security audit' },
  { cmd: '/explain <q>', desc: 'Read-only code Q&A' },
  { cmd: '/init', desc: 'Initialize .bizar/ in this project' },
  { cmd: '/learn', desc: 'Extract patterns from session' },
  { cmd: '/pr-review', desc: 'PR review with @mimir + @forseti' },
  { cmd: '/help', desc: 'Show all slash commands' },
];

let chatState = {
  messages: [],
  sessions: [],
  currentSession: null,
  sending: false,
};

export async function render(ctx) {
  const root = document.getElementById('view-chat');
  if (!root) return;

  if (!chatState.messages.length && !chatState.sessions.length) {
    // Initial load — fetch on first render
    try {
      const data = await ctx.api.get('/chat?limit=200');
      chatState.messages = data.messages || [];
      chatState.sessions = data.sessions || [];
    } catch (err) {
      console.error('chat load failed:', err);
    }
  }

  root.innerHTML = `
    <div class="chat">
      <div class="flex justify-between items-center mb-2">
        <span class="card-title">Chat</span>
        <div class="flex gap-2 items-center">
          <select id="chat-session" class="text-sm" style="width:auto">
            <option value="">All sessions (${chatState.sessions.length})</option>
            ${chatState.sessions.map((s) => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.id)} · ${escapeHTML(s.id.slice(-6))} · ${new Date(s.mtime).toLocaleDateString()}</option>`).join('')}
          </select>
          <button class="btn text-sm" id="chat-refresh">Refresh</button>
          <button class="btn primary text-sm" id="chat-clear">Clear View</button>
        </div>
      </div>

      <div class="chat-list" id="chat-list">
        ${renderMessages(chatState.messages)}
      </div>

      <div class="chat-input">
        <textarea id="chat-text" placeholder="Send a message… (Enter to send, Shift+Enter for newline, / for commands)" rows="2"></textarea>
        <button class="btn primary" id="chat-send" ${chatState.sending ? 'disabled' : ''}>Send</button>
      </div>

      <div id="chat-suggestions" class="text-xs muted" style="display:none;margin-top:4px;"></div>
    </div>
  `;

  wireEvents(root, ctx);
}

function renderMessages(messages) {
  if (!messages.length) {
    return '<div class="empty">No messages yet. Type something below to start.</div>';
  }
  // Show newest at the bottom — reverse if backend returned newest-first
  const list = [...messages].reverse();
  return list.map((m) => `
    <div class="chat-msg ${escapeHTML(m.role || 'assistant')}">
      <div class="role">${escapeHTML(m.role || 'assistant')}${m.agent ? ` · ${escapeHTML(m.agent)}` : ''}${m.ts ? ` · ${escapeHTML(formatTime(m.ts))}` : ''}</div>
      <div class="body">${renderMarkdown(m.content || m.message || '')}</div>
    </div>
  `).join('');
}

function wireEvents(root, ctx) {
  const list = root.querySelector('#chat-list');
  const sendBtn = root.querySelector('#chat-send');
  const textArea = root.querySelector('#chat-text');
  const refreshBtn = root.querySelector('#chat-refresh');
  const clearBtn = root.querySelector('#chat-clear');
  const sessionSel = root.querySelector('#chat-session');
  const suggestions = root.querySelector('#chat-suggestions');

  // Auto-scroll to bottom
  list.scrollTop = list.scrollHeight;

  // Slash command suggestions
  const updateSuggestions = debounce(() => {
    const v = textArea.value;
    if (v.startsWith('/') && !v.includes(' ')) {
      const q = v.toLowerCase();
      const matches = SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(q)).slice(0, 6);
      if (matches.length) {
        suggestions.innerHTML = matches.map((m) =>
          `<div><span class="mono">${escapeHTML(m.cmd)}</span> — <span class="muted">${escapeHTML(m.desc)}</span></div>`
        ).join('');
        suggestions.style.display = 'block';
      } else {
        suggestions.style.display = 'none';
      }
    } else {
      suggestions.style.display = 'none';
    }
  }, 80);
  textArea.addEventListener('input', updateSuggestions);

  // Tab completion for first slash command
  textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && suggestions.style.display !== 'none') {
      e.preventDefault();
      const first = suggestions.querySelector('.mono');
      if (first) {
        const cmd = first.textContent.split(' ')[0];
        textArea.value = cmd + ' ';
        textArea.focus();
        suggestions.style.display = 'none';
      }
    }
  });

  // Enter to send (Shift+Enter = newline)
  textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  async function sendMessage() {
    const message = textArea.value.trim();
    if (!message) return;
    if (chatState.sending) return;
    chatState.sending = true;
    sendBtn.disabled = true;
    // Optimistic UI
    const optimistic = { role: 'user', content: message, ts: Date.now() };
    chatState.messages = [optimistic, ...chatState.messages];
    list.innerHTML = renderMessages(chatState.messages);
    list.scrollTop = list.scrollHeight;
    textArea.value = '';
    suggestions.style.display = 'none';
    try {
      await ctx.api.post('/chat', { message });
      ctx.showToast('Message accepted. Open the TUI to dispatch.', 'success');
    } catch (err) {
      ctx.showToast(`Send failed: ${err.message}`, 'error');
      chatState.messages = chatState.messages.filter((m) => m !== optimistic);
      list.innerHTML = renderMessages(chatState.messages);
    } finally {
      chatState.sending = false;
      sendBtn.disabled = false;
      textArea.focus();
    }
  }

  refreshBtn.addEventListener('click', async () => {
    try {
      const data = await ctx.api.get('/chat?limit=200');
      chatState.messages = data.messages || [];
      chatState.sessions = data.sessions || [];
      list.innerHTML = renderMessages(chatState.messages);
      list.scrollTop = list.scrollHeight;
      ctx.showToast('Chat refreshed.', 'info', 1500);
    } catch (err) {
      ctx.showToast(`Refresh failed: ${err.message}`, 'error');
    }
  });

  clearBtn.addEventListener('click', () => {
    chatState.messages = [];
    list.innerHTML = renderMessages(chatState.messages);
  });

  sessionSel.addEventListener('change', async () => {
    const sid = sessionSel.value;
    try {
      const data = await ctx.api.get(sid ? `/chat?session=${encodeURIComponent(sid)}` : '/chat?limit=200');
      chatState.messages = data.messages || [];
      chatState.sessions = data.sessions || [];
      list.innerHTML = renderMessages(chatState.messages);
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      ctx.showToast(`Session load failed: ${err.message}`, 'error');
    }
  });
}
