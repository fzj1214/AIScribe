# AIScribe — Offline Writing & Translation Assistant for Chrome

A privacy-first, local-by-default browser extension that brings lightweight translation and writing assistance directly into Chrome’s Side Panel and on-page toolbar.

## Overview
AIScribe integrates seamlessly with Chrome to help you translate, compare, and refine text without leaving the page. It follows a minimal-permissions, local-first design: preferences are stored locally, features run inside the browser, and there’s no data exfiltration by default.

## Key Features
- One-click Translation: Translate selected text via an on-page toolbar or context menu.
- Side Panel Tools: Dedicated pages for Translation (translation.html) and Writing (writing.html), plus a home page (index.html) entry.
- Persistent Settings: Choose and save your target language and preferences in the Options page (options.html). Settings persist across sessions.
- Stable & Robust: Content script runs in the ISOLATED world to ensure reliable access to the Chrome APIs and your saved preferences.
- Privacy-First: Local-by-default flow; no external services required for the core experience.

## Architecture
- Manifest V3: See manifest.json
  - Background Service Worker: background.js (type: module)
  - Content Script: content.js (run_at: document_idle, world: ISOLATED)
  - Side Panel: index.html as the default path; additional pages translation.html, writing.html
  - Options Page: options.html
- Assets: icons/ (16, 32, 48, 128), logo.svg

## Requirements
- Chrome with Side Panel support and standard extension APIs.
- No build step required; this is a static MV3 extension.

## Installation (Load Unpacked)
1. Clone the repository:
   - `git clone https://github.com/fzj1214/AIScribe.git`
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable “Developer mode”.
4. Click “Load unpacked” and select the project folder.
5. Pin AIScribe in the toolbar for quick access.

## Quick Start
1. Open the Side Panel (AIScribe) and set your target language in index.html or Options.
2. On any web page, select text and use the on-page toolbar or context menu to translate.
3. Use translation.html to compare and refine translated text; use writing.html for writing assistance workflows.

## Operations Guide (How to Use)
- Set Target Language:
  - Open the Side Panel, pick “Home” or “Options” and choose your preferred target language (e.g., French: `fr`). Your choice is saved locally.
- Translate Selected Text:
  - Select text on a page. Use the floating toolbar or right-click → Translate. The result appears inline or in the Side Panel, depending on your interaction.
- Translation Page (translation.html):
  - Paste or input text to translate, view results, and compare versions. Designed for focused translation workflows.
- Writing Page (writing.html):
  - Draft, refine, and improve sentences and paragraphs. Use it for tone adjustments and clarity improvements.
- Options (options.html):
  - Manage preferences (e.g., default translation target). These settings persist and are read reliably by the content script.

## Testing Guide (for Judges)
Use the checklist below to verify functionality quickly:
1. Load the extension unpacked and pin it.
2. Open the Side Panel → set target language (e.g., French `fr`).
3. Visit any web page and select text.
4. Trigger translation via the floating toolbar or context menu.
5. Confirm the output uses the saved target language.
6. Refresh the page and re-translate: verify the target language stays consistent.
7. Open translation.html and test translating pasted text.
8. Open writing.html and test refining sample text.
9. Inspect DevTools Console (optional): verify content script logs show the correct target language.

Expected Results:
- The content script consistently reads the saved target language (thanks to ISOLATED world and storage fallback logic).
- Translation actions reflect your Options setting across page refreshes.

## Permissions & Privacy
- Permissions: `storage`, `activeTab`, `contextMenus`, `sidePanel`
- Host Permissions: `<all_urls>`
- Rationale:
  - storage: Persist user preferences (e.g., target language).
  - activeTab: Operate on the current page when you trigger actions.
  - contextMenus: Provide right-click translation actions.
  - sidePanel: Integrate Side Panel UI.
  - <all_urls>: Allow selecting and translating text on any webpage you visit.
- Privacy Principles:
  - Local-first by default; preferences are stored locally.
  - No data leaves your device unless you explicitly choose to use external services.

## Packaging (Optional)
- No build process is required. To package for distribution:
  - Increase version in manifest.json.
  - Zip the project directory (excluding .git).

## Contributing
- Issues and PRs are welcome. Please keep changes aligned with privacy-first, minimal-permissions principles.

## License
- MIT License. See LICENSE for details.
