document.addEventListener('DOMContentLoaded', async () => {
  const api = {
    hasStorage: !!(globalThis.chrome && chrome.storage && chrome.storage.local)
  };
  async function safeGet(key, def) {
    try { if (api.hasStorage) { const r = await chrome.storage.local.get(key); return (r && (key in r)) ? r[key] : def; } } catch (_) {}
    return def;
  }
  function safeSet(obj) { try { if (api.hasStorage) chrome.storage.local.set(obj); } catch (_) {} }

  const sel = document.getElementById('home-target');
  if (sel) {
    const cur = await safeGet('defaultTranslationTarget', 'zh');
    sel.value = String(cur).toLowerCase();
    sel.addEventListener('change', () => {
      safeSet({ defaultTranslationTarget: sel.value });
    });
  }

  const goTranslation = document.getElementById('go-translation');
  if (goTranslation) {
    goTranslation.addEventListener('click', () => {
      location.href = 'translation.html';
    });
  }
  const goWriting = document.getElementById('go-writing');
  if (goWriting) {
    goWriting.addEventListener('click', () => {
      location.href = 'writing.html';
    });
  }
});