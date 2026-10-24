(function () {
'use strict';

/* ================= state ================= */
const KEY = 'coachos_v02';
const KEYSTORE = 'coachos_apikey';
const MODEL = 'claude-sonnet-4-5-20250929';
const fresh = () => ({ demo: false, name: '', task: '', taskKey: '', minutes: null, step: 0, knowledge: [], tone: null, agentName: '', rules: [], drafts: [], events: [], messages: [], lessonsDone: [], lastMove: '' });
let S = load();
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? Object.assign(fresh(), s) : fresh(); } catch (e) { return fresh(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: the session still works in memory */ } }
let _u = 0;
const uid = () => Date.now().toString(36) + (_u++).toString(36);

/* ================= utils ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = t => t.split(/\s+/).filter(Boolean);
const clip = (t, n = 48) => { t = t.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const phrase = (t, n) => clip(t, n).replace(/[.,;:!?]+$/, '');
const when = ts => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeTag = ts => `<time datetime="${new Date(ts).toISOString()}">${esc(when(ts))}</time>`;
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));
const paras = t => String(t).split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join('');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const fmtMins = m => m >= 60 ? (m / 60).toFixed(1).replace(/\.0$/, '') + ' h' : m + ' min';
const apiKey = () => { try { return localStorage.getItem(KEYSTORE) || ''; } catch (e) { return ''; } };
function log(type, text) { S.events.push({ id: uid(), t: Date.now(), type, text }); save(); }

/* ================= model access (optional, bring your own key) ================= */
let llmError = '';
async function llm(system, user, max = 900) {
  llmError = '';
  if (!apiKey()) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages: [{ role: 'user', content: user }] })
    });
    if (!r.ok) { llmError = 'The model answered with status ' + r.status + '.'; return null; }
    const j = await r.json();
    const t = (j.content || []).map(c => c.text || '').join('').trim();
    if (!t) llmError = 'The model sent an empty answer.';
    return t || null;
  } catch (e) { llmError = 'The model could not be reached.'; return null; }
}

/* ================= tone card ================= */
const STOP = new Set('the,a,an,and,or,but,of,to,in,for,on,with,is,are,was,were,we,our,you,your,i,my,it,this,that,at,by,from,as,be,will,has,have,not,so,if,they,their,its,can,all,about'.split(','));
function analyseTone(text) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const ws = text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
  const avgLen = sentences.length ? Math.round(ws.length / sentences.length) : 0;
  const excl = (text.match(/!/g) || []).length;
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
  const g = text.match(/\b(hi|hey|hello|dear)\b/i);
  const formal = /\b(regards|sincerely|please find|kindly)\b/i.test(text);
  const freq = {};
  ws.forEach(w => { if (w.length > 3 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1; });
  const anchors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  return {
    avgLen, emoji,
    energy: excl >= 2 ? 'high' : excl === 1 ? 'medium' : 'calm',
    greeting: g ? g[0][0].toUpperCase() + g[0].slice(1).toLowerCase() : 'none',
    formality: formal ? 'formal' : 'conversational',
    anchors
  };
}
function recomputeTone() { S.tone = S.knowledge.length ? analyseTone(S.knowledge.map(k => k.text).join('. ')) : null; }
function toneFacts(t) {
  const rows = [
    ['Sentence length', `about ${t.avgLen} words, ${t.avgLen <= 12 ? 'short and punchy' : t.avgLen <= 20 ? 'balanced' : 'long form'}`],
    ['Register', t.formality],
    ['Energy', t.energy],
    ['Greeting', t.greeting === 'none' ? 'none, straight to the point' : t.greeting],
    ['Emoji', t.emoji ? 'yes' : 'no']
  ];
  if (t.anchors.length) rows.push(['Words you use often', t.anchors.join(', ')]);
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

/* ================= drafts ================= */
const TASKS = [
  { k: 'brief', label: 'Campaign briefs' },
  { k: 'linkedin', label: 'LinkedIn posts' },
  { k: 'digest', label: 'Weekly performance digests' }
];
const EMOJI_STAR = '✨', EMOJI_ROCKET = '🚀', EMOJI_BUBBLE = '💬';
function makeDraft(taskKey, tone, topic) {
  const t = tone || analyseTone('');
  const g = t.greeting !== 'none' ? t.greeting + ' team,\n\n' : '';
  const about = topic ? `About: ${topic}\n\n` : '';
  const sign = t.formality === 'formal' ? '\n\nRegards' : (t.emoji ? '\n\nSent with ' + (t.energy === 'high' ? EMOJI_ROCKET : EMOJI_STAR) : '');
  const lead = t.energy === 'high' ? 'Big one this week' : t.energy === 'medium' ? 'Worth your attention' : 'A quick, calm update';
  switch (taskKey) {
    case 'brief':
      return `${g}${about}Campaign brief: [campaign name]\n\nObjective: [one line]\nAudience: [who it is for, be specific]\nKey message: [the one thing they should remember]\nChannels: [where it runs]\nCall to action: [what they do next]\nTimeline: [key dates]\n\n${lead}: keep the brief to one page so anyone can act on it in five minutes.${sign}`;
    case 'linkedin':
      return `${t.emoji ? EMOJI_STAR + ' ' : ''}${lead}: here is what we learned this week.\n\n${about}[Story or insight in one or two lines. Keep it real, keep it specific.]\n\n[What it means for your audience, one line.]\n\n[One clear takeaway or a question that invites comments.]\n\n#[topic] #[industry]${t.emoji ? ' ' + EMOJI_BUBBLE : ''}`;
    case 'digest':
      return `${g}${about}Weekly performance digest\n\nHighlights\n• [Metric 1]: [value] ([up or down] on last week)\n• [Metric 2]: [value] ([up or down] on last week)\n• [Metric 3]: [value]\n\nWhat worked: [one line]\nWhat needs attention: [one line]\nNext week: [one line]${sign}`;
    default:
      return `${g}${about}[Draft for ${S.task || 'your task'}]\n\n[Opening line in your voice]\n[Main content in short paragraphs]\n[A clear next step]${sign}`;
  }
}
function agentSystemPrompt() {
  const t = S.tone;
  const toneDesc = t ? `sentences of about ${t.avgLen} words, ${t.formality}, ${t.energy} energy, ${t.emoji ? 'uses emoji' : 'no emoji'}, greeting: ${t.greeting}${t.anchors.length ? ', often uses the words ' + t.anchors.join(', ') : ''}` : 'no tone card yet';
  const rules = S.rules.length ? '\nStanding rules from the user:\n' + S.rules.map(r => '- ' + r.text).join('\n') : '';
  return `You are ${S.agentName || 'a work agent'}, a personal marketing assistant for ${S.name || 'the user'}. You write in the user's own voice, never like generic AI. Output only the draft text, with no preamble and no quotes around it. Tone: ${toneDesc}.${rules}`;
}
async function writeDraftText(topic) {
  const examples = S.knowledge.slice(-3).map((k, i) => `Example ${i + 1}:\n"""\n${k.text.slice(0, 1500)}\n"""`).join('\n\n');
  const text = await llm(
    agentSystemPrompt(),
    `Task: write a draft for "${S.task}".${topic ? `\nTopic: ${topic}` : ''}\n\nThe user's own work, to imitate:\n${examples}\n\nUse [square brackets] for facts you do not have. Keep it under 200 words.`
  );
  return text; // null means the caller falls back to the template
}
let drafting = false, queueNotice = '', queueNoticeFor = '';
async function createDraft(topic) {
  drafting = true; queueNotice = ''; queueNoticeFor = '';
  if (currentView() === 'queue') renderQueue();
  const llmText = await writeDraftText(topic);
  const failed = !llmText && apiKey();
  if (failed) queueNotice = llmError + ' Your agent used the built-in template instead.';
  const text = llmText || makeDraft(S.taskKey, S.tone, topic);
  const d = { id: uid(), taskKey: S.taskKey, taskLabel: S.task, topic: topic || '', text, original: text, status: 'review', rate: null, rating: '', live: !!llmText, created: Date.now(), reviewedAt: 0, ops: null, ratio: 1, learned: '' };
  S.drafts.push(d);
  if (failed) queueNoticeFor = d.id;
  log('draft', `${S.agentName || 'Your agent'} wrote a draft${topic ? ' about ' + clip(topic, 40) : ''}${llmText ? ' with the live model' : ' from a template'}.`);
  drafting = false;
  return { d, failed };
}

/* ================= edit capture ================= */
function editRate(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length) return wb.length ? 100 : 0;
  const m = wa.length, n = wb.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (wa[i - 1] === wb[j - 1] ? 0 : 1));
  return Math.round(100 * dp[m][n] / Math.max(m, n));
}
function diffTokens(a, b) {
  const A = a.split(/(\s+)/).filter(x => x !== ''), B = b.split(/(\s+)/).filter(x => x !== '');
  const m = A.length, n = B.length;
  if (m * n > 4e6) return [{ op: 'del', text: a }, { op: 'ins', text: b }];
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (op, text) => { const l = out[out.length - 1]; if (l && l.op === op) l.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < m) push('del', A[i++]);
  while (j < n) push('ins', B[j++]);
  return out;
}
function renderDiff(ops) {
  return ops.map(o => {
    const t = esc(o.text);
    if (o.op === 'eq' || !o.text.trim()) return t;
    return o.op === 'ins' ? `<ins>${t}</ins>` : `<del>${t}</del>`;
  }).join('');
}
function learnedNote(rate, ops) {
  if (rate === 0) return 'No changes. This draft already sounds like you.';
  const pick = op => ops.filter(o => o.op === op).map(o => o.text.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  const del = pick('del'), ins = pick('ins'), parts = [];
  if (del) parts.push(`you cut “${phrase(del, 40)}”`);
  if (ins) parts.push(`you added “${phrase(ins, 40)}”`);
  return 'Learned: ' + (parts.join(' and ') || 'you reworded the draft') + '.';
}
const reviewed = () => S.drafts.filter(d => d.status === 'done');

/* ================= proficiency ================= */
const LEVELS = [
  { name: 'Novice', min: 0, opens: 'Coach, agent builder and the review queue' },
  { name: 'Builder', min: 40, opens: 'Standing rules built from your edits' },
  { name: 'Architect', min: 75, opens: 'Portable agent config you can copy out' }
];
function proficiency() {
  const r = reviewed(), last = r[r.length - 1];
  const items = [
    { label: 'Defined the task', max: 10, got: S.task ? 10 : 0 },
    { label: 'Shared an example of your best work', max: 10, got: S.knowledge.length ? 10 : 0 },
    { label: 'Added more examples (5 each, up to 2)', max: 10, got: Math.min(2, Math.max(0, S.knowledge.length - 1)) * 5 },
    { label: 'Built the tone card', max: 10, got: S.tone ? 10 : 0 },
    { label: 'Named your agent', max: 5, got: S.agentName ? 5 : 0 },
    { label: 'Finished a first review', max: 15, got: r.length ? 15 : 0 },
    { label: 'Reviewed more drafts (4 each, up to 4)', max: 16, got: Math.min(4, Math.max(0, r.length - 1)) * 4 },
    { label: 'Turned edits into rules (5 each, up to 3)', max: 15, got: Math.min(3, S.rules.filter(x => x.source === 'edit').length) * 5 },
    { label: 'Latest edit rate at or under 15%', max: 5, got: last && last.rate <= 15 ? 5 : 0 }
  ];
  const score = Math.min(100, items.reduce((a, i) => a + i.got, 0));
  const level = [...LEVELS].reverse().find(l => score >= l.min);
  const next = LEVELS[LEVELS.indexOf(level) + 1] || null;
  return { score, level, next, items };
}
const rulesOpen = () => proficiency().score >= LEVELS[1].min;
const configOpen = () => proficiency().score >= LEVELS[2].min;
function telemetry() {
  const r = reviewed();
  const avg = r.length ? Math.round(r.reduce((a, d) => a + d.rate, 0) / r.length) : null;
  const accepted = r.filter(d => d.rate <= 15).length;
  return { n: r.length, avg, accepted, pct: r.length ? Math.round(100 * accepted / r.length) : null, saved: S.minutes && r.length ? S.minutes * r.length : null };
}

/* ================= coaching tactics ================= */
const MOVES = { example: 'Teach by example', socratic: 'Socratic prompt', template: 'Template hand-over', explain: 'Build, then explain' };
function pickMove() {
  const r = reviewed(), last = r[r.length - 1];
  const rate = last ? last.rate : 0;
  const whys = {
    example: 'Your own work teaches more than a description.',
    explain: 'Your first edit is the first learning signal.',
    socratic: `Your last edit rate was ${rate}%, so the useful question is what is still missing.`,
    template: `Your last edit rate was ${rate}%, so a template of what you always fix will help.`
  };
  let order;
  if (!last) order = ['example'];
  else if (r.length === 1) order = ['explain', 'socratic'];
  else if (rate > 40) order = ['template', 'example'];
  else if (rate <= 15) order = ['socratic', 'example'];
  else order = ['example', 'template'];
  const key = order.find(k => k !== S.lastMove) || order[0];
  return { key, why: whys[key] };
}

/* ================= lessons from failure patterns ================= */
function wordsOf(text) { return text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)); }
function lessons() {
  const done = reviewed().filter(d => d.ops && d.rate > 0);
  if (!done.length) return [];
  const out = [];
  const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const cuts = done.filter(d => d.ratio < 0.85), adds = done.filter(d => d.ratio > 1.15);
  if (cuts.length >= 2) {
    const n = Math.max(20, Math.round(median(cuts.map(d => words(d.text).length)) / 10) * 10);
    out.push({ id: 'cut:' + cuts.length, title: 'You keep cutting length', why: `In ${cuts.length} of your last ${done.length} reviews you shortened the draft.`, rule: `Keep drafts under ${n} words.` });
  }
  if (adds.length >= 2) {
    const n = Math.max(20, Math.round(median(adds.map(d => words(d.text).length)) / 10) * 10);
    out.push({ id: 'add:' + adds.length, title: 'You keep adding detail', why: `In ${adds.length} of your last ${done.length} reviews you made the draft longer.`, rule: `Write at least ${n} words.` });
  }
  const dels = new Map(), inss = new Map();
  done.forEach(d => {
    const a = new Set(), b = new Set();
    d.ops.forEach(o => { if (o.op === 'del') wordsOf(o.text).forEach(w => a.add(w)); if (o.op === 'ins') wordsOf(o.text).forEach(w => b.add(w)); });
    a.forEach(w => dels.set(w, (dels.get(w) || 0) + 1));
    b.forEach(w => inss.set(w, (inss.get(w) || 0) + 1));
  });
  [...dels].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).slice(0, 2).forEach(([w, c]) =>
    out.push({ id: `del:${w}:${c}`, title: `You cut “${w}” again`, why: `You removed “${w}” in ${c} reviews.`, rule: `Avoid the word “${w}”.` }));
  [...inss].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).slice(0, 2).forEach(([w, c]) =>
    out.push({ id: `ins:${w}:${c}`, title: `You add “${w}” every time`, why: `You added “${w}” in ${c} reviews.`, rule: `Use the word “${w}” where it fits.` }));
  if (done.length === 1 && !out.length) {
    const pick = op => done[0].ops.filter(o => o.op === op).map(o => o.text.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    const del = pick('del'), ins = pick('ins');
    if (del) out.push({ id: 'first-del', title: 'Turn your first cut into a rule', why: `You removed “${phrase(del, 60)}”.`, rule: `Leave out “${phrase(del, 40)}”.` });
    else if (ins) out.push({ id: 'first-ins', title: 'Turn your first addition into a rule', why: `You added “${phrase(ins, 60)}”.`, rule: `Include “${phrase(ins, 40)}”.` });
  }
  return out.filter(l => !S.lessonsDone.includes(l.id) && !S.rules.some(r => r.text === l.rule));
}

/* ================= toast ================= */
let toastTimer;
function toast(text, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>` + (undo ? '<button type="button" id="toastUndo">Undo</button>' : '');
  el.classList.add('show');
  if (undo) $('#toastUndo').onclick = () => { undo(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 8000 : 3000);
}

/* ================= chat ================= */
const scrollEnd = el => el.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'end' });
function msgHtml(m) {
  if (m.who === 'user') return paras(m.text);
  return paras(m.text) + (m.extra || '') + (m.move ? `<small class="msg__move">Move: ${esc(MOVES[m.move.key])}. ${esc(m.move.why)}</small>` : '');
}
function appendMsg(m) {
  const d = document.createElement('div');
  d.className = `msg msg--${m.who}${m.error ? ' msg--error' : ''}`;
  d.innerHTML = msgHtml(m);
  $('#chatMessages').appendChild(d);
  scrollEnd(d);
}
function coachSay(text, opts = {}) {
  const m = { who: 'coach', text, extra: opts.extra || '', move: opts.move || null, error: !!opts.error };
  if (m.move) { S.lastMove = m.move.key; log('move', `${MOVES[m.move.key]}. ${m.move.why}`); }
  S.messages.push(m); save();
  if (currentView() === 'coach') { $('#chatFoot').hidden = false; $('#chatMessages').querySelector('.empty')?.remove(); appendMsg(m); }
}
function userSay(text) {
  const m = { who: 'user', text };
  S.messages.push(m); save();
  $('#chatMessages').querySelector('.empty')?.remove();
  appendMsg(m);
}
function typing(on) {
  let el = $('#typing');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'typing'; el.className = 'msg msg--coach msg--typing';
    el.innerHTML = '<span class="spin" aria-hidden="true"></span><span>Sanidhi is writing</span>';
    $('#chatMessages').appendChild(el); scrollEnd(el);
  } else if (!on && el) el.remove();
}
function setChips(list) {
  const row = $('#chipRow'); row.innerHTML = '';
  list.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = c.primary ? 'btn btn--ink' : 'btn'; b.textContent = c.label;
    b.onclick = () => c.onPick();
    row.appendChild(b);
  });
}
function setComposer(mode, label, focus = true) {
  const c = $('#composer');
  if (mode === 'none') { c.innerHTML = ''; return; }
  const l = esc(label);
  const send = '<button class="btn btn--ink" id="sendBtn" type="button"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-send"/></svg><span>Send</span></button>';
  c.innerHTML = `<div style="flex:1;min-width:0"><label class="visually-hidden" for="chatInput">${l}</label>` +
    (mode === 'text' ? `<input class="field" id="chatInput" type="text" autocomplete="off" placeholder="${l}">` : `<textarea class="field" id="chatInput" placeholder="${l}"></textarea>`) + '</div>' + send;
  $('#sendBtn').onclick = onSend;
  $('#chatInput').addEventListener('keydown', e => { if (mode === 'text' && e.key === 'Enter') { e.preventDefault(); onSend(); } });
  if (focus) $('#chatInput').focus({ preventScroll: true });
}
function renderChat() {
  const box = $('#chatMessages'); box.innerHTML = '';
  if (!S.messages.length) {
    box.innerHTML = '<div class="empty"><strong>Start your first session</strong><p>You tell Sanidhi how your week goes, paste one example of your best work, and review a first draft. About ten minutes.</p><button class="btn btn--ink" id="startBtn" type="button">Start session</button></div>';
    $('#chatFoot').hidden = true;
    $('#startBtn').onclick = beginOnboarding;
    return;
  }
  $('#chatFoot').hidden = false;
  S.messages.forEach(m => { const d = document.createElement('div'); d.className = `msg msg--${m.who}${m.error ? ' msg--error' : ''}`; d.innerHTML = msgHtml(m); box.appendChild(d); });
  resumeComposer();
  box.scrollTop = box.scrollHeight;
}
function resumeComposer() {
  if (S.step === 0) setComposer('text', 'Your first name', false);
  else if (S.step === 1) { if (!$('#chipRow').children.length) taskChips(); }
  else if (S.step === 2) { if (!$('#chipRow').children.length) minuteChips(); }
  else if (S.step === 3) setComposer('textarea', `Paste your best ${S.task.toLowerCase()} here`, false);
  else if (S.step === 4) setComposer('text', 'Name your agent', false);
  else if (S.agentName) { if (!$('#chipRow').children.length) setChips(afterChips()); setComposer('text', 'Ask Sanidhi anything about your agent', false); }
}
const afterChips = () => [{ label: 'Open the queue', onPick: () => go('#/queue') }, { label: 'See your progress', onPick: () => go('#/progress') }];

/* ---- onboarding ---- */
function beginOnboarding() {
  S.step = 0; S.messages = []; save();
  log('session', 'Started a session with Sanidhi.');
  renderChat();
  coachSay('Hi, I am Sanidhi, your coach. I help you build your own AI assistant for the work you do every week. Not a generic bot.\n\nFirst, what should I call you?');
  setChips([]); setComposer('text', 'Your first name');
}
function taskChips() {
  setComposer('none');
  const chips = TASKS.map(t => ({ label: t.label, onPick: () => pickTask(t.k, t.label) }));
  chips.push({ label: 'Something else', onPick: () => { setChips([]); setComposer('text', 'Describe the task in a few words'); } });
  setChips(chips);
}
function minuteChips() {
  setComposer('none');
  setChips([15, 30, 45, 60, 120].map(m => ({ label: fmtMins(m), onPick: () => pickMinutes(m) })).concat([{ label: 'Not sure', onPick: () => pickMinutes(null) }]));
}
function pickTask(key, label) {
  setChips([]); userSay(label);
  S.taskKey = key; S.task = label; S.step = 2; save(); log('task', `Chose ${label.toLowerCase()} as the task to hand over.`);
  coachSay(`${label}: a good first target, because you already know what good looks like.\n\nAbout how long does it take you by hand, each time? I use this to work out the time you save, and nothing else.`);
  minuteChips();
}
function pickMinutes(m) {
  setChips([]); userSay(m ? fmtMins(m) : 'Not sure');
  S.minutes = m; S.step = 3; save();
  coachSay('Now paste a real example of your best work for this task. Even a rough one is fine. I read it and build your tone card, so your agent writes like you and not like the internet.', { move: { key: 'example', why: 'Your own work teaches more than a description.' } });
  setComposer('textarea', `Paste your best ${S.task.toLowerCase()} here`);
}
function onSend() {
  const inp = $('#chatInput'); const val = inp.value.trim();
  if (!val) { inp.focus(); return; }
  userSay(val); inp.value = '';
  advance(val);
}
async function advance(val) {
  if (S.step === 0) {
    S.name = val.split(/\s+/)[0]; S.step = 1; save();
    coachSay(`Good to meet you, ${S.name}. Tell me about your week. Which recurring marketing task eats the most of it?`);
    taskChips(); return;
  }
  if (S.step === 1) { pickTaskText(val); return; }
  if (S.step === 3) {
    S.knowledge.push({ id: uid(), title: clip(val, 44), text: val, added: Date.now() });
    recomputeTone(); S.step = 4; save();
    log('example', 'Shared an example of their best work.'); log('tone', 'Built the tone card.');
    coachSay('I read your example. Here is what I learned about how you write.\n\nNow give your agent a name.', { extra: toneFacts(S.tone) });
    setComposer('text', 'Name your agent, for example Mira'); return;
  }
  if (S.step === 4) {
    S.agentName = val; S.step = 5; save(); log('agent', `Named the agent ${val}.`);
    setComposer('none');
    coachSay(`Building ${S.agentName} v0 around your task and your tone card. One moment.`);
    typing(true);
    const { d, failed } = await createDraft('');
    typing(false);
    if (failed) coachSay(queueNotice, { error: true });
    coachSay(`${S.agentName} v0 is ready, with a first draft of your real work.\n\nReview it as you would a junior colleague's work. Every edit you make teaches ${S.agentName}. Your edits are the training.`, { move: { key: 'explain', why: 'A first draft you can edit makes the loop concrete.' } });
    setChips([{ label: 'Review the first draft', primary: true, onPick: () => go('#/queue/' + d.id) }]);
    refreshChrome(); renderCoachSide(); return;
  }
  // free chat
  const history = S.messages.slice(-8).map(m => `${m.who === 'user' ? S.name || 'User' : 'Sanidhi'}: ${m.text}`).join('\n');
  const p = proficiency();
  typing(true);
  const reply = await llm(
    `You are Sanidhi, a warm and practical coach inside CoachOS. You teach non-technical marketers to build and improve their own AI work agents. Plain English, encouraging, one concrete next step, under 80 words. Context: the user is ${S.name}, agent ${S.agentName}, task "${S.task}", proficiency ${p.score}/100 (${p.level.name}).`,
    `Conversation so far:\n${history}\n\nReply to the last message.`, 400);
  typing(false);
  if (reply) coachSay(reply);
  else if (apiKey()) coachSay(`${llmError} Try again in a moment, or check the API key.`, { error: true });
  else coachSay('Noted. Without an API key I cannot hold an open conversation, but I can take you to your queue or your progress. Add a key from the top bar and I answer for real.');
  setChips(afterChips());
}
function pickTaskText(val) {
  S.taskKey = 'custom'; S.task = val; S.step = 2; save(); log('task', `Chose ${val.toLowerCase()} as the task to hand over.`);
  coachSay(`${val}: a good first target.\n\nAbout how long does it take you by hand, each time? I use this to work out the time you save, and nothing else.`);
  minuteChips();
}

/* ================= shared chrome ================= */
function levelLine(p) { return `${p.level.name}${p.next ? `, ${p.next.min - p.score} points to ${p.next.name}` : ''}`; }
function renderCoachSide() {
  const p = proficiency(), r = reviewed();
  const steps = [
    ['Define the task', !!S.task], ['Share your best work', S.knowledge.length > 0], ['Read your tone card', !!S.tone],
    ['Name your agent', !!S.agentName], ['Finish a first review', r.length > 0], ['Turn an edit into a rule', S.rules.some(x => x.source === 'edit')]
  ];
  const firstOpen = steps.findIndex(s => !s[1]);
  const ev = S.events.slice(-4).reverse();
  $('#coachSide').innerHTML = `
    <section aria-labelledby="sd-prof"><h2 id="sd-prof">Builder proficiency</h2>
      <div class="score"><b>${p.score}</b><span>${esc(p.level.name)}</span></div>
      <div class="meter" role="progressbar" aria-label="Builder proficiency" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.score}"><i style="--w:${p.score}%"></i></div>
      <p class="help">${esc(levelLine(p))}. <a href="#/progress">How the score works</a></p>
    </section>
    <section aria-labelledby="sd-steps"><h2 id="sd-steps">Your agent, step by step</h2>
      <ol class="steps">${steps.map(([t, ok], i) => `<li data-state="${ok ? 'done' : i === firstOpen ? 'now' : 'todo'}"><span class="tick" aria-hidden="true"></span><span>${esc(t)}<span class="visually-hidden">, ${ok ? 'done' : i === firstOpen ? 'next' : 'not started'}</span></span></li>`).join('')}</ol>
    </section>
    <section aria-labelledby="sd-act"><h2 id="sd-act">Recent activity</h2>
      ${ev.length ? `<ul class="log">${ev.map(e => `<li>${esc(e.text)}<time datetime="${new Date(e.t).toISOString()}">${esc(when(e.t))}</time></li>`).join('')}</ul>` : '<p class="help">Nothing yet. Activity from your sessions and reviews lands here.</p>'}
    </section>`;
}
function refreshChrome() {
  const pending = S.drafts.filter(d => d.status === 'review').length;
  const c = $('#queueCount');
  c.hidden = !pending;
  c.innerHTML = pending ? `${pending}<span class="visually-hidden"> ${pending === 1 ? 'draft' : 'drafts'} waiting</span>` : '';
  $('#demoChip').hidden = !S.demo;
  $('#liveChip').hidden = !apiKey();
}

/* ================= queue ================= */
let draftBuf = {};
function currentView() { return $$('.view').find(v => !v.hidden)?.id.replace('view-', '') || ''; }
function renderQueue(arg, mode) {
  if (arg === undefined) { const r = parseRoute(); arg = r.arg; mode = r.mode; }
  const list = S.drafts.slice().reverse();
  let d = S.drafts.find(x => x.id === arg);
  if (!d && list.length && !drafting) { d = list.find(x => x.status === 'review') || list[0]; history.replaceState(null, '', `#/queue/${d.id}${mode ? '/' + mode : ''}`); }
  const pending = S.drafts.filter(x => x.status === 'review').length;
  $('#queueSub').textContent = drafting ? 'Your agent is drafting.' : pending ? `${plural(pending, 'draft')} waiting for your review.` : list.length ? 'Nothing waiting. Ask for a new draft any time.' : 'Drafts from your agent appear here.';
  $('#newDraftBtn').disabled = !S.tone || drafting;
  $('#newDraftBtn').setAttribute('aria-busy', drafting ? 'true' : 'false');
  $('#newDraftBtn').title = S.tone ? '' : 'Finish your first session with Sanidhi first.';

  // list
  const L = $('#queueList');
  if (!list.length && !drafting) {
    L.innerHTML = '<div class="empty"><strong>No drafts yet</strong><p>Finish your first session with Sanidhi and your agent writes one. After that, press New draft.</p><a class="btn" href="#/coach">Go to Coach</a></div>';
  } else {
    L.innerHTML = `<ul class="rows" aria-label="Drafts">` +
      (drafting ? '<li class="row" aria-busy="true"><span><span class="skel"></span><span class="skel skel--short"></span></span><span class="status">Drafting</span></li>' : '') +
      list.map(x => `<li><a class="row" href="#/queue/${x.id}" ${d && x.id === d.id ? 'aria-current="true"' : ''}><b>${esc(x.topic || x.taskLabel)}</b>${x.status === 'done' ? `<span class="fig">${x.rate}%</span><small>Reviewed, edit rate</small>` : '<span class="status status--wait">Needs review</span><small>' + esc(when(x.created)) + '</small>'}</a></li>`).join('') + '</ul>';
  }

  // sheet
  const Sh = $('#queueSheet');
  if (drafting) {
    Sh.innerHTML = '<div class="sheet" aria-busy="true"><div class="sheet__head"><div><h2>Drafting</h2><time>Your agent is writing from your examples.</time></div></div><span class="skel"></span><span class="skel"></span><span class="skel skel--short"></span><span class="skel"></span><span class="skel skel--short"></span></div>';
  } else if (!d) {
    Sh.innerHTML = '<div class="sheet"><div class="empty"><strong>Nothing to review</strong><p>When your agent has a draft, it opens here so you can edit it and see your changes tracked.</p></div></div>';
  } else {
    Sh.innerHTML = sheetHtml(d, d.status === 'done' ? 'changes' : (mode === 'changes' ? 'changes' : 'edit'));
    wireSheet(d);
  }
  renderQueueSide(d);
}
function sheetHtml(d, mode) {
  const done = d.status === 'done';
  const text = draftBuf[d.id] ?? d.text;
  const live = done ? d.rate : editRate(d.original, text);
  const notice = queueNotice && queueNoticeFor === d.id ? `<p class="notice" role="alert">${esc(queueNotice)}</p>` : '';
  let body;
  if (mode === 'changes') {
    const ops = done ? d.ops : diffTokens(d.original, text);
    body = `<div class="diff" id="diffBox" tabindex="0" aria-label="Your changes">${renderDiff(ops)}</div><p class="diff-key">Struck-through text was deleted. Underlined text was added.</p>`;
  } else {
    body = `<label class="visually-hidden" for="draftText">Draft text</label><textarea class="field" id="draftText" aria-describedby="draftHelp">${esc(text)}</textarea><p class="field-err" id="draftErr" role="alert"></p>`;
  }
  const bar = `<div class="sheet__bar">
      <fieldset class="seg"><legend class="visually-hidden">View</legend>
        <input type="radio" name="mode" id="m-edit" value="edit" ${mode === 'edit' ? 'checked' : ''} ${done ? 'disabled' : ''}><label for="m-edit">Edit</label>
        <input type="radio" name="mode" id="m-changes" value="changes" ${mode === 'changes' ? 'checked' : ''}><label for="m-changes">Changes</label>
      </fieldset>
      <div class="rate"><span>${done ? 'Edit rate' : 'Edit rate so far'}</span><b id="liveRate">${live}%</b></div>
    </div>`;
  let foot;
  if (done) {
    foot = `<div class="settled">
      <span class="mark">Reviewed</span>
      <fieldset class="rating"><legend>How close was it?</legend>
        <span class="seg">${[['not', 'Not close'], ['close', 'Close'], ['ready', 'Ready']].map(([v, l]) => `<input type="radio" name="rating" id="r-${v}" value="${v}" ${d.rating === v ? 'checked' : ''}><label for="r-${v}">${l}</label>`).join('')}</span>
      </fieldset></div>`;
  } else {
    foot = `<div class="sheet__foot">
      <p class="help" id="draftHelp">Every edit teaches ${esc(S.agentName || 'your agent')}.</p>
      <div class="actions"><button class="btn" id="approveBtn" type="button">Approve as is</button><button class="btn btn--ink" id="saveBtn" type="button">Save my edits</button></div></div>`;
  }
  return `<article class="sheet" aria-labelledby="sheetTitle">
    <div class="sheet__head"><div><h2 id="sheetTitle" tabindex="-1">${esc(d.topic || d.taskLabel)}</h2>
      <time datetime="${new Date(d.created).toISOString()}">${esc(S.agentName || 'Agent')} wrote this ${esc(when(d.created))}, ${d.live ? 'with the live model' : 'from a template'}</time></div></div>
    ${notice}${bar}${body}${foot}</article>`;
}
function wireSheet(d) {
  const done = d.status === 'done';
  $$('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
    const ta = $('#draftText'); if (ta) draftBuf[d.id] = ta.value;
    go(`#/queue/${d.id}/${r.value}`);
  }));
  if (done) {
    $$('input[name="rating"]').forEach(r => r.addEventListener('change', () => { d.rating = r.value; save(); log('rating', `Rated a draft ${r.nextElementSibling.textContent.toLowerCase()}.`); }));
    return;
  }
  const ta = $('#draftText');
  const approve = $('#approveBtn');
  const sync = () => {
    const v = ta ? ta.value : (draftBuf[d.id] ?? d.text);
    if (ta) draftBuf[d.id] = v;
    $('#liveRate').textContent = editRate(d.original, v) + '%';
    const changed = v !== d.original;
    approve.disabled = changed;
    $('#draftHelp').textContent = changed ? 'You changed the draft, so save your edits. Approve is for drafts you left alone.' : `Every edit teaches ${S.agentName || 'your agent'}.`;
    if (ta) { $('#draftErr').textContent = ''; ta.removeAttribute('aria-invalid'); }
  };
  if (ta) ta.addEventListener('input', sync);
  sync();
  approve.onclick = () => settle(d, d.original, true);
  $('#saveBtn').onclick = () => {
    const v = ta ? ta.value : (draftBuf[d.id] ?? d.text);
    if (!v.trim()) { $('#draftErr').textContent = 'A draft cannot be empty. Write something, or approve the original.'; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
    settle(d, v, false);
  };
}
async function settle(d, edited, asIs) {
  const ops = asIs ? [{ op: 'eq', text: d.original }] : diffTokens(d.original, edited);
  const rate = asIs ? 0 : editRate(d.original, edited);
  d.text = edited; d.rate = rate; d.ops = ops; d.status = 'done'; d.reviewedAt = Date.now();
  d.ratio = words(d.original).length ? words(edited).length / words(d.original).length : 1;
  d.learned = learnedNote(rate, ops);
  delete draftBuf[d.id];
  save();
  log('edit', asIs ? 'Approved a draft with no edits.' : `Saved edits, edit rate ${rate}%.`);
  const move = pickMove();
  const text = {
    explain: `${d.learned}\n\nThat is the loop. You edit, I name what changed, and ${S.agentName} gets a little closer to you.`,
    socratic: `Only ${rate}% changed. What would make the next draft ready with no edits at all? Tell me and I will turn it into a rule.`,
    template: `Your edit rate was ${rate}%. Here is a template to hand over: write down the three things you always fix, one line each. The Improve me panel in your queue has the first candidates.`,
    example: `${d.learned}\n\nPaste one more example of your best work and I will sharpen the tone card. You can add it on the Agent page.`
  }[move.key];
  coachSay(text, { move });
  refreshChrome();
  history.replaceState(null, '', `#/queue/${d.id}/changes`);
  renderQueue(d.id, 'changes');
  $('#sheetTitle')?.focus?.();
  const note = await llm('You are Sanidhi, a coach watching a user edit their AI agent\'s draft. In one sentence of at most 25 words, plain English, say what the edit teaches the agent about the user\'s preferences. Start with "Learned:".', `ORIGINAL DRAFT:\n${d.original.slice(0, 1200)}\n\nUSER'S EDITED VERSION:\n${edited.slice(0, 1200)}`, 200);
  if (note && !asIs) { d.learned = note; save(); if (currentView() === 'queue') renderQueueSide(d); }
}
function renderQueueSide(d) {
  const ls = lessons(), r = reviewed();
  const learned = d && d.status === 'done' ? `<section aria-labelledby="qs-learn"><h2 id="qs-learn">Learned from this edit</h2><p>${esc(d.learned)}</p><p class="help">Edit rate ${d.rate}%. ${esc(d.reviewedAt ? when(d.reviewedAt) : '')}</p></section>` : '';
  $('#queueSide').innerHTML = learned + `
    <section aria-labelledby="qs-imp"><h2 id="qs-imp" tabindex="-1">Improve me</h2>
      ${ls.length ? ls.map((l, i) => `<details class="lesson"><summary>${esc(l.title)}</summary><div class="lesson__body">
          <p>${esc(l.why)}</p><p>A rule turns the pattern into an instruction your agent follows in every live draft.</p>
          <label for="rule-${i}">Rule</label><input class="field" id="rule-${i}" value="${esc(l.rule)}">
          <div class="actions"><button class="btn btn--ink btn--small" type="button" data-add="${i}">Add to my rules</button><button class="btn btn--small" type="button" data-skip="${i}">Not now</button></div>
        </div></details>`).join('')
        : `<p class="help">${r.length ? 'No lessons right now. Sanidhi adds one when your edits show a pattern.' : 'Review your first draft. A lesson appears when your edits show a pattern.'}</p>`}
    </section>`;
  $$('[data-add]', $('#queueSide')).forEach(b => b.onclick = () => {
    const l = ls[+b.dataset.add]; const text = $('#rule-' + b.dataset.add).value.trim();
    if (!text) { $('#rule-' + b.dataset.add).focus(); return; }
    S.rules.push({ id: uid(), text, source: 'edit', added: Date.now() }); S.lessonsDone.push(l.id);
    log('rule', `Added a rule: ${text}`); save(); renderQueueSide(d); refreshChrome();
    $('#qs-imp').focus();
  });
  $$('[data-skip]', $('#queueSide')).forEach(b => b.onclick = () => { S.lessonsDone.push(ls[+b.dataset.skip].id); save(); renderQueueSide(d); });
}

/* ================= agent ================= */
function renderAgent(focusSel) {
  const p = proficiency(), open = rulesOpen(), cfg = configOpen();
  const kn = S.knowledge, t = S.tone;
  const title = S.agentName || 'Your agent';
  const config = JSON.stringify({
    name: S.agentName, version: `0.${reviewed().length}`,
    task: { label: S.task, minutesByHand: S.minutes },
    systemPrompt: agentSystemPrompt(),
    knowledge: kn.map(k => ({ id: k.id, title: k.title, words: words(k.text).length })),
    rules: S.rules.map(r => r.text),
    review: { policy: 'human-review-required' }
  }, null, 2);
  $('#agentBody').innerHTML = `
    <header class="view-head"><h1 id="h-agent" tabindex="-1">${esc(title)}</h1>
      <p class="lead">${S.agentName ? 'What your agent knows, how it sounds and the rules it follows.' : 'Your agent appears here once you finish a first session with Sanidhi.'}</p></header>

    <section class="block" aria-labelledby="a-task"><h2 id="a-task" tabindex="-1">Task</h2>
      <form id="taskForm" novalidate><div class="form-row">
        <div><label for="taskInput">The one task you handed over</label><input class="field" id="taskInput" value="${esc(S.task)}" autocomplete="off" aria-describedby="taskErr"><p class="field-err" id="taskErr" role="alert"></p></div>
        <div><label for="minInput">Minutes by hand</label><input class="field" id="minInput" type="number" inputmode="numeric" min="1" max="600" value="${S.minutes || ''}" aria-describedby="taskErr"></div>
      </div><div class="actions"><button class="btn" type="submit">Save task</button><span class="help" id="taskHelp" role="status"></span></div></form>
    </section>

    <section class="block" aria-labelledby="a-ex"><h2 id="a-ex" tabindex="-1">Examples of your best work</h2>
      <p class="lead">Your agent learns your voice from these. The tone card is rebuilt whenever you add or remove one.</p>
      ${kn.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Example</th><th scope="col" class="num">Words</th><th scope="col">Added</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
        ${kn.map(k => `<tr><td><span class="cell-title">${esc(k.title)}</span></td><td class="num">${words(k.text).length}</td><td>${timeTag(k.added)}</td><td><button class="btn btn--text btn--small" type="button" data-rm-ex="${k.id}">Remove<span class="visually-hidden"> ${esc(k.title)}</span></button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty"><strong>No examples yet</strong><p>Paste one real piece of your best work below and your agent has something to learn from.</p></div>'}
      <form class="add-form" id="exForm" novalidate><label for="exText">Add an example</label>
        <textarea class="field" id="exText" aria-describedby="exErr" placeholder="Paste a real one, even a rough one"></textarea><p class="field-err" id="exErr" role="alert"></p>
        <div class="actions"><button class="btn btn--ink" type="submit">Add example</button></div></form>
    </section>

    <section class="block" aria-labelledby="a-tone"><h2 id="a-tone" tabindex="-1">Tone card</h2>
      ${t ? `<p class="lead">Built from ${plural(kn.length, 'example')}.</p>${toneFacts(t)}` : '<div class="empty"><strong>No tone card yet</strong><p>Add an example above and the card appears here.</p></div>'}
    </section>

    <section class="block" aria-labelledby="a-rules"><h2 id="a-rules" tabindex="-1">Standing rules</h2>
      <p class="lead">Short instructions your agent follows in every draft. They come from your edits or from you.</p>
      ${open ? '' : `<p class="locked">Rules open at Builder level, 40 points. You have ${p.score}. Finishing a first review gets you there.</p>`}
      ${S.rules.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Rule</th><th scope="col">Source</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
        ${S.rules.map(r => `<tr><td>${esc(r.text)}</td><td>${r.source === 'edit' ? 'From your edits' : 'Added by you'}</td><td><button class="btn btn--text btn--small" type="button" data-rm-rule="${r.id}">Remove<span class="visually-hidden"> rule: ${esc(r.text)}</span></button></td></tr>`).join('')}</tbody></table></div>`
        : (open ? '<div class="empty"><strong>No rules yet</strong><p>Rules from your edits appear in Improve me on the queue. You can also write one here.</p></div>' : '')}
      <form class="rule-add" id="ruleForm" novalidate><label class="visually-hidden" for="ruleText">New rule</label>
        <input class="field" id="ruleText" placeholder="Never open with a question" ${open ? '' : 'disabled'} autocomplete="off">
        <button class="btn" type="submit" ${open ? '' : 'disabled'}>Add rule</button></form>
      ${apiKey() ? '' : '<p class="help">Rules apply to live drafts. Without an API key your agent writes from templates, so rules are saved but not applied yet.</p>'}
    </section>

    <section class="block" aria-labelledby="a-policy"><h2 id="a-policy">Review policy</h2>
      <p>Every draft waits for your review. Nothing your agent writes counts as done until you approve it or save your edits.</p>
    </section>

    <section class="block" aria-labelledby="a-cfg"><h2 id="a-cfg">Portable config</h2>
      <p class="lead">Your agent as plain data: system prompt, knowledge and rules. It is not tied to one model vendor.</p>
      ${cfg ? '' : `<p class="locked">Copying the config opens at Architect level, 75 points. You have ${p.score}.</p>`}
      <details class="cfg"><summary>Show the config</summary><pre tabindex="0">${esc(config)}</pre></details>
      <div class="actions" style="margin-top:var(--space-sm)"><button class="btn" id="cfgCopy" type="button" ${cfg ? '' : 'disabled'}><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-copy"/></svg><span>Copy config</span></button></div>
    </section>`;
  const root = $('#agentBody');
  $('#taskForm').onsubmit = e => {
    e.preventDefault();
    const label = $('#taskInput').value.trim(), m = $('#minInput').value.trim();
    const mins = m ? Math.round(+m) : null;
    if (!label) { $('#taskErr').textContent = 'Name the task, for example LinkedIn posts.'; $('#taskInput').setAttribute('aria-invalid', 'true'); $('#taskInput').focus(); return; }
    if (mins !== null && (!(mins >= 1 && mins <= 600))) { $('#taskErr').textContent = 'Minutes by hand must be a number from 1 to 600, or leave it empty.'; $('#minInput').setAttribute('aria-invalid', 'true'); $('#minInput').focus(); return; }
    S.task = label; S.minutes = mins; S.drafts.forEach(d => { if (d.status === 'review') d.taskLabel = label; });
    save(); log('task', 'Updated the task.'); $('#taskErr').textContent = ''; $('#taskHelp').textContent = 'Saved.';
  };
  $('#exForm').onsubmit = e => {
    e.preventDefault();
    const v = $('#exText').value.trim();
    if (words(v).length < 12) { $('#exErr').textContent = 'Paste a longer example, at least 12 words, so the tone card has something to read.'; $('#exText').setAttribute('aria-invalid', 'true'); $('#exText').focus(); return; }
    S.knowledge.push({ id: uid(), title: clip(v, 44), text: v, added: Date.now() });
    recomputeTone(); save(); log('example', 'Added an example of their best work.'); refreshChrome(); renderAgent('#exText');
  };
  $('#ruleForm').onsubmit = e => {
    e.preventDefault();
    const v = $('#ruleText').value.trim(); if (!v) { $('#ruleText').focus(); return; }
    S.rules.push({ id: uid(), text: v, source: 'manual', added: Date.now() }); save(); log('rule', `Added a rule: ${v}`); renderAgent('#ruleText');
  };
  $$('[data-rm-ex]', root).forEach(b => b.onclick = () => {
    const i = S.knowledge.findIndex(k => k.id === b.dataset.rmEx); const [item] = S.knowledge.splice(i, 1);
    recomputeTone(); save(); renderAgent('#a-ex');
    toast('Example removed.', () => { S.knowledge.splice(i, 0, item); recomputeTone(); save(); renderAgent('#a-ex'); });
  });
  $$('[data-rm-rule]', root).forEach(b => b.onclick = () => {
    const i = S.rules.findIndex(r => r.id === b.dataset.rmRule); const [item] = S.rules.splice(i, 1);
    save(); renderAgent('#a-rules');
    toast('Rule removed.', () => { S.rules.splice(i, 0, item); save(); renderAgent('#a-rules'); });
  });
  $('#cfgCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(config); toast('Config copied.'); } catch (e) { toast('Could not copy. Open the config and select it by hand.'); }
  };
  if (focusSel) $(focusSel)?.focus({ preventScroll: true });
}

/* ================= progress ================= */
function chartSvg(rates) {
  const W = 640, H = 240, pl = 58, pr = 16, pt = 14, pb = 32, n = rates.length;
  const x = i => pl + (n === 1 ? 0 : i * (W - pl - pr) / (n - 1)), y = v => pt + (100 - v) * (H - pt - pb) / 100;
  const grid = [0, 25, 50, 75, 100].map(v => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 10}" y="${y(v) + 5}" text-anchor="end">${v}%</text>`).join('');
  const pts = rates.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const dots = rates.map((v, i) => `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"/><text x="${x(i)}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Edit rate by review. First review ${rates[0]} percent, latest ${rates[n - 1]} percent. The table below lists every value.">${grid}<polyline class="line" points="${pts}"/>${dots}</svg>`;
}
function renderProgress() {
  const p = proficiency(), tm = telemetry(), r = reviewed();
  const ev = S.events.slice(-10).reverse();
  $('#progressBody').innerHTML = `
    <header class="view-head"><h1 id="h-progress" tabindex="-1">Progress</h1><p class="lead">Your skill as a builder, and how your agent is doing.</p></header>
    <div class="prog">
      <section aria-labelledby="p-score"><h2 id="p-score">Builder proficiency</h2>
        <div class="big"><b>${p.score}</b><span>${esc(p.level.name)}</span></div>
        <div class="meter" role="progressbar" aria-label="Builder proficiency" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.score}"><i style="--w:${p.score}%"></i></div>
        <p class="help">${esc(levelLine(p))}.</p>
        <h3 class="sub">Levels and what they open</h3>
        <div class="table-wrap"><table><thead><tr><th scope="col">Level</th><th scope="col" class="num">From</th><th scope="col">What opens</th><th scope="col">Status</th></tr></thead><tbody>
          ${LEVELS.map(l => `<tr><td><span class="cell-title">${l.name}</span></td><td class="num">${l.min}</td><td>${esc(l.opens)}</td><td>${p.score >= l.min ? (l === p.level ? 'You are here' : 'Reached') : 'Not yet'}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section aria-labelledby="p-earn"><h2 id="p-earn">How the score adds up</h2>
        <div class="table-wrap"><table><thead><tr><th scope="col">What counts</th><th scope="col" class="num">Points</th></tr></thead><tbody>
          ${p.items.map(i => `<tr><td>${esc(i.label)}</td><td class="num">${i.got} of ${i.max}</td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>
    <div class="stats">
      <div><b>${tm.n}</b><span>Drafts reviewed</span><small>Approved or saved with edits</small></div>
      <div><b>${tm.avg === null ? 'None yet' : tm.avg + '%'}</b><span>Average edit rate</span><small>Share of words you changed</small></div>
      <div><b>${tm.pct === null ? 'None yet' : tm.pct + '%'}</b><span>Accepted</span><small>Drafts with an edit rate of 15% or less</small></div>
      <div><b>${tm.saved === null ? 'Not set' : fmtMins(tm.saved)}</b><span>Time saved</span><small>${S.minutes ? `Reviews times your ${S.minutes} minutes by hand` : 'Add minutes by hand on the Agent page'}</small></div>
    </div>
    <div class="prog">
      <section aria-labelledby="p-trend"><h2 id="p-trend">Edit rate by review</h2>
        ${r.length >= 2 ? chartSvg(r.map(d => d.rate)) + '<p class="help">Review number along the bottom, share of words you changed up the side. A falling line means your agent is learning you.</p>' : `<div class="empty"><strong>${r.length ? 'One review so far' : 'No reviews yet'}</strong><p>${r.length ? `Your first edit rate was ${r[0].rate}%. A second review draws the line.` : 'Review a draft in your queue and its edit rate lands here. A falling line means your agent is learning you.'}</p>${r.length ? '' : '<a class="btn" href="#/queue">Open the queue</a>'}</div>`}
      </section>
      <section aria-labelledby="p-rev"><h2 id="p-rev">Reviews</h2>
        ${r.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Draft</th><th scope="col" class="num">Edit rate</th><th scope="col">Rating</th><th scope="col">Reviewed</th></tr></thead><tbody>
          ${r.map(d => `<tr><td>${esc(d.topic || d.taskLabel)}</td><td class="num">${d.rate}%</td><td>${d.rating ? ({ not: 'Not close', close: 'Close', ready: 'Ready' })[d.rating] : 'Not rated'}</td><td>${timeTag(d.reviewedAt)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="help">Reviews you finish are listed here, with the rating you gave each one.</p>'}
      </section>
    </div>
    <section aria-labelledby="p-act" style="margin-top:var(--space-xl)"><h2 id="p-act">Activity</h2>
      ${ev.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">What happened</th></tr></thead><tbody>${ev.map(e => `<tr><td>${timeTag(e.t)}</td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="help">Sessions, edits, ratings and rules are logged here as they happen.</p>'}
    </section>`;
}

/* ================= router ================= */
const VIEWS = ['coach', 'queue', 'agent', 'progress'];
const TITLES = { coach: 'Coach', queue: 'Review queue', agent: 'Agent', progress: 'Progress' };
function parseRoute() {
  const [v, arg, mode] = (location.hash || '').replace(/^#\/?/, '').split('/');
  return { view: VIEWS.includes(v) ? v : (S.agentName ? 'queue' : 'coach'), arg, mode };
}
function go(hash) { if (location.hash === hash) route(true); else location.hash = hash; }
let firstRoute = true;
function route(user) {
  const { view, arg, mode } = parseRoute();
  VIEWS.forEach(v => { $('#view-' + v).hidden = v !== view; });
  $$('.tabs a').forEach(a => { if (a.dataset.tab === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = `${TITLES[view]} | CoachOS`;
  refreshChrome();
  if (view === 'coach') { renderChat(); renderCoachSide(); }
  if (view === 'queue') renderQueue(arg, mode);
  if (view === 'agent') renderAgent();
  if (view === 'progress') renderProgress();
  if (!firstRoute || user) { window.scrollTo(0, 0); $('#h-' + view)?.focus({ preventScroll: true }); }
  firstRoute = false;
}
window.addEventListener('hashchange', () => route(true));

/* ================= dialogs and top bar ================= */
const keyDlg = $('#keyDialog'), resetDlg = $('#resetDialog');
$('#keyBtn').onclick = () => {
  $('#keyInput').value = ''; $('#keyErr').textContent = '';
  $('#keyStatus').textContent = apiKey() ? 'A key is saved.' : 'No key is saved, so drafts come from templates.';
  $('#keyRemove').hidden = !apiKey();
  keyDlg.showModal(); $('#keyInput').focus();
};
$('#keyCancel').onclick = () => keyDlg.close();
$('#keyRemove').onclick = () => { try { localStorage.removeItem(KEYSTORE); } catch (e) { /* ignore */ } keyDlg.close(); refreshChrome(); toast('API key removed. Drafts come from templates.'); };
$('#keyForm').onsubmit = e => {
  e.preventDefault();
  const k = $('#keyInput').value.trim();
  if (!k) { $('#keyErr').textContent = 'Paste a key to save it, or choose Cancel.'; $('#keyInput').setAttribute('aria-invalid', 'true'); $('#keyInput').focus(); return; }
  try { localStorage.setItem(KEYSTORE, k); } catch (er) { $('#keyErr').textContent = 'This browser blocked storage, so the key could not be saved.'; return; }
  keyDlg.close(); refreshChrome(); toast('Live model connected.');
};
$('#resetBtn').onclick = () => resetDlg.showModal();
$('#resetCancel').onclick = () => resetDlg.close();
$('#resetConfirm').onclick = () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } location.href = location.pathname; };
$('#newDraftBtn').onclick = () => { $('#topicForm').hidden = false; $('#topicInput').focus(); };
$('#topicCancel').onclick = () => { $('#topicForm').hidden = true; $('#newDraftBtn').focus(); };
$('#topicForm').onsubmit = async e => {
  e.preventDefault();
  const topic = $('#topicInput').value.trim(); $('#topicInput').value = ''; $('#topicForm').hidden = true;
  const { d } = await createDraft(topic);
  refreshChrome(); history.replaceState(null, '', '#/queue/' + d.id); renderQueue(d.id);
  $('#sheetTitle')?.focus?.();
};

/* ================= sample data for review (?demo=1) ================= */
function seedDemo() {
  const sample = 'Hey team! Big week. Our webinar campaign hit 1,240 signups, best ever. The founder story post outperformed everything else. Short lines, real numbers, one clear ask. That is how we win. Let us do more of this.';
  S = fresh(); S.demo = true;
  S.name = 'Ananya'; S.task = 'LinkedIn posts'; S.taskKey = 'linkedin'; S.minutes = 30; S.step = 5; S.agentName = 'Mira';
  S.knowledge = [{ id: uid(), title: clip(sample, 44), text: sample, added: Date.now() - 36e5 }];
  recomputeTone();
  S.messages = [
    { who: 'coach', text: 'Hi, I am Sanidhi, your coach. I help you build your own AI assistant for the work you do every week.', extra: '', move: null, error: false },
    { who: 'user', text: 'Ananya' },
    { who: 'coach', text: 'I read your example. Here is what I learned about how you write.', extra: toneFacts(S.tone), move: { key: 'example', why: 'Your own work teaches more than a description.' }, error: false },
    { who: 'coach', text: 'Mira v0 is ready, with a first draft of your real work.', extra: '', move: { key: 'explain', why: 'A first draft you can edit makes the loop concrete.' }, error: false }
  ];
  ['linkedin', 'digest'].forEach((k, i) => {
    const text = makeDraft(k, S.tone, '');
    S.drafts.push({ id: uid(), taskKey: k, taskLabel: k === 'linkedin' ? 'LinkedIn posts' : 'Weekly performance digests', topic: '', text, original: text, status: 'review', rate: null, rating: '', live: false, created: Date.now() - (2 - i) * 6e4, reviewedAt: 0, ops: null, ratio: 1, learned: '' });
  });
  log('session', 'Sample data loaded for review.');
  save();
}

/* ================= boot ================= */
(function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1' && !q.get('keep')) seedDemo();
  const screen = q.get('screen');
  if (!location.hash && (screen === 'session' || screen === 'dash')) history.replaceState(null, '', location.pathname + (q.get('demo') ? '?demo=1&keep=1' : '') + (screen === 'session' ? '#/coach' : '#/queue'));
  else if (q.get('demo') === '1' && !q.get('keep')) history.replaceState(null, '', location.pathname + '?demo=1&keep=1' + location.hash);
  route(false);
})();
})();
