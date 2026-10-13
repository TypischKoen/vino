// Perplexity (Sonar): betaald van je tegoed, zoekt zelf op internet. Handig voor wijninfo en prijzen.
import { extractJson } from './wine.js';
import * as P from './prompts.js';
import { promptFor } from './prompts.js';

const BASE = 'https://api.perplexity.ai';
export const MODEL = 'sonar';

export class PerplexityError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

export function friendlyError(e) {
  if (!(e instanceof PerplexityError)) return null;
  return e.detail ? `${e.message}\n\nPerplexity zegt: ${e.detail.slice(0, 220)}` : e.message;
}

export const isAbort = (e) => e?.name === 'AbortError';

async function raise(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  const msg = body.error?.message ?? body.detail ?? '';
  if (res.status === 401) throw new PerplexityError('badkey', 'Je Perplexity-sleutel klopt niet. Check hem bij Instellingen.', String(msg));
  if (res.status === 402 || /credit|balance|quota exceeded|insufficient/i.test(String(msg))) {
    throw new PerplexityError('credits', 'Je Perplexity-tegoed is op. Waardeer op via perplexity.ai, of de app gebruikt de gratis AI.', String(msg));
  }
  if (res.status === 429) throw new PerplexityError('quota', 'Even te veel vragen bij Perplexity. Probeer het zo nog eens.', String(msg));
  if (res.status >= 500) throw new PerplexityError('busy', 'Perplexity is even overbelast. Probeer het zo nog eens.', String(msg));
  if (/image|vision/i.test(String(msg))) throw new PerplexityError('novision', 'Perplexity kon de foto niet lezen.', String(msg));
  throw new PerplexityError('bad', 'Perplexity snapte het verzoek niet.', String(msg));
}

async function post(key, body, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, ...body }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    // Internet is er wel, maar het verzoek komt niet door: Perplexity blokkeert dan verzoeken uit webapps (CORS)
    if (navigator.onLine !== false) {
      throw new PerplexityError('cors', 'Perplexity laat deze app niet verbinden (ze blokkeren verzoeken vanuit webapps). De app gebruikt dan vanzelf de gratis AI.');
    }
    throw new PerplexityError('net', 'Geen verbinding. Check je internet.');
  }
  // Kent Perplexity de instelling "niet zoeken" niet, dan nog een keer zonder
  if (res.status === 400 && 'disable_search' in body) {
    const peek = await res.clone().text().catch(() => '');
    if (/disable_search|unrecognized|unknown|extra/i.test(peek)) {
      const { disable_search, ...rest } = body;
      return post(key, rest, signal);
    }
  }
  if (!res.ok) await raise(res);
  return res;
}

// Bronvermeldingen als [1] weghalen, die zeggen in de app niks
const clean = (t) => t.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '').replace(/[ \t]+\n/g, '\n');

const userContent = (text, image) => (image
  ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }]
  : text);

function answer(data) {
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new PerplexityError('cut', 'Het antwoord werd te lang en is afgekapt. Probeer het nog eens.');
  const text = choice?.message?.content ?? '';
  if (!text.trim()) throw new PerplexityError('empty', 'Perplexity gaf een leeg antwoord. Probeer het nog eens.');
  return text;
}

async function askJson(key, { system, text, image, schema, search = false }) {
  const body = {
    messages: [
      { role: 'system', content: `${system}\n\nAntwoord met alleen geldige JSON volgens het schema.` },
      { role: 'user', content: userContent(text, image) },
    ],
    response_format: { type: 'json_schema', json_schema: { schema } },
  };
  // Zoeken kost per vraag extra; alleen aanzetten waar het iets oplevert
  if (!search) body.disable_search = true;
  const res = await post(key, body);
  return extractJson(answer(await res.json()));
}

export async function testKey(key) {
  await post(key, { messages: [{ role: 'user', content: 'Antwoord met alleen het woord: ok' }], max_tokens: 20, disable_search: true });
  return MODEL;
}

export async function identify(key, { text, image, product, search }) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, image,
    text: promptFor({ text, image, product, search }),
  });
  return Array.isArray(r) ? r : r.wines ?? [];
}

export async function enrichOnline(key, wine, sources) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, search: !sources,
    text: sources ? P.ENRICH_FROM_SOURCES(wine, sources) : `${P.ENRICH(wine)} Geef precies één wijn in de lijst.`,
  });
  return Array.isArray(r) ? r[0] : r.wines?.[0] ?? r;
}

export async function pair(key, args) {
  // Met een recept-link zoekt Perplexity het recept zelf op
  return askJson(key, { system: P.PAIR_SYSTEM(), schema: P.PAIR_SCHEMA, text: P.pairText(args), image: args.image, search: Boolean(args.url) });
}

// history: [{role: 'user', text, image?} | {role: 'assistant', text}]
export async function chat(key, { system, history, onText, signal, webSearch }) {
  const lastImage = history.findLastIndex((m) => m.image);
  const messages = [
    { role: 'system', content: system },
    ...history.map((m, i) => ({ role: m.role, content: m.role === 'user' ? userContent(m.text, i === lastImage ? m.image : null) : m.text })),
  ];
  const body = { messages, stream: true };
  if (!webSearch) body.disable_search = true;
  const res = await post(key, body, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onText?.(clean(text)); }
    }
  }
  if (!text) throw new PerplexityError('empty', 'Perplexity gaf een leeg antwoord. Probeer het nog eens.');
  return { text: clean(text), raw: null };
}
