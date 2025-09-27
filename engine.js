const DEFAULTS = { enableToolbar: true, defaultTranslationTarget: 'zh' };

export async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...data };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set(merged);
}

export async function ensureDefaults() {
  const data = await chrome.storage.local.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in data)) missing[k] = v;
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
}

export function rewriteText(text, settings) {
  if (!text) return '';
  let t = text
    .replace(/\s+/g, ' ')
    .trim();

  const zhSynonyms = [
    ['非常', '十分'],
    ['很', '颇'],
    ['真的', '确实'],
    ['但是', '然而'],
    ['所以', '因此'],
    ['总之', '从而'],
  ];
  zhSynonyms.forEach(([a, b]) => { t = t.replace(new RegExp(a, 'g'), b); });

  const enSynonyms = [
    ['very', 'highly'],
    ['really', 'truly'],
    ['but', 'however'],
    ['so', 'therefore'],
    ['nice', 'pleasant'],
  ];
  enSynonyms.forEach(([a, b]) => { t = t.replace(new RegExp(`\\b${a}\\b`, 'gi'), b); });

  t = t
    .replace(/\s*([,.!?;:，。！？；：])/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/, '')
    .replace(/ \)/g, ')')
    .replace(/\( /g, '(');
  return t;
}

export function translateText(text, settings) {
  if (!text) return '';
  const target = (settings?.defaultTranslationTarget || 'zh').toLowerCase();
  if (target === 'zh') {
    const dict = {
      'hello': '你好',
      'world': '世界',
      'thank you': '谢谢',
      'ai': '人工智能',
      'assistant': '助手',
      'translate': '翻译',
      'summary': '摘要',
      'writing': '写作',
    };
    let t = text.toLowerCase();
    Object.entries(dict).forEach(([en, zh]) => {
      t = t.replace(new RegExp(en, 'g'), zh);
    });
    return t;
  } else if (target === 'en') {
    const dict = {
      '你好': 'hello',
      '世界': 'world',
      '谢谢': 'thank you',
      '人工智能': 'AI',
      '助手': 'assistant',
      '翻译': 'translate',
      '摘要': 'summary',
      '写作': 'writing',
    };
    let t = text;
    Object.entries(dict).forEach(([zh, en]) => {
      t = t.replace(new RegExp(zh, 'g'), en);
    });
    return t;
  }
  return text;
}

export function summarizeText(text, settings) {
  if (!text) return '';
  const sentences = text.split(/(?<=[。.!?！？])/).map(s=>s.trim()).filter(Boolean);
  if (sentences.length <= 2) return text;
  const keywords = ['重要', '因此', '总结', '关键', '结论', 'overall', 'therefore', 'in conclusion', 'key'];
  const scored = sentences.map(s => {
    let score = s.length;
    keywords.forEach(k => { if (s.includes(k)) score += 50; });
    return { s, score };
  });
  scored.sort((a,b)=>b.score-a.score);
  const top = scored.slice(0, Math.min(3, scored.length)).map(x=>x.s);
  return top.join(' ');
}

// 简易“评分与建议”，供本地演示使用：
// - 一致性：用户译文与机器译文的一、二元重合度
// - 流畅性：标点/空格使用、重复字符、句子长度分布
// - 充分性：根据用户译文长度与原文长度（中文按字，英文按词）估算覆盖度
function tokenizeCNEN(str) {
  if (!str) return [];
  const cn = (str.match(/[\u4e00-\u9fa5]/g) || []).map(x=>x);
  const en = (str.toLowerCase().match(/[a-zA-Z]+/g) || []);
  const nums = (str.match(/\d+/g) || []);
  return [...cn, ...en, ...nums];
}
function ngrams(tokens, n=2) {
  const arr = [];
  for (let i=0;i<=tokens.length-n;i++) arr.push(tokens.slice(i, i+n).join(' '));
  return arr;
}
function overlapRatio(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  setA.forEach(x=>{ if (setB.has(x)) inter++; });
  return inter / Math.max(setA.size, setB.size);
}
function fluencyScore(str) {
  if (!str) return 0;
  let score = 60;
  // 过多连续空格扣分
  if (/\s{3,}/.test(str)) score -= 10;
  // 标点后缺少空格（英文）扣分
  const badSpacing = (str.match(/([,.!?;:])(\S)/g) || []).length;
  score -= Math.min(10, badSpacing*2);
  // 重复字符扣分
  if (/(.)\1{2,}/.test(str)) score -= 10;
  // 句子过长或过短扣分
  const sentences = str.split(/(?<=[。.!?！？;；])/).filter(s=>s.trim());
  if (sentences.length) {
    const avg = sentences.reduce((a,b)=>a+b.length,0)/sentences.length;
    if (avg < 15) score -= 5; else if (avg > 120) score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}
function adequacyScore(original, user) {
  const oTokens = tokenizeCNEN(original);
  const uTokens = tokenizeCNEN(user);
  if (!oTokens.length || !uTokens.length) return 0;
  const ratio = Math.min(1, uTokens.length / oTokens.length);
  const cov = overlapRatio(new Set(oTokens).size ? oTokens : [], new Set(uTokens).size ? uTokens : []);
  // 用长度覆盖度为主（0.7），词重合为辅（0.3）
  const s = 70*ratio + 30*cov;
  return Math.max(0, Math.min(100, s));
}

export async function evaluateTranslation(original, machine, user) {
  original = (original||'').trim();
  machine = (machine||'').trim();
  user = (user||'').trim();
  if (!original) return 'Please provide the original text first.';
  if (!user) return 'Please enter your translation to get a score.';

  // 首选：使用 Prompt API（Gemini Nano）进行评分
  try {
    if (typeof LanguageModel !== 'undefined') {
      // 检查可用性并在需要时监听下载进度
      try {
        const availability = await LanguageModel.availability?.();
        // downloadable/readily 等状态均尝试创建，会在 monitor 中显示进度
      } catch (_) {}
      const session = await LanguageModel.create({
        monitor(m) {
          try {
            m.addEventListener('downloadprogress', (e) => {
              const pct = typeof e?.loaded === 'number' ? Math.round(e.loaded * 100) : undefined;
              if (typeof pct === 'number') console.log(`Prompt model download ${pct}%`);
            });
          } catch (e) { console.warn('monitor addEventListener error', e); }
        }
      });

      const messages = [
        { role: 'system', content: 'You are a professional bilingual translation reviewer. Score the user translation based on: 1) Accuracy, 2) Fluency. Each 0-100, and provide an Overall score. Give specific, actionable suggestions. Output format:\nOverall: X/100\nAccuracy: A/100\nFluency: F/100\nSuggestions: ...\nDo not invent content; judge strictly based on the provided text.' },
        { role: 'user', content: `Original:\n${original}\n\nAI reference translation:\n${machine || '(none)'}\n\nUser translation:\n${user}\n\nPlease score and provide suggestions following the format.` }
      ];
      const result = await session.prompt(messages);
      if (typeof result === 'string' && result.trim()) return result.trim();
      // 某些实现可能返回对象结构，尽量容错
      if (result && typeof result?.content === 'string') return result.content.trim();
    }
  } catch (e) {
    console.warn('Prompt API scoring failed, falling back to heuristic:', e);
  }

  // 回退：沿用旧的启发式评分算法
  const u1 = tokenizeCNEN(user), m1 = tokenizeCNEN(machine);
  const u2 = ngrams(u1,2), m2 = ngrams(m1,2);
  const consistency = Math.round(100*(0.6*overlapRatio(u1,m1) + 0.4*overlapRatio(u2,m2)));
  const fluency = Math.round(fluencyScore(user));
  const adequacy = Math.round(adequacyScore(original, user));
  const overall = Math.round(0.4*adequacy + 0.35*fluency + 0.25*consistency);

  const stop = new Set(['的','了','和','与','并','而','the','a','an','to','of','in','on','for','and','or','is','are']);
  const missing = m1.filter(w=>!stop.has(w) && !u1.includes(w));
  const freq = {};
  missing.forEach(w=>{ freq[w]=(freq[w]||0)+1; });
  const topMissing = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([w])=>w);

  const suggestions = [];
  if (fluency < 70) suggestions.push('Pay attention to punctuation and spacing; avoid consecutive spaces and overly long sentences.');
  if (adequacy < 70) suggestions.push('Increase information coverage to ensure key terms and points are not missed.');
  if (consistency < 60) suggestions.push('Large differences from the AI reference; double-check terminology and phrasing.');
  if (topMissing.length) suggestions.push('Consider revising these terms: ' + topMissing.join(', '));

  return [
    `Overall: ${overall}/100`,
    `Adequacy: ${adequacy}/100`,
    `Fluency: ${fluency}/100`,
    `Consistency with AI: ${consistency}/100`,
    suggestions.length ? ('Suggestions: ' + suggestions.join(' ')) : 'Suggestions: Good overall performance.'
  ].join('\n');
}