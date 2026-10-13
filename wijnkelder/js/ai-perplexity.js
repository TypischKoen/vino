// Perplexity Agent API (POST /v1/responses), de opvolger van Sonar (/chat/completions).
// Vormen van verzoek en antwoord volgen de officiële SDK (@perplexity-ai/perplexity_ai, ResponsesRequestInput).
// Bewust een simpele fetch met alleen Authorization + Content-Type: dat komt vanuit een webapp door.
import { extractJson } from './wine.js';
import * as P from './prompts.js';
import { promptFor } from './prompts.js';

const URL_RESPONSES = 'https://api.perplexity.ai/v1/responses';
// De SDK-voorbeelden gebruiken 'sonar'; staat Perplexity alleen de lange naam toe, dan die
const MODELS = ['sonar', 'perplexity/sonar'];
const MODEL_KEY = 'wijnkelder.perplexityModel';

export class PerplexityError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

export function friendlyError(e) {
  if (!(e instanceof PerplexityError)) return null;
  return e.detail ? `${e.message}\n\nPerplexity zegt: ${e.detail.slice(0, 220)}` : e.message;
}

export const isAbort = (e) => e?.name === 'AbortError';

const remembered = () => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } };
const remember = (m) => { try { localStorage.setItem(MODEL_KEY, m); } catch {} };
const modelOrder = () => [...new Set([remembered(), ...MODELS].filter(Boolean))];

async function raise(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  const msg = String(body.error?.message ?? body.detail ?? body.message ?? '');
  if (res.status === 401) throw new PerplexityError('badkey', 'Je Perplexity-sleutel klopt niet. Check hem bij Instellingen.', msg);
  if (res.status === 402 || /credit|balance|insufficient/i.test(msg)) {
    throw new PerplexityError('credits', 'Je Perplexity-tegoed is op. Waardeer op in de API Console (console.perplexity.ai), of de app gebruikt de gratis AI.', msg);
  }
  if (res.status === 429) {
    const wait = res.headers.get('retry-after');
    throw new PerplexityError('quota', `Even te veel vragen bij Perplexity.${wait ? ` Probeer het over ${wait} seconden opnieuw.` : ' Probeer het zo opnieuw.'}`, msg);
  }
  if (res.status >= 500) throw new PerplexityError('busy', 'Perplexity is even overbelast. Probeer het zo nog eens.', msg);
  if ((res.status === 400 || res.status === 404) && /model/i.test(msg)) throw new PerplexityError('model', 'Perplexity kent dit model niet.', msg);
  if (/image|vision/i.test(msg)) throw new PerplexityError('novision', 'Perplexity kon de foto niet lezen.', msg);
  throw new PerplexityError('bad', 'Perplexity snapte het verzoek niet.', msg);
}

async function send(key, body, signal) {
  let lastError;
  for (const model of modelOrder()) {
    let res;
    try {
      res = await fetch(URL_RESPONSES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, ...body }),
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      if (navigator.onLine !== false) throw new PerplexityError('cors', 'Perplexity laat deze app niet verbinden. De app gebruikt dan vanzelf de gratis AI.');
      throw new PerplexityError('net', 'Geen verbinding. Check je internet.');
    }
    if (res.ok) { remember(model); return res; }
    try { await raise(res); } catch (e) {
      if (e.code !== 'model') throw e;
      lastError = e;
    }
  }
  throw lastError;
}

// Bronnummers als [1] weghalen, die zeggen in de app niks
const clean = (t) => t.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '').replace(/[ \t]+\n/g, '\n');

function content(text, image) {
  if (!image) return text;
  return [
    { type: 'input_text', text },
    { type: 'input_image', image_url: `data:${image.mediaType};base64,${image.data}` },
  ];
}

// Tekst uit output[]: alle message-items, alle output_text-delen (zoals de SDK zijn output_text maakt)
export function outputText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && part.text)
    .map((part) => part.text)
    .join('');
}

function check(response) {
  if (response.status === 'failed' || response.error) {
    throw new PerplexityError('busy', 'Perplexity kon geen antwoord maken.', response.error?.message ?? '');
  }
  const text = outputText(response);
  if (!text.trim()) throw new PerplexityError('empty', 'Perplexity gaf een leeg antwoord. Probeer het nog eens.');
  return text;
}

const webTools = ({ search, fetchUrl }) => [
  ...(search ? [{ type: 'web_search', search_context_size: 'medium', user_location: { country: 'NL' } }] : []),
  ...(fetchUrl ? [{ type: 'fetch_url', max_urls: 2 }] : []),
];

// Zonder tools zoekt de Agent API niet op internet (scheelt tegoed)
async function askJson(key, { system, text, image, schema, name, search = false, fetchUrl = false }) {
  const tools = webTools({ search, fetchUrl });
  const body = {
    instructions: system,
    input: [{ type: 'message', role: 'user', content: content(text, image) }],
    response_format: { type: 'json_schema', json_schema: { name, schema } },
    max_output_tokens: 4000,
    ...(tools.length ? { tools } : {}),
  };
  const res = await send(key, body);
  return extractJson(check(await res.json()));
}

export async function testKey(key) {
  const res = await send(key, { input: 'Antwoord met alleen het woord: ok', max_output_tokens: 20 });
  check(await res.json());
  return remembered() ?? MODELS[0];
}

export async function identify(key, { text, image, product, search }) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, name: 'wijnen', image,
    text: promptFor({ text, image, product, search }),
  });
  return Array.isArray(r) ? r : r.wines ?? [];
}

export async function enrichOnline(key, wine, sources) {
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, name: 'wijnen', search: !sources,
    text: sources ? P.ENRICH_FROM_SOURCES(wine, sources) : `${P.ENRICH(wine)} Geef precies één wijn in de lijst.`,
  });
  return Array.isArray(r) ? r[0] : r.wines?.[0] ?? r;
}

export async function pair(key, args) {
  // Met een recept-link leest Perplexity die pagina zelf (fetch_url)
  return askJson(key, {
    system: P.PAIR_SYSTEM(), schema: P.PAIR_SCHEMA, name: 'wijnadvies',
    text: P.pairText(args), image: args.image, fetchUrl: Boolean(args.url),
  });
}

// history: [{role: 'user', text, image?} | {role: 'assistant', text}]
export async function chat(key, { system, history, onText, signal, webSearch }) {
  const lastImage = history.findLastIndex((m) => m.image);
  const input = history.map((m, i) => ({
    type: 'message',
    role: m.role,
    content: m.role === 'user' ? content(m.text, i === lastImage ? m.image : null) : m.text,
  }));
  const tools = webTools({ search: webSearch, fetchUrl: webSearch });
  const res = await send(key, { instructions: system, input, stream: true, ...(tools.length ? { tools } : {}) }, signal);

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
      if (!payload || payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === 'response.output_text.delta' && ev.delta) {
        text += ev.delta;
        onText?.(clean(text));
      } else if (ev.type === 'response.failed') {
        throw new PerplexityError('busy', 'Perplexity kon geen antwoord maken.', ev.error?.message ?? '');
      } else if (ev.type === 'response.completed' && !text && ev.response) {
        text = outputText(ev.response); // geen losse stukjes ontvangen: pak het hele antwoord
        if (text) onText?.(clean(text));
      }
    }
  }
  if (!text) throw new PerplexityError('empty', 'Perplexity gaf een leeg antwoord. Probeer het nog eens.');
  return { text: clean(text), raw: null };
}
