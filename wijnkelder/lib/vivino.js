// Vivino heeft geen openbare API. Wat wel kan: je data exporteren
// (vivino.com > instellingen > privacy > "Download je data") en de CSV hier inladen.
// De kolomnamen verschillen per export, dus we matchen op een lijst met synoniemen.

const COLUMN_ALIASES = {
  winery: ['winery', 'producer', 'wijnhuis', 'producent'],
  name: ['wine name', 'wine', 'name', 'wijn', 'naam'],
  vintage: ['vintage', 'year', 'jaar', 'jaargang'],
  type: ['wine type', 'type', 'soort'],
  grape: ['grape', 'grapes', 'regional wine style', 'style', 'druif', 'druiven'],
  region: ['region', 'regio'],
  country: ['country', 'land'],
  quantity: ['user cellar count', 'cellar count', 'count', 'quantity', 'bottles', 'aantal', 'flessen'],
  rating: ['average rating', 'vivino rating', 'rating', 'your rating', 'score'],
  drinkWindow: ['drinking window', 'drink window', 'drinkvenster'],
  notes: ['personal note', 'your review', 'note', 'notes', 'notitie'],
  vivinoUrl: ['link to wine', 'url', 'link', 'vivino url'],
  imageUrl: ['label image', 'image', 'image url'],
};

// RFC 4180-achtige CSV parser: quotes, komma's/puntkomma's en enters binnen velden
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

function mapHeaders(headers) {
  const map = {};
  const clean = headers.map((h) => h.toLowerCase().trim());
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    // eerste alias die voorkomt wint, zodat "average rating" voor "your rating" gaat
    for (const alias of aliases) {
      const idx = clean.indexOf(alias);
      if (idx !== -1) { map[field] = idx; break; }
    }
  }
  return map;
}

export function parseVivinoCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { wines: [], recognized: [] };
  const [headers, ...data] = rows;
  const map = mapHeaders(headers);
  if (map.name === undefined && map.winery === undefined) {
    throw new Error(`Geen kolom voor wijnnaam of producent gevonden. Kolommen in je bestand: ${headers.join(', ')}`);
  }

  const wines = data.map((cells) => {
    const get = (f) => (map[f] === undefined ? undefined : cells[map[f]]?.trim());
    const wine = {
      winery: get('winery'),
      name: get('name'),
      vintage: get('vintage'),
      type: get('type'),
      grape: get('grape'),
      region: get('region'),
      country: get('country'),
      rating: get('rating'),
      notes: get('notes'),
      vivinoUrl: get('vivinoUrl'),
      imageUrl: get('imageUrl'),
      // geen aantal-kolom (bv. de "full wine list" export) = we gaan uit van 1 fles
      quantity: get('quantity') || 1,
    };
    const win = get('drinkWindow');
    const years = win?.match(/\d{4}/g);
    if (years?.length) {
      wine.drinkFrom = years[0];
      wine.drinkUntil = years[years.length - 1];
    }
    // Vivino zet "U.V." of "N.V." bij wijnen zonder jaargang
    if (wine.vintage && !/^\d{4}$/.test(wine.vintage)) delete wine.vintage;
    return wine;
  });

  return { wines, recognized: Object.keys(map) };
}
