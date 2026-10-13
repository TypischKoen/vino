import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { WineStore } from './lib/store.js';
import { parseVivinoCsv } from './lib/vivino.js';
import { searchWine, buildQuery, enrichmentFromResults, googleConfigured } from './lib/google.js';
import { suggestWine } from './lib/pairing.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const store = new WineStore(path.join(dir, 'data', 'wines.json'));
await store.load();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '10mb' }));
app.use(express.static(path.join(dir, 'public')));

// Kleine helper zodat async fouten netjes als JSON terugkomen
const route = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  let status = err.status ?? 400;
  let message = err.message;
  if (err instanceof Anthropic.RateLimitError) { status = 429; message = 'Even te veel AI-verzoeken, probeer het zo nog eens.'; }
  else if (err instanceof Anthropic.AuthenticationError) { status = 500; message = 'Je ANTHROPIC_API_KEY klopt niet.'; }
  else if (err instanceof Anthropic.APIError) { status = 502; message = `AI-fout: ${err.message}`; }
  res.status(status).json({ error: message });
});

app.get('/api/status', (req, res) => {
  res.json({ ai: Boolean(process.env.ANTHROPIC_API_KEY), google: googleConfigured() });
});

app.get('/api/wines', (req, res) => res.json(store.all()));

app.post('/api/wines', route(async (req, res) => {
  res.status(201).json(await store.add(req.body));
}));

app.patch('/api/wines/:id', route(async (req, res) => {
  const wine = await store.update(req.params.id, req.body);
  if (!wine) return res.status(404).json({ error: 'Wijn niet gevonden' });
  res.json(wine);
}));

app.delete('/api/wines/:id', route(async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: 'Wijn niet gevonden' });
  res.status(204).end();
}));

// Vivino CSV import. ?mode=add telt aantallen op, standaard wordt de voorraad overschreven.
app.post('/api/import/vivino', route(async (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return res.status(400).json({ error: 'Stuur de CSV als tekst mee' });
  }
  const { wines, recognized } = parseVivinoCsv(req.body);
  const mode = req.query.mode === 'add' ? 'add' : 'replace';
  const result = await store.importMany(wines, mode);
  res.json({ ...result, recognized });
}));

// Losse Google zoekopdracht, handig bij het handmatig toevoegen van een fles
app.get('/api/google', route(async (req, res) => {
  if (!req.query.q) return res.status(400).json({ error: 'Geef een zoekterm mee (?q=...)' });
  res.json(await searchWine(String(req.query.q)));
}));

// Wijn verrijken met Google info. Vult alleen lege velden, behalve beschrijving en link.
app.post('/api/wines/:id/enrich', route(async (req, res) => {
  const wine = store.get(req.params.id);
  if (!wine) return res.status(404).json({ error: 'Wijn niet gevonden' });
  const results = await searchWine(buildQuery(wine));
  const patch = enrichmentFromResults(results);
  if (wine.vivinoUrl) delete patch.vivinoUrl;
  if (wine.imageUrl) delete patch.imageUrl;
  res.json({ wine: await store.update(wine.id, patch), results });
}));

app.post('/api/pair', route(async (req, res) => {
  const dish = String(req.body?.dish ?? '').trim();
  if (!dish) return res.status(400).json({ error: 'Vertel welk gerecht je eet' });
  res.json(await suggestWine(dish, store.all()));
}));

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Wijnkelder draait op http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  Let op: geen ANTHROPIC_API_KEY, wijnadvies werkt niet');
  if (!googleConfigured()) console.log('  Let op: geen Google sleutels, opzoeken werkt niet');
});
