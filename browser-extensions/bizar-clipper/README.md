# BizarHarness Clipper — Browser Extension

Save web pages and text selections directly to your BizarHarness vault.

## Installation

### Chrome / Edge (Chromium)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `browser-extensions/bizar-clipper/` directory

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from `browser-extensions/bizar-clipper/`

> For permanent Firefox installation, the extension must be signed. See
> [Extension Workshop](https://extensionworkshop.com/).

## Usage

- **Right-click** any page → "Save page to BizarHarness"
- **Select text** → right-click → "Save selection to BizarHarness"
- **Select text** → floating "Save to Bizar" button appears
- Click the extension icon to configure the dashboard URL and test connectivity

## Requirements

- BizarHarness dashboard running on `http://127.0.0.1:4097`
- Clipboard routes registered in the dashboard API

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker: context menus, API relay |
| `content.js` | Content script: floating save button |
| `popup.html` / `popup.js` | Popup UI: URL config, test, recent clips |
| `icons/` | Extension icons |
