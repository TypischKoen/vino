import * as db from './db.js';
import * as AI from './ai.js';
import { TYPES, TYPE_KEYS, STATUS_LABEL, SORTS, label, drinkStatus, stats, matches, cellarForPrompt, normalizeWine, toCsv, euro } from './wine.js';
import { startScanner, scanImage, lookupBarcode } from './scan.js';
import { toAiImage, thumbnail } from './image.js';
import * as weather from './weather.js';
import { webSearch, hasSearchKey, sourcesForPrompt, testSearch } from './search.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YEAR = new Date().getFullYear();

const S = {
  wines: [], log: [], wishlist: [],
  tab: 'vandaag', sub: null,
  filter: { q: '', type: null, status: null, sort: 'soort', showEmpty: false },
  pair: { dish: '', people: 2, mood: [], image: null, preview: null, url: '', showUrl: false, result: null, loading: false, error: '' },
  chat: { system: null, history: [], display: [], busy: false, ctl: null, image: null, preview: null },
  weather: null,
};

/* ================= kleine bouwstenen ================= */

function bottleSvg(color) {
  return `<svg viewBox="0 0 26 64" aria-hidden="true"><path d="M10 2h6v14c0 3 6 6 6 13v31a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V29c0-7 6-10 6-13V2Z" fill="${color}" opacity=".9"/><rect x="4" y="36" width="18" height="14" rx="1.5" fill="#f5ede8" opacity=".85"/></svg>`;
}
const typeColor = (w) => (TYPES[w.type] ?? TYPES.rood).color;

function thumb(w, cls = 'thumb') {
  return `<div class="${cls}" style="background:color-mix(in srgb, ${typeColor(w)} 22%, var(--surface-2))">${
    w.photo ? `<img data-photo="${esc(w.photo)}" alt="">` : bottleSvg(typeColor(w))}</div>`;
}

const photoCache = new Map();
async function hydratePhotos(root = document) {
  for (const img of $$('img[data-photo]', root)) {
    const id = img.dataset.photo;
    if (!photoCache.has(id)) photoCache.set(id, await db.photoUrl(id));
    const url = photoCache.get(id);
    if (url) img.src = url; else img.remove();
  }
}

function statusPill(w) {
  const st = drinkStatus(w, YEAR);
  return st ? `<span class="pill ${st}">${STATUS_LABEL[st]}</span>` : '';
}

function metaLine(w) {
  return [TYPES[w.type]?.label, w.grape, w.appellation || w.region, w.country].filter(Boolean).join(' · ');
}

function bottleRow(w) {
  return `<button class="bottle ${w.quantity > 0 ? '' : 'empty-stock'}" data-action="wine" data-id="${esc(w.id)}">
    ${thumb(w)}
    <span class="t">
      <span class="name">${esc(label(w))}</span>
      <span class="meta">${esc(metaLine(w))}</span>
      ${statusPill(w)}
    </span>
    <span class="count" aria-label="${w.quantity} flessen">${w.quantity}</span>
  </button>`;
}

function stars(value, action, id) {
  return `<span class="stars" role="radiogroup" aria-label="Score">${[1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="${n <= (value ?? 0) ? 'on' : ''}" data-action="${action}" data-id="${esc(id ?? '')}" data-value="${n}" aria-label="${n} sterren">★</button>`).join('')}</span>`;
}

function loading(text) {
  return `<div class="loading"><svg class="glass-anim" viewBox="0 0 28 36" aria-hidden="true"><path d="M4 2h20l-2 13a8 8 0 0 1-16 0L4 2Z" fill="none" stroke="currentColor" stroke-width="2"/><path class="fill" d="M5.5 8h17l-1.3 7a7 7 0 0 1-14.4 0Z" fill="var(--wine)"/><path d="M14 23v9M9 34h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>${esc(text)}</span></div>`;
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Simpele markdown voor de chat: vet, cursief, lijstjes, alinea's
function md(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>');
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*•]\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list !== tag) { if (list) html += `</${list}>`; html += `<${tag}>`; list = tag; }
      html += `<li>${inline((ul ?? ol)[1])}</li>`;
      continue;
    }
    if (list) { html += `</${list}>`; list = null; }
    if (line.startsWith('#')) html += `<p><strong>${inline(line.replace(/^#+\s*/, ''))}</strong></p>`;
    else if (line) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

/* ================= sheets ================= */

let sheetCleanup = null;
function openSheet(title, body, { onMount, onClose } = {}) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title.replace(/<[^>]+>/g, ''));
  sheet.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h3>${title}</h3><button class="close" data-action="close-sheet" aria-label="Sluiten">✕</button></div>
    <div class="sheet-body">${body}</div>`;
  document.body.append(scrim, sheet);
  scrim.addEventListener('click', () => closeSheet());
  requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
  sheetCleanup = onClose ?? null;
  hydratePhotos(sheet);
  onMount?.(sheet);
  return sheet;
}
function closeSheet(instant = false) {
  const sheet = $('.sheet');
  const scrim = $('.scrim');
  sheetCleanup?.();
  sheetCleanup = null;
  if (!sheet) return;
  if (instant) { sheet.remove(); scrim?.remove(); return; }
  sheet.classList.remove('show');
  scrim?.classList.remove('show');
  setTimeout(() => { sheet.remove(); scrim?.remove(); }, 300);
}
const sheetBody = () => $('.sheet .sheet-body');

/* ================= data ================= */

async function load() {
  [S.wines, S.log, S.wishlist] = await Promise.all([db.all('wines'), db.all('log'), db.all('wishlist')]);
}

let dirty = false;
db.events.addEventListener('change', async (e) => {
  if (e.detail === 'photos') return;
  if (e.detail === 'settings') { applyTheme(); return; } // instellingen-scherm leest zelf al de nieuwste waarden
  await load();
  const typing = document.activeElement?.closest?.('#app') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (typing) dirty = true; else render();
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (dirty && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) { dirty = false; render(); }
}, 50));

function applyTheme() {
  const t = db.settings().theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// Zelfde wijn (producent + naam + jaar) telt op in plaats van dubbel
async function addWines(list, photoId) {
  const key = (w) => [w.winery, w.name, w.vintage].map((v) => String(v ?? '').toLowerCase().trim()).join('|');
  let added = 0;
  for (const raw of list) {
    const w = normalizeWine(raw);
    if (!w.name) continue;
    const existing = S.wines.find((x) => key(x) === key(w));
    if (existing) await db.saveWine({ ...existing, quantity: existing.quantity + (w.quantity || 1), photo: existing.photo ?? photoId });
    else await db.saveWine({ ...w, photo: w.photo ?? photoId });
    added += w.quantity || 1;
  }
  await load();
  return added;
}

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ================= views ================= */

function greeting() {
  const h = new Date().getHours();
  const name = db.settings().name;
  const part = h < 6 ? 'Goedenacht' : h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
  return name ? `${part}, ${esc(name)}` : part;
}

const MOODS = ['Licht en fris', 'Iets feestelijks', 'Op = op, drink wat weg moet', 'Verras me', 'Geen alcohol-bom'];

function viewToday() {
  const st = stats(S.wines, YEAR);
  const p = S.pair;
  const total = Math.max(1, st.bottles);
  const typebar = TYPE_KEYS.filter((t) => st.byType[t]).map((t) =>
    `<i style="width:${(st.byType[t] / total) * 100}%;background:${TYPES[t].color}" title="${TYPES[t].label}: ${st.byType[t]}"></i>`).join('');
  const legend = TYPE_KEYS.filter((t) => st.byType[t]).map((t) =>
    `<span><i style="background:${TYPES[t].color}"></i>${TYPES[t].label} ${st.byType[t]}</span>`).join('');

  return `<div class="view">
    <header class="top">
      <span class="eyebrow">${greeting()}</span>
      <h1>Wat gaat er <em>open</em> vandaag?</h1>
    </header>

    ${!isStandalone() && isIos() ? `<button class="card row between" data-action="sub" data-sub="installeren" style="text-align:left;cursor:pointer">
      <span><b>Zet me op je beginscherm</b><br><span class="small muted">Dan werk ik als een echte app, ook offline.</span></span><span class="link">Hoe?</span></button>` : ''}

    <section class="card ask raised" aria-label="Wijn bij je eten">
      <textarea id="dish" rows="2" placeholder="Wat eet je? bv. stoofvlees met friet, of zalm met citroen uit de oven">${esc(p.dish)}</textarea>
      ${p.preview ? `<div class="attach"><img src="${p.preview}" alt="Foto van je gerecht"><span class="small">Foto van je gerecht</span><button class="link" data-action="pair-clear-photo" style="margin-left:auto">Weg</button></div>` : ''}
      ${p.showUrl ? `<input id="pair-url" type="url" inputmode="url" placeholder="Plak een link naar het recept" value="${esc(p.url)}">` : ''}
      <div class="ask-tools">
        <label class="icon-btn" aria-label="Foto van je gerecht" title="Foto van je gerecht" style="position:relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <input type="file" accept="image/*" data-change="pair-photo" style="position:absolute;inset:0;opacity:0">
        </label>
        <button class="icon-btn ${p.showUrl ? 'on' : ''}" data-action="pair-url" aria-label="Recept-link" title="Recept-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>
        </button>
        <span class="stepper" aria-label="Aantal mensen">
          <button data-action="people" data-delta="-1" aria-label="Minder mensen">−</button>
          <output>${p.people}</output>
          <button data-action="people" data-delta="1" aria-label="Meer mensen">+</button>
        </span>
        <span class="small muted">${p.people === 1 ? 'persoon' : 'personen'}</span>
      </div>
      <div class="chips">${MOODS.map((m) => `<button class="chip" data-action="mood" data-mood="${esc(m)}" aria-pressed="${p.mood.includes(m)}">${esc(m)}</button>`).join('')}</div>
      <button class="btn wine block" data-action="pair" ${p.loading ? 'disabled' : ''}>Kies mijn wijn</button>
    </section>

    <section id="pair-result" aria-live="polite">${pairResult()}</section>

    ${S.weather ? `<section class="card row" style="gap:14px;flex-wrap:nowrap"><span style="font-size:2rem">${S.weather.icon}</span>
      <span><b class="num">${S.weather.temp}°</b> <span class="muted">${esc(S.weather.text)}, max ${S.weather.max}°</span><br><span class="small">${esc(weather.weatherTip(S.weather))}</span></span></section>` : ''}

    ${st.urgent.length ? `<section class="stack">
      <div class="row between"><h2>Drink deze <em>binnenkort</em></h2></div>
      <div class="hscroll">${st.urgent.map(bottleRow).join('')}</div>
    </section>` : ''}

    <section class="stack">
      <h2>Je kelder in cijfers</h2>
      ${S.wines.length ? `<div class="tiles">
        <div class="tile"><b>${st.bottles}</b><span>flessen</span></div>
        <div class="tile"><b>${st.labels}</b><span>verschillende wijnen</span></div>
        <div class="tile"><b>${st.value ? euro(st.value) : '–'}</b><span>geschatte waarde</span></div>
        <div class="tile"><b>${st.oldest ?? '–'}</b><span>oudste jaargang</span></div>
      </div>
      ${st.bottles ? `<div class="typebar" role="img" aria-label="Verdeling per soort">${typebar}</div><div class="legend">${legend}</div>` : ''}`
      : `<div class="empty"><h3>Nog geen flessen</h3><p>Tik op de rode + om je eerste fles toe te voegen. Een foto van het etiket is het snelst.</p><button class="btn" data-action="add">Fles toevoegen</button></div>`}
    </section>
  </div>`;
}

function pairResult() {
  const p = S.pair;
  if (p.loading) return `<div class="card">${loading('Even in de kelder kijken...')}</div>`;
  if (p.error) return `<div class="card"><p class="danger">${esc(p.error)}</p></div>`;
  const r = p.result;
  if (!r) return '';
  const byId = new Map(S.wines.map((w) => [w.id, w]));
  const pick = r.keuze && byId.get(r.keuze.id);
  const scoreColor = (m) => (m >= 8 ? 'var(--ok)' : m >= 6 ? 'var(--gold)' : 'var(--warn)');
  let html = `<div class="card raised advice">
    <div class="stack" style="gap:4px"><span class="eyebrow">${esc(r.gerecht)}</span><p class="muted small">${esc(r.sleutel)}</p></div>`;
  if (pick) {
    html += `<div class="pick">
      <span class="pour" style="background:${typeColor(pick)}"></span>
      <div>
        <div class="row between" style="flex-wrap:nowrap;align-items:start">
          <div class="stack" style="gap:2px;min-width:0"><span class="eyebrow">Trek deze open</span><h3>${esc(label(pick))}</h3></div>
          <span class="score" style="border:2px solid ${scoreColor(r.keuze.match)};color:${scoreColor(r.keuze.match)}" aria-label="Match ${r.keuze.match} van 10">${r.keuze.match}</span>
        </div>
        <p>${esc(r.keuze.waarom)}</p>
        <p class="small muted">🌡️ ${esc(r.keuze.serveren)}${r.flessen > 1 ? ` · Je hebt ${r.flessen} flessen nodig${pick.quantity < r.flessen ? `, er liggen er ${pick.quantity}` : ''}.` : ''}</p>
        <div class="row">
          <button class="btn sm wine" data-action="open-bottle" data-id="${esc(pick.id)}">Geopend, haal er 1 af</button>
          <button class="btn sm ghost" data-action="wine" data-id="${esc(pick.id)}">Bekijk fles</button>
        </div>
      </div>
    </div>`;
  }
  for (const a of r.alternatieven ?? []) {
    const w = byId.get(a.id);
    if (!w || w.id === pick?.id) continue;
    html += `<div class="alt"><span class="pour" style="background:${typeColor(w)}"></span><div class="stack" style="gap:4px;min-width:0">
      <div class="row between"><b>${esc(label(w))}</b><span class="small muted num">${a.match}/10</span></div>
      <p class="small">${esc(a.waarom)}</p>
      <div class="row"><button class="link small" data-action="open-bottle" data-id="${esc(w.id)}">Deze open ik</button></div>
    </div></div>`;
  }
  if (r.koopTip?.stijl) {
    html += `<div class="alt"><span class="pour" style="background:var(--gold)"></span><div class="stack" style="gap:4px">
      <span class="eyebrow">${pick ? 'Of koop dit' : 'Niks passends in huis, koop dit'}</span>
      <b>${esc(r.koopTip.stijl)}</b><p class="small">${esc(r.koopTip.waarom)}</p>
      <p class="small muted">Bijvoorbeeld: ${esc(r.koopTip.voorbeeld)}</p>
      <div><button class="btn sm ghost" data-action="wish-from-tip">Op de kooplijst</button></div>
    </div></div>`;
  }
  return html + '</div>';
}

function viewCellar() {
  const f = S.filter;
  let list = S.wines.filter((w) => f.showEmpty || w.quantity > 0)
    .filter((w) => matches(w, f.q))
    .filter((w) => !f.type || w.type === f.type)
    .filter((w) => !f.status || drinkStatus(w, YEAR) === f.status);
  list = list.sort(SORTS[f.sort] ?? SORTS.soort);
  const bottles = list.reduce((n, w) => n + w.quantity, 0);
  const typeChips = TYPE_KEYS.map((t) => `<button class="chip" data-action="filter-type" data-type="${t}" aria-pressed="${f.type === t}"><span class="dot" style="background:${TYPES[t].color}"></span>${TYPES[t].label}</button>`).join('');
  const statusChips = Object.entries(STATUS_LABEL).map(([k, v]) => `<button class="chip" data-action="filter-status" data-status="${k}" aria-pressed="${f.status === k}">${v}</button>`).join('');
  return `<div class="view">
    <header class="top"><span class="eyebrow num">${bottles} ${bottles === 1 ? 'fles' : 'flessen'}</span><h1>De <em>kelder</em></h1></header>
    <input id="search" type="search" placeholder="Zoek op naam, druif, land, vak..." value="${esc(f.q)}" autocomplete="off">
    <div class="chips">${typeChips}</div>
    <div class="chips">${statusChips}</div>
    <div class="row between">
      <label class="row small muted" style="gap:6px"><input type="checkbox" id="show-empty" ${f.showEmpty ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--gold)"> ook lege</label>
      <select id="sort" style="width:auto" aria-label="Sorteren">
        ${[['soort', 'Op soort'], ['naam', 'Op naam'], ['jaar', 'Oudste eerst'], ['drinken', 'Eerst opdrinken'], ['nieuw', 'Laatst toegevoegd'], ['prijs', 'Duurste eerst'], ['score', 'Hoogste score']]
          .map(([k, v]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="list">${list.length ? list.map(bottleRow).join('')
      : S.wines.length ? '<div class="empty">Niks gevonden met deze filters.</div>'
      : '<div class="empty"><h3>Lege kelder</h3><p>Tik op de rode + om flessen toe te voegen.</p></div>'}</div>
  </div>`;
}

const QUICK_QUESTIONS = [
  'Welke flessen moet ik als eerste opdrinken?',
  'Wat ontbreekt er in mijn kelder?',
  'Plan een wijnavond voor 6 met wat ik heb',
  'Welke fles is het meest bijzonder?',
  'Ik heb €30, wat moet ik kopen?',
];

function viewSommelier() {
  const c = S.chat;
  const bubbles = c.display.map((m, i) => `<div class="msg ${m.role === 'user' ? 'me' : 'ai'}" ${m.live ? 'id="chat-live"' : ''}>
    ${m.preview ? `<img src="${m.preview}" alt="">` : ''}${m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') : (m.text ? md(m.text) : loading('Denkt na...'))}
    ${m.error ? `<p class="danger small">${esc(m.error)}</p>` : ''}</div>`).join('');
  return `<div class="view">
    <header class="top row between" style="align-items:end">
      <div><span class="eyebrow">Kent je hele kelder</span><h1>De <em>sommelier</em></h1></div>
      ${c.display.length ? '<button class="btn sm ghost" data-action="chat-reset">Nieuw gesprek</button>' : ''}
    </header>
    <div class="chat" id="chat">
      ${c.display.length ? bubbles : `<p class="muted">Vraag alles over wijn of over je kelder. Stuur gerust een foto mee van een wijnkaart, een etiket in de winkel of je eten.</p>
      <div class="wrap-chips">${QUICK_QUESTIONS.map((q) => `<button class="chip" data-action="chat-quick">${esc(q)}</button>`).join('')}</div>`}
    </div>
  </div>
  <div class="composer"><div>
    <label class="icon-btn ${c.preview ? 'on' : ''}" aria-label="Foto meesturen" style="position:relative">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
      <input type="file" accept="image/*" data-change="chat-photo" style="position:absolute;inset:0;opacity:0">
    </label>
    <textarea id="chat-input" rows="1" placeholder="${c.preview ? 'Wat wil je weten over de foto?' : 'Vraag de sommelier...'}"></textarea>
    ${c.busy ? '<button class="icon-btn on" data-action="chat-stop" aria-label="Stop">■</button>'
      : '<button class="icon-btn on" data-action="chat-send" aria-label="Versturen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>'}
  </div></div>`;
}

function viewMore() {
  const sub = S.sub;
  if (sub === 'logboek') return viewLog();
  if (sub === 'kooplijst') return viewWishlist();
  if (sub === 'instellingen') return viewSettings();
  if (sub === 'backup') return viewBackup();
  if (sub === 'installeren') return viewInstall();
  const item = (key, ic, text, extra = '') => `<button data-action="sub" data-sub="${key}"><span class="ic">${ic}</span>${text}${extra}<span class="chev">›</span></button>`;
  const open = S.wishlist.filter((w) => !w.done).length;
  return `<div class="view">
    <header class="top"><span class="eyebrow">Alles op een rij</span><h1><em>Meer</em></h1></header>
    <div class="menu">
      ${item('logboek', '📖', 'Logboek', `<span class="small muted" style="margin-left:6px">${S.log.length} geopend</span>`)}
      ${item('kooplijst', '🛒', 'Kooplijst', open ? `<span class="small muted" style="margin-left:6px">${open} te halen</span>` : '')}
    </div>
    <div class="menu">
      ${item('instellingen', '⚙️', 'Instellingen', AI.hasKey() ? '' : '<span class="pill nu" style="margin-left:8px">sleutel nodig</span>')}
      ${item('backup', '💾', 'Backup en export')}
      ${item('installeren', '📲', 'Op je iPhone zetten')}
    </div>
    <p class="small muted">Alles staat alleen op dit toestel. Maak af en toe een backup.</p>
  </div>`;
}

const back = `<button class="back" data-action="sub" data-sub="">‹ Meer</button>`;

function viewLog() {
  const items = [...S.log].sort((a, b) => b.date - a.date);
  const fmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="view">${back}
    <header class="top"><span class="eyebrow">Wat je hebt opengetrokken</span><h1>Het <em>logboek</em></h1></header>
    <div class="list">${items.length ? items.map((l) => `<div class="card stack" style="gap:6px">
      <div class="row between"><b>${esc(label(l.wine))}</b><span class="small muted">${fmt.format(l.date)}</span></div>
      ${l.dish ? `<span class="small">🍽️ ${esc(l.dish)}</span>` : ''}
      <div class="row between">${stars(l.rating, 'rate-log', l.id)}<button class="link small danger" data-action="del-log" data-id="${esc(l.id)}">weg</button></div>
    </div>`).join('') : '<div class="empty"><h3>Nog niks geopend</h3><p>Als je bij een advies op "Geopend" tikt, komt hij hier te staan. Dan kun je hem later een score geven.</p></div>'}</div>
  </div>`;
}

function viewWishlist() {
  const items = [...S.wishlist].sort((a, b) => (a.done - b.done) || (b.added - a.added));
  return `<div class="view">${back}
    <header class="top"><span class="eyebrow">Voor bij de slijter</span><h1>De <em>kooplijst</em></h1></header>
    <form class="row" data-submit="wish-add" style="flex-wrap:nowrap"><input id="wish-text" placeholder="bv. lichte pinot noir voor bij vis" autocomplete="off"><button class="btn">Erbij</button></form>
    <div class="list">${items.length ? items.map((w) => `<div class="card row" style="flex-wrap:nowrap;align-items:start;${w.done ? 'opacity:.5' : ''}">
      <input type="checkbox" data-change="wish-done" data-id="${esc(w.id)}" ${w.done ? 'checked' : ''} style="width:22px;height:22px;flex:none;accent-color:var(--gold);margin-top:2px" aria-label="Gekocht">
      <div class="stack" style="gap:2px;flex:1;min-width:0"><b style="${w.done ? 'text-decoration:line-through' : ''}">${esc(w.text)}</b>${w.why ? `<span class="small muted">${esc(w.why)}</span>` : ''}
        ${w.done ? '' : `<div class="row"><button class="link small" data-action="wish-bought" data-id="${esc(w.id)}">Gekocht, zet in kelder</button></div>`}</div>
      <button class="link small danger" data-action="wish-del" data-id="${esc(w.id)}">weg</button>
    </div>`).join('') : '<div class="empty"><p>Nog leeg. Als de sommelier een koop-tip geeft, kun je die hier bewaren.</p></div>'}</div>
  </div>`;
}

function keyBlock(p, title, hint, value, howto) {
  return `<div class="stack" style="gap:8px;padding-top:6px">
    <b>${title}</b>
    <p class="small muted">${howto}</p>
    <input id="key-${p}" type="password" autocomplete="off" placeholder="${esc(hint)}" value="${esc(value)}">
    <div class="row"><button class="btn sm" data-action="save-key" data-provider="${p}">Opslaan en testen</button><span id="msg-${p}" class="small"></span></div>
  </div>`;
}

function viewSettings() {
  const s = db.settings();
  return `<div class="view">${back}
    <header class="top"><span class="eyebrow">Afstellen</span><h1><em>Instellingen</em></h1></header>
    <section class="card stack">
      <h3>Perplexity <em>(je tegoed)</em></h3>
      ${keyBlock('perplexity', 'Perplexity API-sleutel', 'pplx-...', s.perplexityKey,
        'Maak een sleutel in de <b>API Console</b> op <b>console.perplexity.ai</b> → <b>API Keys</b>. Gaat van je tegoed af, ongeveer een halve tot 1 cent per vraag. Wordt als eerste gebruikt voor advies en de sommelier, en voor <b>online zoeken</b> bij "Info opzoeken" en onbekende barcodes.')}
    </section>
    <section class="card stack">
      <h3>Gemini <em>(gratis reserve)</em></h3>
      ${keyBlock('gemini', 'Gemini van Google', 'AIza...', s.geminiKey,
        'Ga naar <b>aistudio.google.com</b> → <b>Get API key</b> → <b>Create API key</b>. Log in met je Google-account, geen creditcard nodig. Neemt het over als Perplexity het niet doet.')}
      <p class="small muted">Gratis AI mag je vragen en foto's gebruiken om te trainen. Deel geen privé-dingen met de sommelier. Je sleutels blijven op dit toestel.</p>
    </section>
    <section class="card stack">
      <h3>Claude <em>(betaald, optioneel)</em></h3>
      ${keyBlock('claude', 'Claude API-sleutel', 'sk-ant-...', s.apiKey,
        'Op <b>console.anthropic.com</b> → API Keys, met wat tegoed erop. Ongeveer 1 tot 3 cent per vraag.')}
      <label class="switch" style="border:0;padding-bottom:0"><span><b>Claude als eerste keus</b><br><span class="small muted">Anders Perplexity en daarna Gemini.</span></span><input type="checkbox" data-change="set-prefer-claude" ${s.preferClaude ? 'checked' : ''}></label>
    </section>
    <section class="card">
      <label class="field"><span>Je naam (voor de begroeting)</span><input id="set-name" value="${esc(s.name)}" placeholder="Koen"></label>
      <label class="switch"><span><b>Sommelier mag online zoeken</b><br><span class="small muted">Voor prijzen, recensies en recepten. Iets duurder per vraag.</span></span><input type="checkbox" data-change="set-web" ${s.webSearch ? 'checked' : ''}></label>
      <label class="switch"><span><b>Weer-tip op Vandaag</b><br><span class="small muted">Gebruikt je locatie en Open-Meteo.</span></span><input type="checkbox" data-change="set-weather" ${s.weather ? 'checked' : ''}></label>
      <label class="field" style="padding-top:14px"><span>Thema</span>
        <select data-change="set-theme">${[['auto', 'Volg iPhone'], ['dark', 'Kelder (donker)'], ['light', 'Daglicht (licht)']].map(([k, v]) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
    </section>
  </div>`;
}

function viewBackup() {
  return `<div class="view">${back}
    <header class="top"><span class="eyebrow">Veilig bewaren</span><h1><em>Backup</em></h1></header>
    <section class="card stack">
      <p>Je kelder staat alleen op dit toestel. Bewaar af en toe een backup in iCloud Drive of stuur hem naar jezelf.</p>
      <button class="btn block" data-action="export-json">Backup maken (met foto's)</button>
      <button class="btn ghost block" data-action="export-csv">Exporteren voor Excel (CSV)</button>
    </section>
    <section class="card stack">
      <h3>Backup terugzetten</h3>
      <label class="btn line block" style="position:relative">Kies backup-bestand<input type="file" accept="application/json,.json" data-change="import-json" style="position:absolute;inset:0;opacity:0"></label>
      <p class="small muted">Bestaande flessen blijven staan, flessen uit de backup worden toegevoegd of bijgewerkt.</p>
    </section>
    <section class="card stack">
      <h3 class="danger">Alles wissen</h3>
      <button class="btn line block danger" data-action="wipe">Kelder, logboek en kooplijst wissen</button>
    </section>
  </div>`;
}

function viewInstall() {
  return `<div class="view">${back}
    <header class="top"><span class="eyebrow">Eenmalig, 20 seconden</span><h1>Op je <em>iPhone</em></h1></header>
    <section class="card stack">
      <ol class="steps">
        <li><span>Open deze pagina in <b>Safari</b> (niet in Chrome of een app).</span></li>
        <li><span>Tik onderin op de <b>deel-knop</b> (het vierkantje met de pijl omhoog).</span></li>
        <li><span>Scroll en kies <b>Zet op beginscherm</b>.</span></li>
        <li><span>Tik op <b>Voeg toe</b>. Klaar, Wijnkelder staat nu tussen je apps.</span></li>
      </ol>
    </section>
    <section class="card stack">
      <h3>Snel vragen met Siri</h3>
      <p class="small">Maak in de app <b>Opdrachten</b> een opdracht met de actie <b>Open URL</b> en plak dit adres erin:</p>
      <code style="overflow-wrap:anywhere">${esc(new URL('./#vandaag', location.href).href)}</code>
      <p class="small muted">Noem hem "Welke wijn" en zeg "Hé Siri, welke wijn", dan staat de app meteen klaar.</p>
    </section>
  </div>`;
}

/* ================= render ================= */

function render() {
  const app = $('#app');
  const views = { vandaag: viewToday, kelder: viewCellar, sommelier: viewSommelier, meer: viewMore };
  const scroll = window.scrollY;
  app.innerHTML = (views[S.tab] ?? viewToday)();
  for (const b of $$('.tabs [data-tab]')) {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  hydratePhotos(app);
  if (S.tab === 'sommelier') requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
  else window.scrollTo(0, scroll);
}

function go(tab, sub = null) {
  S.tab = tab;
  S.sub = sub;
  history.replaceState(null, '', `#${tab}${sub ? '/' + sub : ''}`);
  window.scrollTo(0, 0);
  render();
}

/* ================= wijn bekijken / bewerken ================= */

function wineSheet(id) {
  const w = S.wines.find((x) => x.id === id);
  if (!w) return;
  const opens = S.log.filter((l) => l.wineId === id).sort((a, b) => b.date - a.date);
  const fmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  const fact = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  openSheet(esc(w.name), `
    <div class="hero" style="background:color-mix(in srgb, ${typeColor(w)} 30%, var(--surface))">${w.photo ? `<img data-photo="${esc(w.photo)}" alt="Foto van de fles">` : bottleSvg(typeColor(w))}</div>
    <div class="stack" style="gap:4px">
      <span class="eyebrow">${esc([w.winery, w.vintage].filter(Boolean).join(' · '))}</span>
      <h2>${esc(label(w))}</h2>
      <div class="row">${statusPill(w)}${w.rating ? `<span class="small" style="color:var(--gold)">${'★'.repeat(w.rating)}</span>` : ''}</div>
    </div>
    <div class="row between card" style="padding:10px 14px">
      <span><b>Op voorraad</b></span>
      <span class="stepper"><button data-action="qty" data-id="${esc(w.id)}" data-delta="-1" aria-label="Eén minder">−</button><output class="num">${w.quantity}</output><button data-action="qty" data-id="${esc(w.id)}" data-delta="1" aria-label="Eén meer">+</button></span>
    </div>
    <dl class="facts" style="margin:0">
      ${fact('Soort', TYPES[w.type]?.label)}${fact('Druif', w.grape)}${fact('Appellation', w.appellation)}${fact('Regio', w.region)}
      ${fact('Land', w.country)}${fact('Drinkvenster', (w.drinkFrom || w.drinkUntil) && `${w.drinkFrom ?? '?'} tot ${w.drinkUntil ?? '?'}`)}
      ${fact('Prijs', w.price && euro(w.price))}${fact('Alcohol', w.abv && `${w.abv}%`)}${fact('Ligt in', w.location)}${fact('Barcode', w.barcode)}
    </dl>
    ${w.tasting ? `<div class="stack" style="gap:4px"><span class="eyebrow">Smaak</span><p>${esc(w.tasting)}</p></div>` : ''}
    ${w.pairsWith ? `<div class="stack" style="gap:4px"><span class="eyebrow">Past bij</span><p>${esc(w.pairsWith)}</p></div>` : ''}
    ${w.notes ? `<div class="stack" style="gap:4px"><span class="eyebrow">Notitie</span><p>${esc(w.notes)}</p></div>` : ''}
    ${w.sources?.length ? `<div class="stack" style="gap:6px"><span class="eyebrow">Gevonden op internet</span>${w.sources.map((r) =>
      `<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--gold);overflow-wrap:anywhere">${esc(r.title)}</a>${r.date ? `<span class="small muted" style="margin-top:-4px">${esc(r.date)}</span>` : ''}`).join('')}</div>` : ''}
    <div class="stack">
      <button class="btn wine block" data-action="open-bottle" data-id="${esc(w.id)}" ${w.quantity ? '' : 'disabled'}>Fles openen</button>
      <div class="row" style="flex-wrap:nowrap">
        <button class="btn ghost" style="flex:1" data-action="edit-wine" data-id="${esc(w.id)}">Bewerken</button>
        <button class="btn ghost" style="flex:1" data-action="enrich" data-id="${esc(w.id)}">Info opzoeken</button>
      </div>
      <button class="btn line block" data-action="ask-about" data-id="${esc(w.id)}">Vraag de sommelier</button>
    </div>
    ${opens.length ? `<div class="stack" style="gap:6px"><span class="eyebrow">Eerder geopend</span>${opens.map((l) =>
      `<span class="small">${fmt.format(l.date)}${l.dish ? `, bij ${esc(l.dish)}` : ''}${l.rating ? ` · ${'★'.repeat(l.rating)}` : ''}</span>`).join('')}</div>` : ''}
    <button class="link danger" data-action="del-wine" data-id="${esc(w.id)}">Fles verwijderen</button>
  `);
}

const FORM_FIELDS = [
  ['name', 'Naam', 'text', 'full', 'Barolo'], ['winery', 'Producent', 'text', 'full', 'Pio Cesare'],
  ['vintage', 'Jaar', 'number', '', '2018'], ['price', 'Prijs (€)', 'decimal', '', '24,95'],
  ['grape', 'Druif', 'text', 'full', 'Nebbiolo'], ['appellation', 'Appellation', 'text', '', 'Barolo DOCG'],
  ['region', 'Regio', 'text', '', 'Piemonte'], ['country', 'Land', 'text', '', 'Italië'], ['abv', 'Alcohol %', 'decimal', '', '14'],
  ['drinkFrom', 'Drinken vanaf', 'number', '', '2024'], ['drinkUntil', 'Drinken tot', 'number', '', '2035'],
  ['location', 'Ligt in (vak/rek)', 'text', 'full', 'Rek 2, vak B'],
  ['tasting', 'Smaak', 'area', 'full', 'Kers, roos, teer...'], ['pairsWith', 'Past bij', 'area', 'full', 'Truffelrisotto, wild...'],
  ['notes', 'Notitie', 'area', 'full', 'Gekregen van oom Henk'],
];

function wineForm(initial = {}, { title = 'Fles toevoegen', onDone } = {}) {
  const w = normalizeWine({ quantity: 1, ...initial });
  const state = { type: w.type, quantity: w.quantity, rating: w.rating ?? 0, photoBlob: null, photo: w.photo };
  const input = ([k, lab, kind, cls, ph]) => {
    const v = w[k] ?? '';
    const tag = kind === 'area'
      ? `<textarea name="${k}" id="f-${k}" rows="2" placeholder="${esc(ph)}">${esc(v)}</textarea>`
      : `<input name="${k}" id="f-${k}" ${kind === 'number' ? 'type="number" inputmode="numeric"' : kind === 'decimal' ? 'inputmode="decimal"' : 'type="text"'} placeholder="${esc(ph)}" value="${esc(v)}">`;
    return `<label class="field ${cls}"><span>${lab}</span>${tag}</label>`;
  };
  openSheet(title, `
    <form class="stack" data-submit="save-wine" id="wine-form">
      <div class="row" style="flex-wrap:nowrap;gap:14px">
        <label class="thumb" style="width:72px;height:92px;position:relative;cursor:pointer;flex:none;background:color-mix(in srgb, ${typeColor(w)} 22%, var(--surface-2))" aria-label="Foto kiezen">
          ${w.photo ? `<img data-photo="${esc(w.photo)}" alt="" id="form-photo">` : `<span id="form-photo" class="small muted" style="text-align:center">📷<br>foto</span>`}
          <input type="file" accept="image/*" data-change="form-photo" style="position:absolute;inset:0;opacity:0">
        </label>
        <div class="stack" style="flex:1;gap:8px">
          <span class="field"><span>Op voorraad</span></span>
          <span class="stepper"><button type="button" data-action="form-qty" data-delta="-1" aria-label="Minder">−</button><output id="form-qty" class="num">${state.quantity}</output><button type="button" data-action="form-qty" data-delta="1" aria-label="Meer">+</button></span>
        </div>
      </div>
      <div class="field"><span>Soort</span><div class="wrap-chips">${TYPE_KEYS.map((t) => `<button type="button" class="chip" data-action="form-type" data-type="${t}" aria-pressed="${state.type === t}"><span class="dot" style="background:${TYPES[t].color}"></span>${TYPES[t].label}</button>`).join('')}</div></div>
      <div class="fields">${FORM_FIELDS.map(input).join('')}</div>
      <div class="field"><span>Jouw score</span><div id="form-stars">${stars(state.rating, 'form-rate')}</div></div>
      <button class="btn wine block" type="submit">Opslaan</button>
    </form>`, {
    onMount(sheet) {
      sheet._form = { state, initial: w, onDone };
    },
  });
}

async function saveWineForm(form) {
  const { state, initial, onDone } = $('.sheet')._form;
  const data = Object.fromEntries(new FormData(form));
  if (!String(data.name ?? '').trim()) { toast('Geef de wijn een naam'); $('#f-name')?.focus(); return; }
  let photo = state.photo;
  if (state.photoBlob) photo = await db.savePhoto(await thumbnail(state.photoBlob));
  const wine = { ...initial, ...data, type: state.type, quantity: state.quantity, rating: state.rating || undefined, photo };
  if (onDone) { closeSheet(); onDone(normalizeWine(wine)); return; }
  if (initial.id) await db.saveWine(wine);
  else await addWines([wine], photo);
  closeSheet();
  toast(`${wine.name} staat in de kelder`);
}

/* ================= toevoegen ================= */

function addSheet() {
  const key = AI.hasKey();
  openSheet('Fles <em>toevoegen</em>', `
    <div class="methods">
      <label class="method" ${key ? '' : 'aria-disabled="true"'}>
        <span class="ic">📸</span><b>Foto</b><span>Van een etiket, of je hele rek in één keer</span>
        ${key ? '<input type="file" accept="image/*" data-change="add-photo">' : ''}
      </label>
      <button class="method" data-action="add-scan"><span class="ic">▥</span><b>Streepjescode</b><span>Scan de barcode op de fles</span></button>
      <button class="method" data-action="add-text" ${key ? '' : 'aria-disabled="true"'}><span class="ic">✍️</span><b>Typ het</b><span>"6 flessen Cava en een Barolo 2018"</span></button>
      <button class="method" data-action="add-manual"><span class="ic">📝</span><b>Zelf invullen</b><span>Alle velden met de hand</span></button>
    </div>
    ${key ? '' : '<p class="small muted">Foto en typen werken met AI. Zet een gratis sleutel bij Meer > Instellingen.</p>'}
    <div id="add-status"></div>`);
}

async function handleFound(wines, photoBlob) {
  if (!wines.length) {
    sheetBody().querySelector('#add-status')?.replaceChildren();
    toast('Ik kon er geen wijn in vinden. Probeer een scherpere foto of typ het.');
    return;
  }
  const photoId = photoBlob ? await db.savePhoto(await thumbnail(photoBlob)) : null;
  if (wines.length === 1) {
    wineForm({ ...wines[0], photo: photoId }, { title: 'Klopt dit?' });
    return;
  }
  reviewSheet(wines.map((w) => ({ ...normalizeWine(w), photo: photoId, keep: true })));
}

function reviewSheet(items) {
  openSheet(`${items.length} wijnen <em>gevonden</em>`, `
    <p class="small muted">Vink uit wat je niet wilt toevoegen. Tik op een wijn om hem aan te passen.</p>
    <div class="list">${items.map((w, i) => `<div class="found">
      <input type="checkbox" data-change="review-keep" data-i="${i}" ${w.keep ? 'checked' : ''} aria-label="Toevoegen">
      <button class="t" data-action="review-edit" data-i="${i}" style="background:none;border:0;text-align:left;padding:0;cursor:pointer;min-width:0">
        <b style="font-family:var(--display);font-size:1.15rem;font-weight:400">${esc(label(w))}</b><br><span class="small muted">${esc(metaLine(w))}</span></button>
      <span class="stepper"><button type="button" data-action="review-qty" data-i="${i}" data-delta="-1" aria-label="Minder">−</button><output class="num">${w.quantity}</output><button type="button" data-action="review-qty" data-i="${i}" data-delta="1" aria-label="Meer">+</button></span>
    </div>`).join('')}</div>
    <button class="btn wine block" data-action="review-save">Zet ${items.filter((w) => w.keep).length} in de kelder</button>
  `, { onMount: (s) => { s._review = items; } });
}

function textSheet() {
  openSheet('Typ <em>wat je hebt</em>', `
    <form class="stack" data-submit="add-text">
      <textarea id="add-text-input" rows="4" placeholder="bv. 6 flessen Codorníu cava, 2 Barolo 2018 van Pio Cesare en een Sancerre van Vacheron"></textarea>
      <button class="btn wine block">Invullen</button>
      <div id="add-status"></div>
    </form>`, { onMount: (s) => setTimeout(() => $('#add-text-input', s)?.focus(), 350) });
}

function scanSheet() {
  let stop = null;
  openSheet('Scan de <em>streepjescode</em>', `
    <div class="scanner"><video id="scan-video" playsinline muted></video><div class="frame"></div></div>
    <div id="scan-status" class="small muted">Richt de camera op de streepjescode op het achteretiket.</div>
    <label class="btn line block" style="position:relative">Of kies een foto van de barcode<input type="file" accept="image/*" data-change="scan-photo" style="position:absolute;inset:0;opacity:0"></label>
    <form class="row" data-submit="scan-manual" style="flex-wrap:nowrap"><input id="scan-code" inputmode="numeric" placeholder="Of typ de cijfers"><button class="btn ghost">Zoek</button></form>
  `, {
    onMount: async (sheet) => {
      try {
        stop = await startScanner($('#scan-video', sheet), (code) => onBarcode(code));
      } catch (e) {
        const msg = e?.name === 'NotAllowedError' ? 'Geen toegang tot de camera. Sta het toe bij Instellingen > Safari > Camera, of kies hieronder een foto.' : 'De camera starten lukte niet. Kies hieronder een foto van de barcode.';
        $('#scan-status', sheet).textContent = msg;
      }
    },
    onClose: () => stop?.(),
  });
}

async function onBarcode(code) {
  const status = $('#scan-status');
  if (status) status.innerHTML = loading(`Code ${code} opzoeken...`);
  try {
    const product = await lookupBarcode(code);
    if (!product) {
      // Niet in Open Food Facts: dan het web doorzoeken op de code
      if (hasSearchKey() && AI.hasKey()) {
        if (status) status.innerHTML = loading(`Code ${code} op internet zoeken...`);
        try {
          const results = await webSearch([`${code}`, `${code} wijn`], { maxResults: 5 });
          if (results.length) {
            const wines = await AI.identifyFromSearch(code, sourcesForPrompt(results));
            if (wines[0]?.name) { wineForm({ ...wines[0], barcode: code }, { title: 'Klopt dit?' }); return; }
          }
        } catch (e) {
          console.warn('Barcode zoeken mislukt:', e.code ?? e.message);
        }
      }
      if (status) status.innerHTML = `<span>Code <b>${esc(code)}</b> kon ik niet vinden. Maak een foto van het etiket of vul hem zelf in.</span>`;
      setTimeout(() => wineForm({ barcode: code }, { title: 'Zelf invullen' }), 1800);
      return;
    }
    if (AI.hasKey()) {
      if (status) status.innerHTML = loading(`Gevonden: ${product.naam ?? code}. ${AI.providerLabel()} vult de rest aan...`);
      const wines = await AI.identifyFromProduct(product);
      wineForm({ ...(wines[0] ?? {}), barcode: code }, { title: 'Klopt dit?' });
    } else {
      wineForm({ name: product.naam, winery: product.merk, country: product.land, abv: product.alcohol, barcode: code }, { title: 'Klopt dit?' });
    }
  } catch (e) {
    if (status) status.innerHTML = `<span class="danger">${esc(AI.friendlyError(e))}</span>`;
  }
}

/* ================= acties ================= */

async function doPair() {
  const p = S.pair;
  p.dish = $('#dish')?.value.trim() ?? p.dish;
  p.url = $('#pair-url')?.value.trim() ?? p.url;
  if (!p.dish && !p.image && !p.url) { toast('Vertel eerst wat je eet'); $('#dish')?.focus(); return; }
  if (!AI.hasKey()) { toast('Zet eerst je AI-sleutel bij Instellingen'); go('meer', 'instellingen'); return; }
  Object.assign(p, { loading: true, error: '', result: null });
  render();
  $('#pair-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const r = await AI.pair({
      dish: p.dish, image: p.image, url: p.url, people: p.people,
      mood: p.mood.join(', '), cellar: cellarForPrompt(S.wines, YEAR),
    });
    const ids = new Set(S.wines.filter((w) => w.quantity > 0).map((w) => w.id));
    if (r.keuze && !ids.has(r.keuze.id)) r.keuze = null;
    r.alternatieven = (r.alternatieven ?? []).filter((a) => ids.has(a.id));
    if (!r.keuze && r.alternatieven.length) r.keuze = { serveren: '', ...r.alternatieven.shift() };
    p.result = r;
  } catch (e) {
    p.error = AI.friendlyError(e);
  } finally {
    p.loading = false;
    render();
    $('#pair-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function openBottle(id) {
  const w = S.wines.find((x) => x.id === id);
  if (!w || w.quantity < 1) return;
  const dish = S.tab === 'vandaag' ? (S.pair.dish || S.pair.result?.gerecht) : '';
  await db.openBottle(w, { dish, people: S.pair.people });
  closeSheet();
  const left = w.quantity - 1;
  toast(`Proost! ${left ? `Nog ${left} over.` : 'Dit was de laatste.'} Geef hem later een score in het logboek.`);
}

async function chatSend(text) {
  const c = S.chat;
  text = (text ?? $('#chat-input')?.value ?? '').trim();
  if (!text && !c.image) return;
  if (!AI.hasKey()) { toast('Zet eerst je AI-sleutel bij Instellingen'); go('meer', 'instellingen'); return; }
  if (c.busy) return;
  c.system ??= AI.chatSystem(cellarForPrompt(S.wines, YEAR), db.settings().name);
  c.history.push({ role: 'user', text: text || 'Wat zie je op deze foto, en wat betekent het voor mij?', image: c.image });
  c.display.push({ role: 'user', text: text || '(foto)', preview: c.preview });
  const live = { role: 'assistant', text: '', live: true };
  c.display.push(live);
  c.image = null; c.preview = null; c.busy = true; c.ctl = new AbortController();
  render();
  try {
    const r = await AI.chat({
      system: c.system, history: c.history, signal: c.ctl.signal,
      onText: (t) => { live.text = t; const el = $('#chat-live'); if (el) { el.innerHTML = md(t); window.scrollTo(0, document.body.scrollHeight); } },
    });
    c.history.push({ role: 'assistant', text: r.text, raw: r.raw });
    live.text = r.text;
  } catch (e) {
    c.history.pop(); // vraag zonder antwoord niet meenemen naar de volgende beurt
    live.error = AI.isAbort(e) ? 'Gestopt.' : AI.friendlyError(e);
  } finally {
    live.live = false;
    c.busy = false;
    c.ctl = null;
    if (S.tab === 'sommelier') render();
  }
}

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const ACTIONS = {
  'close-sheet': () => closeSheet(),
  add: () => addSheet(),
  sub: (el) => go('meer', el.dataset.sub || null),
  wine: (el) => wineSheet(el.dataset.id),
  pair: () => doPair(),
  people: (el) => { S.pair.people = Math.max(1, Math.min(30, S.pair.people + Number(el.dataset.delta))); S.pair.dish = $('#dish')?.value ?? S.pair.dish; render(); },
  mood: (el) => { const m = el.dataset.mood; const list = S.pair.mood; S.pair.mood = list.includes(m) ? list.filter((x) => x !== m) : [...list, m]; el.setAttribute('aria-pressed', S.pair.mood.includes(m)); },
  'pair-url': () => { S.pair.dish = $('#dish')?.value ?? S.pair.dish; S.pair.showUrl = !S.pair.showUrl; if (!S.pair.showUrl) S.pair.url = ''; render(); if (S.pair.showUrl) $('#pair-url')?.focus(); },
  'pair-clear-photo': () => { S.pair.image = null; S.pair.preview = null; S.pair.dish = $('#dish')?.value ?? S.pair.dish; render(); },
  'open-bottle': (el) => openBottle(el.dataset.id),
  'wish-from-tip': async () => {
    const t = S.pair.result?.koopTip;
    if (!t) return;
    await db.put('wishlist', { text: t.stijl, why: `${t.waarom} Bv. ${t.voorbeeld}`, done: false });
    toast('Op de kooplijst gezet');
  },
  'filter-type': (el) => { S.filter.type = S.filter.type === el.dataset.type ? null : el.dataset.type; render(); },
  'filter-status': (el) => { S.filter.status = S.filter.status === el.dataset.status ? null : el.dataset.status; render(); },
  qty: async (el) => {
    const w = S.wines.find((x) => x.id === el.dataset.id);
    const q = Math.max(0, w.quantity + Number(el.dataset.delta));
    await db.saveWine({ ...w, quantity: q });
    el.parentElement.querySelector('output').textContent = q;
  },
  'edit-wine': (el) => { const w = S.wines.find((x) => x.id === el.dataset.id); wineForm(w, { title: 'Bewerken' }); },
  'del-wine': async (el) => {
    if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Zeker weten? Tik nog een keer'; return; }
    await db.remove('wines', el.dataset.id);
    closeSheet();
    toast('Verwijderd');
  },
  enrich: async (el) => {
    if (!AI.hasKey()) { toast('Zet eerst je AI-sleutel bij Instellingen'); return; }
    const w = S.wines.find((x) => x.id === el.dataset.id);
    el.disabled = true;
    el.innerHTML = 'Zoeken...';
    try {
      const base = { name: w.name, winery: w.winery, vintage: w.vintage, type: w.type };
      // Met een Perplexity-sleutel: eerst echte zoekresultaten ophalen, de AI vult de velden daaruit in
      let results = [];
      if (hasSearchKey()) {
        const name = label(w);
        try {
          results = await webSearch([`${name} wijn`, `${name} proefnotities drinkvenster`, `${name} prijs kopen`], { maxResults: 5 });
        } catch (e) {
          // Zoeken mislukt: gewoon door zonder bronnen (de AI zoekt dan zelf, als hij dat kan)
          console.warn('Perplexity Search mislukt:', e.code ?? e.message);
        }
      }
      el.innerHTML = 'Invullen...';
      const found = normalizeWine(await AI.enrichOnline(base, results.length ? sourcesForPrompt(results) : undefined));
      const merged = { ...w };
      for (const [k, v] of Object.entries(found)) if (v != null && v !== '' && (merged[k] == null || merged[k] === '' || ['tasting', 'pairsWith'].includes(k)) && !['id', 'quantity', 'type', 'name', 'winery', 'vintage', 'sources'].includes(k)) merged[k] = v;
      if (results.length) merged.sources = results.slice(0, 6).map(({ title, url, date }) => ({ title, url, ...(date ? { date } : {}) }));
      const saved = await db.saveWine(merged);
      // Meteen de nieuwe versie tonen, niet wachten tot de kelder opnieuw is ingelezen
      S.wines = S.wines.map((x) => (x.id === saved.id ? saved : x));
      toast(results.length ? `Info aangevuld uit ${Math.min(results.length, 8)} bronnen` : 'Info aangevuld');
      wineSheet(saved.id);
    } catch (e) {
      toast(AI.friendlyError(e));
      el.disabled = false;
      el.textContent = 'Info opzoeken';
    }
  },
  'ask-about': (el) => {
    const w = S.wines.find((x) => x.id === el.dataset.id);
    closeSheet();
    go('sommelier');
    chatSend(`Vertel me over de ${label(w)} in mijn kelder. Wanneer drink ik hem het best en waarbij?`);
  },
  'form-qty': (el) => { const st = $('.sheet')._form.state; st.quantity = Math.max(0, st.quantity + Number(el.dataset.delta)); $('#form-qty').textContent = st.quantity; },
  'form-type': (el) => { $('.sheet')._form.state.type = el.dataset.type; $$('.sheet [data-action="form-type"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); },
  'form-rate': (el) => { const st = $('.sheet')._form.state; st.rating = Number(el.dataset.value) === st.rating ? 0 : Number(el.dataset.value); $('#form-stars').innerHTML = stars(st.rating, 'form-rate'); },
  'add-scan': () => scanSheet(),
  'add-text': (el) => { if (el.getAttribute('aria-disabled') === 'true') { toast('Zet eerst je AI-sleutel bij Instellingen'); return; } textSheet(); },
  'add-manual': () => wineForm(),
  'review-edit': (el) => {
    const items = $('.sheet')._review;
    const i = Number(el.dataset.i);
    wineForm(items[i], { title: 'Aanpassen', onDone: (w) => { items[i] = { ...w, keep: true }; reviewSheet(items); } });
  },
  'review-qty': (el) => {
    const items = $('.sheet')._review;
    const w = items[Number(el.dataset.i)];
    w.quantity = Math.max(1, w.quantity + Number(el.dataset.delta));
    el.parentElement.querySelector('output').textContent = w.quantity;
  },
  'review-save': async () => {
    const items = $('.sheet')._review.filter((w) => w.keep);
    const n = await addWines(items);
    closeSheet();
    toast(`${n} ${n === 1 ? 'fles' : 'flessen'} in de kelder gezet`);
  },
  'rate-log': async (el) => { const l = S.log.find((x) => x.id === el.dataset.id); await db.put('log', { ...l, rating: Number(el.dataset.value) }); },
  'del-log': async (el) => db.remove('log', el.dataset.id),
  'wish-del': async (el) => db.remove('wishlist', el.dataset.id),
  'wish-bought': async (el) => {
    const item = S.wishlist.find((x) => x.id === el.dataset.id);
    wineForm({ name: item.text }, { title: 'Gekocht!', onDone: async (w) => { await addWines([w], w.photo); await db.put('wishlist', { ...item, done: true }); toast('In de kelder gezet'); } });
  },
  'save-key': async (el) => {
    const p = el.dataset.provider;
    const key = $(`#key-${p}`).value.trim();
    const msg = $(`#msg-${p}`);
    msg.className = 'small muted';
    msg.style.color = '';
    msg.textContent = 'Testen...';
    try {
      let used = key ? await AI.testKey(p, key) : null;
      if (key && p === 'perplexity') {
        try { await testSearch(key); used = `${used} + zoeken`; } catch (e) { used = `${used}, zoeken lukt niet: ${e.message}`; }
      }
      db.saveSettings({ [{ perplexity: 'perplexityKey', gemini: 'geminiKey', claude: 'apiKey' }[p]]: key });
      msg.className = 'small';
      msg.style.color = 'var(--ok)';
      msg.textContent = !key ? 'Sleutel gewist.' : used ? `Werkt! (${used})` : 'Werkt! Opgeslagen.';
    } catch (e) {
      msg.className = 'small danger';
      msg.textContent = AI.friendlyError(e);
    }
  },
  'export-json': async () => {
    const data = await db.exportAll();
    const date = new Date().toISOString().slice(0, 10);
    await shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), `wijnkelder-backup-${date}.json`);
  },
  'export-csv': async () => {
    await shareOrDownload(new Blob(['﻿' + toCsv(S.wines)], { type: 'text/csv' }), 'wijnkelder.csv');
  },
  wipe: async (el) => {
    if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Echt alles weg? Tik nog een keer'; return; }
    for (const s of ['wines', 'log', 'wishlist', 'photos']) await db.clear(s);
    toast('Alles gewist');
  },
  'chat-send': () => chatSend(),
  'chat-quick': (el) => chatSend(el.textContent),
  'chat-stop': () => S.chat.ctl?.abort(),
  'chat-reset': () => { S.chat = { system: null, history: [], display: [], busy: false, ctl: null, image: null, preview: null }; render(); },
};

const CHANGES = {
  'pair-photo': async (el) => {
    const file = el.files[0];
    if (!file) return;
    S.pair.dish = $('#dish')?.value ?? S.pair.dish;
    S.pair.image = await toAiImage(file);
    S.pair.preview = `data:${S.pair.image.mediaType};base64,${S.pair.image.data}`;
    render();
  },
  'chat-photo': async (el) => {
    const file = el.files[0];
    if (!file) return;
    S.chat.image = await toAiImage(file);
    S.chat.preview = `data:${S.chat.image.mediaType};base64,${S.chat.image.data}`;
    render();
    toast('Foto klaar, typ je vraag erbij');
  },
  'add-photo': async (el) => {
    const file = el.files[0];
    if (!file) return;
    const status = $('#add-status');
    status.innerHTML = loading('Etiket lezen...');
    $$('.method').forEach((m) => { m.style.pointerEvents = 'none'; });
    try {
      const wines = await AI.identifyFromImage(await toAiImage(file));
      await handleFound(wines, file);
    } catch (e) {
      status.innerHTML = `<p class="danger small">${esc(AI.friendlyError(e))}</p>`;
      $$('.method').forEach((m) => { m.style.pointerEvents = ''; });
    }
  },
  'form-photo': async (el) => {
    const file = el.files[0];
    if (!file) return;
    $('.sheet')._form.state.photoBlob = file;
    const holder = $('#form-photo');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.id = 'form-photo';
    holder.replaceWith(img);
  },
  'scan-photo': async (el) => {
    const file = el.files[0];
    if (!file) return;
    try {
      const code = await scanImage(file);
      if (code) onBarcode(code);
      else $('#scan-status').textContent = 'Geen streepjescode gevonden op de foto. Probeer het van dichterbij.';
    } catch {
      $('#scan-status').textContent = 'De foto lezen lukte niet.';
    }
  },
  'review-keep': (el) => {
    const items = $('.sheet')._review;
    items[Number(el.dataset.i)].keep = el.checked;
    const n = items.filter((w) => w.keep).length;
    $('.sheet [data-action="review-save"]').textContent = `Zet ${n} in de kelder`;
  },
  'wish-done': (el) => db.put('wishlist', { ...S.wishlist.find((x) => x.id === el.dataset.id), done: el.checked }),
  'set-web': (el) => db.saveSettings({ webSearch: el.checked }),
  'set-prefer-claude': (el) => db.saveSettings({ preferClaude: el.checked }),
  'set-theme': (el) => db.saveSettings({ theme: el.value }),
  'set-weather': async (el) => {
    db.saveSettings({ weather: el.checked });
    S.weather = null;
    if (el.checked) loadWeather(true);
  },
  'import-json': async (el) => {
    const file = el.files[0];
    if (!file) return;
    try {
      const n = await db.importAll(JSON.parse(await file.text()));
      toast(`${n} wijnen teruggezet`);
    } catch (e) {
      toast(e.message || 'Dit bestand kon ik niet lezen');
    }
  },
};

const SUBMITS = {
  'save-wine': (form) => saveWineForm(form),
  'add-text': async () => {
    const text = $('#add-text-input').value.trim();
    if (!text) return;
    const status = $('#add-status');
    status.innerHTML = loading('Even opzoeken...');
    try {
      await handleFound(await AI.identifyFromText(text));
    } catch (e) {
      status.innerHTML = `<p class="danger small">${esc(AI.friendlyError(e))}</p>`;
    }
  },
  'scan-manual': () => { const code = $('#scan-code').value.replace(/\D/g, ''); if (code) onBarcode(code); },
  'wish-add': async () => {
    const text = $('#wish-text').value.trim();
    if (!text) return;
    await db.put('wishlist', { text, done: false });
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { go(tab.dataset.tab); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !ACTIONS[el.dataset.action]) return;
  e.preventDefault();
  ACTIONS[el.dataset.action](el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-submit]');
  if (!form) return;
  e.preventDefault();
  SUBMITS[form.dataset.submit]?.(form, e);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    S.filter.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'dish') S.pair.dish = e.target.value;
  if (e.target.id === 'pair-url') S.pair.url = e.target.value;
  if (e.target.id === 'chat-input') { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`; }
  if (e.target.id === 'set-name') db.saveSettings({ name: e.target.value.trim() });
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'sort') { S.filter.sort = e.target.value; render(); }
  if (e.target.id === 'show-empty') { S.filter.showEmpty = e.target.checked; render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-input') { e.preventDefault(); chatSend(); }
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'dish') { e.preventDefault(); doPair(); }
  if (e.key === 'Escape') closeSheet();
});

async function loadWeather(force = false) {
  if (!db.settings().weather) return;
  try {
    S.weather = await weather.today();
    if (S.tab === 'vandaag' || force) render();
  } catch {
    if (force) toast('Het weer ophalen lukte niet. Sta locatie toe voor deze app.');
  }
}

/* ================= start ================= */

async function start() {
  applyTheme();
  const [tab, sub] = location.hash.slice(1).split('/');
  if (['vandaag', 'kelder', 'sommelier', 'meer'].includes(tab)) { S.tab = tab; S.sub = sub || null; }
  try {
    await load();
  } catch {
    $('#app').innerHTML = '<div class="view"><div class="empty"><h3>Opslag niet beschikbaar</h3><p>Je browser blokkeert opslag (privémodus?). Open de app normaal in Safari.</p></div></div>';
    return;
  }
  render();
  db.persist();
  loadWeather();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
