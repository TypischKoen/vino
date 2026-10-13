// OpenRouter: gratis AI-modellen via één sleutel. De "openrouter/free" router kiest zelf een
// gratis model dat kan wat je vraagt (ook foto's lezen).
import { extractJson } from './wine.js';
import * as P from './prompts.js';

const BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'openrouter/free';

export class OpenRouterError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

export function friendlyError(e) {
  if (!(e instanceof OpenRouterError)) return null;
  return e.detail ? `${e.message}\n\nOpenRouter zegt: ${e.detail.slice(0, 220)}` : e.message;
}

export const isAbort = (e) => e?.name === 'AbortError';

async function raise(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  const msg = body.error?.message ?? '';
  const raw = body.error?.metadata?.raw ? ` (${body.error.metadata.raw})` : '';
  if (res.status === 401) throw new OpenRouterError('badkey', 'Je OpenRouter-sleutel klopt niet. Check hem bij Instellingen.', msg);
  if (/data policy|privacy|training/i.test(msg)) {
    throw new OpenRouterError('privacy', 'OpenRouter blokkeert de gratis modellen door je privacy-instelling. Ga op openrouter.ai naar Settings → Privacy en zet de gratis modellen (free endpoints) aan.', msg);
  }
  if (res.status === 402) throw new OpenRouterError('credits', 'OpenRouter wil tegoed zien voor dit verzoek.', msg);
  if (res.status === 429) throw new OpenRouterError('quota', 'Je gratis OpenRouter-limiet is even op. Probeer het over een minuut of morgen weer.', msg + raw);
  if (res.status === 404) throw new OpenRouterError('model', 'OpenRouter vond geen gratis model voor deze vraag.', msg + raw);
  if (res.status >= 500) throw new OpenRouterError('busy', 'OpenRouter is even overbelast. Probeer het zo nog eens.', msg + raw);
  throw new OpenRouterError('bad', 'OpenRouter snapte het verzoek niet.', msg + raw);
}

async function post(key, body, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Wijnkelder' },
      body: JSON.stringify({ model: DEFAULT_MODEL, ...body }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new OpenRouterError('net', 'Geen verbinding met OpenRouter. Check je internet.');
  }
  if (!res.ok) await raise(res);
  return res;
}

const userContent = (text, image) => (image
  ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }]
  : text);

function answer(data) {
  if (data.error) throw new OpenRouterError('busy', 'OpenRouter gaf een fout.', data.error.message ?? '');
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new OpenRouterError('cut', 'Het antwoord werd te lang en is afgekapt. Probeer het nog eens.');
  const text = choice?.message?.content ?? '';
  if (!text.trim()) throw new OpenRouterError('empty', 'OpenRouter gaf een leeg antwoord. Probeer het nog eens.');
  return text;
}

// Gratis modellen kennen niet allemaal een vast JSON-schema: vragen in de prompt, tolerant uitlezen
async function askJson(key, { system, text, image, schema }) {
  const res = await post(key, {
    messages: [
      { role: 'system', content: `${system}\n\nAntwoord met alleen geldige JSON volgens dit schema, zonder uitleg of markdown:\n${JSON.stringify(schema)}` },
      { role: 'user', content: userContent(text, image) },
    ],
    temperature: 0.4,
  });
  return extractJson(answer(await res.json()));
}

export async function testKey(key) {
  const res = await post(key, { messages: [{ role: 'user', content: 'Antwoord met alleen het woord: ok' }], max_tokens: 400 });
  return (await res.json()).model ?? DEFAULT_MODEL;
}

export async function identify(key, { text, image, product }) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, image,
    text: image ? P.IDENTIFY_IMAGE : product ? P.IDENTIFY_PRODUCT(product) : P.IDENTIFY_TEXT(text),
  });
  return Array.isArray(r) ? r : r.wines ?? [];
}

// De gratis modellen kunnen niet online zoeken: aanvullen uit eigen kennis
export async function enrichOnline(key, wine) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA,
    text: `Vul zo goed mogelijk aan uit je eigen kennis: ${JSON.stringify(wine)}. Geef precies één wijn.`,
  });
  return Array.isArray(r) ? r[0] : r.wines?.[0] ?? r;
}

export async function pair(key, args) {
  const text = P.pairText(args) + (args.url ? '\n\n(Je kunt de link niet openen. Leid het gerecht af uit de link zelf.)' : '');
  return askJson(key, { system: P.PAIR_SYSTEM(), schema: P.PAIR_SCHEMA, text, image: args.image });
}

// history: [{role: 'user', text, image?} | {role: 'assistant', text}]
export async function chat(key, { system, history, onText, signal }) {
  const lastImage = history.findLastIndex((m) => m.image); // alleen de laatste foto meesturen
  const messages = [
    { role: 'system', content: system },
    ...history.map((m, i) => ({ role: m.role, content: m.role === 'user' ? userContent(m.text, i === lastImage ? m.image : null) : m.text })),
  ];
  const res = await post(key, { messages, stream: true }, signal);
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
      if (!line.startsWith('data:')) continue; // commentaarregels zoals ": OPENROUTER PROCESSING" overslaan
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      if (data.error) throw new OpenRouterError('busy', 'OpenRouter gaf een fout.', data.error.message ?? '');
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onText?.(text); }
    }
  }
  if (!text) throw new OpenRouterError('empty', 'OpenRouter gaf een leeg antwoord. Probeer het nog eens.');
  return { text, raw: null };
}
