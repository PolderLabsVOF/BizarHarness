/**
 * BizarHarness Clipper — popup script.
 *
 * Manages the extension popup UI: dashboard URL configuration,
 * connection testing, and recent clips display.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'bizar-clipper-dash-url';
  const DEFAULT_URL = 'http://127.0.0.1:4097';

  const dashUrlInput = document.getElementById('dash-url');
  const testBtn = document.getElementById('test-btn');
  const statusDiv = document.getElementById('status');
  const recentList = document.getElementById('recent-list');
  const refreshBtn = document.getElementById('refresh-btn');

  // ── Storage helpers ─────────────────────────────────────────────────────────

  async function loadUrl() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || DEFAULT_URL;
  }

  async function saveUrl(url) {
    await chrome.storage.local.set({ [STORAGE_KEY]: url });
  }

  // ── Status display ──────────────────────────────────────────────────────────

  function showStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = 'status';
    if (type === 'ok') statusDiv.classList.add('status-ok');
    else if (type === 'err') statusDiv.classList.add('status-err');
  }

  // ── Test connection ─────────────────────────────────────────────────────────

  async function testConnection() {
    const baseUrl = dashUrlInput.value.trim() || DEFAULT_URL;
    showStatus('Testing…', '');
    testBtn.disabled = true;

    try {
      const r = await fetch(`${baseUrl}/api/clipboard/list`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        showStatus('✓ Dashboard reachable', 'ok');
      } else {
        showStatus(`✗ Dashboard returned ${r.status}`, 'err');
      }
    } catch (err) {
      showStatus(`✗ ${err.message}`, 'err');
    } finally {
      testBtn.disabled = false;
    }
  }

  // ── Recent clips ────────────────────────────────────────────────────────────

  async function loadRecentClips() {
    const baseUrl = dashUrlInput.value.trim() || DEFAULT_URL;
    try {
      const r = await fetch(`${baseUrl}/api/clipboard/list`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        recentList.innerHTML = '<li class="muted">Failed to load clips.</li>';
        return;
      }
      const data = await r.json();
      const clips = data.clips || [];
      if (clips.length === 0) {
        recentList.innerHTML = '<li class="muted">No clips yet.</li>';
        return;
      }
      recentList.innerHTML = clips
        .slice(0, 10)
        .map((c) => `<li title="${c.url || ''}">${c.title || 'Untitled'}</li>`)
        .join('');
    } catch {
      recentList.innerHTML = '<li class="muted">Dashboard not reachable.</li>';
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async function init() {
    const saved = await loadUrl();
    dashUrlInput.value = saved;

    testBtn.addEventListener('click', testConnection);
    refreshBtn.addEventListener('click', loadRecentClips);

    dashUrlInput.addEventListener('change', async () => {
      await saveUrl(dashUrlInput.value.trim() || DEFAULT_URL);
    });

    // Auto-test and load on open
    await testConnection();
    await loadRecentClips();
  }

  init().catch(console.error);
})();
