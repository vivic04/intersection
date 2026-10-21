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
const APP_VERSION = "22";
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
  mem: {}, lastMain: "new", redoRun: 0, xpDev: {}, legacyOwner: "",
  settings: { apiKey: "", provider: "anthropic", model: "", gradeApp: "claude", rate: 1, voice: "", transcript: true, ghToken: "", gistId: "", lastSync: 0 }, started: null, savedAt: 0
});
let S = blank();
try { const raw = localStorage.getItem(KEY); if (raw) S = deepMerge(blank(), JSON.parse(raw)); } catch (e) {}
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") a[k] = deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
function save() { S.savedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Couldn't save. Storage may be full."); } }

/* ============ Off-phone copies ============ */
// A shareable snapshot never includes secrets (API key, GitHub token).
function nextUpInfo() {
  try {
    const it = nextItem(), t = it.type === "challenge" ? null : T(it.id);
    const firstSentence = x => (String(x).match(/^.*?[.!?](\s|$)/) || [x])[0].trim();
    return { title: itemTitle(it), skill: itemSkills(it).map(k => SK[k].name).join(" + "), label: itemLabel(it), tip: t ? firstSentence(t.idea) : firstSentence(CH(it.id).scene) };
  } catch (e) { return null; }
}
function snapshot() { return JSON.stringify(Object.assign({}, S, { nextUp: nextUpInfo(), settings: Object.assign({}, S.settings, { apiKey: "", ghToken: "", vapidPrivate: "" }) })); }
function adopt(j) {
  const keep = { apiKey: S.settings.apiKey, ghToken: S.settings.ghToken, gistId: S.settings.gistId, lastSync: S.settings.lastSync };
  S = deepMerge(blank(), j);
  Object.assign(S.settings, keep);
  if (typeof initLedger === "function" && typeof DEVICE !== "undefined") initLedger();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}
/* ---- Multi-device: each device keeps its own XP ledger so merging never double-counts ---- */
const DEV_KEY = "intersection.device";
let DEVICE = ""; try { DEVICE = localStorage.getItem(DEV_KEY) || ""; if (!DEVICE) { DEVICE = "d" + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, DEVICE); } } catch (e) { DEVICE = "d0"; }
// XP is computed from the play history plus completed missions. Those records merge cleanly across devices
// (a union with no duplicates), so XP can never be double-counted or lost by a sync.
function deriveXP() {
  const t = { q: 0, c: 0, e: 0, n: 0, s: 0 };
  const sks = id => { const x = T(id); if (x) return [x.sk]; const c = CH(id); return c ? c.sk : []; };
  for (const h of S.history || []) { const ks = sks(h.id); if (!ks.length || !h.xp) continue; const each = Math.round(h.xp / ks.length); ks.forEach(k => t[k] = Math.max(0, t[k] + each)); }
  for (const m of S.missions || []) if (m.done && m.awarded) { const x = T(m.id); if (x) t[x.sk] += 15; }
  if (S.cur && !S.cur.finished && S.cur.gained) { const ks = sks(S.cur.item.id); ks.forEach(k => t[k] += Math.round(S.cur.gained / ks.length)); }
  return t;
}
function sumXP() { const t = { q: 0, c: 0, e: 0, n: 0, s: 0 }; for (const d of Object.values(S.xpDev || {})) for (const k in t) t[k] += d[k] || 0; S.xp = t; }
function initLedger() {
  S.xp = deriveXP(); return;
  S.xpDev = S.xpDev || {};
  if (!Object.keys(S.xpDev).length && Object.values(S.xp).some(v => v)) S.xpDev[DEVICE] = Object.assign({}, S.xp);
  S.xpDev[DEVICE] = S.xpDev[DEVICE] || { q: 0, c: 0, e: 0, n: 0, s: 0 };
  sumXP();
}
S.missions.forEach(m => { if (m.done && m.awarded === undefined) m.awarded = true; });
for (const [id, r] of Object.entries(S.mem || {})) if (r.fives === undefined) r.fives = (S.history || []).filter(h => h.id === id && h.score === 5).length;
initLedger();
// Merge another device's progress into this one: union of history, latest of each record, never losing plays.
function mergeStates(L, R) {
  const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const M = JSON.parse(JSON.stringify(L));
  for (const [d, n] of Object.entries(R.log || {})) M.log[d] = Math.max(M.log[d] || 0, n);
  for (const f of ["learned", "spoken", "chDone"]) { M[f] = M[f] || {}; for (const [k, v] of Object.entries(R[f] || {})) M[f][k] = maxDate(M[f][k], v); }
  const better = (a, b) => (!a ? b : !b ? a : ((b.n || 0) > (a.n || 0) || ((b.n || 0) === (a.n || 0) && (b.at || b.due || "") > (a.at || a.due || ""))) ? b : a);
  for (const f of ["mem", "reviews"]) { M[f] = M[f] || {}; for (const [k, v] of Object.entries(R[f] || {})) M[f][k] = better(M[f][k], v); }
  M.answers = Object.assign({}, R.answers || {}, M.answers || {});
  const ms = new Map((M.missions || []).map(m => [m.key, m]));
  for (const m of R.missions || []) { const a = ms.get(m.key); if (!a || (m.done && !a.done)) ms.set(m.key, m); }
  M.missions = [...ms.values()].sort((a, b) => (a.key > b.key ? 1 : -1)).slice(-500);
  const hk = h => [h.d, h.type, h.id, h.xp, h.score, h.kind, h.at || ""].join("|");
  const hs = new Map((M.history || []).map(h => [hk(h), h])); for (const h of R.history || []) if (!hs.has(hk(h))) hs.set(hk(h), h);
  M.history = [...hs.values()].sort((a, b) => (a.d > b.d ? 1 : a.d < b.d ? -1 : 0)).slice(-5000);
  M.xpDev = M.xpDev || {};
  for (const [dev, x] of Object.entries(R.xpDev || {})) { if (dev === DEVICE) continue; const a = M.xpDev[dev] || {}; M.xpDev[dev] = {}; for (const k of ORDER) M.xpDev[dev][k] = Math.max(a[k] || 0, x[k] || 0); }
  // A pre-multi-device backup carries one unnamed XP ledger. The device it came from claims it (legacyOwner) and from then on
  // its own named ledger replaces it everywhere, so it's never counted twice or dropped by guesswork.

  M.pos = Math.max(M.pos || 0, R.pos || 0);
  if (!M.started || (R.started && R.started < M.started)) M.started = R.started;
  if ((R.savedAt || 0) > (M.savedAt || 0)) { M.lastMain = R.lastMain; M.redoRun = R.redoRun; }
  M.savedAt = Math.max(M.savedAt || 0, R.savedAt || 0);
  return M;
}

// Cloud copy: a private GitHub Gist under the user's own account.
const GIST_FILE = "intersection-progress.json", GIST_DESC = "Intersection app progress (auto-synced)";
function gh(path, opts = {}) {
  return fetch("https://api.github.com" + path, Object.assign({}, opts, { headers: Object.assign({ "Authorization": "Bearer " + S.settings.ghToken.trim(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, opts.headers || {}) }));
}
async function ghConnect() {
  const me = await gh("/user"); if (!me.ok) throw new Error(me.status === 401 ? "GitHub rejected that token. Check it and try again." : "Couldn't reach GitHub (" + me.status + ").");
  let id = "";
  const list = await gh("/gists?per_page=100"); if (list.ok) { const gs = await list.json(); const g = gs.find(x => x.files && x.files[GIST_FILE]); if (g) id = g.id; }
  if (!id) {
    const r = await gh("/gists", { method: "POST", body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: snapshot() } } }) });
    if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? "The token needs the 'gist' permission." : "Couldn't create the backup (" + r.status + ").");
    id = (await r.json()).id;
  }
  S.settings.gistId = id; save();
  return syncPull(true);
}
let syncTimer = null, syncing = false;
function syncSoon() { if (!S.settings.ghToken || !S.settings.gistId) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncPush, 1500); }
async function syncPush() {
  if (!S.settings.ghToken || !S.settings.gistId || syncing) return;
  syncing = true;
  try {
    const r = await gh("/gists/" + S.settings.gistId, { method: "PATCH", keepalive: true, body: JSON.stringify({ files: { [GIST_FILE]: { content: snapshot() } } }) });
    if (r.ok) { S.settings.lastSync = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  } catch (e) {} finally { syncing = false; }
  if (view === "settings") render();
}
// On open: if the cloud copy is newer (e.g. new phone or reinstall), use it; otherwise upload ours.
async function syncPull(announce) {
  if (!S.settings.ghToken || !S.settings.gistId) return;
  try {
    const r = await gh("/gists/" + S.settings.gistId, { cache: "no-store" }); if (!r.ok) return;
    const g = await r.json(), f = g.files && g.files[GIST_FILE]; if (!f) return;
    let content = f.content;
    if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
    const remote = JSON.parse(content);
    if (!remote.xp) { await syncPush(); return; }
    // Older backups (before multi-device) have no XP ledger: treat their XP as one other device.
    if (!remote.xpDev || !Object.keys(remote.xpDev).length) {
      remote.xpDev = { legacy: remote.xp };
    }
    const before = JSON.stringify([S.log, S.pos, S.xpDev, Object.keys(S.mem).length]);
    const keepSettings = S.settings, keepCur = S.cur, keepTree = S.treeSeen;
    const hadLocal = Object.keys(S.log).length > 0;
    let merged = mergeStates(S, remote);
    S = deepMerge(blank(), merged); S.settings = keepSettings; S.cur = keepCur; S.treeSeen = keepTree;
    initLedger();
    S.xp = deriveXP();
    S.settings.lastSync = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    const changed = before !== JSON.stringify([S.log, S.pos, S.xpDev, Object.keys(S.mem).length]);
    if (changed && view !== "session") render();
    await syncPush();
    if (announce) toast(changed ? "Synced with your other devices" : "Cloud backup connected");
  } catch (e) {}
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

/* ============ Helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const dkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => dkey(new Date());
const addDays = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return dkey(d); };
// Level k spans 100 + 50·(k−1) XP, so early bars move steadily (a +15 mission is ~15% of level 1, not 60%).
const lvlFloor = L => 100 * (L - 1) + 25 * (L - 1) * (L - 2);
const lvl = xp => { let L = 1; while (lvlFloor(L + 1) <= xp) L++; return L; };
const rank = L => L >= 11 ? "Master" : L >= 8 ? "Expert" : L >= 5 ? "Practitioner" : L >= 3 ? "Apprentice" : "Novice";
function lvlPct(xp) { const L = lvl(xp), a = lvlFloor(L), b = lvlFloor(L + 1); return Math.round((xp - a) / (b - a) * 100); }
function streak() { let d = today(), n = 0; if (!S.log[d]) d = addDays(d, -1); while (S.log[d]) { n++; d = addDays(d, -1); } return n; }
function bestStreak() { const ks = Object.keys(S.log).sort(); let best = 0, run = 0, prev = null; for (const k of ks) { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; } return best; }
function toast(t) { const el = $("#toast"); if (!el.hidden && el.querySelector(".undo")) { setTimeout(() => toast(t), 5200); return; } el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function addXP(sks, n) { const list = Array.isArray(sks) ? sks : [sks]; const each = Math.round(n / list.length);
  { const before0 = Object.fromEntries(list.map(k => [k, lvl(S.xp[k] || 0)])); list.forEach(k => S.xp[k] = Math.max(0, (S.xp[k] || 0) + each));
    setTimeout(() => list.forEach(k => { const L = lvl(S.xp[k] || 0); if (L > before0[k]) toast(`🎉 ${SK[k].name} reached Level ${L} · ${rank(L)}`); }), 0); return n; }
  const before = Object.fromEntries(list.map(k => [k, lvl(S.xp[k] || 0)]));
  setTimeout(() => list.forEach(k => { const L = lvl(S.xp[k] || 0); if (L > before[k]) toast(`🎉 ${SK[k].name} reached Level ${L} · ${rank(L)}`); }), 0); const mine = (S.xpDev = S.xpDev || {})[DEVICE] || (S.xpDev[DEVICE] = { q: 0, c: 0, e: 0, n: 0, s: 0 }); list.forEach(k => mine[k] = Math.max(0, (mine[k] || 0) + each)); sumXP(); return n; }
function seeded(seed) { let x = Math.abs(seed) % 2147483647 || 7; return () => (x = x * 16807 % 2147483647) / 2147483647; }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
function itemSkills(item) { return item.type === "challenge" ? CH(item.id).sk : [T(item.id).sk]; }
function itemTitle(item) { return item.type === "challenge" ? CH(item.id).t : T(item.id).t; }
const typeLabel = { learn: "Learn + drill", speak: "Speaking drill", challenge: "Intersection challenge", mastery: "Mastery round", redo: "Strengthen" };
function itemLabel(item) {
  if (item.redo) { const r = S.mem[item.id]; return "Strengthen" + (item.v ? " · " + VARY_LABEL[item.v] : "") + (r && r.last ? " · last " + r.last + "/5" : ""); }
  return typeLabel[item.mastery ? "mastery" : item.type];
}

/* ============ Speech (TTS) ============ */
let voices = [];
// iOS ships joke voices (Bells, Bubbles, Zarvox…) and low-quality "compact" voices. Keep only real English voices.
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/i;
function loadVoices() { try { voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang) && !NOVELTY.test(v.name)); } catch (e) {} }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); if (view === "settings") render(); }; }
function pickVoice() {
  if (!voices.length) loadVoices();
  const rank = v => (/premium/i.test(v.name) ? 3 : /enhanced/i.test(v.name) ? 2 : 0) + (/en-US/i.test(v.lang) ? 1 : 0) + (/Ava|Samantha|Zoe|Evan|Nathan|Allison/i.test(v.name) ? 0.5 : 0);
  return voices.slice().sort((a, b) => rank(b) - rank(a))[0];
}
// iOS: web audio is muted by the silent switch unless the audio session is "playback".
function setAudioSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} }
let ttsActive = false, ttsUtt = null, ttsCheck = null;
function say(text, btn) {
  if (!("speechSynthesis" in window)) { toast("This browser can't read aloud."); return; }
  const synth = window.speechSynthesis;
  if (ttsActive) { ttsActive = false; synth.cancel(); $$(".speakbtn").forEach(b => b.classList.remove("on")); return; }
  setAudioSession("playback");
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  ttsUtt = u; // keep a reference: iOS can drop utterances that get garbage-collected
  const v = pickVoice(); if (v) u.voice = v;
  u.lang = v ? v.lang : "en-US"; u.rate = S.settings.rate || 1; u.volume = 1;
  let started = false;
  u.onstart = () => { started = true; ttsActive = true; if (btn) btn.classList.add("on"); };
  u.onend = u.onerror = () => { ttsActive = false; if (btn) btn.classList.remove("on"); };
  ttsActive = true;
  synth.speak(u);
  try { synth.resume(); } catch (e) {}
  clearTimeout(ttsCheck);
  ttsCheck = setTimeout(() => { if (!started && !synth.speaking) { ttsActive = false; toast("No sound? Check your volume, or turn off Silent mode, then tap Listen again."); } }, 2500);
}
const speakIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const listenBtn = (id, label = "Listen") => `<button class="speakbtn" data-say="${id}" data-label="${label}">${speakIcon}<span class="t mono">${label}</span></button>`;
const sayTexts = {}, sayClips = {};
const NARRATORS = { heart: { name: "Heart · warm, female", dir: "" }, michael: { name: "Michael · calm, male", dir: "m" } };
// Pre-recorded narration (audio/<key>.mp3). Plays through Silent mode; falls back to the device voice if a clip is missing.
const player = new Audio(); player.preload = "none";
let playerBtn = null;
function clearPlaying() { $$(".speakbtn").forEach(b => { b.classList.remove("on"); const sp = b.querySelector(".t"); if (sp) sp.textContent = b.dataset.label; }); playerBtn = null; }
player.onended = player.onpause = clearPlaying;
// Show elapsed time on the button so it's obvious whether audio is actually playing
player.ontimeupdate = () => { if (playerBtn) { const sp = playerBtn.querySelector(".t"); if (sp) sp.textContent = fmtTime(Math.floor(player.currentTime)) + " / " + (isFinite(player.duration) ? fmtTime(Math.floor(player.duration)) : "…"); } };
function playClip(key, text, btn) {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (playerBtn === btn && !player.paused) { player.pause(); return; }
  setAudioSession("playback");
  clearPlaying();
  const nar = NARRATORS[S.settings.narrator] || NARRATORS.heart;
  let triedDefault = !nar.dir;
  player.onerror = () => {
    if (!triedDefault) { triedDefault = true; player.src = "audio/" + key + ".mp3"; player.play().catch(() => {}); return; }
    clearPlaying(); say(text, btn);
  };
  player.src = "audio/" + (nar.dir ? nar.dir + "/" : "") + key + ".mp3";
  player.defaultPlaybackRate = player.playbackRate = S.settings.rate || 1;
  playerBtn = btn; if (btn) btn.classList.add("on");
  const p = player.play();
  if (p && p.catch) p.catch(err => { if (err && err.name === "NotAllowedError") { clearPlaying(); toast("Tap Listen again to play."); } });
}

/* ============ Recording ============ */
const Rec = { stream: null, mr: null, chunks: [], url: null, recog: null, final: "", interim: "", t0: 0, timer: null, secs: 0, on: false };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
async function startRec() {
  Rec.final = ""; Rec.interim = ""; Rec.secs = 0; Rec.chunks = [];
  if (Rec.url) { URL.revokeObjectURL(Rec.url); Rec.url = null; }
  try {
    setAudioSession("play-and-record");
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
      // iOS ends recognition often; restart gently, never in a tight loop
      r.onend = () => {
        if (!Rec.on || Rec.recog !== r) return;
        const now = Date.now();
        if (Rec.restarts >= 6 || now - (Rec.lastRestart || 0) < 1500) return;
        Rec.restarts++; Rec.lastRestart = now;
        setTimeout(() => { if (Rec.on && Rec.recog === r) { try { r.start(); } catch (e) {} } }, 300);
      };
      r.start();
    } catch (e) { Rec.recog = null; }
  }
  Rec.on = true; Rec.t0 = Date.now(); Rec.restarts = 0;
  clearTimeout(Rec.cap); Rec.cap = setTimeout(() => { if (Rec.on) finishRecording(); }, 180000);
  Rec.timer = setInterval(() => { Rec.secs = Math.round((Date.now() - Rec.t0) / 1000); const t = $("#recTime"); if (t) t.textContent = fmtTime(Rec.secs); }, 250);
  return true;
}
function finishRecording() {
  clearTimeout(Rec.cap);
  const text = stopRec();
  if (sess) { sess.secs = Rec.secs; sess.transcript = text; save(); }
  if (view === "session") render();
}
function stopRec() {
  Rec.on = false; clearInterval(Rec.timer);
  Rec.secs = Math.max(1, Math.round((Date.now() - Rec.t0) / 1000));
  try { Rec.mr && Rec.mr.state !== "inactive" && Rec.mr.stop(); } catch (e) {}
  try { Rec.recog && Rec.recog.stop(); } catch (e) {}
  setTimeout(() => { try { Rec.stream && Rec.stream.getTracks().forEach(t => t.stop()); } catch (e) {} setAudioSession("playback"); }, 300);
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
  const d = variantScene(item);
  return { skill: SK[t.sk].name, technique: t.t + " (" + t.src + ")", idea: t.idea, task: d.scene + "\nTask: " + d.ask, rubric: d.rub, model: d.model };
}
function gradePrompt(item, answer, spoken) {
  const g = gradeContext(item);
  return `You're a demanding but encouraging coach helping a young professional (works in AI strategy, aiming for AI product management) master the skill: ${g.skill}.
Technique: ${g.technique}
${g.idea ? "Core idea: " + g.idea + "\n" : ""}Exercise: ${g.task}
Rubric: ${g.rubric.map((r, i) => (i + 1) + ") " + r).join("  ")}
${g.model ? "Reference answer (one good version, not the only one): " + g.model : "There is no reference answer for this one; judge it against the rubric and the technique."}

My ${spoken ? "spoken answer (speech-to-text transcript, so ignore small transcription errors)" : "answer"}:
"""${answer}"""

Grade me honestly against the rubric. Reply in this exact format, plain text, under 150 words:
Score: N/5
What worked: one sentence.
Fix: the single most important improvement.
Stronger version: my answer rewritten, as short as possible.`;
}
// Instant in-app grading with any provider's API key (the key stays on this phone).
const PROVIDERS = {
  anthropic: { name: "Anthropic (Claude)", model: MODEL, ph: "sk-ant-…", where: "console.anthropic.com → API keys" },
  openai: { name: "OpenAI (ChatGPT)", model: "gpt-4o-mini", ph: "sk-…", where: "platform.openai.com → API keys" },
  gemini: { name: "Google (Gemini)", model: "gemini-2.0-flash", ph: "AIza…", where: "aistudio.google.com → Get API key (has a free tier)" },
  openrouter: { name: "OpenRouter (any model)", model: "openai/gpt-4o-mini", ph: "sk-or-…", where: "openrouter.ai → Keys" }
};
// Grade in an app you already pay for: opens it with the prompt filled in where the app supports that, and copies it either way.
const GRADE_APPS = {
  claude: { name: "Claude", url: q => "https://claude.ai/new?q=" + encodeURIComponent(q) },
  chatgpt: { name: "ChatGPT", url: q => "https://chatgpt.com/?q=" + encodeURIComponent(q) },
  gemini: { name: "Gemini", url: () => "https://gemini.google.com/app", paste: true },
  perplexity: { name: "Perplexity", url: q => "https://www.perplexity.ai/search?q=" + encodeURIComponent(q) },
  copilot: { name: "Copilot", url: () => "https://copilot.microsoft.com/", paste: true }
};
const prov = () => PROVIDERS[S.settings.provider] || PROVIDERS.anthropic;
const gradeModel = () => (S.settings.model || "").trim() || prov().model;
async function aiGrade(item, answer, spoken) {
  const text = await aiText(gradePrompt(item, answer, spoken));
  const m = text.match(/Score:\s*([0-5](?:\.\d)?)/i);
  return { text, score: m ? Math.round(+m[1]) : null };
}
let freshBusy = false;
async function genFresh() {
  if (freshBusy || !sess) return; freshBusy = true;
  const s0 = sess, t = T(s0.item.id);
  const used = [t.scene].concat((IX.vars[t.id] || []).map(v => v[0])).concat(s0.prevFresh || []);
  const settings = ["a job interview", "a family or friendship situation", "a side project or app you're building", "a meeting with senior leaders", "a peer at work", "a landlord, vendor or service provider", "a networking event", "a team you lead"];
  const where = settings[(hash(t.id + today()) >>> 0) % settings.length];
  const prompt = `Write one short, realistic practice scenario for the communication technique "${t.t}" (${t.src}). Core idea: ${t.idea}
Setting: ${where}. The person practising is a young professional in Toronto who works in AI strategy at a bank and is working toward an AI product management role.
It must be clearly different from these: ${used.join(" | ")}
Reply with only JSON: {"scene": "1–2 sentences, second person, concrete details", "ask": "one sentence telling them what to say out loud"}`;
  try {
    const raw = await aiText(prompt, 300);
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!j.scene || !j.ask) throw 0;
    if (sess === s0) { s0.fresh = { scene: String(j.scene), ask: String(j.ask) }; save(); render(); }
  } catch (e) {
    if (sess === s0) { s0.item.v = "v0"; toast("Couldn't write a fresh scenario, so here's a new one from the library."); save(); render(); }
  } finally { freshBusy = false; }
}
async function aiText(prompt, maxTokens = 500) {
  const key = S.settings.apiKey.trim(), P = S.settings.provider || "anthropic", model = gradeModel();
  let url, opts;
  if (P === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    opts = { headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }) };
  } else if (P === "gemini") {
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
    opts = { headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens + 100 } }) };
  } else {
    url = P === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    opts = { headers: { "content-type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }) };
  }
  const res = await fetch(url, Object.assign({ method: "POST" }, opts));
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = (j.error && (j.error.message || j.error)) || ""; } catch (e) {}
    let msg = "The grader returned an error (" + res.status + ")" + (detail ? ": " + detail : ".");
    if (res.status === 401 || res.status === 403) msg = "Your " + prov().name + " key was rejected. Check it in Settings.";
    if (res.status === 429) msg = "Rate limited or out of credit. Wait a minute, or check your balance with " + prov().name + ".";
    if (res.status === 404) msg = "Model \"" + model + "\" wasn't found. Change the model name in Settings.";
    throw new Error(msg);
  }
  const j = await res.json();
  let text = "";
  if (P === "anthropic") text = (j.content || []).map(b => b.text || "").join("");
  else if (P === "gemini") text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("");
  else text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  return text.trim();
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }

/* ============ Daily notification ============ */
// The phone subscribes to push; the subscription + chosen time go into the private gist.
// A scheduled GitHub Action in the app's repo reads it and sends one nudge a day, skipping days you've already played.
const PUSH_FILE = "intersection-push.json";
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = str => { const b = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
async function writePushFile(extra) {
  const st = S.settings;
  const body = Object.assign({ enabled: !!st.notifOn, hour: st.notifHour ?? 9, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, vapidPublic: st.vapidPublic, vapidPrivate: st.vapidPrivate, subscription: st.pushSub || null }, extra || {});
  const r = await gh("/gists/" + st.gistId, { method: "PATCH", body: JSON.stringify({ files: { [PUSH_FILE]: { content: JSON.stringify(body) } } }) });
  if (!r.ok) throw new Error("Couldn't save the notification setting to your cloud backup (" + r.status + ").");
}
async function enableNotifications() {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications. Open Intersection from its home-screen icon (iOS 16.4 or newer).");
  if (!S.settings.ghToken || !S.settings.gistId) throw new Error("Turn on Cloud backup first. Notifications use it to know when you've played.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked. Allow them in iPhone Settings → Notifications → Intersection.");
  const st = S.settings;
  if (!st.vapidPublic || !st.vapidPrivate) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    st.vapidPublic = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    st.vapidPrivate = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) { const k = sub.options && sub.options.applicationServerKey; if (k && b64u(k) !== st.vapidPublic) { await sub.unsubscribe(); sub = null; } }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(st.vapidPublic) });
  st.pushSub = sub.toJSON(); st.notifOn = true; if (st.notifHour == null) st.notifHour = 9;
  save(); await writePushFile(); syncPush();
}
async function disableNotifications() {
  S.settings.notifOn = false; save();
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) {}
  S.settings.pushSub = null; save();
  try { await writePushFile({ enabled: false, subscription: null }); } catch (e) {}
}
const fmtHour = h => (h % 12 || 12) + (h < 12 ? " am" : " pm");

/* ============ Mastery model ============ */
// Each technique/challenge has a strength (0–100) and a due date. Your grades move both:
// weak answers come back within a day or two; strong ones get spaced further and further apart.
const MASTERED = 80, WEAK = 60;
function memOf(id) { return S.mem[id]; }
function applyGrade(id, score) {
  if (!id || score == null) return;
  const sc = Math.max(1, Math.min(5, Math.round(score)));
  const r = S.mem[id] || { m: 0, int: 0, n: 0 };
  r.m = r.n ? Math.round(0.55 * r.m + 0.45 * sc * 20) : sc * 20;
  if (sc === 5) r.fives = (r.fives || 0) + 1;
  r.n++; r.last = sc; r.at = today();
  // Until it's mastered, a technique keeps coming back within a week. Only mastered ones get spaced out to months.
  if (isMastered(r)) r.int = Math.min(120, Math.max(10, Math.round((r.int || 5) * 2.5)));
  else r.int = sc <= 2 ? 1 : sc === 3 ? 3 : sc === 4 ? 4 : 6;
  r.due = addDays(today(), r.int);
  S.mem[id] = r;
}
function nudge(id, ok) { // quick quiz reviews nudge strength without overriding drill grades
  const r = S.mem[id]; if (!r) return;
  r.m = Math.max(0, Math.min(100, r.m + (ok ? 4 : -12)));
  if (!ok) { r.due = addDays(today(), 1); r.int = 1; }
}
// Mastered = two 5/5 answers (revisits rotate scenarios, so these are on different situations) and your latest attempt is still 4+.
const FIVES_TO_MASTER = 2;
function isMastered(r) { return !!r && (r.fives || 0) >= FIVES_TO_MASTER && (r.last || 0) >= 4; }
function memStatus(id) {
  const r = S.mem[id];
  if (!r) return S.learned[id] ? { label: "Learned", cls: "" } : { label: "New", cls: "" };
  if (isMastered(r)) return { label: "Mastered", cls: "good" };
  if ((r.fives || 0) >= 1 && (r.last || 0) >= 4) return { label: "★ 1 of 2", cls: "ok" };
  if (r.m >= WEAK) return { label: "Solid", cls: "ok" };
  return { label: "Needs work", cls: "weak" };
}
function dueStrengthen() {
  return Object.entries(S.mem).filter(([, r]) => r.due <= today())
    .sort((a, b) => a[1].m - b[1].m || a[1].due.localeCompare(b[1].due)).map(([id, r]) => ({ id, r }));
}
// Revisits rotate through different formats so you practise the skill, not the memory of one answer.
const VARY_LABEL = { orig: "Original scenario", v0: "New scenario", v1: "New scenario", teach: "Teach it back", real: "Real-life rehearsal", fresh: "Fresh AI scenario" };
// Mostly new scenarios (9 per technique, cycled least-recent first), with a teach-back and a real-life rehearsal mixed in.
function varyCycle() { return S.settings.apiKey ? ["v", "v", "teach", "v", "fresh", "v", "real", "v", "orig"] : ["v", "v", "teach", "v", "v", "real", "v", "orig"]; }
function nextVariant(id) { const n = (IX.vars[id] || []).length, r = S.mem[id]; return n ? "v" + (((r && r.vp) || 0) % n) : "orig"; }
function strengthenItem(id) {
  if (id.startsWith("x")) return { type: "challenge", id, redo: true };
  const r = S.mem[id], cyc = varyCycle(), f = cyc[((r && r.vi) || 0) % cyc.length];
  return { type: "speak", id, redo: true, v: f === "v" ? nextVariant(id) : f };
}
function variantScene(item) {
  const t = T(item.id), v = item.v || "orig";
  const base = { id: t.id, label: VARY_LABEL[v] || "Scenario" };
  if (v[0] === "v" && IX.vars[t.id] && IX.vars[t.id][+v.slice(1)]) {
    const [scene, ask] = IX.vars[t.id][+v.slice(1)];
    return Object.assign(base, { scene, ask, rub: t.steps.concat(["Fits this specific situation rather than a generic answer"]), model: null, clip: t.id + "_" + v });
  }
  if (v === "teach") return Object.assign(base, { scene: `A friend has never heard of "${t.t}". Explain it so they could use it tomorrow.`, ask: "In under 45 seconds: what it is, when to use it, and one example from your own life.", rub: ["Explains the core idea accurately, in plain words", "Says when it's most useful", "Gives a concrete example of your own, not the lesson's"], model: null, clip: t.id + "_teach" });
  if (v === "real") return Object.assign(base, { scene: `Think of a real conversation, decision or message coming up in the next week where "${t.t}" applies.`, ask: "Say who it's with and what's at stake, then rehearse the exact words you'll use.", rub: t.steps.concat(["Uses real, specific words you'd actually say"]), model: null, clip: t.id + "_real" });
  if (v === "fresh") {
    const f = (sess && sess.item === item && sess.fresh) || {};
    return Object.assign(base, { scene: f.scene || "", ask: f.ask || "", rub: t.steps.concat(["Fits this specific situation rather than a generic answer"]), model: null, clip: null, pending: !f.scene });
  }
  return Object.assign(base, { scene: t.scene, ask: t.ask, rub: t.rub, model: t.model, clip: t.id + "_scene", label: "Original scenario" });
}
// Backfill strength from earlier grades for anyone who started before this existed
(function migrateMem() {
  if (Object.keys(S.mem).length) return;
  for (const h of S.history) if (h.score != null && h.score > 0 && (T(h.id) || CH(h.id))) applyGrade(h.id, h.score);
  for (const id of Object.keys(S.learned)) if (!S.mem[id]) S.mem[id] = { m: 40, int: 2, n: 0, due: today() };
})();

/* ============ Session engine ============ */
let view = "today", sess = null, libSkill = "q", missionLogAll = false;
function newSession(kind, item) {
  const s = { kind, date: today(), item, step: 0, gained: 0, reviews: [], ri: 0, draft: "", transcript: "", secs: 0, quizPick: null, revPick: null, score: null, gradeText: "", rubTicks: [], gradedBy: null, showModel: false };
  if (kind === "daily") {
    const due = Object.entries(S.reviews).filter(([, r]) => r.due <= today()).sort((a, b) => a[1].due.localeCompare(b[1].due)).slice(0, 2).map(([id]) => id);
    s.reviews = due;
  }
  return s;
}
function nextItem() {
  const due = dueStrengthen();
  const weakDue = due.filter(d => d.r.m < WEAK);
  if (S.pos < QUEUE.length) {
    // Mix: after a new session, revisit something due; a growing backlog of weak items gets priority,
    // but never more than 2 strengthen sessions in a row so new material keeps flowing.
    const wantRedo = due.length && (S.lastMain === "new" || (weakDue.length >= 4 && S.redoRun < 2));
    if (wantRedo) return strengthenItem((weakDue[0] || due[0]).id);
    return QUEUE[S.pos];
  }
  if (due.length) return Object.assign(strengthenItem(due[0].id), { mastery: true });
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
  if (S.settings.ghToken && S.settings.gistId && Date.now() - (S.settings.lastSync || 0) > 60000) syncPull(false);
  if (Rec.url) { URL.revokeObjectURL(Rec.url); Rec.url = null; }
  if (kind !== "practice" && S.cur && !S.cur.finished && S.cur.date === today()) { sess = S.cur; }
  else { sess = newSession(kind, item || nextItem()); if (kind !== "practice") S.cur = sess; }
  if (!S.started) S.started = today();
  save(); view = "session"; render(); scrollTo(0, 0);
}
function curStep() { if (sess.ri < sess.reviews.length) return "review"; return stepsFor(sess.item)[sess.step] || "done"; }
function advance() {
  try { speechSynthesis.cancel(); player.pause(); } catch (e) {}
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
  if (sess.score != null) applyGrade(it.id, sess.score || 1);
  if (it.v && S.mem[it.id]) {
    if (!it.direct) S.mem[it.id].vi = (S.mem[it.id].vi || 0) + 1;
    if (/^v\d+$/.test(it.v)) S.mem[it.id].vp = (S.mem[it.id].vp || 0) + 1;
  } else if (it.v && /^v\d+$/.test(it.v)) S.mem[it.id] = Object.assign(S.mem[it.id] || { m: 0, int: 1, n: 0, due: today() }, { vp: 1 });
  else if (it.type === "learn" && !S.mem[it.id]) S.mem[it.id] = { m: sess.quizPick === T(it.id).q[0][2] ? 35 : 20, int: 1, n: 0, due: addDays(d, 1) };
  if (sess.kind !== "practice") {
    if (it.redo) { S.lastMain = "redo"; S.redoRun = (S.redoRun || 0) + 1; }
    else { S.lastMain = "new"; S.redoRun = 0; }
  }
  if (sess.kind !== "practice" && !it.redo && !it.mastery && QUEUE[S.pos] && QUEUE[S.pos].id === it.id && QUEUE[S.pos].type === it.type) sess.advanced = true;
  if (sess.kind !== "practice" && !it.redo && !it.mastery && QUEUE[S.pos] && QUEUE[S.pos].id === it.id && QUEUE[S.pos].type === it.type) S.pos++;
  S.log[d] = (S.log[d] || 0) + 1;
  S.history.push({ d, type: it.type, id: it.id, xp: sess.gained, score: sess.score, kind: sess.kind, adv: !!sess.advanced, at: Date.now() });
  if (S.history.length > 5000) S.history = S.history.slice(-5000);
  sess.finished = true;
  syncSoon();
}
function exitSession() {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (Rec.on) stopRec();
  ttsActive = false; try { player.pause(); } catch (e) {}
  if (sess && sess.finished && S.cur === sess) S.cur = null;
  syncSoon();
  sess = null; view = "today"; save(); render(); scrollTo(0, 0);
}

/* ============ Views ============ */
function render() {
  document.body.classList.toggle("insession", view === "session");
  $$(".tabs button").forEach(b => b.classList.toggle("sel", b.dataset.tab === view));
  const app = $("#app");
  app.className = "app v-" + view;
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
  const open = S.missions.filter(m => !m.done).reverse();
  const doneN = S.missions.filter(m => m.done).length;
  const minK = ORDER.reduce((m, k) => S.xp[k] < S.xp[m] ? k : m, "q");
  const dayN = Math.min(S.pos + 1, QUEUE.length);
  const iosLike = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const install = !isStandalone() && iosLike ? `<div class="install"><b>Install on your iPhone</b><p class="small muted">In Safari, tap Share, then "Add to Home Screen". It'll open full-screen like a normal app and work offline.</p></div>` : "";
  let heroBody;
  if (doneToday && !resume) {
    heroBody = `<div class="eyebrow">Today · done</div><h2>Nice. Today's play is done.</h2>
      <p class="small" style="opacity:.8">Up next: ${esc(itemTitle(item))} · ${itemLabel(item)}</p>
      <div class="btnrow"><button class="btn" data-bonus>Run a bonus play</button></div>`;
  } else {
    heroBody = `<div class="eyebrow">${resume ? "Resume today's play" : "Today's play"} · ${item.redo ? "Revisit" : "Play " + (item.mastery ? "∞" : dayN) + " of " + QUEUE.length}</div>
      <h2>${esc(itemTitle(item))}</h2>
      <div class="chips">${sks.map(k => `<span class="chip" style="--k:var(--${k});background:color-mix(in srgb,var(--${k}) 30%,transparent);color:var(--bg)">${SK[k].name}</span>`).join("")}</div>
      <div class="meta"><span>${itemLabel(item)}</span><span>~5 min</span>${dueN ? `<span>+ ${Math.min(2, dueN)} quick review${dueN > 1 ? "s" : ""}</span>` : ""}</div>
      <button class="btn" data-start>${resume ? "Continue play" : "Start play"}</button>`;
  }
  return `
  <header class="top">
    <div><div class="eyebrow">${esc(dateStr)}</div><h1>Intersection</h1></div>
    <div class="streak">${flame}<b class="mono">${streak()}</b></div>
  </header>
  <section class="hero"><div class="ring">${rings(150, false)}</div>${heroBody}</section>
  <section class="panel treepanel"><canvas id="tree" aria-label="Your growth tree: one branch per skill, a leaf per technique learned, a blossom per technique mastered"></canvas>
    <div class="row2"><span class="small muted">${Tree.caption()}</span><button class="link small" id="treeReplay" style="white-space:nowrap">↻ Replay</button></div></section>
  ${install}
  <section class="panel skillspanel">
    <div class="row2"><h3>Your five skills</h3><span class="small muted">Weakest: <b style="color:var(--${minK})">${SK[minK].name}</b></span></div>
    <div class="ledger">${ORDER.map(k => { const xp = S.xp[k], L = lvl(xp);
      return `<button class="lrow" style="--k:var(--${k})" data-lib="${k}"><span class="name"><i></i>${SK[k].name}</span><span class="lv"><span class="mono">L${L}</span> · ${rank(L)}</span><span class="bar"><span style="width:${lvlPct(xp)}%"></span></span></button>`; }).join("")}</div>
  </section>
  <section class="panel missionspanel">
    <div class="row2"><h3>Field missions</h3><span class="small muted">+15 xp each</span></div>
    ${open.length ? open.map(m => { const t = T(m.id); const k = t ? t.sk : "q";
      return `<button class="mission" style="--k:var(--${k})" data-mission="${esc(m.key)}"><span class="box"></span><span><span class="txt">${esc(m.text)}</span><small>${SK[k].name} · ${esc(t ? t.t : "")}${m.date && m.date !== today() ? " · from " + new Date(m.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""}</small></span></button>`; }).join("")
      : `<p class="small muted">${doneN ? "All caught up. New missions arrive with each Learn play." : "Finish a Learn play to get a real-world mission to try that day."}</p>`}
    ${doneN ? `<button class="link small" data-gomissions style="align-self:flex-start">Mission log · ${doneN} done →</button>` : ""}
  </section>`;
}

function libraryView() {
  const k = libSkill, list = IX.lib.filter(l => l.sk === k);
  const chs = IX.ch.filter(c => c.sk.includes(k));
  let html = `<header><div class="eyebrow">${IX.lib.length} techniques · ${IX.ch.length} challenges</div><h1>Library</h1></header>
  <div class="seg" style="--k:var(--${k})">${ORDER.map(s => `<button class="${s === k ? "sel" : ""}" style="--k:var(--${s})" data-seg="${s}">${SK[s].name}</button>`).join("")}</div>
  <p class="muted small">Practise anything here any time. Practice earns XP but doesn't move your daily path forward.</p>`;
  for (let tier = 1; tier <= 3; tier++) {
    html += `<section class="panel tierpanel" style="--k:var(--${k})"><div class="eyebrow tier">${TIER[tier]}</div><div>`;
    list.filter(l => l.tier === tier).forEach(l => {
      const st = memStatus(l.id), r = S.mem[l.id];
      html += `<button class="lesson" data-open="${l.id}"><span class="t">${esc(l.t)}</span><span class="s">${esc(l.src)}</span><span class="st"><span class="pill ${st.cls}">${st.label}</span>${r ? `<span class="minibar"><span style="width:${r.m}%"></span></span>` : ""}</span></button>`;
    });
    html += `</div></section>`;
  }
  html += `<section class="panel chpanel" style="--k:var(--${k})"><div class="eyebrow tier">Intersection challenges</div><div class="chgrid">`;
  chs.forEach(c => html += `<button class="lesson" data-opench="${c.id}"><span class="t">${esc(c.t)}</span><span class="s">${c.sk.map(s => SK[s].name).join(" + ")}</span><span class="st">${S.mem[c.id] ? `<span class="pill ${memStatus(c.id).cls}">${memStatus(c.id).label}</span>` : `<span class="pill">Try</span>`}</span></button>`);
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
    <button class="btn soft wide" data-vary>Practise in a new situation (${(IX.vars[id] || []).length + 1} available)</button>
    <a class="btn ghost wide" id="surpriseLive" href="#" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center">💬 Surprise me: live roleplay, brand-new situation</a>
    <p class="small muted">${(GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude).name} invents a situation you've never seen, plays the other person, then grades you. Unlimited.</p>
  </div>`;
  $("[data-back]").onclick = () => { view = "library"; render(); };
  $$("[data-practice]").forEach(b => b.onclick = () => startSession("practice", { type: b.dataset.practice, id }));
  $("[data-vary]").onclick = () => startSession("practice", { type: "speak", id, redo: true, v: nextVariant(id), direct: true });
  $("#surpriseLive").onclick = e => {
    const GA = GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude, p = roleplayPrompt({ type: "speak", id }, true);
    e.currentTarget.href = GA.url(p);
    copyText(p).then(ok => toast(ok ? (GA.paste ? "Roleplay copied. Paste it into " + GA.name + "." : "Roleplay also copied, in case it isn't filled in.") : "Opening " + GA.name + "…"));
  };
  scrollTo(0, 0);
}

// Finish estimate from your real pace: how many path steps you've completed per day recently.
// Until there's a week of data, assume one play a day with roughly 2 in 3 being new material (the rest are revisits).
function pathEta(left) {
  if (!left) return "";
  const days = S.started ? Math.round((Date.parse(today()) - Date.parse(S.started)) / 864e5) + 1 : 0;
  const win = Math.min(28, days), since = addDays(today(), -(win - 1));
  const advanced = S.history.filter(h => h.d >= since && (h.adv || (h.adv === undefined && h.kind !== "practice"))).length;
  let perDay, basis;
  if (win >= 7 && advanced > 0) { perDay = advanced / win; basis = `at your pace over the last ${win} days (${(perDay * 7).toFixed(1)} new plays a week)`; }
  else { perDay = 2 / 3; basis = "at one play a day, with about a third being revisits of weaker techniques"; }
  const daysLeft = Math.ceil(left / perDay), finish = new Date(Date.parse(addDays(today(), daysLeft) + "T12:00:00"));
  const span = daysLeft < 60 ? daysLeft + " days" : Math.round(daysLeft / 30.4) + " months";
  return `Finishing takes about ${span}, around ${finish.toLocaleDateString(undefined, { month: "long", year: "numeric" })}, ${basis}`;
}
function progressView() {
  const total = Object.values(S.xp).reduce((a, b) => a + b, 0);
  const minL = Math.min(...ORDER.map(k => lvl(S.xp[k])));
  const sessions = Object.values(S.log).reduce((a, b) => a + b, 0);
  const scored = S.history.filter(h => h.score != null);
  const avg = scored.length ? (scored.slice(-20).reduce((a, h) => a + h.score, 0) / Math.min(20, scored.length)).toFixed(1) : "–";
  let heat = ""; for (let i = 83; i >= 0; i--) { const k = addDays(today(), -i), n = S.log[k] || 0; heat += `<i class="${n > 1 ? "l2" : n ? "l1" : ""} ${i === 0 ? "t" : ""}" title="${k}"></i>`; }
  const left = Math.max(0, QUEUE.length - S.pos);
  const eta = pathEta(left);
  return `<header><div class="eyebrow">${total} xp total</div><h1>Progress</h1></header>
  <section class="panel map">${rings(150, true)}
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0"><span class="eyebrow">Intersection level</span><span class="big mono">L${minL}</span>
    <p class="small muted">Your level is your weakest skill's level. The circles fill in as each one grows.</p></div></section>
  <div class="stats">
    <div class="stat"><b class="mono">${streak()}</b><span>Day streak</span></div>
    <div class="stat"><b class="mono">${bestStreak()}</b><span>Best streak</span></div>
    <div class="stat"><b class="mono">${avg}</b><span>Avg score (last 20)</span></div>
  </div>
  ${(() => {
    const learnedIds = Object.keys(S.mem);
    if (!learnedIds.length) return "";
    const cnt = { good: 0, ok: 0, weak: 0 }; learnedIds.forEach(id => { const c = memStatus(id).cls; if (cnt[c] != null) cnt[c]++; });
    const weakest = learnedIds.filter(id => S.mem[id].m < WEAK).sort((x, y) => S.mem[x].m - S.mem[y].m).slice(0, 5);
    const dueN = dueStrengthen().length;
    return `<section class="panel"><div class="row2"><h3>Mastery</h3><span class="small muted mono">${dueN} due to revisit</span></div>
      <div class="stats"><div class="stat"><b class="mono" style="color:var(--good)">${cnt.good}</b><span>Mastered</span></div><div class="stat"><b class="mono">${cnt.ok}</b><span>Solid</span></div><div class="stat"><b class="mono" style="color:var(--bad)">${cnt.weak}</b><span>Needs work</span></div></div>
      ${weakest.length ? `<span class="eyebrow">Weakest right now</span><div>${weakest.map(id => { const k = T(id) ? T(id).sk : CH(id).sk[0];
        return `<button class="lesson" style="--k:var(--${k})" data-strength="${id}"><span class="t">${esc(itemTitle({ type: T(id) ? "learn" : "challenge", id }))}</span><span class="s">Last score ${S.mem[id].last || "–"}/5 · strength ${S.mem[id].m}%</span><span class="st"><span class="pill weak">Practise</span></span></button>`; }).join("")}</div>` : `<p class="small muted">Nothing weak right now. Weak scores show up here.</p>`}
      <p class="small muted">Score 1–2 and it comes back tomorrow; 3–4 and it's back within days, in a new situation. A technique is Mastered after two 5/5s with your latest attempt still 4+; only then does it space out to weeks and months. Your daily play mixes these in with new material.</p></section>`;
  })()}
  <section class="panel"><div class="row2"><h3>Path</h3><span class="small muted mono">${S.pos}/${QUEUE.length}</span></div>
    <div class="bar" style="--k:var(--accent)"><span style="width:${Math.round(S.pos / QUEUE.length * 100)}%"></span></div>
    <p class="small muted">${left ? `${left} plays of new material left. ${eta}. After that, Mastery mode cycles your spoken drills and challenges, with spaced reviews throughout.` : "Path complete. Mastery mode is on."}</p></section>
  <section class="panel"><h3>Skills</h3><div class="ledger">${ORDER.map(k => { const xp = S.xp[k], L = lvl(xp);
    const lc = IX.lib.filter(l => l.sk === k && S.learned[l.id]).length;
    return `<div class="lrow" style="--k:var(--${k})"><span class="name"><i></i>${SK[k].name}</span><span class="lv"><span class="mono">L${L}</span> · ${rank(L)} · ${xp} xp</span><span class="bar"><span style="width:${lvlPct(xp)}%"></span></span><span class="small muted">${lc}/24 techniques learned · ${lvlFloor(L + 1) - xp} xp to L${L + 1}</span></div>`; }).join("")}</div></section>
  ${(() => {
    const done = S.missions.filter(m => m.done).sort((a, b) => (b.doneDate || "").localeCompare(a.doneDate || "") || (b.key > a.key ? 1 : -1));
    if (!done.length) return "";
    const by = {}; done.forEach(m => { const t = T(m.id); const k = t ? t.sk : "q"; by[k] = (by[k] || 0) + 1; });
    const show = missionLogAll ? done : done.slice(0, 8);
    return `<section class="panel missionlog" id="missionlog"><div class="row2"><h3>Mission log</h3><span class="small muted mono">${done.length} done</span></div>
      <div class="chips">${ORDER.filter(k => by[k]).map(k => `<span class="chip" style="--k:var(--${k})">${SK[k].name} · ${by[k]}</span>`).join("")}</div>
      <div>${show.map(m => { const t = T(m.id); const k = t ? t.sk : "q";
        return `<div class="logrow" style="--k:var(--${k})"><span class="box">✓</span><span><span>${esc(m.text)}</span><small>${new Date((m.doneDate || m.date) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${SK[k].name} · ${esc(t ? t.t : "")}</small></span><button class="link small" data-reopen="${esc(m.key)}">Reopen</button></div>`; }).join("")}</div>
      ${done.length > 8 ? `<button class="link small" data-logall>${missionLogAll ? "Show fewer" : "Show all " + done.length}</button>` : ""}</section>`;
  })()}
  <section class="panel heatpanel"><div class="row2"><h3>Last 12 weeks</h3><span class="small muted mono">${sessions} plays</span></div><div class="heat">${heat}</div></section>`;
}

function settingsView() {
  const st = S.settings;
  return `<header><h1>Settings</h1></header>
  <section class="panel">
    <h3>Your account &amp; devices</h3>
    ${st.ghToken && st.gistId ? `<p class="small"><b style="color:var(--good)">● Synced.</b> <span class="muted">Your progress lives in a private Gist on your GitHub account and merges across every device you link: phone, iPad, laptop. Last synced: ${st.lastSync ? new Date(st.lastSync).toLocaleString() : "not yet"}.</span></p>
      <div class="btnrow"><button class="btn soft" id="syncNow">Sync now</button><button class="btn ghost" id="linkDev">Link another device</button></div>
      <div id="linkBox" hidden class="model"><span class="eyebrow">Link code</span><p class="small muted">On your other device: open Intersection → Settings → "Have a link code?" and paste this. It contains your GitHub token, so only send it to yourself (AirDrop, Notes, or a message to yourself).</p>
        <div class="btnrow"><input type="text" readonly id="linkCode" value="${esc(btoa(JSON.stringify({ t: st.ghToken, g: st.gistId })))}" style="flex:1 1 160px"><button class="btn soft" id="copyLink">Copy</button></div></div>
      <button class="link small" id="ghOff">Disconnect this device</button>`
    : `<p class="small muted">Keep a live copy of your progress in a private Gist on your GitHub account. Free, automatic, and it restores itself if you reinstall or switch phones.</p>
      <p class="small muted">One-time setup: on GitHub, go to Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token. Tick only <b>gist</b>, set no expiration, generate, and paste it here.</p>
      <div class="field"><label for="ghtoken">GitHub token</label><input id="ghtoken" type="password" autocomplete="off" placeholder="ghp_…"></div>
      <button class="btn k" style="--k:var(--accent);color:var(--on-accent)" id="ghConnect">Connect</button>
      <div class="field" style="margin-top:6px"><label for="linkIn">Have a link code from another device?</label><input id="linkIn" type="text" autocomplete="off" placeholder="Paste link code"></div>
      <button class="btn soft" id="linkUse">Link this device</button>`}
  </section>
  <section class="panel">
    <h3>Grading app</h3>
    <p class="small muted">Free option: the grade button opens this app with your answer, the rubric and the model answer filled in (or copied, ready to paste), using the subscription you already have.</p>
    <div class="field"><label for="gradeApp">Open grading in</label><select id="gradeApp">${Object.entries(GRADE_APPS).map(([k, a]) => `<option value="${k}" ${k === (st.gradeApp || "claude") ? "selected" : ""}>${a.name}${a.paste ? " (paste the copied prompt)" : ""}</option>`).join("")}</select></div>
  </section>
  <section class="panel">
    <h3>Instant AI grading (optional)</h3>
    <p class="small muted">Add an API key from any provider and answers are graded right inside the app. Billed per use by the provider, typically a fraction of a cent per grade. The key stays on this phone and is never included in backups.</p>
    <div class="field"><label for="provider">Provider</label><select id="provider">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === (st.provider || "anthropic") ? "selected" : ""}>${p.name}</option>`).join("")}</select></div>
    <div class="field"><label for="apikey">API key</label><input id="apikey" type="password" autocomplete="off" placeholder="${prov().ph}" value="${esc(st.apiKey)}"></div>
    <div class="field"><label for="model">Model</label><input id="model" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${prov().model}" value="${esc(st.model || "")}"></div>
    <p class="small muted">Leave Model blank for the default (${prov().model}). Get a key at ${prov().where}.</p>
    <div class="btnrow"><button class="btn soft" id="saveKey">Save</button>${st.apiKey ? `<button class="btn ghost" id="testKey">Test key</button><button class="btn ghost" id="clearKey">Remove</button>` : ""}</div>
    <p class="small muted" id="keyMsg"></p>
  </section>
  <section class="panel">
    <h3>Voice</h3>
    <div class="field"><label for="narrator">Narrator</label><select id="narrator">${Object.entries(NARRATORS).map(([k, n]) => `<option value="${k}" ${k === (st.narrator || "heart") ? "selected" : ""}>${n.name}</option>`).join("")}</select></div>
    <button class="btn soft" id="previewVoice">▶ Preview narrator</button>
    <div class="field"><label for="rate">Reading speed: <span class="mono" id="rateVal">${st.rate}×</span></label><input id="rate" type="range" min="0.7" max="1.3" step="0.05" value="${st.rate}"></div>
    <div class="toggle"><label for="trans">Live transcript while recording</label><input id="trans" type="checkbox" ${st.transcript ? "checked" : ""}></div>
    <p class="small muted">If recording misbehaves on your phone, turn the live transcript off. You can still type or dictate what you said afterwards. Lessons and scenarios are pre-recorded. If a recording isn't available yet, your iPhone's best installed voice reads it instead; for a more natural one, download an Enhanced voice in iPhone Settings → Accessibility → Spoken Content → Voices.</p>
    <button class="btn ghost" id="testVoice">Sound check</button>
    <p class="small muted mono" id="soundDiag">App version ${APP_VERSION}</p>
  </section>
  <section class="panel">
    <h3>Daily nudge</h3>
    ${st.notifOn ? `<p class="small"><b style="color:var(--good)">● On.</b> <span class="muted">One notification at ${fmtHour(st.notifHour ?? 9)}, only on days you haven't played yet.</span></p>
      <div class="field"><label for="notifHour">Time</label><select id="notifHour">${Array.from({ length: 17 }, (_, i) => i + 6).map(h => `<option value="${h}" ${h === (st.notifHour ?? 9) ? "selected" : ""}>${fmtHour(h)}</option>`).join("")}</select></div>
      <div class="btnrow"><button class="btn soft" id="notifPreview">Preview</button><button class="btn ghost" id="notifOff">Turn off</button></div>
      <details class="small"><summary class="muted" style="cursor:pointer">One-time GitHub step (if you haven't done it)</summary>
        <p class="muted" style="margin-top:8px">The nudge is sent by a free scheduled job in your intersection repo. Give it your backup's ID once: open <b>github.com/vivic04/intersection/settings/secrets/actions/new</b>, name it <b>GIST_ID</b>, paste the value below, then tap Add secret.</p>
        <div class="btnrow" style="margin-top:8px"><input type="text" readonly value="${esc(st.gistId)}" id="gistIdBox" style="flex:1 1 160px"><button class="btn soft" id="copyGist">Copy</button></div>
        <p class="muted" style="margin-top:8px">To test it: github.com/vivic04/intersection/actions → Daily nudge → Run workflow.</p></details>`
    : `<p class="small muted">One notification a day at a time you choose, with today's play and a quick tip. It stays quiet on days you've already played. ${st.ghToken && st.gistId ? "" : "<b>Needs Cloud backup turned on first.</b>"}</p>
      <button class="btn k" style="--k:var(--accent);color:var(--on-accent)" id="notifOn" ${st.ghToken && st.gistId ? "" : "disabled"}>Turn on daily nudge</button>`}
    <p class="small" id="notifMsg"></p>
  </section>
  <section class="panel">
    <h3>Backup file</h3>
    <p class="small muted">Save a copy to Files, iCloud Drive, Notes or email, and restore from it any time.</p>
    <div class="btnrow"><button class="btn soft" id="shareBtn">Save backup…</button><button class="btn ghost" id="fileBtn">Restore from file</button></div>
    <input type="file" id="fileIn" accept="application/json,.json,text/plain" hidden>
    <div class="btnrow"><button class="link" id="exportBtn">Copy as text</button><button class="link" id="importBtn">Paste to restore</button></div>
    <textarea id="importBox" hidden placeholder="Paste a backup here, then tap Paste to restore again"></textarea>
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
  sayClips.learn = t.id + "_learn";
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
  sayClips.drill = t.id + "_drill"; sayTexts.drill = t.drill;
  return `<div class="eyebrow">Written drill · 2–3 min</div><h2>${esc(t.drill)}</h2>${listenBtn("drill", "Read it to me")}
    <textarea id="ans" placeholder="Write it out, or tap the mic on your keyboard to dictate. Rough is fine.">${esc(sess.draft)}</textarea>
    <button class="btn wide" data-drilldone>Get graded →</button>
    <p class="small muted">Skipping? <button class="link" data-skipdrill>Skip the drill</button></p>`;
}
// Live roleplay: the AI plays the other person, answers only what's asked, then grades strictly.
function roleplayPrompt(item, invent) {
  const d = invent ? { scene: "", ask: "", rub: T(item.id).steps.concat(["Fits this specific situation rather than a generic answer"]) } : item.type === "challenge" ? CH(item.id) : variantScene(item);
  const t = item.type === "challenge" ? null : T(item.id);
  const rub = d.rub || [];
  return `Let's run a live roleplay so I can practise ${t ? `the technique "${t.t}" (${t.src}). Core idea: ${t.idea}` : `several skills at once (${CH(item.id).sk.map(k => SK[k].name).join(" + ")})`}

${invent ? `Scenario: invent a fresh, realistic one for me. I'm a young professional in Toronto working in AI strategy at a bank and working toward AI product management. Pick a setting I wouldn't expect (work, a job interview, friends or family, a landlord or vendor, a side project, mentoring, networking) and make it different from: ${[T(item.id).scene].concat((IX.vars[item.id] || []).map(v => v[0])).slice(0, 6).join(" | ")}. Tell me the situation and my task in two sentences, then start.` : `Scenario: ${d.scene}
My task: ${d.ask}`}

How to play it:
- You play the other person in this scenario. If there isn't one, play the most realistic person I'd be talking to (a friend, colleague, stakeholder or interviewer).
- Stay in character. Reply in 1 to 3 sentences, like a real person would.
- Only answer what I actually ask or say. Don't volunteer the key insight. Decide privately on a realistic hidden answer (for example the real root cause, need or objection) and only reveal it when my questions earn it. Vague questions get vague answers; sharp ones get specifics.
- Be a bit busy and human: push back sometimes, go off on small tangents, and don't make it easy.
- Open with one line in character, then wait for me.

After my 6th turn, or whenever I type "grade", step out of character and grade me strictly against:
${rub.map((r, i) => `${i + 1}) ${r}`).join("\n")}
Reply in this format:
Score: N/5 (5 means I handled it the way a skilled professional would; be fair, not stingy)
What worked: one sentence.
Fix: the single most important improvement, quoting a moment from our conversation.
Better move: what I should have said at that moment.
Hidden answer: what you were holding back, and the question that would have unlocked it fastest.`;
}
function modelPanel(d, cls) {
  if (d.model) return `<div class="${cls}"><span class="eyebrow">Model answer</span><p>${esc(d.model)}</p></div>`;
  const t = T(sess.item.id);
  return `<div class="${cls}"><span class="eyebrow">No single right answer here</span><p class="small muted">Check yourself against the technique: ${t.steps.map(esc).join(" · ")}.</p><p class="small muted" style="margin-top:6px">For comparison, a strong answer in a different scenario:</p><p>${esc(t.model)}</p></div>`;
}
function recapStep() {
  const t = T(sess.item.id);
  sayClips.recap = t.id + "_learn"; sayTexts.recap = t.t + ". " + t.idea;
  return `<div class="eyebrow">Speaking drill · recap</div><h1>${esc(t.t)}</h1><p class="src">${esc(t.src)}</p>${listenBtn("recap")}
    <p class="idea">${esc(t.idea)}</p><ul class="list">${t.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <button class="btn wide" data-next>Show me the scenario →</button>`;
}
function sceneData() { return sess.item.type === "challenge" ? CH(sess.item.id) : variantScene(sess.item); }
function sceneStep() {
  const d = sceneData();
  if (d.pending) { genFresh(); return `<div class="eyebrow">Fresh AI scenario</div><h2>Writing you a new situation…</h2><p class="muted">One you haven't seen before, for the same technique.</p>`; }
  sayClips.scene = d.clip || (d.id + "_scene"); sayTexts.scene = d.scene + " " + d.ask;
  return `<div class="eyebrow">${sess.item.type === "challenge" ? "Intersection challenge" : esc(d.label || "Scenario")}</div>
    ${sess.item.type === "challenge" ? `<h1>${esc(d.t)}</h1>` : ""}
    <div class="scene">${esc(d.scene)}</div>${listenBtn("scene", "Read it to me")}
    <p class="ask">${esc(d.ask)}</p>
    <div class="panel"><span class="eyebrow">You'll be graded on</span><ul class="list small">${d.rub.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>
    <button class="btn wide" data-next>I'm ready to answer →</button>
    <div class="livebox">
      <a class="btn ghost wide" id="liveBtn" href="#" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px">💬 Practise live in ${(GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude).name} instead</a>
      <p class="small muted">${(GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude).name} plays the other person, only answers what you ask, then grades you. Come back and tap your score.</p>
      <div id="liveScore" hidden class="panel"><span class="eyebrow">What score did you get?</span><div class="scores">${[1, 2, 3, 4, 5].map(n => `<button data-livescore="${n}">${n}</button>`).join("")}</div></div>
    </div>`;
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
    <button class="btn wide" id="stopRec" style="background:var(--rec);color:#fff" ${Rec.on ? "" : "hidden"}>■ Stop recording</button>
    <div class="btnrow"><button class="btn" data-recdone ${Rec.on ? "disabled" : ""}>${sess.secs ? "Grade it →" : "Skip recording, type instead →"}</button></div>`;
}
function gradeStep() {
  const it = sess.item, spoken = it.type !== "learn";
  const d = it.type === "learn" ? T(it.id) : sceneData();
  const rub = spoken ? d.rub : null;
  const m = spoken && sess.transcript ? speechMetrics(sess.transcript, sess.secs) : null;
  const hasKey = !!S.settings.apiKey.trim();
  let html = `<div class="eyebrow">Grade</div>`;
  if (spoken && sess.gradedBy !== "live") {
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
    html += `<div class="result"><div class="row2"><span class="eyebrow">${sess.gradedBy === "ai" ? "AI coach" : sess.gradedBy === "live" ? "Live roleplay" : sess.gradedBy === "claude" || sess.gradedBy === "app" ? (GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude).name : "Self-check"}</span><span class="score">${sess.score}/5</span></div>${sess.gradeText ? `<div>${esc(sess.gradeText)}</div>` : ""}</div>
      ${modelPanel(d, "panel")}
      <button class="btn wide" data-next>${stepsFor(it).length - 1 === sess.step ? "Finish ✓" : "Continue →"}</button>`;
    return html;
  }
  const GA = GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude;
  html += `<div class="btnrow">${hasKey ? `<button class="btn k" id="aiGrade">Grade with AI</button>` : ""}<a class="btn ${hasKey ? "ghost" : "k"}" id="claudeGrade" href="${GA.url("")}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center">Grade in ${GA.name}</a></div>
    <p class="small muted">Switch grading apps or add an API key in Settings.</p>
    <div id="aiOut"></div>
    <div id="claudeScore" hidden class="panel"><span class="eyebrow">What score did ${GA.name} give you?</span><div class="scores">${[1, 2, 3, 4, 5].map(n => `<button data-cscore="${n}">${n}</button>`).join("")}</div></div>
    <details class="panel"><summary style="font-weight:700;cursor:pointer">Or check yourself</summary>
      ${rub ? `<p class="small muted">Tick what you actually did:</p><div class="rub">${rub.map((r, i) => `<label><input type="checkbox" data-tick="${i}"><span>${esc(r)}</span></label>`).join("")}</div>` : `<p class="small muted">Compare with the model answer, then rate yourself.</p>`}
      ${modelPanel(d, "model")}
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
  return `<div class="eyebrow">Play complete</div>
    <div class="row2" style="align-items:flex-end"><span class="xpbig" style="color:var(--k)">+${sess.gained}</span><span class="streak">${flame}<b class="mono">${streak()}</b></span></div>
    <p class="muted">xp earned. ${sess.kind === "practice" ? "Practice logged." : `Next time: <b>${esc(itemTitle(nx))}</b> (${itemLabel(nx)}).`}</p>
    ${sess.score != null && S.mem[sess.item.id] ? (() => { const r = S.mem[sess.item.id], st = memStatus(sess.item.id);
      return `<div class="panel"><div class="row2"><span class="eyebrow">${esc(itemTitle(sess.item))}</span><span class="pill ${st.cls}">${st.label}</span></div>
        <div class="bar"><span style="width:${r.m}%"></span></div>
        <p class="small muted">${isMastered(r) ? `Mastered. Next check-in in ${r.int} days to keep it sharp.`
          : r.last <= 2 ? "This one needs more plays. It'll come back tomorrow, in a different situation."
          : r.last === 3 ? `Getting there. Back in ${r.int} days with a new scenario.`
          : r.last === 4 ? `Close. A 5/5 is what counts toward Mastered. Back in ${r.int} days.`
          : `5/5! That's ${r.fives} of ${FIVES_TO_MASTER} toward Mastered. ${r.fives < FIVES_TO_MASTER ? "Do it again on a different scenario." : ""}`}</p></div>`; })() : ""}
    <div class="confetti">${ORDER.map(k => `<i style="background:var(--${k})"></i>`).join("")}</div>
    <button class="btn wide" data-exit>Done</button>`;
}

/* ============ Binding ============ */
function bind() {
  $$("[data-tab]").forEach(b => b.onclick = () => { if (view === "session") return; view = b.dataset.tab; render(); scrollTo(0, 0); });
  $$("[data-say]").forEach(b => b.onclick = () => playClip(sayClips[b.dataset.say], sayTexts[b.dataset.say], b));
  if (view === "today") {
    const tc = $("#tree"); if (tc) Tree.mount(tc, false);
    const tr = $("#treeReplay"); if (tr) tr.onclick = () => Tree.mount($("#tree"), true);
    const st = $("[data-start]"); if (st) st.onclick = () => startSession(S.cur && !S.cur.finished && S.cur.date === today() ? S.cur.kind : "daily");
    const bo = $("[data-bonus]"); if (bo) bo.onclick = () => startSession("bonus");
    $$("[data-lib]").forEach(b => b.onclick = () => { libSkill = b.dataset.lib; view = "library"; render(); scrollTo(0, 0); });
    $$("[data-mission]").forEach(b => b.onclick = () => completeMission(b.dataset.mission, b));
    const gm = $("[data-gomissions]"); if (gm) gm.onclick = () => { view = "progress"; render(); setTimeout(() => { const el = $("#missionlog"); if (el) el.scrollIntoView({ behavior: "smooth" }); }, 50); };
  }
  if (view === "progress") {
    $$("[data-reopen]").forEach(b => b.onclick = () => reopenMission(b.dataset.reopen));
    const la = $("[data-logall]"); if (la) la.onclick = () => { missionLogAll = !missionLogAll; render(); const el = $("#missionlog"); if (el) el.scrollIntoView(); };
  }
  if (view === "progress") $$("[data-strength]").forEach(b => b.onclick = () => startSession("practice", strengthenItem(b.dataset.strength)));
  if (view === "library") {
    $$("[data-seg]").forEach(b => b.onclick = () => { libSkill = b.dataset.seg; render(); });
    $$("[data-open]").forEach(b => b.onclick = () => libDetail(b.dataset.open));
    $$("[data-opench]").forEach(b => b.onclick = () => startSession("practice", { type: "challenge", id: b.dataset.opench }));
  }
  if (view === "settings") bindSettings();
  if (view === "session") bindSession();
}
function bindSettings() {
  $("#gradeApp").onchange = e => { S.settings.gradeApp = e.target.value; save(); toast("Grading opens in " + GRADE_APPS[e.target.value].name); };
  $("#provider").onchange = e => { S.settings.provider = e.target.value; S.settings.model = ""; save(); render(); };
  $("#saveKey").onclick = () => { S.settings.apiKey = $("#apikey").value.trim(); S.settings.model = $("#model").value.trim(); save(); toast(S.settings.apiKey ? "Saved on this phone" : "Key cleared"); render(); };
  const ck = $("#clearKey"); if (ck) ck.onclick = () => { S.settings.apiKey = ""; save(); render(); };
  const tk = $("#testKey"); if (tk) tk.onclick = async () => {
    const msg = $("#keyMsg"); tk.disabled = true; msg.textContent = "Testing with a sample answer…";
    try { const r = await aiGrade({ type: "learn", id: IX.lib[0].id }, "The report was late because data came Thursday, because finance refreshes on Thursdays. Fix: use Wednesday's snapshot.", false);
      msg.innerHTML = `<b style="color:var(--good)">Works.</b> ${esc(prov().name)} · ${esc(gradeModel())} gave the sample ${r.score ?? "?"}/5.`; }
    catch (e) { msg.innerHTML = `<b style="color:var(--bad)">Didn't work.</b> ${esc(e.message)}`; }
    tk.disabled = false;
  };
  $("#narrator").onchange = e => { S.settings.narrator = e.target.value; save(); playClip("q1_learn", "", $("#previewVoice")); };
  $("#previewVoice").onclick = e => playClip("q1_learn", "Here's how lessons will sound.", e.currentTarget);
  $("#rate").oninput = e => { S.settings.rate = +e.target.value; $("#rateVal").textContent = S.settings.rate + "×"; player.playbackRate = S.settings.rate; save(); };
  $("#trans").onchange = e => { S.settings.transcript = e.target.checked; save(); };
  $("#testVoice").onclick = () => {
    const out = $("#soundDiag"); const a = new Audio("audio/q1_learn.mp3"); setAudioSession("playback");
    const t0 = Date.now(); let log = "v" + APP_VERSION + " · audioSession: " + (navigator.audioSession ? navigator.audioSession.type : "n/a");
    out.textContent = log + " · loading…";
    a.onerror = () => { out.textContent = log + " · clip error " + (a.error ? a.error.code : "?"); };
    a.play().then(() => {
      setTimeout(() => { out.textContent = log + " · playing, at " + a.currentTime.toFixed(1) + "s after 3s, volume " + a.volume + (a.currentTime > 1 ? ". Audio IS playing. If you heard nothing, check media volume, Silent mode, or a connected Bluetooth device." : ". Audio isn't advancing."); a.pause(); }, 3000);
    }).catch(e => { out.textContent = log + " · play blocked: " + e.name; });
  };
  const gc = $("#ghConnect"); if (gc) gc.onclick = async () => {
    const t = $("#ghtoken").value.trim(); if (!t) { toast("Paste your GitHub token first"); return; }
    S.settings.ghToken = t; gc.disabled = true; gc.textContent = "Connecting…";
    try { await ghConnect(); render(); }
    catch (e) { S.settings.ghToken = ""; S.settings.gistId = ""; save(); gc.disabled = false; gc.textContent = "Connect"; toast(e.message || "Couldn't connect"); }
  };
  const ld = $("#linkDev"); if (ld) ld.onclick = () => { $("#linkBox").hidden = !$("#linkBox").hidden; };
  const cl = $("#copyLink"); if (cl) cl.onclick = async () => { if (await copyText($("#linkCode").value)) toast("Link code copied"); else $("#linkCode").select(); };
  const lu = $("#linkUse"); if (lu) lu.onclick = async () => {
    let j; try { j = JSON.parse(atob($("#linkIn").value.trim())); } catch (e) {}
    if (!j || !j.t || !j.g) { toast("That doesn't look like a link code. Copy the whole code again."); return; }
    S.settings.ghToken = j.t; S.settings.gistId = j.g; lu.disabled = true; lu.textContent = "Linking…";
    try { const me = await gh("/user"); if (!me.ok) throw new Error("GitHub rejected the token in that code."); await syncPull(true); render(); }
    catch (e) { S.settings.ghToken = ""; S.settings.gistId = ""; save(); lu.disabled = false; lu.textContent = "Link this device"; toast(e.message || "Couldn't link"); }
  };
  const sn = $("#syncNow"); if (sn) sn.onclick = async () => { sn.disabled = true; await syncPull(false); await syncPush(); toast("Synced"); };
  const go = $("#ghOff"); if (go) go.onclick = () => { S.settings.ghToken = ""; S.settings.gistId = ""; S.settings.lastSync = 0; save(); toast("Cloud backup off. Your Gist is still on GitHub."); render(); };
  const no = $("#notifOn"); if (no) no.onclick = async () => {
    no.disabled = true; no.textContent = "Turning on…";
    try { await enableNotifications(); toast("Daily nudge on"); render(); }
    catch (e) { no.disabled = false; no.textContent = "Turn on daily nudge"; $("#notifMsg").innerHTML = `<span style="color:var(--bad)">${esc(e.message || "Couldn't turn on notifications.")}</span>`; }
  };
  const nf = $("#notifOff"); if (nf) nf.onclick = async () => { await disableNotifications(); toast("Daily nudge off"); render(); };
  const nh = $("#notifHour"); if (nh) nh.onchange = async e => { S.settings.notifHour = +e.target.value; save(); try { await writePushFile(); toast("Nudge moved to " + fmtHour(S.settings.notifHour)); } catch (err) { toast(err.message); } };
  const np = $("#notifPreview"); if (np) np.onclick = async () => {
    try { const reg = await navigator.serviceWorker.ready; const n = nextUpInfo() || {};
      (await reg.getNotifications()).forEach(x => x.close());
      await reg.showNotification("Today's play: " + (n.title || "ready"), { body: n.tip || "About five minutes. Tap to start.", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "daily" }); }
    catch (e) { toast("Couldn't show a preview. Check notification permission."); }
  };
  const cgi = $("#copyGist"); if (cgi) cgi.onclick = async () => { if (await copyText(S.settings.gistId)) toast("Copied"); else { $("#gistIdBox").select(); } };
  $("#shareBtn").onclick = async () => {
    const name = "intersection-backup-" + today() + ".json";
    const file = new File([snapshot()], name, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Intersection backup" }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    if (await copyText(snapshot())) toast("Sharing isn't available here, so the backup was copied as text instead.");
  };
  $("#fileBtn").onclick = () => $("#fileIn").click();
  $("#fileIn").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (!j.xp) throw 0; adopt(j); save(); syncSoon(); toast("Progress restored"); view = "today"; render(); }
    catch (err) { toast("That file isn't an Intersection backup."); }
  };
  $("#exportBtn").onclick = async () => {
    const data = snapshot();
    if (await copyText(data)) toast("Backup copied. Paste it into Notes.");
    else { const box = $("#importBox"); box.hidden = false; box.value = data; box.select(); toast("Select all and copy the text below"); }
  };
  $("#importBtn").onclick = () => {
    const box = $("#importBox");
    if (box.hidden || !box.value.trim()) { box.hidden = false; box.value = ""; box.focus(); return; }
    try { const j = JSON.parse(box.value); if (!j.xp) throw 0; adopt(j); save(); syncSoon(); toast("Progress restored"); view = "today"; render(); }
    catch (e) { toast("That doesn't look like a backup. Paste the whole copied text."); }
  };
  $("#resetBtn").onclick = () => { $("#resetConfirm").hidden = false; };
  $("#resetNo").onclick = () => { $("#resetConfirm").hidden = true; };
  $("#resetYes").onclick = () => { const st = S.settings; S = blank(); S.settings = st; initLedger(); save(); toast("Progress reset"); view = "today"; render(); };
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
    nudge(id, ok);
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
    if (Rec.busy) return;
    if (!Rec.on) {
      Rec.busy = true;
      try { speechSynthesis.cancel(); player.pause(); } catch (e) {}
      const ok = await startRec(); Rec.busy = false; if (!ok) return;
      rb.classList.add("on"); $("#recHint").textContent = "Recording… tap the button or Stop to finish"; $("#liveText").textContent = SR && S.settings.transcript ? "Listening…" : "Recording. Transcript is off.";
      const nb = $("[data-recdone]"); if (nb) nb.disabled = true;
      const st = $("#stopRec"); if (st) st.hidden = false;
    } else finishRecording();
  };
  const sr2 = $("#stopRec"); if (sr2) sr2.onclick = () => { if (Rec.on) finishRecording(); };
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
  const lb = $("#liveBtn"); if (lb) lb.onclick = e => {
    const GA = GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude, p = roleplayPrompt(sess.item);
    lb.href = GA.url(p);
    copyText(p).then(ok => toast(ok ? (GA.paste ? "Roleplay copied. Paste it into " + GA.name + "." : "Roleplay also copied, in case it isn't filled in.") : "Opening " + GA.name + "…"));
    $("#liveScore").hidden = false;
  };
  $$("[data-livescore]").forEach(b => b.onclick = () => {
    const GA = GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude;
    sess.score = +b.dataset.livescore; sess.gradedBy = "live"; sess.gradeText = "Practised live with " + GA.name + ".";
    award(itemSkills(sess.item), 10 + sess.score * 5);
    sess.step = stepsFor(sess.item).indexOf("grade"); save(); render(); scrollTo(0, 0);
  });
  const cg = $("#claudeGrade"); if (cg) cg.onclick = e => {
    const answer = ($("#ans") ? $("#ans").value : sess.draft).trim() || sess.draft;
    if (!answer) { e.preventDefault(); toast("There's nothing to grade yet. Type what you said."); return; }
    if (sess.item.type !== "learn") sess.transcript = answer;
    const p = gradePrompt(sess.item, answer, sess.item.type !== "learn");
    const GA = GRADE_APPS[S.settings.gradeApp] || GRADE_APPS.claude;
    cg.href = GA.url(p);
    copyText(p).then(ok => toast(ok ? (GA.paste ? "Prompt copied. Paste it into " + GA.name + "." : "Prompt also copied, in case it isn't filled in.") : "Opening " + GA.name + "…"));
    $("#claudeScore").hidden = false; save();
  };
  $$("[data-cscore]").forEach(b => b.onclick = () => { sess.score = +b.dataset.cscore; sess.gradedBy = "app"; sess.gradeText = ""; award(sks, sess.score * 5); save(); render(); });
  $$("[data-self]").forEach(b => b.onclick = () => { sess.score = +b.dataset.self; sess.gradedBy = "self"; award(sks, sess.score * 4); save(); render(); });
  const sr = $("#selfRub"); if (sr) sr.onclick = () => {
    const ticks = $$("[data-tick]").filter(x => x.checked).length, n = $$("[data-tick]").length;
    sess.score = Math.max(1, Math.round(ticks / n * 5)); sess.gradedBy = "self"; award(sks, sess.score * 4); save(); render();
  };
  const ma = $("[data-maccept]"); if (ma) ma.onclick = () => {
    const t = T(sess.item.id);
    S.missions = S.missions.filter(m => !(m.id === t.id && !m.done));
    S.missions.push({ key: "m" + Date.now(), id: t.id, text: t.m, date: today(), done: false });
    if (S.missions.length > 500) S.missions = S.missions.slice(-500);
    advance();
  };
  const ms = $("[data-mskip]"); if (ms) ms.onclick = advance;
}

/* ============ Missions ============ */
function completeMission(key, el) {
  const m = S.missions.find(x => x.key === key); if (!m || m.done) return;
  const t = T(m.id), k = t ? t.sk : "q";
  m.done = true; m.doneDate = today();
  let gained = false;
  if (!m.awarded) { m.awarded = true; addXP(k, 15); gained = true; }
  save(); syncSoon();
  if (el) { el.classList.add("leaving"); setTimeout(render, 380); } else render();
  undoToast("Mission complete" + (gained ? " · +15 xp" : ""), () => {
    m.done = false; m.doneDate = null;
    if (gained) { m.awarded = false; addXP(k, -15); }
    save(); syncSoon(); render();
  });
}
function reopenMission(key) {
  const m = S.missions.find(x => x.key === key); if (!m) return;
  m.done = false; m.doneDate = null; save(); syncSoon(); render(); toast("Moved back to your active missions");
}
function undoToast(msg, onUndo) {
  const el = $("#toast"); el.innerHTML = ""; el.append(msg + "  ");
  const b = document.createElement("button"); b.className = "undo"; b.textContent = "Undo";
  b.onclick = () => { clearTimeout(toast.t); el.hidden = true; onUndo(); };
  el.append(b); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 5000);
}

/* ============ Keyboard (laptop) ============ */
document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
  if (e.key === "Escape" && view === "session") { e.preventDefault(); exitSession(); return; }
  if (typing) return;
  if (view !== "session") {
    const tabs = { t: "today", l: "library", p: "progress", s: "settings" };
    if (tabs[e.key]) { view = tabs[e.key]; render(); scrollTo(0, 0); }
    if (e.key === "Enter" && view === "today") { const b = $("[data-start]") || $("[data-bonus]"); if (b) { e.preventDefault(); b.click(); } }
    return;
  }
  const opts = $$("[data-quiz]:not([disabled]), [data-rev]:not([disabled])");
  if (/^[1-3]$/.test(e.key) && opts[+e.key - 1]) { e.preventDefault(); opts[+e.key - 1].click(); return; }
  if (e.key === "r" || e.key === "R") { const rb = $("#recBtn"); if (rb) { e.preventDefault(); rb.click(); } return; }
  if (e.key === "Enter" || e.key === "ArrowRight") {
    const b = $("[data-next]") || $("[data-recdone]:not([disabled])") || $("[data-maccept]") || $("[data-exit].btn");
    if (b) { e.preventDefault(); b.click(); }
  }
});

/* ============ Boot ============ */
if (S.cur && S.cur.date !== today() && !S.cur.finished) { /* stale unfinished session from a previous day: keep item, reset reviews */ S.cur.date = today(); S.cur.reviews = []; S.cur.ri = 0; }
render();
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
  // When a new version takes over, reload once so the update shows immediately (never mid-session)
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && view !== "session") location.reload(); });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (S.settings.ghToken && S.settings.gistId) syncPush(); }
  else { if (view === "today") render(); syncPull(false); }
});
syncPull(false);
