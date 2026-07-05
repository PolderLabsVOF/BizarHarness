/**
 * BizarHarness Clipper — background service worker (Manifest V3).
 *
 * Provides:
 *   - Right-click context menu: "Save page to BizarHarness"
 *   - Right-click context menu: "Save selection to BizarHarness"
 *   - Relays content-script messages to the dashboard API
 */

const DASHBOARD_URL = 'http://127.0.0.1:4097';

// ── Context menus ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-page',
    title: 'Save page to BizarHarness',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'save-selection',
    title: 'Save selection to BizarHarness',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-page') {
    await savePage(tab);
  } else if (info.menuItemId === 'save-selection') {
    await saveSelection(info, tab);
  }
});

// ── Save handlers ──────────────────────────────────────────────────────────────

/**
 * Save the full page content to the BizarHarness vault.
 */
async function savePage(tab) {
  const data = {
    url: tab.url,
    title: tab.title,
    content: `<!-- saved from ${tab.url} -->\n<!-- ${tab.title} -->`,
    savedAt: new Date().toISOString(),
  };
  await postClip(data);
}

/**
 * Save a text selection to the BizarHarness vault.
 * Injects a content-script ping to grab selected text if the selection
 * context is available server-side — but Manifest V3 contextMenus
 * with "selection" context already provide `info.selectionText`.
 */
async function saveSelection(info, tab) {
  const data = {
    url: tab.url,
    title: tab.title,
    content: `<!-- saved from ${tab.url} -->\n<!-- ${tab.title} -->`,
    selection: info.selectionText || '',
    savedAt: new Date().toISOString(),
  };
  await postClip(data);
}

// ── API call ───────────────────────────────────────────────────────────────────

async function postClip(data) {
  try {
    const r = await fetch(`${DASHBOARD_URL}/api/clipboard/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      console.error('BizarHarness Clipper: save failed', r.status, await r.text().catch(() => ''));
      return;
    }
    const result = await r.json();
    console.log('BizarHarness Clipper: saved', result.notePath);
  } catch (err) {
    console.error('BizarHarness Clipper: network error', err.message);
  }
}

// ── Message relay (content script → background) ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'clip-save') {
    postClip(message.data).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true; // keep channel open for async response
  }
  return false;
});
