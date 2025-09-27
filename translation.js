"use strict";

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// 安全检查：仅在 http(s) 或 file 页面上尝试发送消息
function isSupportedTab(tab) {
  const url = tab?.url || "";
  return /^(https?:|file:)/.test(url);
}

// 统一的安全发送封装，避免未捕获的 Promise 拒绝（用于与内容脚本通信）
async function safeSendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.warn("AIScribe: content script communication failed or not injected (possibly a restricted page or not yet loaded)", e);
  }
}

// 发送前握手：探测内容脚本是否已注入
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AISCRIBE_PING' });
    return true;
  } catch (e) {
    console.warn('AIScribe: No content script detected, you may need to refresh the page to inject it.', e);
    return false;
  }
}

function setStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

async function processBackground(opPayload) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'AISCRIBE_PROCESS', payload: opPayload });
    return r?.result || '';
  } catch (e) {
    console.warn('AIScribe: background processing failed', e);
    return '';
  }
}

// ========= 端侧 AI 翻译集成 =========
function hasOnDeviceTranslator() {
  try { return typeof self !== 'undefined' && 'Translator' in self; } catch (_) { return false; }
}

async function detectLanguageFromText(text) {
  const s = (text || '').trim();
  if (!s) return 'und';
  try {
    if (!('LanguageDetector' in self)) throw new Error('LanguageDetector not available');
    try {
      const avail = typeof LanguageDetector.availability === 'function' ? await LanguageDetector.availability() : 'unknown';
      if (avail === 'downloadable') setStatus('status-translate', 'Downloading language detection model…');
    } catch (_) {}
    const detector = await LanguageDetector.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const p = typeof e?.progress === 'number' ? Math.round(e.progress * 100) : (typeof e?.loaded === 'number' ? Math.round(e.loaded * 100) : undefined);
          if (typeof p === 'number') setStatus('status-translate', `Downloading language detection model… ${p}%`);
        });
      }
    });
    const results = await detector.detect(s.slice(0, 2000));
    try { detector?.destroy?.(); } catch (_) {}
    if (Array.isArray(results) && results.length) {
      const top = results.find(r => r?.detectedLanguage && r.detectedLanguage !== 'und') || results[0];
      return top?.detectedLanguage || 'en';
    }
  } catch (e) {
    console.warn('AIScribe: language detection failed, falling back to heuristic:', e);
  }
  // 回退启发式
  if (/\p{Script=Han}/u.test(s)) return 'zh';
  if (/[àâçéèêëîïôûùüÿñæœ]/i.test(s) || /( le | la | les | des | du | et | est | vous | arrêt | prochain )/i.test(s)) return 'fr';
  return 'en';
}

function chunkTextBySentence(str, maxLen = 1200) {
  const parts = [];
  const sentences = (str || '')
    .split(/(?<=[。.!?！？;；]\s*)/)
    .map(s => s.trim())
    .filter(Boolean);
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > maxLen) { if (buf) parts.push(buf); buf = s; }
    else buf += s;
  }
  if (buf) parts.push(buf);
  if (!parts.length && str) parts.push(str);
  return parts;
}

async function translateOnDevice(original) {
  if (!hasOnDeviceTranslator()) throw new Error('On-device Translator API is not supported in this browser');
  const { defaultTranslationTarget } = await chrome.storage.local.get('defaultTranslationTarget');
  const selectEl = document.getElementById('select-target');
  const target = (selectEl?.value || defaultTranslationTarget || 'zh').toLowerCase();
  const source = await detectLanguageFromText(original);

  const translator = await Translator.create({
    sourceLanguage: source,
    targetLanguage: target,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        const p = (e?.total ? Math.round((e.loaded / e.total) * 100)
          : (typeof e?.progress === 'number' ? Math.round(e.progress * 100) : undefined));
        if (typeof p === 'number') setStatus('status-translate', `Model download ${p}%`);
      });
    }
  });

  // 若翻译器或其内部也支持 addEventListener，则冗余监听一次
  try { translator?.addEventListener?.('downloadprogress', (e) => {
    const p = (e?.total ? Math.round((e.loaded / e.total) * 100) : undefined);
    if (typeof p === 'number') setStatus('status-translate', `Model download ${p}%`);
  }); } catch (_) {}

  // 长文本分块顺序翻译，避免并发占用过高资源
  const chunks = chunkTextBySentence(original);
  const outputs = [];
  for (const c of chunks) {
    let out = '';
    try {
      if (typeof translator.translateStreaming === 'function') {
        const stream = await translator.translateStreaming(c);
        for await (const token of stream) out += token;
      } else {
        out = await translator.translate(c);
      }
    } catch (e) {
      console.warn('translate chunk failed:', e);
    }
    outputs.push(out);
  }

  return outputs.join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const { enableToolbar } = await chrome.storage.local.get('enableToolbar');
  const toggle = document.getElementById('toggle');
  toggle.checked = (enableToolbar ?? true);
  toggle.addEventListener('change', async () => {
    const tab = await getActiveTab();
    await chrome.storage.local.set({ enableToolbar: toggle.checked });
    if (tab?.id && isSupportedTab(tab)) {
      const ok = await ensureContentScript(tab.id);
      if (!ok) {
        const shouldReload = confirm('No content script detected.\nReload the current page to inject the extension content script?');
        if (shouldReload) await chrome.tabs.reload(tab.id);
        return;
      }
      await safeSendMessage(tab.id, { type: 'AISCRIBE_TOGGLE_TOOLBAR', payload: { enabled: toggle.checked } });
    } else {
      console.warn('AIScribe: current page unsupported or no active tab; only local settings updated.');
    }
  });

  // 初始化目标语言选择器并持久化
  try {
    const { defaultTranslationTarget } = await chrome.storage.local.get('defaultTranslationTarget');
    const selectTarget = document.getElementById('select-target');
    if (selectTarget) {
      selectTarget.value = (defaultTranslationTarget ?? 'zh');
      selectTarget.addEventListener('change', async () => {
        await chrome.storage.local.set({ defaultTranslationTarget: selectTarget.value });
      });
    }
  } catch (_) {}

  const tab = await getActiveTab();

  // 从页面当前选区或最近右键导入的选区写入“原文”
  document.getElementById('btn-import').addEventListener('click', async () => {
    let text = '';
    if (tab?.id && isSupportedTab(tab)) {
      const ok = await ensureContentScript(tab.id);
      if (ok) {
        try {
          const r = await chrome.tabs.sendMessage(tab.id, { type: 'AISCRIBE_GET_SELECTION' });
          if (r?.ok && r.text) text = r.text;
        } catch (_) {}
      }
    }
    if (!text) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'AISCRIBE_GET_IMPORTED_SELECTION' });
        if (r?.ok && r.text) text = r.text;
      } catch (_) {}
    }
    const area = document.getElementById('area-original');
    area.value = text || area.value;
    if (!text) alert('No page selection or recently imported text detected. Please select some text on the page and try again.');
  });

  // 生成 AI 翻译（优先使用端侧 Translator，失败则回退到本地引擎）
  document.getElementById('btn-translate-gen').addEventListener('click', async () => {
    const original = document.getElementById('area-original').value.trim();
    if (!original) { setStatus('status-translate', 'Please enter or import the source text first'); return; }

    setStatus('status-translate', 'Preparing model…');
    let machine = '';
    try {
      machine = await translateOnDevice(original);
      if (!machine) throw new Error('On-device translation returned empty');
      setStatus('status-translate', 'Generated');
    } catch (e) {
      console.warn('On-device translation failed, falling back to simple translation:', e);
      setStatus('status-translate', 'On-device failed, using fallback engine…');
      setStatus('status-translate', machine ? 'Generated (fallback)' : 'Generation failed');
    }
    document.getElementById('area-machine').value = machine || '';
  });

  // 评分与建议
  document.getElementById('btn-evaluate').addEventListener('click', async () => {
    const original = document.getElementById('area-original').value.trim();
    const machine = document.getElementById('area-machine').value.trim();
    const user = document.getElementById('area-user').value.trim();
    setStatus('status-eval', 'Scoring…');
    const result = await processBackground({ op: 'evaluate', original, machine, user });
    document.getElementById('area-result').value = result || '';
    setStatus('status-eval', 'Done');
  });

  // 若用户在页面右键导入，弹窗打开时实时填充
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'AISCRIBE_SELECTION_IMPORTED') {
      const t = msg.payload?.text || '';
      if (t) {
        const area = document.getElementById('area-original');
        area.value = t;
      }
    }
  });

  // 启动时尝试带入最近一次右键导入内容（若原文为空）
  try {
    const r = await chrome.runtime.sendMessage({ type: 'AISCRIBE_GET_IMPORTED_SELECTION' });
    const area = document.getElementById('area-original');
    if (area && !area.value && r?.ok && r.text) area.value = r.text;
  } catch (_) {}
  // 添加返回首页按钮事件（由 translation.html 的内联脚本迁移而来，避免 CSP 违规）
  const backHome = document.getElementById('back-home');
  if (backHome) backHome.addEventListener('click', () => { location.href = 'index.html'; });
});