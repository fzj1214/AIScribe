"use strict";

async function load() {
  const { enableToolbar, defaultTranslationTarget } = await chrome.storage.local.get(['enableToolbar','defaultTranslationTarget']);
  document.getElementById('enableToolbar').checked = (enableToolbar ?? true);
  document.getElementById('targetLang').value = (defaultTranslationTarget ?? 'zh');
}

async function save() {
  const enableToolbar = document.getElementById('enableToolbar').checked;
  const defaultTranslationTarget = document.getElementById('targetLang').value;
  await chrome.storage.local.set({ enableToolbar, defaultTranslationTarget });
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('enableToolbar').addEventListener('change', save);
  document.getElementById('targetLang').addEventListener('change', save);
});