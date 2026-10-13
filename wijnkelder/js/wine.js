// Pure helpers rond wijnen. Geen DOM, zodat ze ook in Node te testen zijn.

export const TYPES = {
  rood: { label: 'Rood', color: '#8c1c33' },
  wit: { label: 'Wit', color: '#e3cf76' },
  rosé: { label: 'Rosé', color: '#ef9fb0' },
  mousserend: { label: 'Bubbels', color: '#f1e6b2' },
  dessert: { label: 'Zoet', color: '#d39434' },
  versterkt: { label: 'Port & sherry', color: '#6b2f1c' },
};
export const TYPE_KEYS = Object.keys(TYPES);

const TEXT_FIELDS = ['name', 'winery', 'grape', 'region', 'country', 'appellation', 'notes', 'tasting', 'pairsWith', 'location', 'barcode', 'source'];
const INT_FIELDS = ['vintage', 'quantity', 'drinkFrom', 'drinkUntil', 'rating'];
const FLOAT_FIELDS = ['price', 'abv'];

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeType(t) {
  const s = String(t ?? '').toLowerCase().trim();
  if (TYPES[s]) return s;
  if (s.startsWith('ros')) return 'rosé';
  if (/(wit|white|blanc|bianco|weiss)/.test(s)) return 'wit';
  if (/(mousse|bubbel|sparkl|champ|cava|prosecco|cr[ée]mant|sekt|spumante)/.test(s)) return 'mousserend';
  if (/(dessert|zoet|sweet|sauternes|tokaj|ijswijn|late harvest)/.test(s)) return 'dessert';
  if (/(port|sherry|madeira|versterkt|fortified|marsala)/.test(s)) return 'versterkt';
  return 'rood';
}

export function normalizeWine(raw = {}) {
  const w = {};
  for (const k of TEXT_FIELDS) {
    const v = raw[k];
    if (v == null) continue;
    const s = (Array.isArray(v) ? v.join(', ') : String(v)).trim();
    if (s) w[k] = s.slice(0, k === 'tasting' || k === 'notes' ? 2000 : 300);
  }
  for (const k of INT_FIELDS) {
    const n = parseInt(raw[k], 10);
    if (!Number.isNaN(n)) w[k] = n;
  }
  for (const k of FLOAT_FIELDS) {
    const n = parseFloat(String(raw[k] ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
    if (!Number.isNaN(n)) w[k] = Math.round(n * 100) / 100;
  }
  w.type = normalizeType(raw.type);
  if (w.quantity == null) w.quantity = 1;
  w.quantity = Math.max(0, Math.min(w.quantity, 9999));
  if (w.rating != null) w.rating = Math.max(0, Math.min(5, w.rating));
  if (w.vintage != null && (w.vintage < 1800 || w.vintage > 2100)) delete w.vintage;
  for (const k of ['id', 'photo', 'added', 'updated']) if (raw[k] != null) w[k] = raw[k];
  // Bronnen van "Info opzoeken": alleen http(s)-links, en niet te veel
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources
      .filter((r) => r && /^https?:\/\//i.test(r.url ?? '') && r.title)
      .slice(0, 6)
      .map((r) => ({ title: String(r.title).slice(0, 200), url: String(r.url).slice(0, 500), ...(r.date ? { date: String(r.date).slice(0, 40) } : {}) }));
    if (sources.length) w.sources = sources;
  }
  return w;
}

export function label(w) {
  return [w.winery, w.name, w.vintage].filter(Boolean).join(' ');
}

// 'jong' = nog bewaren, 'piek' = op dronk, 'nu' = laatste kans dit of volgend jaar, 'over' = voorbij het venster
export function drinkStatus(w, year = new Date().getFullYear()) {
  if (!w.drinkFrom && !w.drinkUntil) return null;
  if (w.drinkFrom && year < w.drinkFrom) return 'jong';
  if (w.drinkUntil && year > w.drinkUntil) return 'over';
  if (w.drinkUntil && w.drinkUntil - year <= 1) return 'nu';
  return 'piek';
}

export const STATUS_LABEL = { jong: 'Nog bewaren', piek: 'Op dronk', nu: 'Drink snel', over: 'Over de top' };

export function stats(wines, year = new Date().getFullYear()) {
  const inStock = wines.filter((w) => w.quantity > 0);
  const bottles = inStock.reduce((n, w) => n + w.quantity, 0);
  const value = inStock.reduce((n, w) => n + (w.price ?? 0) * w.quantity, 0);
  const byType = Object.fromEntries(TYPE_KEYS.map((t) => [t, 0]));
  for (const w of inStock) byType[w.type] = (byType[w.type] ?? 0) + w.quantity;
  const urgent = inStock.filter((w) => ['nu', 'over'].includes(drinkStatus(w, year)));
  const vintages = inStock.map((w) => w.vintage).filter(Boolean);
  return {
    bottles,
    labels: inStock.length,
    value,
    byType,
    urgent,
    oldest: vintages.length ? Math.min(...vintages) : null,
  };
}

export function matches(w, query) {
  if (!query) return true;
  const hay = [label(w), w.grape, w.region, w.country, w.appellation, TYPES[w.type]?.label, w.notes, w.location]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((part) => hay.includes(part));
}

export const SORTS = {
  naam: (a, b) => label(a).localeCompare(label(b)),
  jaar: (a, b) => (a.vintage ?? 9999) - (b.vintage ?? 9999),
  nieuw: (a, b) => (b.added ?? 0) - (a.added ?? 0),
  drinken: (a, b) => (a.drinkUntil ?? 9999) - (b.drinkUntil ?? 9999),
  prijs: (a, b) => (b.price ?? 0) - (a.price ?? 0),
  score: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  soort: (a, b) => TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type) || label(a).localeCompare(label(b)),
};

// Compacte weergave van de kelder voor in een prompt
export function cellarForPrompt(wines, year = new Date().getFullYear()) {
  return wines.filter((w) => w.quantity > 0).map((w) => {
    const o = { id: w.id, wijn: label(w), soort: w.type };
    if (w.grape) o.druif = w.grape;
    const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
    if (place) o.herkomst = place;
    if (w.drinkFrom || w.drinkUntil) o.drinkvenster = `${w.drinkFrom ?? '?'}-${w.drinkUntil ?? '?'}`;
    const st = drinkStatus(w, year);
    if (st) o.status = STATUS_LABEL[st];
    o.aantal = w.quantity;
    if (w.price) o.prijs = w.price;
    if (w.rating) o.mijnScore = w.rating;
    if (w.notes) o.notitie = w.notes.slice(0, 160);
    return o;
  });
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(wines) {
  const cols = ['winery', 'name', 'vintage', 'type', 'grape', 'region', 'country', 'quantity', 'price', 'rating', 'drinkFrom', 'drinkUntil', 'location', 'notes'];
  return [cols.join(';'), ...wines.map((w) => cols.map((c) => csvCell(w[c])).join(';'))].join('\n');
}

// Haal één JSON-waarde uit een tekst die er misschien een zin omheen heeft
export function extractJson(text) {
  const t = String(text ?? '').trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start !== -1 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch {} }
  throw new Error('Geen geldige JSON in het antwoord');
}

export function euro(n) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n ?? 0);
}
