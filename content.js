(() => {
  const state = { enabled: true, toolbarEl: null };

  // 在 MAIN world 下，部分页面可能覆盖 window.chrome，导致扩展 API 不可用，做兼容保护
  const api = {
    hasStorage: !!(globalThis.chrome && chrome.storage && chrome.storage.local),
    hasRuntime: !!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage)
  };
  async function safeGetStorage(key, defaultVal) {
    try {
      if (api.hasStorage) {
        const r = await chrome.storage.local.get(key);
        if (r && (key in r)) return r[key];
      }
    } catch (_) {}
    // 回退到后台：某些页面可能覆盖 window.chrome 导致内容脚本无法直接访问 storage
    try {
      if (api.hasRuntime) {
        const resp = await chrome.runtime.sendMessage({ type: 'AISCRIBE_SETTINGS_GET' });
        if (resp?.ok && resp.settings && (key in resp.settings)) {
          return resp.settings[key];
        }
      }
    } catch (_) {}
    return defaultVal;
  }
  function safeSetStorage(obj) {
    try { if (api.hasStorage) chrome.storage.local.set(obj); } catch (_) {}
  }

  async function init() {
    // 安全读取开关，避免 chrome.storage 在 MAIN world 上不可用导致崩溃
    const enableToolbar = await safeGetStorage('enableToolbar', true);
    state.enabled = !!enableToolbar;
    createToolbar();
    bindGlobalEvents();
    // 仅在可用时注册扩展消息监听，避免页面上报错
    if (api.hasRuntime) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'AISCRIBE_PING') {
          sendResponse?.({ ok: true });
          return; // 握手响应即可
        }
        if (msg.type === 'AISCRIBE_TOGGLE_TOOLBAR') {
          state.enabled = !!(msg.payload?.enabled);
          safeSetStorage({ enableToolbar: state.enabled });
          if (!state.enabled) hideToolbar();
        } else if (msg.type === 'AISCRIBE_POPUP_ACTION') {
          const op = msg.payload?.op;
          processSelection(op);
        } else if (msg.type === 'AISCRIBE_GET_SELECTION') {
          try {
            const sel = window.getSelection();
            const text = sel && !sel.isCollapsed ? sel.toString() : '';
            sendResponse?.({ ok: true, text });
          } catch (_) { sendResponse?.({ ok: false, text: '' }); }
          return;
        }
      });
    }
  }

  function createToolbar() {
    const el = document.createElement('div');
    el.id = 'aiscribe-toolbar';
    el.style.cssText = `
      position: fixed; z-index: 2147483647; display: none; padding: 6px 8px; border-radius: 8px;
      background: rgba(32,32,32,0.9); color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, PingFang SC, Noto Sans SC, Arial; font-size: 13px;
    `;
    // 通过安全的 DOM API 构建工具栏，避免使用 innerHTML 触发 Trusted Types/CSP
    const ops = ['rewrite', 'translate', 'summarize'];
    for (const op of ops) {
      const btn = document.createElement('button');
      btn.setAttribute('data-op', op);
      btn.textContent = op === 'rewrite' ? 'Rewrite' : (op === 'translate' ? 'Translate' : 'Summarize');
      btn.style.cssText = 'margin:0 6px;';
      el.appendChild(btn);
    }
    const hint = document.createElement('span');
    hint.id = 'aiscribe-hint';
    hint.style.cssText = 'margin-left:8px;color:#bbb;font-size:12px;display:none;';
    el.appendChild(hint);

    el.querySelectorAll('button').forEach(btn => {
      btn.style.cssText = `
        all: unset; display: inline-block; padding: 6px 10px; border-radius: 6px; cursor: pointer; background: #4b8bf1;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#3a76db'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#4b8bf1'; });
      btn.addEventListener('click', ev => {
        const op = btn.getAttribute('data-op');
        processSelection(op);
      });
    });
    document.documentElement.appendChild(el);
    state.toolbarEl = el;
  }

  function bindGlobalEvents() {
    // 记录鼠标位置，用于 selectionchange 定位回退
    document.addEventListener('mousemove', (e) => {
      state.lastMouse = { x: e.pageX, y: e.pageY };
    }, { passive: true, capture: true });

    // 使用捕获阶段，避免页面 stopPropagation 影响
    document.addEventListener('mouseup', () => {
      if (!state.enabled) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      const rect = getSelectionRect(range) || { left: state.lastMouse?.x || 8, bottom: state.lastMouse?.y || 8 };
      // 保存选区与文本，避免点击按钮后 selection 折叠导致无法处理
      state.savedRange = range.cloneRange();
      state.savedText = sel.toString();
      showToolbar((rect.left ?? 8) + window.scrollX, (rect.bottom ?? 8) + window.scrollY + 8);
    }, { capture: true });

    // 兼容 pointer 事件页面
    document.addEventListener('pointerup', () => {
      if (!state.enabled) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      const rect = getSelectionRect(range) || { left: state.lastMouse?.x || 8, bottom: state.lastMouse?.y || 8 };
      state.savedRange = range.cloneRange();
      state.savedText = sel.toString();
      showToolbar((rect.left ?? 8) + window.scrollX, (rect.bottom ?? 8) + window.scrollY + 8);
    }, { capture: true });

    // 当选择通过键盘或页面脚本发生变化时，也显示工具栏
    document.addEventListener('selectionchange', () => {
      if (!state.enabled) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { return; }
      const range = sel.getRangeAt(0);
      const rect = getSelectionRect(range) || { left: state.lastMouse?.x || 8, bottom: state.lastMouse?.y || 8 };
      state.savedRange = range.cloneRange();
      state.savedText = sel.toString();
      showToolbar((rect.left ?? 8) + window.scrollX, (rect.bottom ?? 8) + window.scrollY + 8);
    }, { capture: true });

    document.addEventListener('mousedown', (e) => {
      const el = state.toolbarEl;
      if (!el) return;
      if (e.target === el || el.contains(e.target)) return; // keep
      hideToolbar();
    });
    window.addEventListener('scroll', () => hideToolbar(), { passive: true });
  }

  function showToolbar(x, y) {
    const el = state.toolbarEl; if (!el) return;
    el.style.left = Math.max(8, x) + 'px';
    el.style.top = Math.max(8, y) + 'px';
    el.style.display = 'block';
  }
  function hideToolbar() { const el = state.toolbarEl; if (el) { el.style.display = 'none'; clearHighlight(); hideHint(); } }

  // 计算选区矩形，兼容多段文本与零尺寸边界
  function getSelectionRect(range) {
    try {
      const r = range.getBoundingClientRect();
      if ((r?.width === 0 || r?.height === 0)) {
        const rects = range.getClientRects?.();
        if (rects && rects.length) return rects[rects.length - 1];
      }
      return r;
    } catch (_) { return null; }
  }
  function highlightToolbarOp(op) {
    const el = state.toolbarEl; if (!el) return;
    clearHighlight();
    const btn = el.querySelector(`button[data-op="${op}"]`);
    if (btn) {
      btn.style.outline = '2px solid #ffd54f';
      btn.style.boxShadow = '0 0 0 3px rgba(255,213,79,0.35)';
    }
    showHint('Please click to continue');
  }
  function clearHighlight() {
    const el = state.toolbarEl; if (!el) return;
    el.querySelectorAll('button').forEach(btn => {
      btn.style.outline = 'none';
      btn.style.boxShadow = 'none';
    });
  }
  function setHint(text) {
    const el = state.toolbarEl; if (!el) return;
    const hint = el.querySelector('#aiscribe-hint');
    if (hint) { hint.textContent = text || ''; hint.style.display = text ? 'inline' : 'none'; }
  }
  function showHint(text) { setHint(text ?? ''); }
  function hideHint() { setHint(''); }

  async function tryBuiltInAI(op, text) {
    try {
      const g = (typeof self !== 'undefined' ? self : window);
      const { Translator, Summarizer, Rewriter, LanguageDetector } = g || {};

      // 如果当前操作对应的内置类不可用，先输出提示日志
      if (op === 'translate' && !(Translator && typeof Translator.create === 'function')) {
        console.warn('AIScribe: Translator unavailable or no create method');
      }
      if (op === 'summarize' && !(Summarizer && typeof Summarizer.create === 'function')) {
        console.warn('AIScribe: Summarizer unavailable or no create method');
      }
      if (op === 'rewrite' && !(Rewriter && typeof Rewriter.create === 'function')) {
        console.warn('AIScribe: Rewriter unavailable or no create method');
      }

      // 1) 翻译：LanguageDetector + Translator
      if (op === 'translate' && Translator && typeof Translator.create === 'function') {
        let source = 'en';
        try {
          if (LanguageDetector && typeof LanguageDetector.availability === 'function') {
            const detAvail = await LanguageDetector.availability();
            console.log('AIScribe: LanguageDetector availability =', detAvail);
            if (detAvail === 'available' || detAvail === 'downloadable') {
              const detector = await LanguageDetector.create({
                monitor(m) {
                  m.addEventListener('downloadprogress', (ev) => {
                    const pct = typeof ev?.progress === 'number' ? Math.round(ev.progress * 100) : (typeof ev?.loaded === 'number' ? Math.round(ev.loaded * 100) : null);
                    setHint(pct != null ? `Downloading language detection model… ${pct}%` : 'Downloading language detection model…');
                  });
                }
              });
              const results = await detector.detect(text.slice(0, 2000));
              if (Array.isArray(results) && results.length) {
                source = results[0]?.detectedLanguage || source;
              }
              setHint('');
              if (detector?.destroy) detector.destroy();
            }
          }
        } catch (_) { /* 忽略语言检测错误 */ setHint(''); }

        const defaultTarget = await safeGetStorage('defaultTranslationTarget', 'zh');
        const target = String(defaultTarget).toLowerCase();
        try {
          const canAvail = typeof Translator.availability === 'function'
            ? await Translator.availability({ sourceLanguage: source, targetLanguage: target })
            : 'unknown';
          console.log('AIScribe: Translator availability =', canAvail, { source, target });
          if (canAvail === 'available' || canAvail === 'downloadable' || canAvail === 'unknown') {
            showHint('Downloading translation model…');
            const translator = await Translator.create({
              sourceLanguage: source,
              targetLanguage: target,
              monitor(m) {
                m.addEventListener('downloadprogress', (ev) => {
                  const pct = typeof ev?.progress === 'number' ? Math.round(ev.progress * 100) : (typeof ev?.loaded === 'number' ? Math.round(ev.loaded * 100) : null);
                  setHint(pct != null ? `Downloading translation model… ${pct}%` : 'Downloading translation model…');
                });
              }
            });
            const r = await translator.translate(text);
            setHint('');
            return r;
          }
        } catch (e) {
          console.warn('AIScribe: Translator error -> falling back', e);
          setHint('');
        }
      }

      // 2) 总结
      if (op === 'summarize' && Summarizer && typeof Summarizer.create === 'function') {
        try {
          const status = typeof Summarizer.availability === 'function' ? await Summarizer.availability() : 'unknown';
          console.log('AIScribe: Summarizer availability =', status);
          if (status === 'available' || status === 'downloadable' || status === 'unknown') {
            showHint('Downloading summarization model…');
            const summarizer = await Summarizer.create({
              type: 'key-points',
              format: 'markdown',
              length: 'medium',
              monitor(m) {
                m.addEventListener('downloadprogress', (ev) => {
                  const pct = typeof ev?.progress === 'number' ? Math.round(ev.progress * 100) : (typeof ev?.loaded === 'number' ? Math.round(ev.loaded * 100) : null);
                  setHint(pct != null ? `Downloading summarization model… ${pct}%` : 'Downloading summarization model…');
                });
              }
            });
            const r = await summarizer.summarize(text);
            setHint('');
            return r;
          }
        } catch (e) {
          console.warn('AIScribe: Summarizer error -> falling back', e);
          setHint('');
        }
      }

      // 3) 润色
      if (op === 'rewrite' && Rewriter && typeof Rewriter.create === 'function') {
        try {
          const status = typeof Rewriter.availability === 'function' ? await Rewriter.availability() : 'unknown';
          console.log('AIScribe: Rewriter availability =', status);
          if (status === 'available' || status === 'downloadable' || status === 'unknown') {
            showHint('Downloading rewrite model…');
            const rewriter = await Rewriter.create({
              monitor(m) {
                m.addEventListener('downloadprogress', (ev) => {
                  const pct = typeof ev?.progress === 'number' ? Math.round(ev.progress * 100) : (typeof ev?.loaded === 'number' ? Math.round(ev.loaded * 100) : null);
                  setHint(pct != null ? `Downloading rewrite model… ${pct}%` : 'Downloading rewrite model…');
                });
              }
            });
            const r = await rewriter.rewrite(text);
            setHint('');
            return r;
          }
        } catch (e) {
          console.warn('AIScribe: Rewriter error -> falling back', e);
          setHint('');
        }
      }
    } catch (e) {
      // 忽略错误，回退到离线 mock 引擎
      console.warn('AIScribe: tryBuiltInAI exception', e);
      setHint('');
    }
    return null;
  }

  // 注入到页面主世界的桥接脚本，使用 self.* 内置 AI 并通过 postMessage 回传结果/进度
  function ensureBridgeInstalled() {
    // 已禁用页面桥接脚本注入，以避免违反页面 CSP（禁止内联脚本）。
    // 保留函数占位以兼容现有调用，返回 false 表示未安装。
    return false;
  }

  // 通过桥接与页面主世界通信，返回内置 AI 结果（已禁用）
  async function callPageAI(op, text) {
    // 页面桥接已禁用，直接返回 null，让后续逻辑走后台处理。
    return Promise.resolve(null);
  }

  async function processSelection(op) {
    const sel = window.getSelection();
    // 支持按钮点击后 selection 折叠的场景
    let range, text;
    if (!sel || sel.isCollapsed) {
      if (state.savedRange && state.savedText) {
        range = state.savedRange.cloneRange();
        text = state.savedText;
      } else { hideToolbar(); return; }
    } else {
      range = sel.getRangeAt(0);
      text = sel.toString();
      // 更新保存的选区
      state.savedRange = range.cloneRange();
      state.savedText = text;
    }

    // 如果没有页面内用户激活（例如从 popup 发起），先显示工具栏并引导用户点击
    if (!(navigator?.userActivation?.isActive)) {
      const rect = range.getBoundingClientRect();
      showToolbar(rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
      highlightToolbarOp(op);
      console.warn('AIScribe: Page interaction required to use built-in AI. Please click a button in the toolbar to continue.');
      return;
    }

    // 显示工具栏以便提示下载进度
    const rect = range.getBoundingClientRect();
    showToolbar(rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
    showHint('Preparing built-in AI…');

    try {
      const aiOut = await tryBuiltInAI(op, text);
      if (aiOut != null) {
        replaceRange(range, aiOut || '');
      } else {
        // 先尝试主世界桥接
        const bridged = await callPageAI(op, text);
        if (bridged != null) {
          replaceRange(range, bridged || '');
        } else {
          try {
            const resp = await chrome.runtime.sendMessage({ type: 'AISCRIBE_PROCESS', payload: { op, text } });
            if (resp?.ok) {
              replaceRange(range, resp.result || '');
            } else {
              showHint('Processing failed: Background did not respond');
              console.warn('AIScribe: Background did not return a result');
              await new Promise(r => setTimeout(r, 1500));
            }
          } catch (err) {
            showHint('Processing failed: Built-in AI and background are unavailable');
            console.warn('AIScribe: Unable to process via built-in AI or background', err);
            await new Promise(r => setTimeout(r, 1800));
          }
        }
      }
    } catch (e) { /* 静默失败 */ }
    hideToolbar();
    // 清理保存的选区
    state.savedRange = null;
    state.savedText = '';
  }

  function replaceRange(range, newText) {
    range.deleteContents();
    const node = document.createTextNode(newText);
    range.insertNode(node);
    // 折叠到插入文本之后
    range.setStartAfter(node);
    range.collapse(true);
  }

  // 启动
  init();
})();