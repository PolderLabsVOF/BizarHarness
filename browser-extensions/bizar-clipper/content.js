/**
 * BizarHarness Clipper — content script.
 *
 * Injects a floating "Save to Bizar" button when text is selected.
 * Clicking the button sends the selection + page metadata to the
 * background service worker for storage.
 */

(function () {
  'use strict';

  let floatingBtn = null;

  // ── Floating button management ──────────────────────────────────────────────

  function createFloatingButton(selectionText) {
    removeFloatingButton();

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'bizar-clipper-float';
    floatingBtn.textContent = '⚡ Save to Bizar';
    Object.assign(floatingBtn.style, {
      position: 'fixed',
      zIndex: 2147483647,
      background: '#8b5cf6',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '6px 14px',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)',
      pointerEvents: 'auto',
      userSelect: 'none',
    });

    floatingBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendClip(selectionText);
      removeFloatingButton();
    });

    document.body.appendChild(floatingBtn);
    positionFloatingButton();
  }

  function positionFloatingButton() {
    if (!floatingBtn) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 4;
    const left = rect.left + window.scrollX;
    floatingBtn.style.top = `${top}px`;
    floatingBtn.style.left = `${left}px`;
  }

  function removeFloatingButton() {
    if (floatingBtn) {
      floatingBtn.remove();
      floatingBtn = null;
    }
  }

  // ── Safe messaging (handles MV3 service-worker disconnect) ─────────────────

  /**
   * Send a message to the background service worker without throwing on
   * disconnected port errors. In Manifest V3 the service worker may be
   * terminated between calls; this wrapper catches the resulting
   * "Attempt to postMessage on disconnected port" error silently and
   * returns undefined, so the caller can fall back to a direct API call.
   */
  async function safeSendMessage(message) {
    try {
      if (typeof browser !== 'undefined' && browser.runtime) {
        // Firefox
        return await browser.runtime.sendMessage(message).catch(() => undefined);
      }
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // Chrome — the API may throw synchronously on disconnected port
        return await chrome.runtime.sendMessage(message).catch(() => undefined);
      }
    } catch {
      // Defensive: any other error, don't surface
    }
    return undefined;
  }

  // ── Save logic ──────────────────────────────────────────────────────────────

  async function sendClip(selectionText) {
    const data = {
      url: location.href,
      title: document.title,
      content: document.documentElement.outerHTML.substring(0, 50000),
      selection: selectionText || null,
      savedAt: new Date().toISOString(),
    };

    // Try sending via background script first
    const response = await safeSendMessage({ type: 'clip-save', data });
    if (response && response.ok) {
      showToast('✓ Saved to Bizar vault');
      return;
    }

    // Direct fetch fallback
    try {
      const r = await fetch('http://127.0.0.1:4097/api/clipboard/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        showToast('✓ Saved to Bizar vault');
      } else {
        showToast('✗ Save failed', '#e74c3c');
      }
    } catch {
      showToast('✗ Dashboard not reachable', '#e74c3c');
    }
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function showToast(msg, bg = '#2ecc71') {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: bg,
      color: '#fff',
      padding: '12px 20px',
      borderRadius: '8px',
      zIndex: 2147483647,
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0,0,0,.3)',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text.length > 5) {
      createFloatingButton(text);
    } else {
      removeFloatingButton();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (floatingBtn && !floatingBtn.contains(e.target)) {
      removeFloatingButton();
    }
  });

  window.addEventListener('scroll', () => {
    if (floatingBtn) positionFloatingButton();
  });
})();
