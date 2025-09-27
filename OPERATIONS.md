# AIScribe Operations & Judge Testing Guide

This guide explains how to install, use, and evaluate AIScribe. It is designed for judges and reviewers to test the application quickly and thoroughly.

## Prerequisites
- Google Chrome (latest stable) with support for Side Panel and Manifest V3 extensions.
- No build steps required; the project runs as a static MV3 extension.

## Installation (Load Unpacked)
1. Clone the repository:
   - `git clone https://github.com/fzj1214/AIScribe.git`
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable “Developer mode”.
4. Click “Load unpacked” and select the cloned project folder.
5. Pin AIScribe in the toolbar for quick access.

## Quick Setup
1. Open the Side Panel (AIScribe).
2. Set the target language from the Home page (index.html) or Options (options.html). For example, choose French (`fr`).
3. Confirm your selection is saved (it persists across sessions).

## Using AIScribe
### A. One-Click Translation (On-Page)
- Select any text on a webpage.
- Use either:
  - The floating toolbar action, or
  - Right-click context menu → Translate.
- Expected Result:
  - The translated output appears inline or is accessible via the Side Panel, using your saved target language.

### B. Translation Page (translation.html)
- Paste or enter text into the input area.
- Trigger translation and review the output.
- Compare versions if needed, refine and copy results.
- Expected Result:
  - Translation uses the saved target language and behaves consistently.

### C. Writing Page (writing.html)
- Use the writing tools to refine sample paragraphs.
- Try tone adjustments and clarity improvements.
- Expected Result:
  - Edits are applied locally; no external data transfer is required for core features.

### D. Settings (options.html)
- Change the target language and other preferences.
- Refresh the active page and repeat a translation.
- Expected Result:
  - The content script reads the updated settings after refresh and uses them reliably.

## Reliability & Persistence Checks
1. Set the target language to French (`fr`).
2. Translate selected text on a random news page.
3. Refresh the page and translate again.
4. Inspect the DevTools Console (optional) to verify content script logs reflect the correct target (e.g., `fr`).

Why this works:
- The content script runs in the ISOLATED world (see manifest.json), ensuring stable access to Chrome APIs and stored preferences.
- Storage fallback logic and message passing mitigate edge cases.

## Troubleshooting
- Target language seems to reset:
  - Confirm the Side Panel shows the intended target (`fr`).
  - Reload the extension (chrome://extensions → Reload) and refresh the page.
- No translation action appears:
  - Ensure AIScribe is pinned and enabled.
  - Check the context menu is available on selected text.
- Logs & diagnostics:
  - Open DevTools (F12) on the page and review console messages from `content.js`.
  - Open the Service Worker console (chrome://extensions → AIScribe → Service Worker) for background logs.

## Privacy & Permissions
- Permissions: `storage`, `activeTab`, `contextMenus`, `sidePanel`.
- Host Permissions: `<all_urls>` (to allow operating on selected text across the web).
- Local-first design: preferences are stored locally; core flows do not require external services.

## Packaging for Evaluation
1. Bump `version` in `manifest.json`.
2. Zip the repository folder (excluding `.git`).
3. Provide the zip to reviewers or upload to the Chrome Web Store for formal review.

## Known Limitations
- On some high-security pages, UI elements or context menus may be restricted by the page itself. The ISOLATED world mitigates API availability issues, but behavior can vary.
- External services are not required for core functionality; if you choose to integrate them, you must update privacy disclosures and permissions accordingly.