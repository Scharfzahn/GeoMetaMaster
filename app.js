/* GeoMetaMaster – GeoGuessr-Meta lernen. Reines Vanilla-JS, keine Build-Tools. */
(() => {
'use strict';

/* ============================================================
   Helfer
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
let rnd = Math.random;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(rnd() * a.length)];
const sample = (a, n) => shuffle(a).slice(0, n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAY = 864e5;
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
function withSeed(seed, fn) { const old = rnd; rnd = mulberry32(hashStr(seed)); try { return fn(); } finally { rnd = old; } }
const pct = v => Math.round(v * 100);

/* ============================================================
   Zustand (localStorage)
   ============================================================ */
const LS_KEY = 'geometamaster.v1';
const defaultState = () => ({
  v: 1, cards: {}, xp: 0,
  streak: { n: 0, last: null, best: 0 },
  stats: { q: 0, c: 0, rounds: 0, perfect: 0, cat: {}, land: {} },
  badges: {}, lessons: {}, boss: {}, daily: {}, days: {},
  settings: { sound: true, lives: true, images: true },
  created: Date.now()
});
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); const d = defaultState(); return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}), stats: Object.assign(d.stats, s.stats || {}) }); }
  } catch (e) { /* ignorieren */ }
  return defaultState();
}
let S = loadState();
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* privater Modus */ } }

/* ============================================================
   Daten
   ============================================================ */
let DB, WORLD;
let CARDS = [], BYID = {}, BYCAT = {}, BYLAND = {}, CATS = {}, WORLDIDS = new Set();

async function loadJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

function indexData() {
  CATS = {}; DB.kategorien.forEach(c => CATS[c.id] = c);
  WORLDIDS = new Set(WORLD.countries.map(c => c.id));
  CARDS = []; BYID = {}; BYCAT = {}; BYLAND = {};
  DB.kategorien.forEach(c => BYCAT[c.id] = []);
  for (const c of DB.karten) {
    if (!c.id || !CATS[c.kategorie] || BYID[c.id]) { console.warn('Karte übersprungen:', c.id); continue; }
    if (c.land && !DB.laender[c.land]) { console.warn('Unbekanntes Land bei Karte', c.id, c.land); continue; }
    if (c.optionen && (typeof c.richtig !== 'number' || !c.frage)) { console.warn('Fragekarte unvollständig', c.id); continue; }
    if (!c.optionen && !c.land) { console.warn('Karte ohne Land/Frage', c.id); continue; }
    CARDS.push(c); BYID[c.id] = c; BYCAT[c.kategorie].push(c);
    if (c.land) (BYLAND[c.land] = BYLAND[c.land] || []).push(c);
  }
}
const L = iso => DB.laender[iso] || { name: iso, flagge: '🏳️', aehnlich: [] };
const landLabel = iso => `${L(iso).flagge} ${L(iso).name}`;
const hasVisual = c => !!((c.image && S.settings.images) || c.diagram);

/* ============================================================
   Spaced Repetition (Leitner)
   ============================================================ */
// Intervall je Fach: 1 = 10 Min, 2 = 1 Tag, 3 = 3 Tage, 4 = 7 Tage, 5 = 21 Tage
const BOX_MS = [0, 10 * 60e3, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
const cs = id => S.cards[id] || (S.cards[id] = { b: 0, d: 0, s: 0, c: 0, w: 0, l: 0 });
const boxOf = id => (S.cards[id] && S.cards[id].b) || 0;
const isDue = id => { const c = S.cards[id]; return !!c && c.b > 0 && c.d <= Date.now(); };
const isNew = id => !boxOf(id);
const masteryOfCard = id => boxOf(id) / 5;

function srsUpdate(card, ok, flags) {
  const c = cs(card.id); c.s++; c.l = Date.now();
  const f = flags[card.id] || (flags[card.id] = { wrong: false, promoted: false });
  if (ok) {
    c.c++;
    if (!f.wrong && !f.promoted) { c.b = c.b ? Math.min(5, c.b + 1) : 2; c.d = Date.now() + BOX_MS[c.b]; f.promoted = true; }
  } else {
    c.w++; c.b = 1; c.d = Date.now() + BOX_MS[1]; f.wrong = true;
  }
  const sc = S.stats; sc.q++; if (ok) sc.c++;
  const k = sc.cat[card.kategorie] = sc.cat[card.kategorie] || { c: 0, w: 0 }; ok ? k.c++ : k.w++;
  if (card.land) { const lk = sc.land[card.land] = sc.land[card.land] || { c: 0, w: 0 }; ok ? lk.c++ : lk.w++; }
}

function poolStats(pool) {
  let due = 0, fresh = 0, seen = 0, sum = 0;
  for (const c of pool) { const b = boxOf(c.id); if (!b) fresh++; else { seen++; if (isDue(c.id)) due++; } sum += b / 5; }
  return { total: pool.length, due, fresh, seen, avg: pool.length ? sum / pool.length : 0 };
}
function countryScore(iso) {
  const cards = BYLAND[iso]; if (!cards || !cards.length) return null;
  const st = poolStats(cards); return { ...st, seenAll: st.seen === st.total };
}
function medalOf(iso) { // -1 keine Karten, 0 grau, 1 Bronze, 2 Silber, 3 Gold
  const s = countryScore(iso); if (!s) return -1; if (!s.seen) return 0;
  if (s.avg >= 0.75 && s.seenAll) return 3; if (s.avg >= 0.35) return 2; return 1;
}
const MEDAL_NAME = ['Neu', 'Bronze', 'Silber', 'Gold'];
const goldCount = () => Object.keys(BYLAND).filter(i => medalOf(i) === 3).length;
const learnedCount = () => CARDS.filter(c => boxOf(c.id) >= 4).length;

function selectCards(pool, n = 10, { weak = false } = {}) {
  const now = Date.now();
  if (weak) {
    const seen = pool.filter(c => boxOf(c.id) > 0 && (S.cards[c.id].w > 0 || boxOf(c.id) <= 2));
    seen.sort((a, b) => {
      const A = S.cards[a.id], B = S.cards[b.id];
      const ra = A.w / Math.max(1, A.c + A.w), rb = B.w / Math.max(1, B.c + B.w);
      return (rb - ra) || (A.b - B.b);
    });
    if (seen.length) return shuffle(seen.slice(0, n));
  }
  const due = pool.filter(c => isDue(c.id)).sort((a, b) => (S.cards[a.id].b - S.cards[b.id].b) || (S.cards[a.id].d - S.cards[b.id].d));
  const fresh = shuffle(pool.filter(c => isNew(c.id))).sort((a, b) => (a.schwierigkeit || 1) - (b.schwierigkeit || 1));
  const waiting = pool.filter(c => boxOf(c.id) > 0 && S.cards[c.id].d > now).sort((a, b) => S.cards[a.id].d - S.cards[b.id].d);
  const sel = due.slice(0, n);
  if (sel.length < n) sel.push(...fresh.slice(0, Math.max(3, Math.min(6, n - sel.length))).slice(0, n - sel.length));
  if (sel.length < n) sel.push(...waiting.slice(0, n - sel.length));
  if (sel.length < n) sel.push(...fresh.slice(sel.filter(c => isNew(c.id)).length, sel.filter(c => isNew(c.id)).length + (n - sel.length)));
  return shuffle(sel);
}

/* ============================================================
   XP, Level, Streak, Abzeichen
   ============================================================ */
const levelFromXP = xp => Math.floor((1 + Math.sqrt(1 + xp / 6.25)) / 2);
const xpForLevel = lv => 25 * (lv - 1) * lv;
const LEVEL_TITLES = ['Tourist', 'Backpacker', 'Wegweiser', 'Pfadfinder', 'Kartenleser', 'Streetview-Fan', 'Meta-Lehrling', 'Plonker', 'Meta-Kenner', 'Geo-Profi', 'Meta-Meister', 'Weltenbummler', 'Orakel', 'Legende'];
const levelTitle = lv => LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, lv - 1)];

function addXP(n) {
  const before = levelFromXP(S.xp);
  S.xp += n; const t = dayKey(); S.days[t] = (S.days[t] || 0) + n;
  const after = levelFromXP(S.xp);
  if (after > before) { setTimeout(() => { sfx('level'); toast(`🎉 Level ${after}: ${levelTitle(after)}`, 'gold'); confetti(); }, 400); }
}
function touchStreak() {
  const t = dayKey(); if (S.streak.last === t) return;
  const y = dayKey(new Date(Date.now() - DAY));
  S.streak.n = S.streak.last === y ? S.streak.n + 1 : 1; S.streak.last = t;
  S.streak.best = Math.max(S.streak.best || 0, S.streak.n);
}
function currentStreak() {
  const t = dayKey(), y = dayKey(new Date(Date.now() - DAY));
  return (S.streak.last === t || S.streak.last === y) ? S.streak.n : 0;
}

const BADGES_BASE = [
  { id: 'first', icon: '🎯', name: 'Erster Schritt', desc: 'Erste Runde abgeschlossen.', test: () => S.stats.rounds >= 1 },
  { id: 'perfect', icon: '💯', name: 'Makellos', desc: 'Eine Runde ohne Fehler.', test: () => S.stats.perfect >= 1 },
  { id: 'streak3', icon: '🔥', name: 'Dranbleiber', desc: '3 Tage in Folge gelernt.', test: () => S.streak.best >= 3 },
  { id: 'streak7', icon: '🔥', name: 'Wochenserie', desc: '7 Tage in Folge gelernt.', test: () => S.streak.best >= 7 },
  { id: 'streak30', icon: '🌋', name: 'Eiserner Wille', desc: '30 Tage in Folge gelernt.', test: () => S.streak.best >= 30 },
  { id: 'q100', icon: '✅', name: '100 richtig', desc: '100 richtige Antworten.', test: () => S.stats.c >= 100 },
  { id: 'q500', icon: '🏆', name: '500 richtig', desc: '500 richtige Antworten.', test: () => S.stats.c >= 500 },
  { id: 'lvl5', icon: '⭐', name: 'Level 5', desc: 'Level 5 erreicht.', test: () => levelFromXP(S.xp) >= 5 },
  { id: 'lvl10', icon: '🌟', name: 'Level 10', desc: 'Level 10 erreicht.', test: () => levelFromXP(S.xp) >= 10 },
  { id: 'gold1', icon: '🥇', name: 'Erstes Gold', desc: 'Ein Land auf Gold gebracht.', test: () => goldCount() >= 1 },
  { id: 'gold5', icon: '👑', name: 'Goldsammler', desc: '5 Länder auf Gold.', test: () => goldCount() >= 5 },
  { id: 'learned50', icon: '🧠', name: 'Langzeitgedächtnis', desc: '50 Karten in Fach 4 oder höher.', test: () => learnedCount() >= 50 },
  { id: 'daily', icon: '📅', name: 'Tagesheld', desc: 'Tägliche Challenge geschafft.', test: () => Object.values(S.daily).some(d => d.done) },
  { id: 'daily7', icon: '🗓️', name: 'Stammspieler', desc: '7 tägliche Challenges geschafft.', test: () => Object.values(S.daily).filter(d => d.done).length >= 7 },
  { id: 'traveler', icon: '🌐', name: 'Weltreisender', desc: 'Alle Länder mindestens auf Bronze.', test: () => { const ids = Object.keys(BYLAND); return ids.length > 0 && ids.every(i => medalOf(i) >= 1); } }
];
function allBadges() {
  const cat = DB.kategorien.filter(c => c.abzeichen).map(c => ({
    id: 'boss-' + c.id, icon: c.abzeichen.icon, name: c.abzeichen.name, desc: `Boss-Level „${c.name}“ besiegt.`, test: () => (S.boss[c.id] || 0) > 0
  }));
  return [...BADGES_BASE, ...cat];
}
function checkBadges() {
  for (const b of allBadges()) {
    if (!S.badges[b.id] && b.test()) {
      S.badges[b.id] = Date.now();
      setTimeout(() => { toast(`${b.icon} Abzeichen: ${b.name}`, 'gold'); sfx('level'); }, 700);
    }
  }
}

/* ============================================================
   Sound, Toasts, Konfetti
   ============================================================ */
let actx;
function tone(f, d, type = 'sine', vol = 0.14, delay = 0) {
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + delay;
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
}
const SFX = {
  right: () => { tone(660, .1); tone(880, .18, 'sine', .14, .09); },
  wrong: () => { tone(220, .2, 'sawtooth', .08); tone(150, .3, 'sawtooth', .08, .12); },
  click: () => tone(520, .05, 'triangle', .08),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .2, 'triangle', .13, i * .1)),
  done: () => [392, 523, 659].forEach((f, i) => tone(f, .18, 'triangle', .12, i * .09)),
  lose: () => [330, 262, 196].forEach((f, i) => tone(f, .25, 'sawtooth', .07, i * .15))
};
function sfx(n) { if (!S.settings.sound) return; try { SFX[n](); } catch (e) { /* kein Audio */ } }
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* egal */ } }

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2800); setTimeout(() => t.remove(), 3300);
}
function floatXP(el, txt) {
  if (!el) return; const r = el.getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'floatxp'; f.textContent = txt;
  f.style.left = (r.left + r.width / 2) + 'px'; f.style.top = (r.top + 4) + 'px'; document.body.appendChild(f); setTimeout(() => f.remove(), 1100);
}
let confettiRun = false;
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#fx'), ctx = cv.getContext('2d'); const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.style.display = 'block';
  const cols = ['#5eead4', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#fb7185'];
  const ps = Array.from({ length: 110 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3, s: 5 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6, vr: (Math.random() - .5) * .4 }));
  const t0 = performance.now(); confettiRun = true;
  (function frame(t) {
    const dt = t - t0; ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = clamp(1 - dt / 2400, 0, 1); ctx.fillRect(-p.s * dpr / 2, -p.s * dpr / 4, p.s * dpr, p.s * dpr / 2); ctx.restore(); });
    if (dt < 2400) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; confettiRun = false; }
  })(t0);
}

/* ============================================================
   Medien: Bilder, Fallback, Diagramme
   ============================================================ */
function fallbackHTML(card) {
  const cat = CATS[card.kategorie] || { icon: '🌍', name: '' };
  return `<div class="fallback"><span class="fb-ico">${cat.icon}</span>${card.hinweis ? `<small>${esc(card.hinweis)}</small>` : `<small>${esc(cat.name)}</small>`}</div>`;
}
function mediaHTML(card, { eager = false, cls = '' } = {}) {
  if (card.diagram) return `<div class="media dia ${cls}">${diagramSVG(card.diagram)}</div>`;
  if (card.image && S.settings.images) {
    return `<div class="media loading ${cls}"><img src="${esc(card.image)}" alt="${esc(card.bildAlt || card.fokus || 'GeoGuessr-Merkmal')}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" data-card="${esc(card.id)}"></div>`;
  }
  return `<div class="media none ${cls}">${fallbackHTML(card)}</div>`;
}
// Bild-Ladeereignisse (error/load bubbeln nicht → Capture)
document.addEventListener('error', e => {
  const im = e.target; if (!(im instanceof HTMLImageElement) || !im.dataset.card) return;
  const card = BYID[im.dataset.card]; const m = im.closest('.media');
  if (m && card) { m.classList.remove('loading'); m.classList.add('failed'); m.innerHTML = fallbackHTML(card); }
}, true);
document.addEventListener('load', e => { const im = e.target; if (im instanceof HTMLImageElement && im.dataset.card) im.closest('.media')?.classList.remove('loading'); }, true);
function preloadCard(card) { if (card && card.image && S.settings.images) { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = card.image; } }

/* Mini-Weltkarte aus Sprite */
function buildSprite() {
  const el = document.createElement('div');
  el.innerHTML = `<svg id="sprite" width="0" height="0" style="position:absolute;visibility:hidden;pointer-events:none" aria-hidden="true"><g id="world">${WORLD.countries.map(c => `<path id="p-${c.id}" d="${c.d}"/>`).join('')}</g></svg>`;
  document.body.appendChild(el.firstChild);
}
function bboxOf(ids) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
  for (const id of ids) {
    const p = document.getElementById('p-' + id); if (!p) continue;
    const b = p.getBBox(); if (!b.width) continue; any = true;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function viewFor(ids, aspect = 1.9, ctxFactor = 2.4) {
  const b = bboxOf(ids); if (!b) return [0, 0, WORLD.w, WORLD.h];
  let w = Math.max(b.w * ctxFactor, 170), h = w / aspect;
  if (h < b.h * 1.5) { h = b.h * 1.5; w = h * aspect; }
  if (w > WORLD.w) { w = WORLD.w; h = w / aspect; }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return [clamp(cx - w / 2, 0, WORLD.w - w), clamp(cy - h / 2, 0, Math.max(0, WORLD.h - h)), w, h];
}
function miniMap(ids, view) {
  const v = view || (ids.length === 1 ? viewFor(ids) : [0, 0, WORLD.w, WORLD.h]);
  return `<svg class="mini" viewBox="${v.map(n => Math.round(n)).join(' ')}" role="img" aria-label="Weltkarte"><use href="#world" class="mw"/>${ids.map(i => `<use href="#p-${i}" class="mh"/>`).join('')}</svg>`;
}

function roadSVG(d) {
  const col = c => ({ yellow: '#facc15', white: '#f1f5f9', red: '#ef4444' }[c] || '#f1f5f9');
  const seg = (x, k, type) => `<line x1="${x}" y1="-10" x2="${x}" y2="250" stroke="${k}" stroke-width="5"${type === 'dashed' ? ' stroke-dasharray="26 22"' : ''}/>`;
  const line = (x, spec) => {
    if (!spec || spec === 'none') return '';
    const [c, t, t2] = spec.split('-'), k = col(c);
    if (t === 'double') return seg(x - 5, k, 'solid') + seg(x + 5, k, 'solid');
    if (t2) return seg(x - 5, k, t) + seg(x + 5, k, t2);
    return seg(x, k, t);
  };
  const car = (cx, cy, up, c) => `<g transform="translate(${cx} ${cy}) rotate(${up ? 0 : 180})"><rect x="-15" y="-28" width="30" height="56" rx="9" fill="${c}"/><rect x="-11" y="-17" width="22" height="13" rx="3" fill="#0b1020" opacity=".55"/><rect x="-11" y="8" width="22" height="9" rx="3" fill="#0b1020" opacity=".35"/><path d="M0 -44 l-8 12 h16z" fill="#fff" opacity=".85"/></g>`;
  const right = d.verkehr !== 'links';
  const upX = right ? 192 : 108, downX = right ? 108 : 192;
  const shoulder = d.standstreifen ? `<rect x="22" y="-10" width="48" height="260" fill="#4b5563"/><rect x="230" y="-10" width="48" height="260" fill="#4b5563"/>` : '';
  return `<svg viewBox="0 0 300 240" class="roadsvg" role="img" aria-label="Straßenmarkierung von oben"><rect width="300" height="240" fill="#2d3a2e"/>${shoulder}<rect x="70" y="-10" width="160" height="260" fill="#374151"/>${line(76, d.rand || 'white-solid')}${line(224, d.rand || 'white-solid')}${line(150, d.mitte)}${d.autos === false ? '' : car(upX, 150, true, '#60a5fa') + car(downX, 70, false, '#f472b6')}</svg>`;
}
function sunSVG(d) {
  const dirs = { N: [0, -1], S: [0, 1], O: [1, 0], W: [-1, 0] }; const v = dirs[d.sonne] || dirs.S;
  const cx = 150, cy = 118, r = 78;
  const sx = cx + v[0] * (r + 22), sy = cy + v[1] * (r + 22);
  const ex = cx - v[0] * 58, ey = cy - v[1] * 58;
  return `<svg viewBox="0 0 300 236" class="sunsvg" role="img" aria-label="Kompass mit Sonne und Schatten"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#1b2440" stroke="#475569" stroke-width="2"/>
  <text x="${cx}" y="${cy - r + 16}" text-anchor="middle" class="cp">N</text><text x="${cx}" y="${cy + r - 6}" text-anchor="middle" class="cp">S</text><text x="${cx + r - 14}" y="${cy + 5}" text-anchor="middle" class="cp">O</text><text x="${cx - r + 14}" y="${cy + 5}" text-anchor="middle" class="cp">W</text>
  <defs><marker id="ah" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#cbd5e1"/></marker></defs>
  <line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round" marker-end="url(#ah)" opacity=".9"/>
  <circle cx="${cx}" cy="${cy}" r="7" fill="#a16207"/>
  <g transform="translate(${sx} ${sy})"><circle r="15" fill="#fbbf24"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line x1="0" y1="-20" x2="0" y2="-27" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}</g>
  <text x="${clamp(sx, 46, 254)}" y="${clamp(sy + (v[1] >= 0 ? 44 : -34), 16, 230)}" text-anchor="middle" class="cl">Sonne (Mittag)</text>
  <text x="${clamp(ex, 40, 260)}" y="${clamp(ey + (v[1] > 0 ? -12 : 20), 14, 230)}" text-anchor="middle" class="cl">Schatten</text></svg>`;
}
function diagramSVG(d) {
  if (d.type === 'strasse') return roadSVG(d);
  if (d.type === 'sonne') return sunSVG(d);
  if (d.type === 'karte') return miniMap(d.laender || [], d.ausschnitt);
  return '';
}

/* ============================================================
   Fragen erzeugen
   ============================================================ */
function distractors(iso, n, cat, forced) {
  if (forced && forced.length) { const f = shuffle(forced.filter(i => DB.laender[i] && i !== iso)); if (f.length >= n) return f.slice(0, n); }
  const sim = shuffle((L(iso).aehnlich || []).filter(i => DB.laender[i] && i !== iso));
  const inCat = new Set(); (BYCAT[cat] || []).forEach(c => c.land && inCat.add(c.land));
  const rest = shuffle(Object.keys(DB.laender).filter(i => i !== iso && !sim.includes(i)));
  rest.sort((a, b) => (inCat.has(b) ? 1 : 0) - (inCat.has(a) ? 1 : 0) + (rnd() - .5) * .8);
  const out = sim.slice(0, Math.min(2, n)); for (const r of rest) { if (out.length >= n) break; if (!out.includes(r)) out.push(r); }
  return out.slice(0, n);
}
function promptFor(card) {
  if (hasVisual(card)) return card.fokus ? `Welches Land passt dazu? <small>Achte auf: ${esc(card.fokus)}</small>` : 'Welches Land passt zu diesem Bild?';
  return 'Welches Land passt zu diesem Merkmal?';
}
function qMC(card) {
  if (card.optionen) {
    const opts = shuffle(card.optionen.map((o, i) => ({ label: esc(o), ok: i === card.richtig })));
    return { kind: 'mc', card, prompt: nl2br(card.frage), opts, answer: esc(card.optionen[card.richtig]) };
  }
  const ids = shuffle([card.land, ...distractors(card.land, 3, card.kategorie, card.ablenker)]);
  return { kind: 'mc', card, prompt: promptFor(card), opts: ids.map(i => ({ label: landLabel(i), ok: i === card.land })), answer: landLabel(card.land) };
}
function qTF(card) {
  if (card.wf && card.wf.length && rnd() < .6) {
    const w = pick(card.wf);
    return { kind: 'tf', card, text: esc(w.aussage), truth: !!w.wahr, answer: w.wahr ? 'Stimmt' : 'Stimmt nicht', note: w.hinweis };
  }
  if (card.optionen) {
    const truth = rnd() < .5; const wrong = card.optionen.map((_, i) => i).filter(i => i !== card.richtig);
    const idx = truth ? card.richtig : pick(wrong);
    return { kind: 'tf', card, text: `${nl2br(card.frage)}<div class="tf-ans">→ ${esc(card.optionen[idx])}</div>`, truth, answer: esc(card.optionen[card.richtig]) };
  }
  const truth = rnd() < .5; const iso = truth ? card.land : distractors(card.land, 1, card.kategorie, card.ablenker)[0];
  return { kind: 'tf', card, text: `Das gehört zu <b>${landLabel(iso)}</b>.`, truth, answer: landLabel(card.land) };
}
function qMap(card) {
  if (!card.land || !WORLDIDS.has(card.land)) return null;
  return { kind: 'map', card, answer: landLabel(card.land) };
}
function qCompare(card) {
  if (!card.land) return null;
  const vis = hasVisual(card);
  let cand = CARDS.filter(c => c.land && !c.optionen && (!c.modi || c.modi.includes('compare')) && c.land !== card.land && c.kategorie === card.kategorie && hasVisual(c) === vis && (vis || c.hinweis));
  if (!cand.length) return null;
  const sim = cand.filter(c => (L(card.land).aehnlich || []).includes(c.land));
  const other = pick(sim.length && rnd() < .7 ? sim : cand);
  const ask = rnd() < .5 ? 0 : 1; // an welcher Position steht die Zielkarte
  const pair = ask === 0 ? [card, other] : [other, card];
  return { kind: 'compare', card, other, pair, ask, answer: landLabel(card.land) };
}
function qPairs(cards) {
  const seen = new Set(); const use = [];
  for (const c of cards) { if (c.land && !c.optionen && (!c.modi || c.modi.includes('pairs')) && !seen.has(c.land) && (hasVisual(c) || c.hinweis)) { seen.add(c.land); use.push(c); } if (use.length >= 5) break; }
  if (use.length < 4) return null;
  return { kind: 'pairs', cards: use, card: use[0], rightOrder: shuffle(use.map(c => c.land)), leftOrder: shuffle(use.map(c => c.id)) };
}
const KIND_W = { mc: 3, feature: 2.4, tf: 1.4, flip: 1.8, map: 1.2, compare: 1.3 };
// Rückwärts-Frage: Land → welches Merkmal passt?
function qFeature(card) {
  if (card.optionen || !card.land || !card.hinweis) return null;
  const byLand = {};
  CARDS.forEach(c => { if (c.kategorie === card.kategorie && !c.optionen && c.land && c.land !== card.land && c.hinweis && !byLand[c.land]) byLand[c.land] = c; });
  const wrong = sample(Object.values(byLand), 3); if (wrong.length < 3) return null;
  const opts = shuffle([{ label: esc(card.hinweis), ok: true }, ...wrong.map(c => ({ label: esc(c.hinweis), ok: false }))]);
  return { kind: 'mc', feature: true, card, prompt: `Was ist typisch für <b>${landLabel(card.land)}</b>? <small>${esc(CATS[card.kategorie].name)}</small>`, opts, answer: esc(card.hinweis) };
}
// Selbsteinschätzung wie bei Karteikarten
function qFlip(card) { return { kind: 'flip', card, answer: card.optionen ? esc(card.optionen[card.richtig]) : landLabel(card.land) }; }
function makeQuestion(card, avoid) {
  const av = avoid instanceof Set ? avoid : new Set(avoid ? [avoid] : []);
  const allowed = k => !card.modi || card.modi.includes(k) || k === 'flip';
  const cand = [];
  const add = (k, ok) => ok && allowed(k) && cand.push([k, KIND_W[k]]);
  add('mc', true); add('tf', true); add('flip', true);
  add('feature', !card.optionen && !!card.land && !!card.hinweis);
  add('map', !card.optionen && !!card.land && WORLDIDS.has(card.land));
  add('compare', !card.optionen && !!card.land);
  let list = cand.filter(([k]) => !av.has(k)); if (!list.length) list = cand;
  let total = list.reduce((a, k) => a + k[1], 0), r = rnd() * total, kind = 'mc';
  for (const [k, w] of list) { if ((r -= w) <= 0) { kind = k; break; } }
  const q = ({ mc: qMC, tf: qTF, map: qMap, compare: qCompare, feature: qFeature, flip: qFlip }[kind])(card);
  return q || qMC(card);
}
function buildQuestions(cards, n = 10, usePairs = true) {
  if (!cards.length) return [];
  const pairQ = usePairs && n >= 8 ? qPairs(shuffle(cards)) : null;
  const need = n - (pairQ ? 1 : 0);
  const order = []; while (order.length < need) { const batch = shuffle(cards); if (order.length && batch[0] === order[order.length - 1] && batch.length > 1) batch.push(batch.shift()); order.push(...batch); }
  order.length = need;
  const used = {}; const qs = order.map(c => { const u = used[c.id] = used[c.id] || new Set(); const q = makeQuestion(c, u); u.add(q.feature ? 'feature' : q.kind); return q; });
  if (pairQ) qs.splice(Math.min(qs.length, Math.floor(qs.length * (.45 + rnd() * .4))), 0, pairQ);
  return qs;
}

/* ============================================================
   Runden-Engine
   ============================================================ */
let R = null, ignorePop = false;
const roundEl = () => $('#round');

function startRound(cfg) {
  if (!cfg.questions.length) { toast('Keine Karten für diese Runde gefunden.'); return; }
  const lives = cfg.forceLives || S.settings.lives ? 3 : 0;
  R = { ...cfg, lives, maxLives: lives, queue: cfg.questions.slice(), i: 0, phase: 'main', total: cfg.questions.length, correct: 0, wrongQs: [], streak: 0, xp: 0, flags: {}, retryTries: {}, t0: Date.now(), answered: false };
  roundEl().hidden = false; document.body.classList.add('in-round');
  history.pushState({ round: 1 }, '');
  drawRoundShell(); sfx('click');
  if (cfg.study && cfg.study.length) { R.study = cfg.study; R.studyI = 0; R.studying = true; showStudy(); } else showQuestion();
}
function drawRoundShell() {
  roundEl().innerHTML = `<div class="rwrap">
    <div class="rhead"><button class="iconbtn" data-act="quit" aria-label="Runde beenden">✕</button>
      <div class="rbar"><i id="rbar"></i></div><div class="hearts" id="hearts" aria-label="Leben"></div></div>
    <div class="rtitle" id="rtitle"></div>
    <div class="rbody" id="rbody"></div>
    <div class="fbwrap" id="fb" hidden></div></div>`;
}
function drawHearts() {
  const el = $('#hearts'); if (!el) return;
  if (!R.maxLives) { el.innerHTML = '<span class="nolife" title="Leben ausgeschaltet">∞</span>'; return; }
  el.innerHTML = Array.from({ length: R.maxLives }, (_, i) => `<span class="${i < R.lives ? 'on' : 'off'}">${i < R.lives ? '❤️' : '🖤'}</span>`).join('');
}
function showQuestion() {
  const q = R.queue[R.i];
  if (!q) return endPhase();
  R.answered = false; R.current = q;
  const done = R.phase === 'main' ? R.i : R.i;
  $('#rbar').style.width = pct(done / R.queue.length) + '%';
  $('#rbar').classList.toggle('retry', R.phase === 'retry');
  $('#rtitle').innerHTML = R.phase === 'retry' ? `🔁 Fehler-Wiederholung <b>${R.i + 1}/${R.queue.length}</b>` : `${esc(R.title)} <b>${R.i + 1}/${R.queue.length}</b>`;
  drawHearts(); $('#fb').hidden = true; $('#fb').innerHTML = ''; $('#fb').className = 'fbwrap'; R.studying = false;
  const body = $('#rbody'); body.className = 'rbody k-' + q.kind; body.scrollTop = 0;
  ({ mc: renderMC, tf: renderTF, map: renderMap, compare: renderCompare, pairs: renderPairs, flip: renderFlip }[q.kind])(q, body);
  body.classList.remove('enter'); void body.offsetWidth; body.classList.add('enter');
  const nx = R.queue[R.i + 1]; if (nx) (nx.cards || [nx.card]).forEach(preloadCard);
}
function showStudy() {
  const cards = R.study, i = R.studyI, c = cards[i];
  $('#rbar').style.width = pct(i / cards.length) + '%'; $('#rbar').classList.remove('retry');
  $('#rtitle').innerHTML = `📖 Erst ansehen – dann abfragen <b>${i + 1}/${cards.length}</b>`;
  drawHearts();
  const cat = CATS[c.kategorie];
  const vis = hasVisual(c) ? `<div class="qmedia">${mediaHTML(c, { eager: true })}</div>` : '';
  const feat = c.optionen ? `<p class="st-q">${nl2br(c.frage)}</p><p class="st-a">✅ ${esc(c.optionen[c.richtig])}</p>` : (c.hinweis ? `<div class="clue"><span class="clue-ico">${cat.icon}</span><p>${nl2br(c.hinweis)}</p></div>` : '');
  const body = $('#rbody'); body.className = 'rbody k-study enter'; body.scrollTop = 0;
  body.innerHTML = `<div class="studycard"><div class="st-cat">${cat.icon} ${esc(cat.name)}</div><h2 class="st-title">${c.land ? landLabel(c.land) : 'Merke dir'}</h2>${vis}${feat}${c.erklaerung ? `<p class="fb-exp">${nl2br(c.erklaerung)}</p>` : ''}${c.merksatz ? `<p class="fb-mem">💡 <b>Merksatz:</b> ${nl2br(c.merksatz)}</p>` : ''}</div>`;
  const fb = $('#fb'); fb.className = 'fbwrap study'; fb.hidden = false;
  fb.innerHTML = `<div class="fbbox st"><div class="stbtns">${i ? '<button class="btn big" id="stprev">‹ Zurück</button>' : ''}<button class="btn primary big" id="stnext">${i < cards.length - 1 ? 'Weiter ›' : 'Quiz starten 🎯'}</button></div><button class="linkbtn" id="stskip">Lernkarten überspringen</button></div>`;
  const go = () => { R.studying = false; showQuestion(); };
  $('#stnext').onclick = () => { sfx('click'); if (i < cards.length - 1) { R.studyI++; showStudy(); } else go(); };
  if ($('#stprev')) $('#stprev').onclick = () => { R.studyI--; showStudy(); };
  $('#stskip').onclick = go;
  cards.slice(i + 1, i + 3).forEach(preloadCard);
}
function renderFlip(q, body) {
  const card = q.card;
  const clue = card.optionen ? `<div class="clue"><span class="clue-ico">${CATS[card.kategorie].icon}</span><p>${nl2br(card.frage)}</p></div>${hasVisual(card) ? `<div class="qmedia">${mediaHTML(card, { eager: true })}</div>` : ''}` : clueHTML(card);
  body.innerHTML = `<div class="qprompt">Weißt du es? <small>${card.optionen ? 'Überlege die Antwort, dann decke auf.' : 'Welches Land? Überlege, dann decke auf.'}</small></div>${clue}
    <div class="flipans" id="flipans" hidden><div class="fa-main">${q.answer}</div>${card.erklaerung ? `<p class="fb-exp">${nl2br(card.erklaerung)}</p>` : ''}${card.merksatz ? `<p class="fb-mem">💡 <b>Merksatz:</b> ${nl2br(card.merksatz)}</p>` : ''}</div>
    <button class="btn primary big" id="reveal">Antwort zeigen</button>
    <div class="fliprate" id="fliprate" hidden><button class="btn big bad" data-v="0">🔁 Nochmal</button><button class="btn big good" data-v="1">✅ Gewusst</button></div>`;
  $('#reveal').onclick = () => { sfx('click'); $('#flipans').hidden = false; $('#reveal').hidden = true; $('#fliprate').hidden = false; $('#flipans').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  $$('#fliprate button', body).forEach(b => b.onclick = () => { if (R.answered) return; answered(q, b.dataset.v === '1', { answer: q.answer, skipPanel: true }); });
}
function clueHTML(card) {
  if (hasVisual(card)) return `<div class="qmedia">${mediaHTML(card, { eager: true })}</div>`;
  return `<div class="clue"><span class="clue-ico">${CATS[card.kategorie].icon}</span><p>${nl2br(card.hinweis || card.fokus || '')}</p></div>`;
}
function renderMC(q, body) {
  body.innerHTML = `<div class="qprompt">${q.prompt}</div>${q.feature ? `<div class="flagbig">${L(q.card.land).flagge}</div>` : q.card.optionen ? (hasVisual(q.card) ? `<div class="qmedia">${mediaHTML(q.card, { eager: true })}</div>` : '') : clueHTML(q.card)}
    <div class="opts">${q.opts.map((o, i) => `<button class="opt" data-i="${i}"><kbd>${i + 1}</kbd><span>${o.label}</span></button>`).join('')}</div>`;
  $$('.opt', body).forEach(b => b.onclick = () => {
    if (R.answered) return; const i = +b.dataset.i, ok = q.opts[i].ok;
    $$('.opt', body).forEach((x, k) => { x.disabled = true; if (q.opts[k].ok) x.classList.add('ok'); });
    if (!ok) b.classList.add('bad'); else b.classList.add('pop');
    answered(q, ok, { answer: q.answer });
  });
}
function renderTF(q, body) {
  body.innerHTML = `<div class="qprompt">Stimmt das?</div>${q.card.optionen && !hasVisual(q.card) ? '' : clueHTML(q.card)}
    <div class="tfstate">${q.text}</div>
    <div class="tfbtns"><button class="opt tf" data-v="1"><span>✅ Stimmt</span></button><button class="opt tf" data-v="0"><span>❌ Stimmt nicht</span></button></div>`;
  $$('.tf', body).forEach(b => b.onclick = () => {
    if (R.answered) return; const v = b.dataset.v === '1', ok = v === q.truth;
    $$('.tf', body).forEach(x => { x.disabled = true; if ((x.dataset.v === '1') === q.truth) x.classList.add('ok'); });
    if (!ok) b.classList.add('bad'); else b.classList.add('pop');
    answered(q, ok, { answer: q.answer, note: q.note });
  });
}
function renderCompare(q, body) {
  const vis = hasVisual(q.card);
  body.innerHTML = `<div class="qprompt">Welches gehört zu <b>${landLabel(q.card.land)}</b>?</div>
    <div class="cmp ${vis ? 'vis' : 'txt'}">${q.pair.map((c, i) => `<button class="cmpbtn" data-i="${i}">${vis ? mediaHTML(c, { eager: true }) : `<div class="clue small"><span class="clue-ico">${CATS[c.kategorie].icon}</span><p>${nl2br(c.hinweis)}</p></div>`}<span class="cmp-n">${i === 0 ? 'A' : 'B'}</span></button>`).join('')}</div>`;
  $$('.cmpbtn', body).forEach(b => b.onclick = () => {
    if (R.answered) return; const i = +b.dataset.i, ok = i === q.ask;
    $$('.cmpbtn', body).forEach((x, k) => { x.disabled = true; x.classList.add(k === q.ask ? 'ok' : (k === i ? 'bad' : 'dim')); });
    answered(q, ok, { answer: q.answer, other: q.other });
  });
}
function renderPairs(q, body) {
  const byId = Object.fromEntries(q.cards.map(c => [c.id, c]));
  body.innerHTML = `<div class="qprompt">Ordne die Länder zu <small>Tippe erst ein Feld links, dann das passende Land rechts.</small></div>
    <div class="pairs"><div class="pcol">${q.leftOrder.map(id => `<button class="ptile" data-id="${id}">${hasVisual(byId[id]) ? mediaHTML(byId[id], { eager: true }) : `<div class="clue small"><p>${esc(byId[id].hinweis)}</p></div>`}</button>`).join('')}</div>
    <div class="pcol right">${q.rightOrder.map(iso => `<button class="pchip" data-iso="${iso}">${landLabel(iso)}</button>`).join('')}</div></div>`;
  let sel = null, matched = 0, mistakes = 0; const wrongIds = new Set();
  $$('.ptile', body).forEach(t => t.onclick = () => { if (t.classList.contains('done') || R.answered) return; $$('.ptile.sel', body).forEach(x => x.classList.remove('sel')); sel = t; t.classList.add('sel'); sfx('click'); });
  $$('.pchip', body).forEach(c => c.onclick = () => {
    if (!sel || c.classList.contains('done') || R.answered) return;
    const card = byId[sel.dataset.id];
    if (card.land === c.dataset.iso) {
      sel.classList.remove('sel'); sel.classList.add('done'); c.classList.add('done'); matched++; sel = null; sfx('right');
      if (matched === q.cards.length) {
        const ok = mistakes <= 1;
        answered(q, ok, { perCard: Object.fromEntries(q.cards.map(x => [x.id, !wrongIds.has(x.id)])), mistakes });
      }
    } else {
      mistakes++; wrongIds.add(card.id); c.classList.add('shake'); sel.classList.add('shake'); buzz(60); sfx('wrong');
      setTimeout(() => { c.classList.remove('shake'); $$('.ptile.shake', body).forEach(x => x.classList.remove('shake')); }, 450);
    }
  });
}

/* ---- Weltkarte (Zoom/Pan/Tap) ---- */
function createMap(host, { cls = () => '', onTap, regions = true } = {}) {
  const W = WORLD.w, H = WORLD.h;
  host.innerHTML = `<svg class="worldmap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Weltkarte"><rect class="sea" x="-200" y="-200" width="${W + 400}" height="${H + 400}"/><g class="land">${WORLD.countries.map(c => `<path data-id="${c.id}" d="${c.d}" class="${cls(c.id)}"/>`).join('')}</g></svg>
  <div class="mapctl"><button data-z="in" aria-label="Hineinzoomen">＋</button><button data-z="out" aria-label="Herauszoomen">－</button><button data-z="0" aria-label="Ganze Welt">🌍</button></div>
  ${regions ? `<div class="regions">${REGIONS.map(r => `<button data-r="${r[0]}">${r[1]}</button>`).join('')}</div>` : ''}`;
  const svg = $('svg', host); let vb = { x: 0, y: 0, w: W, h: H };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const aspect = () => { const r = svg.getBoundingClientRect(); return r.width && r.height ? r.width / r.height : W / H; };
  const norm = () => { vb.w = clamp(vb.w, W / 40, W * 1.2); vb.h = vb.w / (vb.aspect || W / H); vb.x = clamp(vb.x, -W * .15, W * 1.15 - vb.w); vb.y = clamp(vb.y, -H * .3, H * 1.3 - vb.h); };
  const fit = (b, pad = 1.6) => { const a = aspect(); let w = Math.max(b.w * pad, 60), h = w / a; if (h < b.h * pad) { h = b.h * pad; w = h * a; } vb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h, aspect: a }; norm(); anim(); };
  let animT; const anim = () => { svg.classList.add('anim'); apply(); clearTimeout(animT); animT = setTimeout(() => svg.classList.remove('anim'), 450); };
  const toSvg = (cx, cy) => { const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (cx, cy, f) => { const a = aspect(); vb.aspect = a; const p = toSvg(cx, cy); const nw = clamp(vb.w * f, W / 40, W * 1.2), k = nw / vb.w; vb = { x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: nw, h: vb.h * k, aspect: a }; norm(); apply(); };
  const reset = () => { vb = { x: 0, y: 0, w: W, h: H, aspect: aspect() }; const a = vb.aspect; if (a < W / H) { vb.h = vb.w / a; vb.y = (H - vb.h) / 2; } else { vb.w = H * a; vb.x = (W - vb.w) / 2; vb.h = H; } anim(); };
  const ptrs = new Map(); let down = null, pinch0 = null;
  svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, n: ptrs.size }; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); down.moved = true; } });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) { zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch0 / d); } pinch0 = d; return; }
    if (!down) return; if (Math.hypot(cur.x - down.x, cur.y - down.y) > 8) down.moved = true;
    if (down.moved && ptrs.size === 1) { const m = svg.getScreenCTM(); vb.aspect = aspect(); vb.x -= (cur.x - prev.x) / m.a; vb.y -= (cur.y - prev.y) / m.d; norm(); apply(); }
  });
  const up = e => {
    const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
    if (had && down && !down.moved && down.n === 1 && e.type === 'pointerup') {
      if (vb.w > W * 0.31) { zoomAt(e.clientX, e.clientY, 0.28); }       // erst hineinzoomen, damit kleine Länder treffbar sind
      else {
        let el = document.elementFromPoint(e.clientX, e.clientY); let id = el && el.dataset && el.dataset.id;
        if (!id) { let best = 1e9; svg.querySelectorAll('path').forEach(p => { const r = p.getBoundingClientRect(), cx = Math.max(r.left, Math.min(e.clientX, r.right)), cy = Math.max(r.top, Math.min(e.clientY, r.bottom)), d = Math.hypot(cx - e.clientX, cy - e.clientY); if (d < best && d < 22) { best = d; id = p.dataset.id; el = p; } }); }
        if (id) onTap && onTap(id, el);
      }
    }
    if (!ptrs.size) down = null;
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.18 : 1 / 1.18); }, { passive: false });
  host.addEventListener('click', e => {
    const z = e.target.closest('[data-z]'); const r = e.target.closest('[data-r]');
    if (z) { const rc = svg.getBoundingClientRect(); if (z.dataset.z === 'in') zoomAt(rc.left + rc.width / 2, rc.top + rc.height / 2, 1 / 1.6); else if (z.dataset.z === 'out') zoomAt(rc.left + rc.width / 2, rc.top + rc.height / 2, 1.6); else reset(); }
    if (r) { const reg = REGIONS.find(x => x[0] === r.dataset.r); const b = bboxOf(reg[2]); if (b) fit(b, reg[3] || 1.15); }
  });
  reset();
  return {
    svg, reset,
    set(id, c) { const p = svg.querySelector(`path[data-id="${id}"]`); if (p) p.setAttribute('class', c); },
    add(id, c) { svg.querySelector(`path[data-id="${id}"]`)?.classList.add(c); },
    clearSel() { $$('path.sel', svg).forEach(p => p.classList.remove('sel')); },
    focus(id, pad = 3.2) { const b = bboxOf([id]); if (b) fit(b, pad); }
  };
}
const REGIONS = [
  ['eu', 'Europa', ['PT', 'GB', 'FI', 'GR', 'UA', 'NO', 'ES', 'IT'], 1.15],
  ['as', 'Asien', ['TR', 'JP', 'ID', 'IN', 'KZ', 'CN'], 1.1],
  ['af', 'Afrika', ['MA', 'ZA', 'EG', 'SO', 'NG'], 1.1],
  ['na', 'N-Amerika', ['US', 'CA', 'MX'], 1.1],
  ['sa', 'S-Amerika', ['BR', 'AR', 'CL', 'CO'], 1.1],
  ['oc', 'Ozeanien', ['AU', 'NZ'], 1.2]
];

function renderMap(q, body) {
  body.innerHTML = `<div class="qprompt">Tippe das Land auf der Karte an <small>Erst aufs Gebiet tippen = hineinzoomen, dann das Land antippen. ＋/－ und Pinch gehen auch.</small></div>
    <div class="maprow">${clueHTML(q.card).replace('class="qmedia"', 'class="qmedia small"')}<div class="mapbox" id="qmap"></div></div>
    <div class="mapact"><div id="mapsel" class="mapsel">Noch nichts gewählt</div><button class="btn primary big" id="mapok" disabled>Bestätigen</button></div>`;
  let chosen = null;
  const mv = createMap($('#qmap'), { cls: () => '', onTap: id => { if (R.answered) return; chosen = id; mv.clearSel(); mv.add(id, 'sel'); $('#mapsel').innerHTML = `Gewählt: <b>${esc(landName(id))}</b>`; $('#mapok').disabled = false; sfx('click'); } });
  $('#mapok').onclick = () => {
    if (!chosen || R.answered) return; const ok = chosen === q.card.land;
    mv.clearSel(); mv.add(q.card.land, 'ok'); if (!ok) mv.add(chosen, 'bad'); mv.focus(q.card.land, ok ? 4 : 5);
    $('#mapok').disabled = true; $('#mapsel').innerHTML = ok ? '✅ Getroffen!' : `Du hast <b>${esc(landName(chosen))}</b> gewählt.`;
    answered(q, ok, { answer: q.answer });
  };
}
function landName(iso) { return DB.laender[iso]?.name || WORLD.countries.find(c => c.id === iso)?.n || iso; }

/* ---- Antwort auswerten ---- */
function answered(q, ok, info = {}) {
  if (R.answered) return; R.answered = true;
  const main = R.phase === 'main';
  let xpGain = 0;
  if (q.kind === 'pairs') {
    q.cards.forEach(c => { const cok = info.perCard[c.id]; if (main) srsUpdate(c, cok, R.flags); if (cok) xpGain += main ? 4 : 1; });
  } else if (main) { srsUpdate(q.card, ok, R.flags); }
  if (ok) {
    R.streak++;
    if (q.kind !== 'pairs') xpGain = main ? (q.kind === 'flip' ? 8 : 10 + Math.min(R.streak, 5) * 2) : 3;
    if (main) R.correct++; sfx('right');
  } else {
    R.streak = 0; sfx('wrong'); buzz(90);
    if (main) { R.wrongQs.push(q); if (R.maxLives && q.kind !== 'flip') R.lives--; }
  }
  xpGain = Math.round(xpGain * (R.xpMult || 1)); R.xp += xpGain; addXP(xpGain);
  drawHearts(); save(); updateChips();
  const dead0 = main && R.maxLives && R.lives <= 0;
  if (info.skipPanel) { floatXP($('#rbody'), xpGain ? '+' + xpGain : ''); return advance(q, ok, main, dead0); }
  const fb = $('#fb'), card = q.card;
  const head = ok ? pick(['Richtig!', 'Sauber!', 'Genau!', 'Top!', 'Stark!']) : (q.kind === 'tf' || q.kind === 'pairs' ? 'Nicht ganz.' : 'Leider falsch.');
  let body = '';
  if (q.kind === 'pairs') {
    body = `<ul class="fb-list">${q.cards.map(c => `<li class="${info.perCard[c.id] ? 'ok' : 'bad'}"><b>${landLabel(c.land)}</b> – ${esc(c.merksatz || c.erklaerung || '')}</li>`).join('')}</ul>`;
  } else {
    const why = info.note || card.erklaerung;
    body = `${!ok || q.kind === 'tf' ? `<div class="fb-ans">Richtig: <b>${info.answer || q.answer}</b></div>` : ''}${why ? `<p class="fb-exp">${nl2br(why)}</p>` : ''}${card.merksatz ? `<p class="fb-mem">💡 <b>Merksatz:</b> ${nl2br(card.merksatz)}</p>` : ''}`;
    if (q.kind === 'compare' && !ok) body += `<p class="fb-exp">Das andere Bild gehört zu <b>${landLabel(q.other.land)}</b>.</p>`;
  }
  const src = card.image && card.source && card.source.url ? `<small class="fb-src">Bild: <a href="${esc(card.source.url)}" target="_blank" rel="noopener">${esc(card.source.lizenz || 'Wikimedia Commons')}</a></small>` : '';
  const dead = main && R.maxLives && R.lives <= 0;
  fb.className = 'fbwrap ' + (ok ? 'ok' : 'bad');
  fb.innerHTML = `<div class="fbbox"><div class="fb-h">${ok ? '✅' : '❌'} ${head}<span class="fb-xp">${xpGain ? '+' + xpGain + ' XP' : ''}</span></div>${body}${src}
    <button class="btn primary big" id="nextbtn">${dead ? 'Weiter (keine Leben mehr)' : 'Weiter'}</button></div>`;
  fb.hidden = false; $('#nextbtn').focus({ preventScroll: true });
  floatXP($('#rbody'), xpGain ? '+' + xpGain : '');
  $('#nextbtn').onclick = () => advance(q, ok, main, dead);
}
function advance(q, ok, main, dead) {
  sfx('click');
  if (dead) return finishRound('dead');
  // falsch im Retry → am Ende nochmal (max. 2x), jedes Mal in anderer Frageart
  if (!main && !ok) { const k = q.card.id; R.retryTries[k] = (R.retryTries[k] || 0) + 1; if (R.retryTries[k] < 3) R.queue.push(makeQuestion(q.card, new Set([q.feature ? 'feature' : q.kind]))); }
  R.i++; showQuestion();
}
function endPhase() {
  if (R.phase === 'main' && R.wrongQs.length) {
    const ids = [...new Set(R.wrongQs.flatMap(q => q.kind === 'pairs' ? q.cards.filter(c => R.flags[c.id]?.wrong) : [q.card]).map(c => c.id))];
    const cards = ids.map(id => BYID[id]);
    R.phase = 'retry'; R.queue = cards.map(c => { const k = R.wrongQs.find(q => q.card && q.card.id === c.id)?.kind; return makeQuestion(c, new Set(k ? [k] : [])); }); R.i = 0;
    roundEl().querySelector('.rbody').innerHTML = `<div class="interlude"><div class="big">🔁</div><h2>Fehler wiederholen</h2><p>${cards.length} Karte${cards.length > 1 ? 'n' : ''} warten noch einmal auf dich – so bleibt es hängen.</p><button class="btn primary big" id="goretry">Los geht’s</button></div>`;
    $('#fb').hidden = true; $('#goretry').onclick = () => { sfx('click'); showQuestion(); }; $('#rtitle').textContent = '';
    return;
  }
  finishRound('done');
}
function finishRound(reason) {
  const total = R.queue.length && R.phase === 'main' ? R.queue.length : R.total;
  const asked = R.wrongQs.length + R.correct; const acc = asked ? R.correct / asked : 0;
  const perfect = reason === 'done' && R.wrongQs.length === 0 && asked >= Math.min(R.total, 8);
  let bonus = 0; const notes = [];
  if (reason === 'done') { bonus += 20; notes.push('Runde geschafft +20'); if (perfect) { bonus += 30; notes.push('Fehlerfrei +30'); } }
  if (R.kind === 'lesson' && reason === 'done' && acc >= .6) {
    const L_ = S.lessons[R.cat] = S.lessons[R.cat] || {}; const first = !L_[R.idx]?.done;
    L_[R.idx] = { done: true, best: Math.max(L_[R.idx]?.best || 0, pct(acc)) }; if (first) { bonus += 25; notes.push('Lektion abgeschlossen +25'); }
  }
  let won = false;
  if (R.kind === 'boss') { won = reason === 'done'; if (won) { S.boss[R.cat] = (S.boss[R.cat] || 0) + 1; bonus += 100; notes.push('Boss besiegt +100'); } }
  if (R.kind === 'daily') { const first = !S.daily[dayKey()]?.done; S.daily[dayKey()] = { done: true, score: pct(acc), xp: R.xp }; if (first && reason === 'done') { bonus += 25; notes.push('Tagesbonus +25'); } }
  bonus = Math.round(bonus * (R.xpMult || 1));
  if (bonus) { R.xp += bonus; addXP(bonus); }
  touchStreak(); S.stats.rounds++; if (perfect) S.stats.perfect++;
  checkBadges(); save(); updateChips();
  const lost = reason === 'dead';
  sfx(lost ? 'lose' : 'done'); if (!lost && (acc >= .8 || won)) confetti();
  const stars = lost ? 0 : acc >= .95 ? 3 : acc >= .75 ? 2 : acc >= .5 ? 1 : 0;
  const wrongCards = [...new Map(R.wrongQs.flatMap(q => q.kind === 'pairs' ? q.cards.filter(c => R.flags[c.id]?.wrong) : [q.card]).map(c => [c.id, c])).values()];
  const kind = R.kind, cat = R.cat, repeat = R.repeat;
  roundEl().innerHTML = `<div class="rwrap result"><div class="resbox">
    <div class="res-ico">${lost ? '💔' : won ? '🏆' : '🎉'}</div>
    <h1>${lost ? 'Keine Leben mehr' : won ? 'Boss besiegt!' : 'Runde geschafft!'}</h1>
    <div class="stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
    <div class="res-stats"><div><b>${R.correct}/${asked}</b><small>richtig</small></div><div><b>${pct(acc)}%</b><small>Treffer</small></div><div><b>+${R.xp}</b><small>XP</small></div></div>
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${wrongCards.length ? `<h3>Das nochmal anschauen</h3><ul class="miss">${wrongCards.map(c => `<li><b>${c.land ? landLabel(c.land) : esc(CATS[c.kategorie].name)}</b><span>${esc(c.merksatz || c.erklaerung || '')}</span></li>`).join('')}</ul>` : ''}
    <div class="resbtns"><button class="btn primary big" data-act="roundagain">${repeat ? 'Nochmal' : 'Weiter lernen'}</button><button class="btn big" data-act="quitdone">Fertig</button></div></div></div>`;
  R.finished = true; R.reason = reason; R.kindDone = kind; R.catDone = cat;
}
function closeRound() {
  roundEl().hidden = true; roundEl().innerHTML = ''; document.body.classList.remove('in-round');
  if (history.state && history.state.round) { ignorePop = true; history.back(); }
  R = null; render(); updateChips();
}

/* ---- Runden starten ---- */
function lessonsOf(catId) {
  const cs_ = BYCAT[catId].map((c, i) => [c, i]).sort((a, b) => ((a[0].schwierigkeit || 1) - (b[0].schwierigkeit || 1)) || a[1] - b[1]).map(x => x[0]);
  const out = []; for (let i = 0; i < cs_.length; i += 5) out.push(cs_.slice(i, i + 5));
  if (out.length > 1 && out[out.length - 1].length < 3) { const last = out.pop(); out[out.length - 1].push(...last); }
  return out;
}
const lessonUnlocked = (cat, i) => i === 0 || !!S.lessons[cat]?.[i - 1]?.done;
function startLesson(cat, idx) {
  const cards = lessonsOf(cat)[idx]; if (!cards) return;
  const qs = buildQuestions(cards, 10, true);
  startRound({ kind: 'lesson', cat, idx, title: `${CATS[cat].name} · Lektion ${idx + 1}`, questions: qs, study: cards.filter(c => isNew(c.id)), repeat: () => startLesson(cat, idx) });
}
function startPractice({ cat, land, weak } = {}) {
  let pool = CARDS; if (cat) pool = BYCAT[cat]; if (land) pool = BYLAND[land] || [];
  const sel = selectCards(pool, 10, { weak });
  const title = weak ? 'Schwächen' : land ? `${L(land).flagge} ${L(land).name}` : cat ? CATS[cat].name : 'Mixed';
  const qs = buildQuestions(sel, 10, true);
  startRound({ kind: 'practice', title, questions: qs, study: sel.filter(c => isNew(c.id)).slice(0, 5), repeat: () => startPractice({ cat, land, weak }) });
}
function bossStatus(cat) {
  const st = poolStats(BYCAT[cat]); const need = Math.min(6, Math.ceil(st.total * .6));
  return { ok: st.total > 0 && st.seen >= Math.max(1, need) && st.seen / st.total >= .6, seen: st.seen, need: Math.ceil(st.total * .6), total: st.total };
}
function startBoss(cat) {
  const b = bossStatus(cat); if (!b.ok) { toast(`Boss gesperrt: erst ${b.need} Karten sehen (${b.seen}/${b.total})`); return; }
  const pool = BYCAT[cat]; const sel = shuffle(pool).slice(0, Math.min(pool.length, 12));
  const qs = buildQuestions(sel, 12, true);
  startRound({ kind: 'boss', cat, title: `👹 Boss: ${CATS[cat].name}`, questions: qs, forceLives: true, repeat: () => startBoss(cat) });
}
function startDaily() {
  const t = dayKey();
  const qs = withSeed('daily-' + t, () => { const sel = sample(CARDS, 10); return buildQuestions(sel, 10, true); });
  const done = S.daily[t]?.done;
  startRound({ kind: 'daily', title: '📅 Tägliche Challenge', questions: qs, xpMult: done ? 0.5 : 2, repeat: null });
}

/* ============================================================
   Ansichten
   ============================================================ */
const app = () => $('#app');
const bar = (v, c = '') => `<div class="pbar ${c}"><i style="width:${pct(clamp(v, 0, 1))}%"></i></div>`;
function ring(v, icon, color) {
  const r = 26, c = 2 * Math.PI * r;
  return `<div class="ring" style="--c:${color}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="bg"/><circle cx="32" cy="32" r="${r}" class="fg" stroke-dasharray="${(c * clamp(v, 0, 1)).toFixed(1)} ${c.toFixed(1)}"/></svg><span>${icon}</span></div>`;
}
function updateChips() {
  const lv = levelFromXP(S.xp), a = xpForLevel(lv), b = xpForLevel(lv + 1);
  $('#chip-streak b').textContent = currentStreak();
  $('#chip-level .lvl').textContent = 'Lv ' + lv; $('#chip-level .xpbar i').style.width = pct((S.xp - a) / (b - a)) + '%';
}
const VIEWS = {};
function render() {
  if (R) return;
  const [, view = 'home', arg] = (location.hash || '#/home').split('/');
  const v = VIEWS[view] ? view : 'home';
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === (v === 'cat' || v === 'sheet' ? 'paths' : v)));
  app().innerHTML = VIEWS[v](decodeURIComponent(arg || ''));
  app().scrollTop = 0; window.scrollTo(0, 0);
  if (VIEWS[v].after) VIEWS[v].after(decodeURIComponent(arg || ''));
  updateChips();
}

VIEWS.home = () => {
  const lv = levelFromXP(S.xp), a = xpForLevel(lv), b = xpForLevel(lv + 1);
  const st = poolStats(CARDS); const t = dayKey(); const d = S.daily[t];
  const strk = currentStreak();
  const hearts = S.settings.lives ? '❤️❤️❤️' : '∞';
  return `<section class="hero card">
      <div class="hero-l"><div class="lvlbadge">${lv}</div></div>
      <div class="hero-r"><h1>${esc(levelTitle(lv))}</h1><div class="sub">${S.xp} XP · noch ${b - S.xp} bis Level ${lv + 1}</div>${bar((S.xp - a) / (b - a), 'gold')}
        <div class="hero-meta"><span>🔥 ${strk} ${strk === 1 ? 'Tag' : 'Tage'}</span><span>${hearts} pro Runde</span><span>🧠 ${learnedCount()} gelernt</span></div></div></section>
    <section class="actions">
      <button class="btn primary huge" data-act="practice"><span class="bi">▶️</span><span><b>Jetzt lernen</b><small>${st.due} fällig · ${st.fresh} neu</small></span></button>
      <button class="btn huge ${d?.done ? 'doneb' : ''}" data-act="daily"><span class="bi">${d?.done ? '✅' : '📅'}</span><span><b>Tägliche Challenge</b><small>${d?.done ? `Heute geschafft (${d.score}%) – nochmal für ½ XP` : 'Doppelte XP + Bonus'}</small></span></button>
      <button class="btn huge" data-act="weak"><span class="bi">🎯</span><span><b>Schwächen trainieren</b><small>Deine kniffligsten Karten</small></span></button>
    </section>
    <h2 class="sec">Nach Kategorie üben</h2>
    <div class="catgrid">${DB.kategorien.map(c => catCard(c)).join('')}</div>
    <h2 class="sec">Nach Land üben</h2>
    <div class="landgrid">${Object.keys(BYLAND).sort((x, y) => landName(x).localeCompare(landName(y), 'de')).map(i => `<button class="landchip m${medalOf(i)}" data-act="country" data-iso="${i}"><span class="fl">${L(i).flagge}</span><b>${esc(L(i).name)}</b><i class="medal">${['', '🥉', '🥈', '🥇'][medalOf(i)] || '·'}</i></button>`).join('')}</div>
    <p class="foot">Tipp: Kurze Runden jeden Tag schlagen lange Marathons – das Spaced-Repetition-System plant deine Wiederholungen automatisch.</p>`;
};
function catCard(c) {
  const st = poolStats(BYCAT[c.id]); const l = lessonsOf(c.id).filter((_, i) => S.lessons[c.id]?.[i]?.done).length;
  return `<a class="catcard" href="#/cat/${c.id}" style="--c:${c.farbe}">${ring(st.avg, c.icon, c.farbe)}<div class="ci"><b>${esc(c.name)}</b><small>${st.total} Karten · ${st.seen} gesehen${st.due ? ` · <em>${st.due} fällig</em>` : ''}</small></div></a>`;
}
VIEWS.paths = () => `<h1 class="ph1">Lernpfade</h1><p class="lead">Jede Kategorie hat ihren eigenen Pfad aus Lektionen, ein Boss-Level und eine freie Übungsrunde.</p><div class="catgrid big">${DB.kategorien.map(c => catCard(c)).join('')}</div>`;

VIEWS.cat = id => {
  const c = CATS[id]; if (!c) return `<p>Kategorie nicht gefunden.</p>`;
  const st = poolStats(BYCAT[id]); const lessons = lessonsOf(id); const boss = bossStatus(id);
  const nodes = lessons.map((ls, i) => {
    const done = S.lessons[id]?.[i]; const open = lessonUnlocked(id, i);
    const flags = [...new Set(ls.map(x => x.land).filter(Boolean))].slice(0, 5).map(x => L(x).flagge).join(' ');
    return `<button class="node ${done ? 'done' : open ? 'open' : 'locked'}" style="--o:${(i % 4) - 1.5}" ${open ? `data-act="lesson" data-cat="${id}" data-idx="${i}"` : 'disabled'}>
      <span class="nc">${done ? '✓' : open ? i + 1 : '🔒'}</span><span class="nt"><b>Lektion ${i + 1}</b><small>${flags || c.icon} · ${ls.length} Karten${done ? ` · beste ${done.best}%` : ''}</small></span></button>`;
  }).join('');
  const bossDone = S.boss[id] || 0;
  return `<a class="back" href="#/paths">‹ Pfade</a>
    <section class="cathead card" style="--c:${c.farbe}">${ring(st.avg, c.icon, c.farbe)}<div><h1>${esc(c.name)}</h1><p>${esc(c.beschreibung || '')}</p>
    <div class="sub">${st.total} Karten · ${st.seen} gesehen · ${st.due} fällig · Ø Fach ${(st.avg * 5).toFixed(1)}/5</div></div></section>
    <div class="actions row"><button class="btn primary big" data-act="practice" data-cat="${id}">🔁 Üben (Wiederholung)</button>
    <a class="btn big" href="#/sheet/cat:${id}">📖 Spickzettel<small>alles auf einer Seite</small></a><button class="btn big ${boss.ok ? '' : 'lockb'}" data-act="boss" data-cat="${id}">${boss.ok ? '👹' : '🔒'} Boss-Level${bossDone ? ` ✓${bossDone > 1 ? '×' + bossDone : ''}` : ''}<small>${boss.ok ? `Abzeichen: ${esc(c.abzeichen?.name || '')}` : `Sieh erst ${boss.need} Karten (${boss.seen}/${boss.total})`}</small></button></div>
    <h2 class="sec">Lernpfad</h2><div class="path">${nodes}<div class="node bossnode ${bossDone ? 'done' : boss.ok ? 'open' : 'locked'}" ${boss.ok ? `data-act="boss" data-cat="${id}"` : ''}><span class="nc">${bossDone ? '🏆' : '👹'}</span><span class="nt"><b>Boss-Level</b><small>${esc(c.abzeichen?.name || '')}</small></span></div></div>
    <h2 class="sec">Alle Karten <small class="mut">(${st.total})</small></h2><div class="cardgrid">${BYCAT[id].map(cardTile).join('')}</div>`;
};
function cardTile(c) {
  const b = boxOf(c.id);
  return `<button class="ctile" data-act="card" data-id="${esc(c.id)}"><div class="ct-m">${mediaHTML(c)}</div><div class="ct-t"><b>${c.land ? landLabel(c.land) : esc(c.frage.slice(0, 48))}</b><span class="box b${b}" title="Fach ${b}">${'●'.repeat(b)}${'○'.repeat(5 - b)}</span></div></button>`;
}

VIEWS.sheet = arg => {
  const [t, id] = arg.split(':'); const isCat = t === 'cat';
  const cards = isCat ? (BYCAT[id] || []) : (BYLAND[id] || []);
  const title = isCat ? `${CATS[id]?.icon || ''} ${esc(CATS[id]?.name || '')}` : `${L(id).flagge} ${esc(L(id).name)}`;
  const sorted = cards.slice().sort((a, b) => isCat ? landName(a.land || 'ZZ').localeCompare(landName(b.land || 'ZZ'), 'de') : (CATS[a.kategorie].name.localeCompare(CATS[b.kategorie].name, 'de')));
  const items = sorted.map(c => `<article class="sheetitem" style="--c:${CATS[c.kategorie].farbe}">
    <div class="si-h"><b>${c.land && isCat ? landLabel(c.land) : (!isCat ? CATS[c.kategorie].icon + ' ' + esc(CATS[c.kategorie].name) : '')}</b>${c.land && !isCat && c.optionen ? '' : ''}<span class="box b${boxOf(c.id)}">${'●'.repeat(boxOf(c.id))}${'○'.repeat(5 - boxOf(c.id))}</span></div>
    ${hasVisual(c) ? `<div class="si-m">${mediaHTML(c)}</div>` : ''}
    <p class="si-t">${c.optionen ? `<b>${nl2br(c.frage)}</b><br>✅ ${esc(c.optionen[c.richtig])}` : esc(c.hinweis || c.fokus || '')}</p>
    ${c.erklaerung ? `<p class="mut">${nl2br(c.erklaerung)}</p>` : ''}${c.merksatz ? `<p class="fb-mem">💡 ${nl2br(c.merksatz)}</p>` : ''}</article>`).join('');
  return `<a class="back" href="${isCat ? '#/cat/' + id : '#/home'}">‹ Zurück</a><h1 class="ph1">📖 Spickzettel: ${title}</h1><p class="lead">Alles auf einer Seite zum Durchlesen. Die Punkte zeigen dein Lernfach (●●●●● = sitzt).</p>
    <div class="btnrow noprint"><button class="btn primary" data-act="practice" ${isCat ? `data-cat="${id}"` : `data-land="${id}"`}>🎯 Jetzt üben</button></div><div class="sheetlist">${items}</div>`;
};
VIEWS.map = () => {
  const counts = [0, 0, 0, 0]; Object.keys(BYLAND).forEach(i => counts[Math.max(0, medalOf(i))]++);
  return `<h1 class="ph1">Weltkarte</h1><p class="lead">Jedes Land färbt sich, wenn du seine Karten lernst.</p>
    <div class="legend"><span><i class="lg m0"></i>Neu (${counts[0]})</span><span><i class="lg m1"></i>Bronze (${counts[1]})</span><span><i class="lg m2"></i>Silber (${counts[2]})</span><span><i class="lg m3"></i>Gold (${counts[3]})</span><span><i class="lg m-1"></i>noch keine Karten</span></div>
    <div class="mapbox big" id="pmap"></div><p class="foot">Tippe aufs Gebiet = hineinzoomen, dann ein Land antippen für Details und gezieltes Üben.</p>`;
};
VIEWS.map.after = () => { createMap($('#pmap'), { cls: id => 'm' + medalOf(id), onTap: id => { if (BYLAND[id]) openCountry(id); else toast(`${landName(id)}: noch keine Karten – ergänze sie in data/cards.json`); } }); };

VIEWS.stats = () => {
  const sc = S.stats; const acc = sc.q ? sc.c / sc.q : 0;
  const cats = DB.kategorien.map(c => { const st = poolStats(BYCAT[c.id]); const k = sc.cat[c.id] || { c: 0, w: 0 }; const n = k.c + k.w; const a = n ? k.c / n : null; return { c, st, n, a, score: n ? (a * .5 + st.avg * .5) : null }; });
  const weakCats = cats.filter(x => x.n >= 3).sort((a, b) => a.score - b.score).slice(0, 5);
  const lands = Object.keys(BYLAND).map(i => { const k = sc.land[i] || { c: 0, w: 0 }; const n = k.c + k.w; const s = countryScore(i); return { i, n, a: n ? k.c / n : null, s, score: n ? (k.c / n) * .5 + s.avg * .5 : null }; });
  const weakLands = lands.filter(x => x.n >= 3).sort((a, b) => a.score - b.score).slice(0, 6);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * DAY); return { k: dayKey(d), l: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()], v: S.days[dayKey(d)] || 0 }; });
  const mx = Math.max(50, ...days.map(d => d.v));
  const boxes = [1, 2, 3, 4, 5].map(b => CARDS.filter(c => boxOf(c.id) === b).length); const mxb = Math.max(1, ...boxes);
  return `<h1 class="ph1">Statistik</h1>
    <div class="kpis"><div class="kpi"><b>${sc.q}</b><small>Antworten</small></div><div class="kpi"><b>${sc.q ? pct(acc) + '%' : '–'}</b><small>Trefferquote</small></div><div class="kpi"><b>${sc.rounds}</b><small>Runden</small></div><div class="kpi"><b>${S.streak.best || 0}</b><small>Beste Serie</small></div></div>
    <div class="grid2"><section class="card"><h2>Letzte 7 Tage (XP)</h2><div class="bars">${days.map(d => `<div class="barcol"><i style="height:${Math.max(3, d.v / mx * 100)}%"></i><b>${d.v || ''}</b><small>${d.l}</small></div>`).join('')}</div></section>
    <section class="card"><h2>Lernfächer (Leitner)</h2><div class="bars">${boxes.map((n, i) => `<div class="barcol box"><i style="height:${Math.max(3, n / mxb * 100)}%"></i><b>${n}</b><small>Fach ${i + 1}</small></div>`).join('')}</div><p class="mut">Neu: ${CARDS.length - boxes.reduce((a, b) => a + b, 0)} · Fach 5 = Langzeitgedächtnis</p></section></div>
    <div class="grid2"><section class="card"><h2>Schwächste Kategorien</h2>${weakCats.length ? weakCats.map(x => `<div class="wrow"><span>${x.c.icon} ${esc(x.c.name)}</span><span class="wv">${pct(x.a)}%</span>${bar(x.score, 'warn')}<button class="mini-btn" data-act="practice" data-cat="${x.c.id}">Üben</button></div>`).join('') : '<p class="mut">Spiele ein paar Runden – dann siehst du hier, wo es hakt.</p>'}</section>
    <section class="card"><h2>Schwächste Länder</h2>${weakLands.length ? weakLands.map(x => `<div class="wrow"><span>${landLabel(x.i)}</span><span class="wv">${pct(x.a)}%</span>${bar(x.score, 'warn')}<button class="mini-btn" data-act="practice" data-land="${x.i}">Üben</button></div>`).join('') : '<p class="mut">Noch nicht genug Daten (mind. 3 Antworten je Land).</p>'}</section></div>
    <section class="card"><h2>Alle Kategorien</h2>${cats.map(x => `<div class="wrow"><span>${x.c.icon} ${esc(x.c.name)}</span><span class="wv">${x.a === null ? '–' : pct(x.a) + '%'}</span>${bar(x.st.avg)}</div>`).join('')}</section>
    <div class="actions row"><button class="btn primary big" data-act="weak">🎯 Schwächen trainieren</button></div>`;
};

VIEWS.profile = () => {
  const lv = levelFromXP(S.xp); const bs = allBadges(); const earned = bs.filter(b => S.badges[b.id]).length;
  const tg = (k, label, sub) => `<label class="toggle"><span><b>${label}</b><small>${sub}</small></span><input type="checkbox" data-set="${k}" ${S.settings[k] ? 'checked' : ''}><i></i></label>`;
  return `<h1 class="ph1">Profil</h1>
    <section class="card prof"><div class="lvlbadge">${lv}</div><div><h2>${esc(levelTitle(lv))}</h2><p class="mut">${S.xp} XP · ${earned}/${bs.length} Abzeichen · ${goldCount()} Gold-Länder</p></div></section>
    <h2 class="sec">Abzeichen</h2><div class="badges">${bs.map(b => `<div class="badge ${S.badges[b.id] ? 'on' : ''}" title="${esc(b.desc)}"><span>${S.badges[b.id] ? b.icon : '🔒'}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>
    <h2 class="sec">Einstellungen</h2><section class="card settings">
      ${tg('sound', 'Sounds', 'Kleine Töne bei richtig/falsch')}
      ${tg('lives', 'Leben (3 pro Runde)', 'Aus = entspanntes Üben ohne Rundenabbruch (Boss hat immer Leben)')}
      ${tg('images', 'Bilder anzeigen', 'Aus spart mobile Daten – dann zählen die Beschreibungen')}
      <div class="btnrow"><button class="btn" data-act="credits">📷 Bildnachweise</button><button class="btn" data-act="export">⬇️ Fortschritt sichern</button><button class="btn" data-act="import">⬆️ Wiederherstellen</button><button class="btn danger" data-act="reset">🗑️ Zurücksetzen</button></div>
      ${deferredInstall ? `<div class="btnrow"><button class="btn primary" data-act="install">📲 App installieren</button></div>` : ''}
      <input type="file" id="importfile" accept="application/json" hidden></section>
    <p class="foot">Meta ändert sich: Google tauscht Kameras und Autos aus, Länder bekommen neue Abdeckung. Die Karten sind Lern-Startpunkte aus Community-Wissen – im Zweifel gilt, was du im Spiel siehst. Bilder: Wikimedia Commons (Lizenzen unter „Bildnachweise“).</p>`;
};

/* ============================================================
   Modale
   ============================================================ */
function openModal(html, cls = '') {
  const m = $('#modal'); m.hidden = false; m.className = 'overlay modal ' + cls;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="iconbtn close" data-act="closemodal" aria-label="Schließen">✕</button>${html}</div>`;
  document.body.classList.add('modal-open');
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; document.body.classList.remove('modal-open'); }
function openCard(id) {
  const c = BYID[id]; if (!c) return; const b = boxOf(id), st = S.cards[id];
  openModal(`<div class="cardview">${mediaHTML(c, { eager: true, cls: 'big' })}
    <h2>${c.land ? landLabel(c.land) : esc(CATS[c.kategorie].icon + ' ' + CATS[c.kategorie].name)}</h2>
    ${c.frage ? `<p><b>${nl2br(c.frage)}</b></p>` : ''}${c.optionen ? `<p class="fb-ans">Antwort: <b>${esc(c.optionen[c.richtig])}</b></p>` : ''}
    ${c.hinweis ? `<p class="mut">${nl2br(c.hinweis)}</p>` : ''}
    <p>${nl2br(c.erklaerung || '')}</p>${c.merksatz ? `<p class="fb-mem">💡 <b>Merksatz:</b> ${nl2br(c.merksatz)}</p>` : ''}
    <p class="mut">Fach ${b}/5${st ? ` · ${st.c}× richtig · ${st.w}× falsch` : ' · noch nicht geübt'}</p>
    ${c.image && c.source ? `<small class="fb-src">Bild: ${esc(c.source.autor || 'unbekannt')} · ${esc(c.source.lizenz || '')} · <a href="${esc(c.source.url || '#')}" target="_blank" rel="noopener">Quelle</a></small>` : ''}</div>`);
}
function openCountry(iso) {
  const s = countryScore(iso); const m = medalOf(iso); const cards = BYLAND[iso] || [];
  const cats = DB.kategorien.map(c => { const cc = cards.filter(x => x.kategorie === c.id); if (!cc.length) return ''; const st = poolStats(cc); return `<div class="wrow"><span>${c.icon} ${esc(c.name)}</span><span class="wv">${cc.length}</span>${bar(st.avg)}</div>`; }).join('');
  openModal(`<div class="countrysheet"><div class="cflag">${L(iso).flagge}</div><h2>${esc(L(iso).name)}</h2><p class="mut">${m >= 1 ? MEDAL_NAME[m] : 'Noch nicht gestartet'} · ${s ? s.seen : 0}/${cards.length} Karten gesehen · ${s ? pct(s.avg) : 0}% Beherrschung</p>
    <div class="medalrow m${m}"><span>🥉</span><span>🥈</span><span>🥇</span></div>${cats}
    <div class="btnrow"><button class="btn primary big" data-act="practice" data-land="${iso}">🎯 ${esc(L(iso).name)} üben</button><a class="btn big" href="#/sheet/land:${iso}">📖 Spickzettel</a></div></div>`);
}
function openCredits() {
  const withImg = CARDS.filter(c => c.image && c.source);
  openModal(`<h2>📷 Bildnachweise</h2><p class="mut">Alle Bilder stammen von Wikimedia Commons und werden direkt von dort geladen. ${withImg.length} Bilder.</p>
    <div class="credits">${withImg.map(c => `<div class="cr"><img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="64" height="48"><div><b>${esc(c.source.titel || c.id)}</b><small>${esc(c.source.autor || 'unbekannt')} · ${esc(c.source.lizenz || '')} · <a href="${esc(c.source.url || '#')}" target="_blank" rel="noopener">Dateiseite</a></small></div></div>`).join('')}</div>`, 'tall');
}
function confirmBox(title, text, yes, cb, danger = false) {
  openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btnrow"><button class="btn ${danger ? 'danger' : 'primary'} big" id="cyes">${esc(yes)}</button><button class="btn big" data-act="closemodal">Abbrechen</button></div>`, 'confirm');
  $('#cyes').onclick = () => { closeModal(); cb(); };
}

/* ============================================================
   Aktionen (Event-Delegation)
   ============================================================ */
let deferredInstall = null;
const ACT = {
  practice: d => startPractice({ cat: d.cat, land: d.land }),
  weak: () => startPractice({ weak: true }),
  daily: startDaily,
  lesson: d => startLesson(d.cat, +d.idx),
  boss: d => startBoss(d.cat),
  card: d => openCard(d.id),
  country: d => openCountry(d.iso),
  closemodal: closeModal,
  credits: openCredits,
  quit: () => { if (R && !R.finished) confirmBox('Runde beenden?', 'Dein bisheriger Fortschritt in dieser Runde bleibt erhalten.', 'Beenden', closeRound, true); else closeRound(); },
  quitdone: () => closeRound(),
  roundagain: () => { const rep = R && R.repeat; closeRound(); if (rep) rep(); else startPractice({}); },
  export: () => { const b = new Blob([JSON.stringify(S)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `geometamaster-fortschritt-${dayKey()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); },
  import: () => $('#importfile').click(),
  reset: () => confirmBox('Fortschritt löschen?', 'Alle XP, Karten-Fächer, Abzeichen und Statistiken werden gelöscht. Das kann nicht rückgängig gemacht werden.', 'Alles löschen', () => { S = defaultState(); save(); render(); toast('Fortschritt zurückgesetzt'); }, true),
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); }
};
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  const fn = ACT[a.dataset.act]; if (!fn) return;
  if (a.dataset.act !== 'quit') sfx('click');
  if (['practice', 'weak', 'daily', 'lesson', 'boss'].includes(a.dataset.act)) closeModal();
  fn(a.dataset, a);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.set) { S.settings[t.dataset.set] = t.checked; save(); }
  if (t.id === 'importfile' && t.files[0]) {
    t.files[0].text().then(txt => { const o = JSON.parse(txt); if (!o || typeof o !== 'object' || !o.cards) throw 0; S = Object.assign(defaultState(), o); save(); render(); toast('Fortschritt wiederhergestellt ✓', 'gold'); }).catch(() => toast('Datei konnte nicht gelesen werden'));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (R && !R.finished) ACT.quit(); return; }
  if (!R || R.finished || !$('#modal').hidden) return;
  if (e.key === 'Enter' && R.answered) { $('#nextbtn')?.click(); return; }
  if (R.studying && e.key === 'Enter') { $('#stnext')?.click(); return; }
  if (!R.answered && /^[1-4]$/.test(e.key)) { const b = $$('.opt')[+e.key - 1]; b && b.click(); }
});
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (R && !R.finished) { history.pushState({ round: 1 }, ''); ACT.quit(); }
  else if (R && R.finished) closeRound();
});
window.addEventListener('hashchange', () => { closeModal(); render(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (location.hash.startsWith('#/profile')) render(); });

/* ============================================================
   Start
   ============================================================ */
async function init() {
  try {
    [DB, WORLD] = await Promise.all([loadJSON('data/cards.json'), loadJSON('data/world.json')]);
  } catch (err) {
    $('#boot').innerHTML = `<div class="boot-globe">⚠️</div><p>Daten konnten nicht geladen werden.<br><small>${esc(err.message)}</small></p><p><button class="btn primary" onclick="location.reload()">Neu laden</button></p>`;
    return;
  }
  indexData(); buildSprite(); checkBadges(); save();
  $('#boot').remove(); $('#shell').hidden = false;
  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
}
init();
})();
