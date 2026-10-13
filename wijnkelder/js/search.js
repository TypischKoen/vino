// Webzoeken met de Perplexity Search API: ruwe, gerangschikte resultaten (titel, url, snippet, datum).
// Geen AI-antwoord; de AI in ai.js leest deze resultaten om velden in te vullen.
import { settings } from './db.js';

export const MAX_QUERIES = 5; // de API neemt maximaal 5 zoekvragen per verzoek

export class SearchError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

export const hasSearchKey = () => Boolean(settings().perplexityKey);

// Zelfde pagina met andere schrijfwijze (www, slash aan het eind, utm-tags) telt als dubbel
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${u.search}`;
  } catch {
    return String(url ?? '').trim().toLowerCase();
  }
}

// Bij meerdere zoekvragen geeft de API per vraag een lijst; samenvoegen in volgorde en dubbele URL's eruit
export function mergeResults(results) {
  const flat = (Array.isArray(results?.[0]) ? results.flat() : results ?? []).filter((r) => r && r.url && r.title);
  const seen = new Set();
  const out = [];
  for (const r of flat) {
    const key = normalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: r.title, url: r.url, snippet: r.snippet ?? '', ...(r.date ? { date: r.date } : {}), ...(r.last_updated ? { last_updated: r.last_updated } : {}) });
  }
  return out;
}

// SDK pas laden als er echt gezocht wordt
let sdk;
const loadSdk = async () => (sdk ??= (await import('../vendor/perplexity.js')).Perplexity);
let client;
let clientKey;

function translate(e, Perplexity) {
  if (e instanceof Perplexity.AuthenticationError) return new SearchError('badkey', 'Je Perplexity-sleutel klopt niet. Check hem bij Instellingen.');
  if (e instanceof Perplexity.RateLimitError) {
    const wait = e.headers?.get?.('retry-after');
    return new SearchError('quota', `Even te veel zoekopdrachten bij Perplexity.${wait ? ` Probeer het over ${wait} seconden opnieuw.` : ' Probeer het zo opnieuw.'}`);
  }
  if (e instanceof Perplexity.PermissionDeniedError) return new SearchError('denied', 'Deze Perplexity-sleutel mag niet zoeken, of je tegoed is op.', e.message);
  if (e instanceof Perplexity.BadRequestError || e instanceof Perplexity.UnprocessableEntityError) return new SearchError('bad', 'Perplexity snapte de zoekvraag niet.', e.message);
  if (e instanceof Perplexity.APIConnectionError) {
    return navigator.onLine === false
      ? new SearchError('net', 'Geen verbinding. Check je internet.')
      : new SearchError('cors', 'Perplexity laat deze app niet zoeken (ze blokkeren verzoeken vanuit webapps).');
  }
  if (e instanceof Perplexity.APIError) return new SearchError('busy', 'Zoeken bij Perplexity lukt even niet.', e.message);
  return e;
}

/**
 * Zoek op het web. `queries`: één zoekvraag of een lijst (max 5, elk apart uitgevoerd).
 * Geeft een samengevoegde lijst zonder dubbele URL's.
 */
export async function webSearch(queries, { maxResults = 5, country = 'NL', contextSize = 'medium', domains, signal } = {}) {
  const key = settings().perplexityKey;
  if (!key) throw new SearchError('nokey', 'Vul een Perplexity-sleutel in bij Meer > Instellingen om online te zoeken.');
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q).trim()).filter(Boolean).slice(0, MAX_QUERIES);
  if (!list.length) return [];
  const Perplexity = await loadSdk();
  if (!client || clientKey !== key) {
    client = new Perplexity({ apiKey: key, maxRetries: 1 });
    clientKey = key;
  }
  const body = {
    query: list.length === 1 ? list[0] : list,
    max_results: Math.max(1, Math.min(20, maxResults)),
    search_context_size: contextSize,
    country,
  };
  if (domains?.length) body.search_domain_filter = domains;
  try {
    const res = await client.search.create(body, { signal });
    return mergeResults(res.results);
  } catch (e) {
    throw translate(e, Perplexity);
  }
}

export async function testSearch(key) {
  const Perplexity = await loadSdk();
  try {
    const res = await new Perplexity({ apiKey: key, maxRetries: 0 }).search.create({ query: 'Barolo wijn', max_results: 1 });
    return res.results?.length ?? 0;
  } catch (e) {
    throw translate(e, Perplexity);
  }
}

// Compacte tekst voor in een prompt
export function sourcesForPrompt(results, max = 8) {
  return results.slice(0, max).map((r, i) =>
    `[${i + 1}] ${r.title}${r.date ? ` (${r.date})` : ''}\n${r.url}\n${(r.snippet ?? '').slice(0, 600)}`).join('\n\n');
}
