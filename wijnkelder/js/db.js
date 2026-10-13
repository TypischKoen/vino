// Opslag op het toestel zelf (IndexedDB). Op een iPhone-beginscherm-app blijft dit bewaard.
import { uid, normalizeWine } from './wine.js';

const DB_NAME = 'wijnkelder';
const STORES = ['wines', 'log', 'wishlist', 'photos'];
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const events = new EventTarget();
const changed = (store) => events.dispatchEvent(new CustomEvent('change', { detail: store }));

export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));

export async function put(store, item) {
  const row = { ...item, id: item.id ?? uid(), updated: Date.now() };
  row.added ??= row.updated;
  await tx(store, 'readwrite', (s) => s.put(row));
  changed(store);
  return row;
}

export async function remove(store, id) {
  await tx(store, 'readwrite', (s) => s.delete(id));
  changed(store);
}

export async function clear(store) {
  await tx(store, 'readwrite', (s) => s.clear());
  changed(store);
}

// Wijnen
export const saveWine = (w) => put('wines', normalizeWine(w));

export async function openBottle(wine, { dish, people } = {}) {
  const current = (await get('wines', wine.id)) ?? wine;
  await put('wines', { ...current, quantity: Math.max(0, (current.quantity ?? 1) - 1) });
  return put('log', {
    wineId: wine.id, wine: { name: wine.name, winery: wine.winery, vintage: wine.vintage, type: wine.type },
    dish: dish || '', people: people || null, date: Date.now(),
  });
}

// Foto's apart, zodat de wijnlijst snel blijft
export async function savePhoto(blob) {
  const row = await put('photos', { blob });
  return row.id;
}
export async function photoUrl(id) {
  if (!id) return null;
  const row = await get('photos', id);
  return row?.blob ? URL.createObjectURL(row.blob) : null;
}

// Backup: alles als één JSON-bestand, foto's als data-URL
const blobToDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function exportAll() {
  const photos = await all('photos');
  return {
    app: 'wijnkelder', version: 1, exported: new Date().toISOString(),
    wines: await all('wines'), log: await all('log'), wishlist: await all('wishlist'),
    photos: await Promise.all(photos.map(async (p) => ({ id: p.id, data: await blobToDataUrl(p.blob) }))),
  };
}

export async function importAll(data, { replace = false } = {}) {
  if (data?.app !== 'wijnkelder') throw new Error('Dit is geen backup van Wijnkelder');
  if (replace) for (const s of STORES) await tx(s, 'readwrite', (st) => st.clear());
  for (const p of data.photos ?? []) {
    const blob = await (await fetch(p.data)).blob();
    await tx('photos', 'readwrite', (s) => s.put({ id: p.id, blob }));
  }
  for (const s of ['wines', 'log', 'wishlist']) {
    for (const row of data[s] ?? []) await tx(s, 'readwrite', (st) => st.put(row));
  }
  for (const s of STORES) changed(s);
  return (data.wines ?? []).length;
}

// Instellingen: klein en per toestel
const SETTINGS_KEY = 'wijnkelder.settings';
const DEFAULTS = { preferClaude: false, perplexityKey: '', geminiKey: '', geminiModel: '', apiKey: '', weather: false, theme: 'auto', webSearch: true, name: '' };
export function settings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch {}
  // Wie Claude al gebruikte, blijft Claude als eerste keus houden
  if (!('preferClaude' in stored) && stored.apiKey && stored.provider !== 'gemini') stored.preferClaude = true;
  return { ...DEFAULTS, ...stored };
}
export function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
  events.dispatchEvent(new CustomEvent('change', { detail: 'settings' }));
  return next;
}

// Vraag Safari om de opslag niet op te ruimen
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
