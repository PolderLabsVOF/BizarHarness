// dashboard/js/views/settings.js — user settings form.
import { escapeHTML } from '../utils.js';

let settingsState = { data: null, dirty: false, saving: false };

export async function render(ctx) {
  const root = document.getElementById('view-settings');
  if (!root) return;

  if (!settingsState.data) {
    try {
      const data = await ctx.api.get('/settings');
      settingsState.data = data.data;
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load settings: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }

  const s = settingsState.data || {};
  const notif = s.notifications || {};
  const about = s.about || {};

  root.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <span class="card-title" style="font-size:18px">Settings</span>
      <div class="flex gap-2 items-center">
        <button class="btn text-sm" id="set-reload">Reload</button>
        <button class="btn primary text-sm" id="set-save" ${settingsState.saving || !settingsState.dirty ? 'disabled' : ''}>${settingsState.saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title mb-2">General</div>

        <div class="form-row">
          <label>Theme</label>
          <div class="flex gap-2 items-center">
            <select id="set-theme">
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="system" ${s.theme === 'system' ? 'selected' : ''}>System</option>
            </select>
            <span class="theme-swatch" id="theme-swatch-dark" title="Dark" style="display:inline-block;width:16px;height:16px;border-radius:3px;background:#0d1117;border:1px solid #30363d;cursor:pointer"></span>
            <span class="theme-swatch" id="theme-swatch-light" title="Light" style="display:inline-block;width:16px;height:16px;border-radius:3px;background:#f6f8fa;border:1px solid #d0d7de;cursor:pointer"></span>
          </div>
          <span class="help">Dark is the default; light is a low-contrast variant.</span>
        </div>

        <div class="form-row">
          <label>Default Agent</label>
          <input type="text" id="set-default-agent" value="${escapeHTML(s.defaultAgent || '')}" placeholder="e.g. odin">
          <span class="help">Agent used when none is specified.</span>
        </div>

        <div class="form-row">
          <label>Model Override</label>
          <input type="text" id="set-default-model" value="${escapeHTML(s.defaultModel || '')}" placeholder="(leave empty to use provider default)">
        </div>
      </div>

      <div class="card">
        <div class="card-title mb-2">Notifications</div>
        <div class="form-row checkbox">
          <input type="checkbox" id="set-n-agent" ${notif.onAgentComplete ? 'checked' : ''}>
          <label for="set-n-agent">Notify when an agent invocation completes</label>
        </div>
        <div class="form-row checkbox">
          <input type="checkbox" id="set-n-plan" ${notif.onPlanApproval ? 'checked' : ''}>
          <label for="set-n-plan">Notify when a plan needs approval</label>
        </div>

        <div class="card-title mb-2 mt-4">About</div>
        <table class="text-sm" style="width:100%">
          <tbody>
            <tr><td class="muted">Version</td><td class="mono">${escapeHTML(about.version || '2.5.0')}</td></tr>
            <tr><td class="muted">Homepage</td><td><a href="${escapeHTML(about.homepage || '#')}" target="_blank" rel="noopener">${escapeHTML(about.homepage || '')}</a></td></tr>
            <tr><td class="muted">License</td><td>${escapeHTML(about.license || 'MIT')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  wire(root, ctx);
}

function wire(root, ctx) {
  const save = root.querySelector('#set-save');
  const reload = root.querySelector('#set-reload');
  const fields = ['theme', 'defaultAgent', 'defaultModel', 'n-agent', 'n-plan'];

  // Apply theme on change — instant, no save required
  root.querySelector('#set-theme')?.addEventListener('change', (e) => {
    const val = e.target.value;
    __bizar.applyTheme(val);
    __bizar.settings = { ...(__bizar.settings || {}), theme: val };
  });

  // Swatch click shortcuts
  root.querySelector('#theme-swatch-dark')?.addEventListener('click', () => {
    root.querySelector('#set-theme').value = 'dark';
    __bizar.applyTheme('dark');
    __bizar.settings = { ...(__bizar.settings || {}), theme: 'dark' };
    settingsState.dirty = true;
    save.disabled = false;
  });
  root.querySelector('#theme-swatch-light')?.addEventListener('click', () => {
    root.querySelector('#set-theme').value = 'light';
    __bizar.applyTheme('light');
    __bizar.settings = { ...(__bizar.settings || {}), theme: 'light' };
    settingsState.dirty = true;
    save.disabled = false;
  });

  const markDirty = () => {
    settingsState.dirty = true;
    save.disabled = settingsState.saving;
  };
  ['set-theme', 'set-default-agent', 'set-default-model', 'set-n-agent', 'set-n-plan']
    .forEach((id) => root.querySelector('#' + id)?.addEventListener('input', markDirty));

  save.addEventListener('click', async () => {
    settingsState.saving = true;
    save.disabled = true;
    save.textContent = 'Saving…';
    const newData = {
      theme: root.querySelector('#set-theme').value,
      defaultAgent: root.querySelector('#set-default-agent').value.trim(),
      defaultModel: root.querySelector('#set-default-model').value.trim(),
      notifications: {
        onAgentComplete: root.querySelector('#set-n-agent').checked,
        onPlanApproval: root.querySelector('#set-n-plan').checked,
      },
      about: settingsState.data.about,
    };
    try {
      const result = await ctx.api.put('/settings', newData);
      settingsState.data = result.data;
      settingsState.dirty = false;
      settingsState.saving = false;
      ctx.snapshot = { ...(ctx.snapshot || {}), settings: result };
      // Apply theme immediately + update global state
      __bizar.applyTheme(newData.theme);
      __bizar.settings = { ...(__bizar.settings || {}), theme: newData.theme };
      // Broadcast so other tabs/clients update
      ctx.ws.send({ type: 'settings:change', settings: result.data });
      // Show saved indicator
      save.textContent = '✓ Saved';
      setTimeout(() => {
        if (settingsState.dirty) {
          save.textContent = 'Save';
        } else {
          save.textContent = 'Save';
        }
      }, 1500);
      ctx.showToast('Settings saved.', 'success', 2000);
    } catch (err) {
      settingsState.saving = false;
      save.disabled = false;
      save.textContent = 'Save';
      ctx.showToast(`Save failed: ${err.message}`, 'error');
    }
  });

  reload.addEventListener('click', async () => {
    try {
      const data = await ctx.api.get('/settings');
      settingsState.data = data.data;
      settingsState.dirty = false;
      ctx.snapshot = { ...(ctx.snapshot || {}), settings: data };
      render(ctx);
      ctx.showToast('Settings reloaded.', 'info', 1500);
    } catch (err) {
      ctx.showToast(`Reload failed: ${err.message}`, 'error');
    }
  });
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (theme === 'dark') {
    root.removeAttribute('data-theme');
  } else {
    // system
    const prefersLight = matchMedia('(prefers-color-scheme: light)').matches;
    root.setAttribute('data-theme', prefersLight ? 'light' : '');
  }
}
