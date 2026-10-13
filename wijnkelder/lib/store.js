// Simpele opslag in een JSON-bestand. Prima voor één persoon met een paar honderd flessen.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const FIELDS = [
  'winery', 'name', 'vintage', 'type', 'grape', 'region', 'country',
  'quantity', 'rating', 'drinkFrom', 'drinkUntil', 'notes',
  'vivinoUrl', 'imageUrl', 'description', 'webUrl',
];

export function normalizeWine(input) {
  const wine = {};
  for (const key of FIELDS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    wine[key] = input[key];
  }
  for (const key of ['vintage', 'quantity', 'drinkFrom', 'drinkUntil']) {
    if (wine[key] !== undefined) {
      const n = parseInt(wine[key], 10);
      if (Number.isNaN(n)) delete wine[key];
      else wine[key] = n;
    }
  }
  if (wine.rating !== undefined) {
    const r = parseFloat(String(wine.rating).replace(',', '.'));
    if (Number.isNaN(r)) delete wine.rating;
    else wine.rating = r;
  }
  for (const key of FIELDS) {
    if (typeof wine[key] === 'string') wine[key] = wine[key].trim();
  }
  if (wine.quantity === undefined) wine.quantity = 1;
  if (wine.quantity < 0) wine.quantity = 0;
  return wine;
}

// Sleutel om dubbele wijnen te herkennen bij een import
export function wineKey(w) {
  return [w.winery, w.name, w.vintage]
    .map((v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

export class WineStore {
  constructor(file) {
    this.file = file;
    this.wines = [];
  }

  async load() {
    try {
      this.wines = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.wines = [];
    }
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.wines, null, 2));
    await rename(tmp, this.file);
  }

  all() {
    return this.wines;
  }

  get(id) {
    return this.wines.find((w) => w.id === id);
  }

  async add(input) {
    const wine = { id: randomUUID(), ...normalizeWine(input), addedAt: new Date().toISOString() };
    if (!wine.name && !wine.winery) throw new Error('Een wijn heeft minstens een naam of producent nodig');
    this.wines.push(wine);
    await this.save();
    return wine;
  }

  async update(id, patch) {
    const wine = this.get(id);
    if (!wine) return null;
    const merged = normalizeWine({ ...wine, ...patch });
    Object.keys(wine).forEach((k) => { if (!['id', 'addedAt'].includes(k)) delete wine[k]; });
    Object.assign(wine, merged);
    await this.save();
    return wine;
  }

  async remove(id) {
    const before = this.wines.length;
    this.wines = this.wines.filter((w) => w.id !== id);
    if (this.wines.length === before) return false;
    await this.save();
    return true;
  }

  // Import: bestaande wijn (zelfde producent+naam+jaar) krijgt nieuwe info, anders toevoegen.
  // mode 'replace' zet de voorraad gelijk aan de import, 'add' telt erbij op.
  async importMany(items, mode = 'replace') {
    let added = 0;
    let updated = 0;
    const byKey = new Map(this.wines.map((w) => [wineKey(w), w]));
    for (const item of items) {
      const incoming = normalizeWine(item);
      if (!incoming.name && !incoming.winery) continue;
      const existing = byKey.get(wineKey(incoming));
      if (existing) {
        const quantity = mode === 'add'
          ? (existing.quantity ?? 0) + incoming.quantity
          : incoming.quantity;
        Object.assign(existing, { ...existing, ...incoming, quantity });
        updated++;
      } else {
        const wine = { id: randomUUID(), ...incoming, addedAt: new Date().toISOString() };
        this.wines.push(wine);
        byKey.set(wineKey(wine), wine);
        added++;
      }
    }
    await this.save();
    return { added, updated };
  }
}
