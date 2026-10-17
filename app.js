"use strict";
/* ============ Constants ============ */
const ORDER = ["q", "c", "e", "n", "s"];
const SK = {
  q: { name: "Questions", tag: "Ask the right question" },
  c: { name: "Comms", tag: "Be understood" },
  e: { name: "Execution", tag: "Get it done" },
  n: { name: "Negotiation", tag: "Grow the pie, then claim" },
  s: { name: "Sales", tag: "Move people to yes" }
};
const KEY = "intersection.state.v1";
const MODEL = "claude-haiku-5-5";
const TIER = { 1: "Foundations", 2: "Practitioner", 3: "Advanced" };

/* ============ Curriculum queue ============ */
// Interleave skills by tier; each technique gets a learn session, then a spoken session ~4 sessions later;
// a cross-skill challenge every 7th slot.
function buildQueue() {
  const learn = [];
  for (let tier = 1; tier <= 3; tier++)
    for (let i = 0; i < 8; i++)
      for (const sk of ORDER) {
        const t = IX.lib.find(l => l.sk === sk && l.tier === tier && IX.lib.filter(x => x.sk === sk && x.tier === tier).indexOf(l) === i);
        if (t) learn.push(t.id);
      }
  const q = [];
  const pendingSpeak = [];
  let li = 0, ci = 0, slot = 0;
  while (li < learn.length || pendingSpeak.length) {
    slot++;
    if (slot % 7 === 0 && ci < IX.ch.length) { q.push({ type: "challenge", id: IX.ch[ci++].id }); continue; }
    const due = pendingSpeak.find(p => p.at <= slot);
    if (due && (slot % 2 === 0 || li >= learn.length)) {
      pendingSpeak.splice(pendingSpeak.indexOf(due), 1);
      q.push({ type: "speak", id: due.id });
      continue;
    }
    if (li < learn.length) {
      q.push({ type: "learn", id: learn[li] });
      pendingSpeak.push({ id: learn[li], at: slot + 4 });
      li++;
    } else if (pendingSpeak.length) {
      const p = pendingSpeak.shift();
      q.push({ type: "speak", id: p.id });
    }
  }
  while (ci < IX.ch.length) q.push({ type: "challenge", id: IX.ch[ci++].id });
  return q;
}
const QUEUE = buildQueue();
const T = id => IX.lib.find(l => l.id === id);
const CH = id => IX.ch.find(c => c.id === id);

/* ============ State ============ */
const blank = () => ({
  v: 1, xp: { q: 0, c: 0, e: 0, n: 0, s: 0 }, pos: 0, learned: {}, spoken: {}, chDone: {},
  log: {}, reviews: {}, missions: [], answers: {}, history: [], cur: null,
  settings: { apiKey: "", rate: 1, voice: "", transcript: true }, started: null
});
let S = blank();
try { const raw = localStorage.getItem(KEY); if (raw) S = deepMerge(blank(), JSON.parse(raw)); } catch (e) {}
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") a[k] = deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Couldn't save. Storage may be full."); } }
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

/* ============ Helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const dkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => dkey(new Date());
const addDays = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return dkey(d); };
const lvl = xp => Math.floor(Math.sqrt(xp / 25)) + 1;
const lvlFloor = L => 25 * (L - 1) * (L - 1);
const rank = L => L >= 11 ? "Master" : L >= 8 ? "Expert" : L >= 5 ? "Practitioner" : L >= 3 ? "Apprentice" : "Novice";
function lvlPct(xp) { const L = lvl(xp), a = lvlFloor(L), b = lvlFloor(L + 1); return Math.round((xp - a) / (b - a) * 100); }
function streak() { let d = today(), n = 0; if (!S.log[d]) d = addDays(d, -1); while (S.log[d]) { n++; d = addDays(d, -1); } return n; }
function bestStreak() { const ks = Object.keys(S.log).sort(); let best = 0, run = 0, prev = null; for (const k of ks) { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; } return best; }
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function addXP(sks, n) { const list = Array.isArray(sks) ? sks : [sks]; const each = Math.round(n / list.length); list.forEach(k => S.xp[k] = Math.max(0, (S.xp[k] || 0) + each)); return n; }
function seeded(seed) { let x = Math.abs(seed) % 2147483647 || 7; return () => (x = x * 16807 % 2147483647) / 2147483647; }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
function itemSkills(item) { return item.type === "challenge" ? CH(item.id).sk : [T(item.id).sk]; }
function itemTitle(item) { return item.type === "challenge" ? CH(item.id).t : T(item.id).t; }
const typeLabel = { learn: "Learn + drill", speak: "Speaking drill", challenge: "Intersection challenge", mastery: "Mastery round" };

/* ============ Speech (TTS) ============ */
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); } catch (e) {} }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); if (view === "settings") render(); }; }
function pickVoice() {
  if (!voices.length) loadVoices();
  return voices.find(v => v.name === S.settings.voice) || voices.find(v => /Samantha|Ava|Allison|Google US English|Daniel|Karen/i.test(v.name)) || voices[0];
}
function say(text, btn) {
  if (!("speechSynthesis" in window)) { toast("This browser can't read aloud."); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); if (btn) btn.classList.remove("on"); return; }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = S.settings.rate || 1; u.lang = v ? v.lang : "en-US";
  speechSynthesis.speak(u);
}
const speakIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const listenBtn = (id, label = "Listen") => `<button class="speakbtn" data-say="${id}">${speakIcon}${label}</button>`;
const sayTexts = {};

/* ============ Recording ============ */
const Rec = { stream: null, mr: null, chunks: [], url: null, recog: null, final: "", interim: "", t0: 0, timer: null, secs: 0, on: false };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
async function startRec() {
  Rec.final = ""; Rec.interim = ""; Rec.secs = 0; Rec.chunks = [];
  if (Rec.url) { URL.revokeObjectURL(Rec.url); Rec.url = null; }
  try {
    Rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast("Microphone blocked. Allow it in Settings, or type your answer instead.");
    return false;
  }
  try {
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
    Rec.mr = new MediaRecorder(Rec.stream, mime ? { mimeType: mime } : undefined);
    Rec.mr.ondataavailable = e => { if (e.data && e.data.size) Rec.chunks.push(e.data); };
    Rec.mr.onstop = () => {
      if (Rec.chunks.length) { Rec.url = URL.createObjectURL(new Blob(Rec.chunks, { type: Rec.mr.mimeType || "audio/mp4" })); }
      const a = $("#playback"); if (a && Rec.url) { a.src = Rec.url; a.hidden = false; }
    };
    Rec.mr.start(250);
  } catch (e) { Rec.mr = null; }
  if (SR && S.settings.transcript) {
    try {
      const r = new SR(); Rec.recog = r;
      r.lang = "en-US"; r.continuous = true; r.interimResults = true;
      r.onresult = ev => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) Rec.final += res[0].transcript.trim() + " "; else interim += res[0].transcript;
        }
        Rec.interim = interim;
        const el = $("#liveText"); if (el) el.textContent = (Rec.final + interim).trim() || "Listening…";
      };
      r.onerror = () => {};
      r.onend = () => { if (Rec.on && Rec.recog === r) { try { r.start(); } catch (e) {} } };
      r.start();
    } catch (e) { Rec.recog = null; }
  }
  Rec.on = true; Rec.t0 = Date.now();
  Rec.timer = setInterval(() => { Rec.secs = Math.round((Date.now() - Rec.t0) / 1000); const t = $("#recTime"); if (t) t.textContent = fmtTime(Rec.secs); }, 250);
  return true;
}
function stopRec() {
  Rec.on = false; clearInterval(Rec.timer);
  Rec.secs = Math.max(1, Math.round((Date.now() - Rec.t0) / 1000));
  try { Rec.mr && Rec.mr.state !== "inactive" && Rec.mr.stop(); } catch (e) {}
  try { Rec.recog && Rec.recog.stop(); } catch (e) {}
  setTimeout(() => { try { Rec.stream && Rec.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }, 300);
  return (Rec.final + " " + Rec.interim).replace(/\s+/g, " ").trim();
}
const fmtTime = s => Math.floor(s / 60) + ":" + pad(s % 60);
const FILLERS = /\b(um+|uh+|erm|like|you know|basically|actually|kind of|sort of|i mean)\b/gi;
function speechMetrics(text, secs) {
  const words = (text.match(/\b[\w']+\b/g) || []).length;
  const fillers = (text.match(FILLERS) || []).length;
  const wpm = secs ? Math.round(words / secs * 60) : 0;
  return { words, fillers, wpm };
}

/* ============ AI grading ============ */
function gradeContext(item) {
  if (item.type === "challenge") {
    const c = CH(item.id);
    return { skill: c.sk.map(k => SK[k].name).join(" + "), technique: "Cross-skill challenge: " + c.t, idea: "", task: c.scene + "\nTask: " + c.ask, rubric: c.rub, model: c.model };
  }
  const t = T(item.id);
  if (item.type === "learn") return { skill: SK[t.sk].name, technique: t.t + " (" + t.src + ")", idea: t.idea, task: t.drill, rubric: t.steps, model: t.model };
  return { skill: SK[t.sk].name, technique: t.t + " (" + t.src + ")", idea: t.idea, task: t.scene + "\nTask: " + t.ask, rubric: t.rub, model: t.model };
}
function gradePrompt(item, answer, spoken) {
  const g = gradeContext(item);
  return `You're a demanding but encouraging coach helping a young professional (works in AI strategy, aiming for AI product management) master the skill: ${g.skill}.
Technique: ${g.technique}
${g.idea ? "Core idea: " + g.idea + "\n" : ""}Exercise: ${g.task}
Rubric: ${g.rubric.map((r, i) => (i + 1) + ") " + r).join("  ")}
Reference answer (one good version, not the only one): ${g.model}

My ${spoken ? "spoken answer (speech-to-text transcript, so ignore small transcription errors)" : "answer"}:
"""${answer}"""

Grade me honestly against the rubric. Reply in this exact format, plain text, under 150 words:
Score: N/5
What worked: one sentence.
Fix: the single most important improvement.
Stronger version: my answer rewritten, as short as possible.`;
}
async function aiGrade(item, answer, spoken) {
  const key = S.settings.apiKey.trim();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: "user", content: gradePrompt(item, answer, spoken) }] })
  });
  if (!res.ok) {
    let msg = "The grader returned an error (" + res.status + ").";
    if (res.status === 401) msg = "Your API key was rejected. Check it in Settings.";
    if (res.status === 429) msg = "Too many requests. Wait a minute and try again.";
    if (res.status === 400) { try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) {} }
    throw new Error(msg);
  }
  const j = await res.json();
  const text = (j.content || []).map(b => b.text || "").join("").trim();
  const m = text.match(/Score:\s*([0-5](?:\.\d)?)/i);
  return { text, score: m ? Math.round(+m[1]) : null };
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }

/* ============ Session engine ============ */
let view = "today", sess = null, libSkill = "q";
function newSession(kind, item) {
  const s = { kind, date: today(), item, step: 0, gained: 0, reviews: [], ri: 0, draft: "", transcript: "", secs: 0, quizPick: null, revPick: null, score: null, gradeText: "", rubTicks: [], gradedBy: null, showModel: false };
  if (kind === "daily") {
    const due = Object.entries(S.reviews).filter(([, r]) => r.due <= today()).sort((a, b) => a[1].due.localeCompare(b[1].due)).slice(0, 2).map(([id]) => id);
    s.reviews = due;
  }
  return s;
}
function nextItem() {
  if (S.pos < QUEUE.length) return QUEUE[S.pos];
  // Mastery mode: cycle back through spoken drills and challenges, least recently practiced first
  const pool = IX.lib.map(t => ({ type: "speak", id: t.id, last: S.spoken[t.id] || "" })).concat(IX.ch.map(c => ({ type: "challenge", id: c.id, last: S.chDone[c.id] || "" })));
  pool.sort((a, b) => a.last.localeCompare(b.last));
  return { type: pool[0].type, id: pool[0].id, mastery: true };
}
function stepsFor(item) {
  if (item.type === "learn") return ["learn", "quiz", "drill", "grade", "mission"];
  if (item.type === "speak") return ["recap", "scene", "record", "grade"];
  return ["scene", "record", "grade"];
}
function startSession(kind, item) {
  if (Rec.url) { URL.revokeObjectURL(Rec.url); Rec.url = null; }
  if (kind !== "practice" && S.cur && !S.cur.finished && S.cur.date === today()) { sess = S.cur; }
  else { sess = newSession(kind, item || nextItem()); if (kind !== "practice") S.cur = sess; }
  if (!S.started) S.started = today();
  save(); view = "session"; render(); scrollTo(0, 0);
}
function curStep() { if (sess.ri < sess.reviews.length) return "review"; return stepsFor(sess.item)[sess.step] || "done"; }
function advance() {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (sess.ri < sess.reviews.length) { sess.ri++; sess.revPick = null; sess.revQi = null; }
  else { sess.step++; }
  if (curStep() === "done") finishSession();
  save(); render(); scrollTo(0, 0);
}
function finishSession() {
  const it = sess.item, d = today();
  if (it.type === "learn") {
    if (!S.learned[it.id]) S.reviews[it.id] = { due: addDays(d, 2), int: 2, n: 0 };
    S.learned[it.id] = d;
  } else if (it.type === "speak") S.spoken[it.id] = d;
  else S.chDone[it.id] = d;
  if (sess.kind !== "practice" && !it.mastery && QUEUE[S.pos] && QUEUE[S.pos].id === it.id && QUEUE[S.pos].type === it.type) S.pos++;
  S.log[d] = (S.log[d] || 0) + 1;
  S.history.push({ d, type: it.type, id: it.id, xp: sess.gained, score: sess.score });
  if (S.history.length > 800) S.history = S.history.slice(-800);
  sess.finished = true;
}
function exitSession() {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (Rec.on) stopRec();
  if (sess && sess.finished && S.cur === sess) S.cur = null;
  sess = null; view = "today"; save(); render(); scrollTo(0, 0);
}

/* ============ Views ============ */
function render() {
  document.body.classList.toggle("insession", view === "session");
  $$(".tabs button").forEach(b => b.classList.toggle("sel", b.dataset.tab === view));
  const app = $("#app");
  if (view === "today") app.innerHTML = todayView();
  else if (view === "library") app.innerHTML = libraryView();
  else if (view === "progress") app.innerHTML = progressView();
  else if (view === "settings") app.innerHTML = settingsView();
  else if (view === "session") app.innerHTML = sessionView();
  bind();
}

const flame = `<svg class="flame" viewBox="0 0 18 22"><path d="M9 1c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3 0-6 1-9z" fill="var(--e)"/></svg>`;
function rings(size = 150, opacity = true) {
  const cx = 75, cy = 75, R = 27, r = 40;
  let out = `<svg viewBox="0 0 150 150" width="${size}" height="${size}" aria-hidden="true">`;
  ORDER.forEach((k, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const f = opacity ? Math.min(.5, .07 + (lvl(S.xp[k]) - 1) * .045) : .22;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="var(--${k})" fill-opacity="${f.toFixed(2)}" stroke="var(--${k})" stroke-width="1.6"/>`;
  });
  return out + "</svg>";
}
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone; }

function todayView() {
  const d = new Date();
  const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneToday = !!S.log[today()];
  const resume = S.cur && S.cur.date === today() && !S.cur.finished ? S.cur : null;
  const item = resume ? resume.item : nextItem();
  const sks = itemSkills(item);
  const dueN = Object.values(S.reviews).filter(r => r.due <= today()).length;
  const open = S.missions.filter(m => !m.done || m.doneDate === today()).slice(-6).reverse();
  const minK = ORDER.reduce((m, k) => S.xp[k] < S.xp[m] ? k : m, "q");
  const dayN = Math.min(S.pos + 1, QUEUE.length);
  const install = !isStandalone() ? `<div class="install"><b>Install on your iPhone</b><p class="small muted">In Safari, tap Share, then "Add to Home Screen". It'll open full-screen like a normal app and work offline.</p></div>` : "";
  let heroBody;
  if (doneToday && !resume) {
    heroBody = `<div class="eyebrow">Today · done</div><h2>Nice. Today's rep is in.</h2>
      <p class="small" style="opacity:.8">Up next: ${esc(itemTitle(item))} · ${typeLabel[item.type]}</p>
      <div class="btnrow"><button class="btn" data-bonus>Do a bonus rep</button></div>`;
  } else {
    heroBody = `<div class="eyebrow">${resume ? "Resume today's rep" : "Today's rep"} · Session ${item.mastery ? "∞" : dayN} of ${QUEUE.length}</div>
      <h2>${esc(itemTitle(item))}</h2>
      <div class="chips">${sks.map(k => `<span class="chip" style="--k:var(--${k});background:color-mix(in srgb,var(--${k}) 30%,transparent);color:var(--bg)">${SK[k].name}</span>`).join("")}</div>
      <div class="meta"><span>${typeLabel[item.mastery ? "mastery" : item.type]}</span><span>~5 min</span>${dueN ? `<span>+ ${Math.min(2, dueN)} quick review${dueN > 1 ? "s" : ""}</span>` : ""}</div>
      <button class="btn" data-start>${resume ? "Continue" : "Start"}</button>`;
  }
  return `
  <header class="top">
    <div><div class="eyebrow">${esc(dateStr)}</div><h1>Intersection</h1></div>
    <div class="streak">${flame}<b class="mono">${streak()}</b></div>
  </header>
  <section class="hero"><div class="ring">${rings(150, false)}</div>${heroBody}</section>
  ${install}
  <section class="panel">
    <div class="row2"><h3>Your five skills</h3><span class="small muted">Weakest: <b style="color:var(--${minK})">${SK[minK].name}</b></span></div>
    <div class="ledger">${ORDER.map(k => { const xp = S.xp[k], L = lvl(xp);
      return `<button class="lrow" style="--k:var(--${k})" data-lib="${k}"><span class="name"><i></i>${SK[k].name}</span><span class="lv"><span class="mono">L${L}</span> · ${rank(L)}</span><span class="bar"><span style="width:${lvlPct(xp)}%"></span></span></button>`; }).join("")}</div>
  </section>
  <section class="panel">
    <div class="row2"><h3>Field missions</h3><span class="small muted">+15 xp each</span></div>
    ${open.length ? open.map(m => { const t = T(m.id); const k = t ? t.sk : "q";
      return `<button class="mission ${m.done ? "done" : ""}" style="--k:var(--${k})" data-mission="${esc(m.key)}"><span class="box">${m.done ? "✓" : ""}</span><span><span class="txt">${esc(m.text)}</span><small>${SK[k].name} · ${esc(t ? t.t : "")}</small></span></button>`; }).join("")
      : `<p class="small muted">Finish a Learn session to get a real-world mission to try that day.</p>`}
  </section>`;
}

function libraryView() {
  const k = libSkill, list = IX.lib.filter(l => l.sk === k);
  const chs = IX.ch.filter(c => c.sk.includes(k));
  let html = `<header><div class="eyebrow">${IX.lib.length} techniques · ${IX.ch.length} challenges</div><h1>Library</h1></header>
  <div class="seg" style="--k:var(--${k})">${ORDER.map(s => `<button class="${s === k ? "sel" : ""}" style="--k:var(--${s})" data-seg="${s}">${SK[s].name}</button>`).join("")}</div>
  <p class="muted small">Practise anything here any time. Practice earns XP but doesn't move your daily path forward.</p>`;
  for (let tier = 1; tier <= 3; tier++) {
    html += `<section class="panel" style="--k:var(--${k})"><div class="eyebrow tier">${TIER[tier]}</div><div>`;
    list.filter(l => l.tier === tier).forEach(l => {
      const st = S.learned[l.id] ? (S.spoken[l.id] ? "Mastered ✓" : "Learned") : "New";
      html += `<button class="lesson" data-open="${l.id}"><span class="t">${esc(l.t)}</span><span class="s">${esc(l.src)}</span><span class="st ${S.learned[l.id] ? "d" : ""}">${st}</span></button>`;
    });
    html += `</div></section>`;
  }
  html += `<section class="panel" style="--k:var(--${k})"><div class="eyebrow tier">Intersection challenges</div><div>`;
  chs.forEach(c => html += `<button class="lesson" data-opench="${c.id}"><span class="t">${esc(c.t)}</span><span class="s">${c.sk.map(s => SK[s].name).join(" + ")}</span><span class="st ${S.chDone[c.id] ? "d" : ""}">${S.chDone[c.id] ? "Done ✓" : "Try"}</span></button>`);
  return html + `</div></section>`;
}

function libDetail(id) {
  const t = T(id);
  view = "detail";
  $("#app").innerHTML = `<div style="--k:var(--${t.sk});display:flex;flex-direction:column;gap:16px">
    <button class="link" data-back style="align-self:flex-start">← Library</button>
    <span class="chip" style="align-self:flex-start">${SK[t.sk].name} · ${TIER[t.tier]}</span>
    <h1>${esc(t.t)}</h1><p class="src">${esc(t.src)}</p>
    <p class="idea">${esc(t.idea)}</p>
    <ul class="list">${t.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <div class="btnrow"><button class="btn k" data-practice="learn">Practise: written</button><button class="btn ghost" data-practice="speak">Practise: speaking</button></div>
  </div>`;
  $("[data-back]").onclick = () => { view = "library"; render(); };
  $$("[data-practice]").forEach(b => b.onclick = () => startSession("practice", { type: b.dataset.practice, id }));
  scrollTo(0, 0);
}

function progressView() {
  const total = Object.values(S.xp).reduce((a, b) => a + b, 0);
  const minL = Math.min(...ORDER.map(k => lvl(S.xp[k])));
  const sessions = Object.values(S.log).reduce((a, b) => a + b, 0);
  const scored = S.history.filter(h => h.score != null);
  const avg = scored.length ? (scored.slice(-20).reduce((a, h) => a + h.score, 0) / Math.min(20, scored.length)).toFixed(1) : "–";
  let heat = ""; for (let i = 83; i >= 0; i--) { const k = addDays(today(), -i), n = S.log[k] || 0; heat += `<i class="${n > 1 ? "l2" : n ? "l1" : ""} ${i === 0 ? "t" : ""}" title="${k}"></i>`; }
  const left = Math.max(0, QUEUE.length - S.pos);
  return `<header><div class="eyebrow">${total} xp total</div><h1>Progress</h1></header>
  <section class="panel map">${rings(150, true)}
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0"><span class="eyebrow">Intersection level</span><span class="big mono">L${minL}</span>
    <p class="small muted">Your level is your weakest skill's level. The circles fill in as each one grows.</p></div></section>
  <div class="stats">
    <div class="stat"><b class="mono">${streak()}</b><span>Day streak</span></div>
    <div class="stat"><b class="mono">${bestStreak()}</b><span>Best streak</span></div>
    <div class="stat"><b class="mono">${avg}</b><span>Avg score (last 20)</span></div>
  </div>
  <section class="panel"><div class="row2"><h3>Path</h3><span class="small muted mono">${S.pos}/${QUEUE.length}</span></div>
    <div class="bar" style="--k:var(--accent)"><span style="width:${Math.round(S.pos / QUEUE.length * 100)}%"></span></div>
    <p class="small muted">${left ? `${left} sessions of new material left, about ${Math.round(left / 30)} months at one a day. After that, Mastery mode cycles your spoken drills and challenges, with spaced reviews throughout.` : "Path complete. Mastery mode is on."}</p></section>
  <section class="panel"><h3>Skills</h3><div class="ledger">${ORDER.map(k => { const xp = S.xp[k], L = lvl(xp);
    const lc = IX.lib.filter(l => l.sk === k && S.learned[l.id]).length;
    return `<div class="lrow" style="--k:var(--${k})"><span class="name"><i></i>${SK[k].name}</span><span class="lv"><span class="mono">L${L}</span> · ${rank(L)} · ${xp} xp</span><span class="bar"><span style="width:${lvlPct(xp)}%"></span></span><span class="small muted">${lc}/24 techniques learned · ${lvlFloor(L + 1) - xp} xp to L${L + 1}</span></div>`; }).join("")}</div></section>
  <section class="panel"><div class="row2"><h3>Last 12 weeks</h3><span class="small muted mono">${sessions} sessions</span></div><div class="heat">${heat}</div></section>`;
}

function settingsView() {
  const st = S.settings;
  return `<header><h1>Settings</h1></header>
  <section class="panel">
    <h3>AI grading</h3>
    <p class="small muted">Without a key, use "Grade in Claude": it copies your answer and the rubric and opens the Claude app, using your existing subscription at no extra cost. With an Anthropic API key, grading happens instantly in the app; it's billed per use, roughly a fraction of a cent per grade on ${MODEL}. The key stays on this phone only.</p>
    <div class="field"><label for="apikey">Anthropic API key (optional)</label><input id="apikey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(st.apiKey)}"></div>
    <div class="btnrow"><button class="btn soft" id="saveKey">Save key</button>${st.apiKey ? `<button class="btn ghost" id="clearKey">Remove</button>` : ""}</div>
    <p class="small muted">Get one at console.anthropic.com → API keys. Set a low monthly spend limit there.</p>
  </section>
  <section class="panel">
    <h3>Voice</h3>
    <div class="field"><label for="voice">Reading voice</label><select id="voice"><option value="">Automatic</option>${voices.map(v => `<option ${v.name === st.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="rate">Reading speed: <span class="mono" id="rateVal">${st.rate}×</span></label><input id="rate" type="range" min="0.7" max="1.3" step="0.05" value="${st.rate}"></div>
    <div class="toggle"><label for="trans">Live transcript while recording</label><input id="trans" type="checkbox" ${st.transcript ? "checked" : ""}></div>
    <p class="small muted">If recording misbehaves on your phone, turn the live transcript off. You can still type or dictate what you said afterwards. Tip: download an Enhanced voice in iPhone Settings → Accessibility → Spoken Content → Voices for much more natural reading.</p>
    <button class="btn ghost" id="testVoice">Test voice</button>
  </section>
  <section class="panel">
    <h3>Backup</h3>
    <p class="small muted">Progress lives on this phone. Copy a backup now and then (paste it into Notes), and restore it if you switch phones.</p>
    <div class="btnrow"><button class="btn soft" id="exportBtn">Copy backup</button><button class="btn ghost" id="importBtn">Restore…</button></div>
    <textarea id="importBox" hidden placeholder="Paste a backup here, then tap Restore again"></textarea>
  </section>
  <section class="panel">
    <h3>About the content</h3>
    <p class="small muted">${IX.lib.length} techniques from primary sources (Fisher & Ury, Voss, Rackham, Minto, Cialdini, Kahneman, Christensen, Klein, Gollwitzer and more), written in plain language. Each has a lesson, two scenario quizzes, a written drill with a model answer, a spoken drill with a rubric, and a real-world mission. Plus ${IX.ch.length} cross-skill challenges and spaced review.</p>
    <button class="btn ghost" id="resetBtn">Reset all progress</button>
    <div id="resetConfirm" hidden class="btnrow"><button class="btn" style="background:var(--bad);color:#fff" id="resetYes">Yes, erase everything</button><button class="btn ghost" id="resetNo">Cancel</button></div>
  </section>`;
}

/* ---------- Session views ---------- */
function sessionView() {
  const step = curStep(), it = sess.item;
  const sks = itemSkills(it), k = sks[0];
  const steps = stepsFor(it), total = sess.reviews.length + steps.length;
  const idx = Math.min(sess.ri + (sess.ri >= sess.reviews.length ? sess.step : 0), total);
  const head = `<div class="shead"><button class="link" data-exit>✕ ${sess.finished ? "Close" : "Save & exit"}</button><div class="chips">${sks.map(s => `<span class="chip" style="--k:var(--${s})">${SK[s].name}</span>`).join("")}</div></div>
    <div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</div>`;
  let body = "";
  if (sess.finished) body = doneStep();
  else if (step === "review") body = reviewStep();
  else body = ({ learn: learnStep, quiz: quizStep, drill: drillStep, grade: gradeStep, mission: missionStep, recap: recapStep, scene: sceneStep, record: recordStep })[step]();
  return `<div style="--k:var(--${k});display:flex;flex-direction:column;gap:16px">${head}<section class="card">${body}</section></div>`;
}
function reviewStep() {
  const id = sess.reviews[sess.ri], t = T(id), r = S.reviews[id];
  if (sess.revQi == null) sess.revQi = (r && r.n % 2 === 0) ? 1 : 0;
  const q = t.q[sess.revQi];
  const rnd = seeded(hash(id + today())); const order = [0, 1, 2]; for (let i = 2; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const p = sess.revPick;
  return `<div class="eyebrow">Quick review · ${esc(t.t)}</div><h2 style="--k:var(--${t.sk})">${esc(q[0])}</h2>
    <div class="opts" style="--k:var(--${t.sk})">${order.map(i => { let c = ""; if (p != null) { if (i === q[2]) c = "right"; else if (i === p) c = "wrong"; } return `<button class="opt ${c}" data-rev="${i}" ${p != null ? "disabled" : ""}>${esc(q[1][i])}</button>`; }).join("")}</div>
    ${p != null ? `<p class="why" style="--k:var(--${t.sk})"><b>${p === q[2] ? "Right. +5 xp" : "Not quite."}</b> ${esc(q[3])}</p><button class="btn wide" data-next>Continue</button>` : ""}`;
}
function learnStep() {
  const t = T(sess.item.id);
  sayTexts.learn = t.t + ". " + t.idea + " " + t.steps.join(". ");
  return `<div class="eyebrow">Learn · ${TIER[t.tier]}</div><h1>${esc(t.t)}</h1><p class="src">${esc(t.src)}</p>
    ${listenBtn("learn")}
    <p class="idea">${esc(t.idea)}</p>
    <ul class="list">${t.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <button class="btn wide" data-next>Quick check →</button>`;
}
function quizStep() {
  const t = T(sess.item.id), q = t.q[0];
  const rnd = seeded(hash(t.id)); const order = [0, 1, 2]; for (let i = 2; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const p = sess.quizPick;
  return `<div class="eyebrow">Scenario check</div><h2>${esc(q[0])}</h2>
    <div class="opts">${order.map(i => { let c = ""; if (p != null) { if (i === q[2]) c = "right"; else if (i === p) c = "wrong"; } return `<button class="opt ${c}" data-quiz="${i}" ${p != null ? "disabled" : ""}>${esc(q[1][i])}</button>`; }).join("")}</div>
    ${p != null ? `<p class="why"><b>${p === q[2] ? "Right. +10 xp" : "Not quite. +3 xp"}</b> ${esc(q[3])}</p><button class="btn wide" data-next>Drill →</button>` : ""}`;
}
function drillStep() {
  const t = T(sess.item.id);
  sayTexts.drill = t.drill;
  return `<div class="eyebrow">Written drill · 2–3 min</div><h2>${esc(t.drill)}</h2>${listenBtn("drill", "Read it to me")}
    <textarea id="ans" placeholder="Write it out, or tap the mic on your keyboard to dictate. Rough is fine.">${esc(sess.draft)}</textarea>
    <button class="btn wide" data-drilldone>Get graded →</button>
    <p class="small muted">Skipping? <button class="link" data-skipdrill>Skip the drill</button></p>`;
}
function recapStep() {
  const t = T(sess.item.id);
  sayTexts.recap = t.t + ". " + t.idea;
  return `<div class="eyebrow">Speaking drill · recap</div><h1>${esc(t.t)}</h1><p class="src">${esc(t.src)}</p>${listenBtn("recap")}
    <p class="idea">${esc(t.idea)}</p><ul class="list">${t.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <button class="btn wide" data-next>Show me the scenario →</button>`;
}
function sceneData() { return sess.item.type === "challenge" ? CH(sess.item.id) : T(sess.item.id); }
function sceneStep() {
  const d = sceneData();
  sayTexts.scene = d.scene + " " + d.ask;
  return `<div class="eyebrow">${sess.item.type === "challenge" ? "Intersection challenge" : "Scenario"}</div>
    ${sess.item.type === "challenge" ? `<h1>${esc(d.t)}</h1>` : ""}
    <div class="scene">${esc(d.scene)}</div>${listenBtn("scene", "Read it to me")}
    <p class="ask">${esc(d.ask)}</p>
    <div class="panel"><span class="eyebrow">You'll be graded on</span><ul class="list small">${d.rub.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>
    <button class="btn wide" data-next>I'm ready to answer →</button>`;
}
function recordStep() {
  const d = sceneData();
  return `<div class="eyebrow">Your turn · speak it</div><p class="ask">${esc(d.ask)}</p>
    <div class="recorder">
      <button class="recbtn ${Rec.on ? "on" : ""}" id="recBtn" aria-label="${Rec.on ? "Stop recording" : "Start recording"}">
        <svg class="mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
        <svg class="sq" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
      </button>
      <span class="timer" id="recTime">${fmtTime(Rec.on ? Rec.secs : sess.secs)}</span>
      <span class="small muted" id="recHint">${Rec.on ? "Recording… tap to stop" : sess.secs ? "Tap to record again" : "Tap to start, then answer out loud"}</span>
    </div>
    <div class="transcript" id="liveText">${esc(sess.transcript) || (SR && S.settings.transcript ? "Your words will appear here as you speak." : "Live transcript is off or not supported here. You can type what you said on the next screen.")}</div>
    <audio id="playback" controls ${Rec.url ? `src="${Rec.url}"` : "hidden"}></audio>
    <div class="btnrow"><button class="btn" data-recdone ${Rec.on ? "disabled" : ""}>${sess.secs ? "Grade it →" : "Skip recording, type instead →"}</button></div>`;
}
function gradeStep() {
  const it = sess.item, spoken = it.type !== "learn";
  const d = it.type === "learn" ? T(it.id) : sceneData();
  const rub = spoken ? d.rub : null;
  const m = spoken && sess.transcript ? speechMetrics(sess.transcript, sess.secs) : null;
  const hasKey = !!S.settings.apiKey.trim();
  let html = `<div class="eyebrow">Grade</div>`;
  if (spoken) {
    html += `<h2>How did it go?</h2>
      ${Rec.url ? `<audio controls src="${Rec.url}"></audio>` : ""}
      ${m ? `<div class="metrics"><div class="metric"><b class="mono">${fmtTime(sess.secs)}</b><span>Length</span></div><div class="metric"><b class="mono">${m.wpm}</b><span>Words/min</span></div><div class="metric"><b class="mono" style="color:${m.fillers > 3 ? "var(--bad)" : "var(--good)"}">${m.fillers}</b><span>Fillers</span></div></div>
      <p class="small muted">${m.wpm > 175 ? "A bit fast. Aim for 130–160 words a minute and use pauses." : m.wpm && m.wpm < 110 ? "On the slow side; tighten it up." : "Good pace."} ${m.fillers > 3 ? "Swap fillers for short pauses." : ""}</p>` : ""}
      <label class="small muted" for="ans">${sess.transcript ? "Transcript (fix any mistakes before grading)" : "Type or dictate what you said, so it can be graded"}</label>
      <textarea id="ans" style="min-height:110px">${esc(sess.transcript || sess.draft)}</textarea>`;
  } else {
    html += `<h2>Your answer</h2><div class="model" style="background:var(--surface);border:1px solid var(--line)">${esc(sess.draft) || "<i>No answer written.</i>"}</div>`;
  }
  if (sess.score != null) {
    html += `<div class="result"><div class="row2"><span class="eyebrow">${sess.gradedBy === "ai" ? "AI coach" : sess.gradedBy === "claude" ? "Claude" : "Self-check"}</span><span class="score">${sess.score}/5</span></div>${sess.gradeText ? `<div>${esc(sess.gradeText)}</div>` : ""}</div>
      <div class="panel"><span class="eyebrow">Model answer</span><p>${esc(d.model)}</p></div>
      <button class="btn wide" data-next>${stepsFor(it).length - 1 === sess.step ? "Finish ✓" : "Continue →"}</button>`;
    return html;
  }
  html += `<div class="btnrow">${hasKey ? `<button class="btn k" id="aiGrade">Grade with AI</button>` : ""}<a class="btn ${hasKey ? "ghost" : "k"}" id="claudeGrade" href="https://claude.ai/new" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center">Grade in Claude app</a></div>
    <div id="aiOut"></div>
    <div id="claudeScore" hidden class="panel"><span class="eyebrow">What score did Claude give you?</span><div class="scores">${[1, 2, 3, 4, 5].map(n => `<button data-cscore="${n}">${n}</button>`).join("")}</div></div>
    <details class="panel"><summary style="font-weight:700;cursor:pointer">Or check yourself</summary>
      ${rub ? `<p class="small muted">Tick what you actually did:</p><div class="rub">${rub.map((r, i) => `<label><input type="checkbox" data-tick="${i}"><span>${esc(r)}</span></label>`).join("")}</div>` : `<p class="small muted">Compare with the model answer, then rate yourself.</p>`}
      <div class="model"><span class="eyebrow">Model answer</span><p>${esc(d.model)}</p></div>
      ${rub ? `<button class="btn soft wide" id="selfRub">Score my ticks</button>` : `<div class="scores">${[1, 2, 3, 4, 5].map(n => `<button data-self="${n}">${n}</button>`).join("")}</div>`}
    </details>`;
  return html;
}
function missionStep() {
  const t = T(sess.item.id);
  return `<div class="eyebrow">Take it into your day</div><h2>${esc(t.m)}</h2>
    <p class="muted">Missions show up on your Today screen. Tick it off once you've done it, for +15 xp.</p>
    <div class="btnrow"><button class="btn ghost" data-mskip>Skip</button><button class="btn k" data-maccept>Accept mission</button></div>`;
}
function doneStep() {
  const nx = nextItem();
  return `<div class="eyebrow">Session complete</div>
    <div class="row2" style="align-items:flex-end"><span class="xpbig" style="color:var(--k)">+${sess.gained}</span><span class="streak">${flame}<b class="mono">${streak()}</b></span></div>
    <p class="muted">xp earned. ${sess.kind === "practice" ? "Practice logged." : `Next time: <b>${esc(itemTitle(nx))}</b> (${typeLabel[nx.mastery ? "mastery" : nx.type]}).`}</p>
    <div class="confetti">${ORDER.map(k => `<i style="background:var(--${k})"></i>`).join("")}</div>
    <button class="btn wide" data-exit>Done</button>`;
}

/* ============ Binding ============ */
function bind() {
  $$("[data-tab]").forEach(b => b.onclick = () => { if (view === "session") return; view = b.dataset.tab; render(); scrollTo(0, 0); });
  $$("[data-say]").forEach(b => b.onclick = () => say(sayTexts[b.dataset.say], b));
  if (view === "today") {
    const st = $("[data-start]"); if (st) st.onclick = () => startSession(S.cur && !S.cur.finished && S.cur.date === today() ? S.cur.kind : "daily");
    const bo = $("[data-bonus]"); if (bo) bo.onclick = () => startSession("bonus");
    $$("[data-lib]").forEach(b => b.onclick = () => { libSkill = b.dataset.lib; view = "library"; render(); scrollTo(0, 0); });
    $$("[data-mission]").forEach(b => b.onclick = () => {
      const m = S.missions.find(x => x.key === b.dataset.mission); if (!m) return; const t = T(m.id), k = t ? t.sk : "q";
      if (m.done) { m.done = false; m.doneDate = null; addXP(k, -15); } else { m.done = true; m.doneDate = today(); addXP(k, 15); toast("Mission complete · +15 xp"); }
      save(); render();
    });
  }
  if (view === "library") {
    $$("[data-seg]").forEach(b => b.onclick = () => { libSkill = b.dataset.seg; render(); });
    $$("[data-open]").forEach(b => b.onclick = () => libDetail(b.dataset.open));
    $$("[data-opench]").forEach(b => b.onclick = () => startSession("practice", { type: "challenge", id: b.dataset.opench }));
  }
  if (view === "settings") bindSettings();
  if (view === "session") bindSession();
}
function bindSettings() {
  $("#saveKey").onclick = () => { S.settings.apiKey = $("#apikey").value.trim(); save(); toast(S.settings.apiKey ? "Key saved on this phone" : "Key cleared"); render(); };
  const ck = $("#clearKey"); if (ck) ck.onclick = () => { S.settings.apiKey = ""; save(); render(); };
  $("#voice").onchange = e => { S.settings.voice = e.target.value; save(); };
  $("#rate").oninput = e => { S.settings.rate = +e.target.value; $("#rateVal").textContent = S.settings.rate + "×"; save(); };
  $("#trans").onchange = e => { S.settings.transcript = e.target.checked; save(); };
  $("#testVoice").onclick = () => say("Here's how I'll read your scenarios. Ask, then pause, and let the silence work.");
  $("#exportBtn").onclick = async () => {
    const data = JSON.stringify(Object.assign({}, S, { settings: Object.assign({}, S.settings, { apiKey: "" }) }));
    if (await copyText(data)) toast("Backup copied. Paste it into Notes.");
    else { const box = $("#importBox"); box.hidden = false; box.value = data; box.select(); toast("Select all and copy the text below"); }
  };
  $("#importBtn").onclick = () => {
    const box = $("#importBox");
    if (box.hidden || !box.value.trim()) { box.hidden = false; box.value = ""; box.focus(); return; }
    try { const j = JSON.parse(box.value); if (!j.xp) throw 0; const key = S.settings.apiKey; S = deepMerge(blank(), j); if (!S.settings.apiKey) S.settings.apiKey = key; save(); toast("Progress restored"); view = "today"; render(); }
    catch (e) { toast("That doesn't look like a backup. Paste the whole copied text."); }
  };
  $("#resetBtn").onclick = () => { $("#resetConfirm").hidden = false; };
  $("#resetNo").onclick = () => { $("#resetConfirm").hidden = true; };
  $("#resetYes").onclick = () => { const st = S.settings; S = blank(); S.settings = st; save(); toast("Progress reset"); view = "today"; render(); };
}
function award(sks, n) { sess.gained += addXP(sks, n); }
function bindSession() {
  const sks = itemSkills(sess.item);
  $$("[data-exit]").forEach(b => b.onclick = exitSession);
  $$("[data-next]").forEach(b => b.onclick = advance);
  $$("[data-rev]").forEach(b => b.onclick = () => {
    const id = sess.reviews[sess.ri], t = T(id), r = S.reviews[id] || { int: 2, n: 0 };
    const ok = +b.dataset.rev === t.q[sess.revQi][2];
    sess.revPick = +b.dataset.rev;
    r.n = (r.n || 0) + 1;
    if (ok) { r.int = Math.min(180, Math.round(r.int * 2.5)); award(t.sk, 5); } else { r.int = 2; }
    r.due = addDays(today(), r.int); S.reviews[id] = r; save(); render();
  });
  $$("[data-quiz]").forEach(b => b.onclick = () => {
    const t = T(sess.item.id), i = +b.dataset.quiz; sess.quizPick = i;
    award(t.sk, i === t.q[0][2] ? 10 : 3); save(); render();
  });
  const ans = $("#ans"); if (ans) ans.oninput = () => { if (curStep() === "grade" && sess.item.type !== "learn") sess.transcript = ans.value; else sess.draft = ans.value; save(); };
  const dd = $("[data-drilldone]"); if (dd) dd.onclick = () => {
    sess.draft = $("#ans").value.trim();
    if (sess.draft.length < 15) { toast("Write a bit more first, even rough notes."); return; }
    S.answers[sess.item.id] = sess.draft; award(sks, 10); advance();
  };
  const sk = $("[data-skipdrill]"); if (sk) sk.onclick = () => { sess.draft = ""; sess.score = 0; sess.gradedBy = "self"; sess.step++; advance(); };
  const rb = $("#recBtn"); if (rb) rb.onclick = async () => {
    if (!Rec.on) {
      try { speechSynthesis.cancel(); } catch (e) {}
      const ok = await startRec(); if (!ok) return;
      rb.classList.add("on"); $("#recHint").textContent = "Recording… tap to stop"; $("#liveText").textContent = SR && S.settings.transcript ? "Listening…" : "Recording. Transcript is off.";
      const nb = $("[data-recdone]"); if (nb) nb.disabled = true;
    } else {
      const text = stopRec(); sess.secs = Rec.secs; sess.transcript = text; save();
      setTimeout(render, 450);
    }
  };
  const rd = $("[data-recdone]"); if (rd) rd.onclick = () => { if (sess.secs) award(sks, 10); advance(); };
  const ai = $("#aiGrade"); if (ai) ai.onclick = async () => {
    const answer = ($("#ans") ? $("#ans").value : sess.draft).trim() || sess.draft;
    if (!answer) { toast("There's nothing to grade yet. Type what you said."); return; }
    if (sess.item.type !== "learn") sess.transcript = answer;
    ai.disabled = true; $("#aiOut").innerHTML = `<p class="small muted">Grading…</p>`;
    try {
      const r = await aiGrade(sess.item, answer, sess.item.type !== "learn");
      sess.gradeText = r.text.replace(/^Score:.*\n?/i, "").trim(); sess.score = r.score ?? 3; sess.gradedBy = "ai";
      award(sks, sess.score * 5); save(); render();
    } catch (e) { ai.disabled = false; $("#aiOut").innerHTML = `<p class="small" style="color:var(--bad)">${esc(e.message || "Couldn't reach the grader. Check your connection.")}</p>`; }
  };
  const cg = $("#claudeGrade"); if (cg) cg.onclick = e => {
    const answer = ($("#ans") ? $("#ans").value : sess.draft).trim() || sess.draft;
    if (!answer) { e.preventDefault(); toast("There's nothing to grade yet. Type what you said."); return; }
    if (sess.item.type !== "learn") sess.transcript = answer;
    const p = gradePrompt(sess.item, answer, sess.item.type !== "learn");
    cg.href = "https://claude.ai/new?q=" + encodeURIComponent(p);
    copyText(p).then(ok => toast(ok ? "Prompt also copied, in case it isn't filled in." : "Opening Claude…"));
    $("#claudeScore").hidden = false; save();
  };
  $$("[data-cscore]").forEach(b => b.onclick = () => { sess.score = +b.dataset.cscore; sess.gradedBy = "claude"; sess.gradeText = ""; award(sks, sess.score * 5); save(); render(); });
  $$("[data-self]").forEach(b => b.onclick = () => { sess.score = +b.dataset.self; sess.gradedBy = "self"; award(sks, sess.score * 4); save(); render(); });
  const sr = $("#selfRub"); if (sr) sr.onclick = () => {
    const ticks = $$("[data-tick]").filter(x => x.checked).length, n = $$("[data-tick]").length;
    sess.score = Math.max(1, Math.round(ticks / n * 5)); sess.gradedBy = "self"; award(sks, sess.score * 4); save(); render();
  };
  const ma = $("[data-maccept]"); if (ma) ma.onclick = () => {
    const t = T(sess.item.id);
    S.missions = S.missions.filter(m => !(m.id === t.id && !m.done));
    S.missions.push({ key: "m" + Date.now(), id: t.id, text: t.m, date: today(), done: false });
    if (S.missions.length > 60) S.missions = S.missions.slice(-60);
    advance();
  };
  const ms = $("[data-mskip]"); if (ms) ms.onclick = advance;
}

/* ============ Boot ============ */
if (S.cur && S.cur.date !== today() && !S.cur.finished) { /* stale unfinished session from a previous day: keep item, reset reviews */ S.cur.date = today(); S.cur.reviews = []; S.cur.ri = 0; }
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "today") render(); });
