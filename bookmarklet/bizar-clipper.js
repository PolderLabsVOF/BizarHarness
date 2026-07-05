/**
 * BizarHarness Clipper — Bookmarklet
 *
 * Save the current page (title, URL, HTML, selected text) to your
 * BizarHarness vault in one click.
 *
 * Installation:
 *   1. Create a new bookmark
 *   2. Set the URL to the minified single-line version below
 *   3. Click it on any page
 *
 * The minified version is the last line of this file.
 */

(function () {
  'use strict';

  const selection = window.getSelection().toString();
  const data = {
    url: location.href,
    title: document.title,
    content: document.documentElement.outerHTML.substring(0, 50000),
    selection: selection || null,
    savedAt: new Date().toISOString(),
  };

  fetch('http://127.0.0.1:4097/api/clipboard/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
    .then(function (r) {
      if (r.ok) {
        var toast = document.createElement('div');
        toast.textContent = '\u2713 Saved to Bizar vault';
        toast.style.cssText =
          'position:fixed;top:20px;right:20px;background:#2ecc71;color:white;padding:12px 20px;border-radius:8px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.3);';
        document.body.appendChild(toast);
        setTimeout(function () {
          toast.remove();
        }, 3000);
      }
    })
    .catch(function () {});
})();

// Minified bookmarklet URL (copy the line below into a bookmark URL field):
// javascript:(function(){const e=window.getSelection().toString();fetch("http://127.0.0.1:4097/api/clipboard/save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:location.href,title:document.title,content:document.documentElement.outerHTML.substring(0,50000),selection:e||null,savedAt:new Date().toISOString()})}).then(function(t){if(t.ok){var n=document.createElement("div");n.textContent="\u2713 Saved to Bizar vault",n.style.cssText="position:fixed;top:20px;right:20px;background:#2ecc71;color:white;padding:12px 20px;border-radius:8px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.3);",document.body.appendChild(n),setTimeout(function(){n.remove()},3000)}}).catch(function(){})})();
