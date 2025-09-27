import { rewriteText, translateText, summarizeText, getSettings, setSettings, ensureDefaults, evaluateTranslation } from './engine.js'

// 在安装时初始化默认设置，避免顶层 await 影响注册
chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch((e) => console.error('ensureDefaults error:', e));
  try {
    chrome.contextMenus.create({
      id: 'aiscribe-import-selection',
      title: 'Import selected text to AIScribe',
      contexts: ['selection']
    });
  } catch (e) {
    console.warn('contextMenus.create failed:', e);
  }
  // 点击扩展图标时直接打开侧边面板
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) { console.warn('sidePanel.setPanelBehavior failed:', e); }
});

// 浏览器启动时也确保该行为生效
chrome.runtime.onStartup?.addListener(() => {
  try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (_) {}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'aiscribe-import-selection') {
    // 直接使用 selectionText，如果不可用则向内容脚本请求
    const text = info.selectionText || '';
    let finalText = text;
    try {
      if ((!finalText || finalText.trim().length === 0) && tab?.id) {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'AISCRIBE_GET_SELECTION' });
        if (r?.ok) finalText = r.text || finalText;
      }
    } catch (_) {}
    if (finalText && finalText.trim()) {
      await chrome.storage.local.set({ lastImportedSelection: finalText });
      // 通知弹窗（若打开）更新
      try { chrome.runtime.sendMessage({ type: 'AISCRIBE_SELECTION_IMPORTED', payload: { text: finalText } }); } catch (_) {}
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) { sendResponse(); return; }
      if (msg.type === 'AISCRIBE_PROCESS') {
        const { op, text, original, machine, user } = msg.payload || {};
        const settings = await getSettings();
        let result = text || '';
        if (op === 'rewrite') result = rewriteText(text, settings);
        else if (op === 'translate') result = translateText(text, settings);
        else if (op === 'summarize') result = summarizeText(text, settings);
        else if (op === 'evaluate') result = await evaluateTranslation(original || '', machine || '', user || '');
        sendResponse({ ok: true, result });
      } else if (msg.type === 'AISCRIBE_SETTINGS_SET') {
        await setSettings(msg.payload || {});
        sendResponse({ ok: true });
      } else if (msg.type === 'AISCRIBE_SETTINGS_GET') {
        const s = await getSettings();
        sendResponse({ ok: true, settings: s });
      } else if (msg.type === 'AISCRIBE_GET_IMPORTED_SELECTION') {
        const { lastImportedSelection } = await chrome.storage.local.get('lastImportedSelection');
        sendResponse({ ok: true, text: lastImportedSelection || '' });
      } else {
        sendResponse({ ok: false });
      }
    } catch (e) {
      console.error('SW error:', e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 保持消息通道打开以等待异步 sendResponse
})