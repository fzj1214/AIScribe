"use strict";

function setStatus(text) {
  const el = document.getElementById('status-writing');
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

function hasOnDevice(name) {
  try { return typeof self !== 'undefined' && name in self; } catch (_) { return false; }
}

async function createRewriter() {
  if (!hasOnDevice('Rewriter')) throw new Error('Rewriter unavailable');
  try {
    const status = typeof Rewriter.availability === 'function' ? await Rewriter.availability() : 'unknown';
    if (status === 'downloadable') setStatus('Preparing to download rewrite model…');
  } catch (_) {}
  const inst = await Rewriter.create({
    monitor(m) {
      try {
        m.addEventListener('downloadprogress', (e) => {
          const p = typeof e?.progress === 'number' ? Math.round(e.progress * 100) : (typeof e?.loaded === 'number' ? Math.round(e.loaded * 100) : undefined);
          if (typeof p === 'number') setStatus(`Rewrite model download ${p}%`);
        });
      } catch (_) {}
    }
  });
  return inst;
}

async function createProofreader() {
  if (!hasOnDevice('Proofreader')) throw new Error('Proofreader unavailable');
  try {
    const status = typeof Proofreader.availability === 'function' ? await Proofreader.availability() : 'unknown';
    if (status === 'downloadable') setStatus('Preparing to download proofreading model…');
  } catch (_) {}
  const inst = await Proofreader.create({
    monitor(m) {
      try {
        m.addEventListener('downloadprogress', (e) => {
          const p = typeof e?.progress === 'number' ? Math.round(e.progress * 100) : (typeof e?.loaded === 'number' ? Math.round(e.loaded * 100) : undefined);
          if (typeof p === 'number') setStatus(`Proofreading model download ${p}%`);
        });
      } catch (_) {}
    }
  });
  return inst;
}

async function doRewrite(input) {
  setStatus('Rewriting…');
  try {
    const rw = await createRewriter();
    const r = await rw.rewrite(input);
    return r || '';
  } catch (e) {
    console.warn('Rewriter failed, falling back to local rewriteText:', e);
    return await processBackground({ op: 'rewrite', text: input });
  } finally { setStatus(''); }
}

async function doProofread(input) {
  setStatus('Proofreading…');
  try {
    const pf = await createProofreader();
    const r = await pf.proofread(input);
    // 兼容可能的返回结构
    if (typeof r === 'string') return r;
    if (r && typeof r?.text === 'string') return r.text;
    return JSON.stringify(r, null, 2);
  } catch (e) {
    console.warn('Proofreader failed, falling back to summarizeText as a hint:', e);
    // 作为简化：用 summarizeText 给出关键句提示
    return await processBackground({ op: 'summarize', text: input });
  } finally { setStatus(''); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('back-home').addEventListener('click', () => { location.href = 'index.html'; });
  const input = document.getElementById('writing-input');
  const output = document.getElementById('writing-output');

  document.getElementById('btn-rewrite').addEventListener('click', async () => {
    const text = (input.value || '').trim();
    if (!text) { setStatus('Please enter text first'); return; }
    const r = await doRewrite(text);
    output.value = r || '';
  });

  document.getElementById('btn-proofread').addEventListener('click', async () => {
    const text = (input.value || '').trim();
    if (!text) { setStatus('Please enter text first'); return; }
    const r = await doProofread(text);
    output.value = r || '';
  });
});