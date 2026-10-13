// Google Gemini als AI. Gratis te gebruiken binnen de limieten van Google AI Studio.
import { extractJson } from './wine.js';
import * as P from './prompts.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';
// Als een model geen gratis versie heeft of de limiet op is, proberen we de volgende.
// Elk model heeft bij Google een eigen gratis dagteller.
export const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const WORKING_KEY = 'wijnkelder.geminiWorkingModel';

export class GeminiError extends Error {
  constructor(code, message, status, detail = '') { super(message); this.code = code; this.status = status; this.detail = detail; }
}

const MESSAGES = {
  badkey: 'Je Gemini API-sleutel klopt niet. Check hem bij Instellingen.',
  denied: 'Deze Gemini-sleutel mag dit niet. Check of de sleutel bij een actief project hoort.',
  model: 'Dit Gemini-model bestaat niet (meer). Pas de modelnaam aan bij Instellingen, of laat hem leeg.',
  nofree: 'Geen van de Gemini-modellen heeft op dit moment een gratis limiet voor jouw sleutel.',
  quota: 'Je gratis Gemini-limiet is op voor alle modellen. Probeer het over een minuut, of morgen weer.',
  region: 'Gemini is niet beschikbaar in jouw land of voor dit account.',
  busy: 'Gemini is even overbelast. Probeer het zo nog eens.',
  refused: 'Gemini wilde hier niet op ingaan. Probeer het anders te omschrijven.',
  cut: 'Het antwoord werd te lang en is afgekapt. Probeer het nog eens.',
  empty: 'Gemini gaf een leeg antwoord. Probeer het nog eens.',
  net: 'Geen verbinding. Check je internet.',
};

// Laat ook zien wat Google zelf zei, dan weet je waar het aan ligt
export function friendlyError(e) {
  if (!(e instanceof GeminiError)) return null;
  return e.detail ? `${e.message}\n\nGoogle zegt: ${e.detail.slice(0, 220)}` : e.message;
}

export const isAbort = (e) => e?.name === 'AbortError';

async function raise(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  const msg = body.error?.message ?? '';
  const status = body.error?.status ?? '';
  if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('badkey', MESSAGES.badkey, 400, msg);
  if (res.status === 400 && /location|region|country/i.test(msg)) throw new GeminiError('region', MESSAGES.region, 400, msg);
  if (res.status === 401 || res.status === 403) throw new GeminiError('denied', MESSAGES.denied, res.status, msg);
  if (res.status === 404) throw new GeminiError('model', MESSAGES.model, 404, msg);
  if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
    // "limit: 0" betekent: dit model heeft helemaal geen gratis versie
    const code = /limit:\s*0\b/.test(msg) ? 'nofree' : 'quota';
    throw new GeminiError(code, MESSAGES[code], 429, msg);
  }
  if (res.status >= 500) throw new GeminiError('busy', MESSAGES.busy, res.status, msg);
  throw new GeminiError('bad', `Gemini snapte het verzoek niet: ${msg || res.status}`, res.status, '');
}

function remembered() {
  try { return localStorage.getItem(WORKING_KEY); } catch { return null; }
}
export const workingModel = () => remembered();
function remember(model) {
  try { localStorage.setItem(WORKING_KEY, model); } catch {}
}

// Eigen model van de gebruiker eerst, dan het model dat de vorige keer werkte, dan de vaste lijst
function candidates(preferred) {
  const custom = preferred && preferred !== DEFAULT_MODEL ? [preferred] : [];
  return [...new Set([...custom, remembered(), ...FALLBACK_MODELS].filter(Boolean))];
}

const RETRYABLE = new Set(['nofree', 'quota', 'model']);

async function call(key, preferred, method, body, signal) {
  let lastError;
  let sawQuota = false;
  for (const model of candidates(preferred)) {
    let res;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new GeminiError('net', MESSAGES.net);
    }
    if (res.ok) {
      remember(model);
      res.model = model;
      return res;
    }
    try { await raise(res); } catch (e) {
      if (!RETRYABLE.has(e.code)) throw e;
      if (e.code === 'quota') sawQuota = true;
      lastError = e;
    }
  }
  // Alles geprobeerd: zeg of het "geen gratis versie" of "limiet op" was
  if (sawQuota && lastError.code !== 'quota') throw new GeminiError('quota', MESSAGES.quota, 429, lastError.detail);
  if (lastError?.code === 'model') throw lastError;
  throw new GeminiError(lastError?.code ?? 'quota', MESSAGES[lastError?.code] ?? MESSAGES.quota, 429, lastError?.detail);
}

// Echte mini-vraag, zodat je meteen ziet of er een gratis model werkt. Geeft het werkende model terug.
export async function testKey(key, model = DEFAULT_MODEL) {
  const res = await call(key, model, 'generateContent', {
    contents: [{ role: 'user', parts: [{ text: 'Antwoord met alleen het woord: ok' }] }],
  });
  return res.model;
}

// Gemini wil geen additionalProperties in het schema
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
  return out;
}

function checkCandidate(data) {
  if (data.promptFeedback?.blockReason) throw new GeminiError('refused', MESSAGES.refused);
  const cand = data.candidates?.[0];
  if (!cand) throw new GeminiError('empty', MESSAGES.empty);
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(cand.finishReason)) throw new GeminiError('refused', MESSAGES.refused);
  if (cand.finishReason === 'MAX_TOKENS') throw new GeminiError('cut', MESSAGES.cut);
  return cand;
}

const textParts = (parts = []) => parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
const imagePart = (img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } });

async function askJson(key, model, { system, parts, schema, tools }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: tools ? [...parts, { text: P.JSON_ONLY }] : parts }],
  };
  if (tools) body.tools = tools; // zoeken en JSON-modus gaan niet altijd samen, dus dan tolerant uitlezen
  else body.generationConfig = { responseMimeType: 'application/json', responseJsonSchema: geminiSchema(schema) };
  let res;
  try {
    res = await call(key, model, 'generateContent', body);
  } catch (e) {
    // Oudere modellen kennen responseJsonSchema niet: dan zonder schema, alleen JSON-modus
    if (!(e instanceof GeminiError && e.code === 'bad' && /schema/i.test(e.message))) throw e;
    body.generationConfig = { responseMimeType: 'application/json' };
    body.contents[0].parts.push({ text: `Gebruik precies dit JSON-schema: ${JSON.stringify(schema)}` });
    res = await call(key, model, 'generateContent', body);
  }
  const cand = checkCandidate(await res.json());
  return extractJson(textParts(cand.content?.parts));
}

export async function identify(key, model, { text, image, product }) {
  const parts = [];
  if (image) parts.push(imagePart(image));
  parts.push({ text: image ? P.IDENTIFY_IMAGE : product ? P.IDENTIFY_PRODUCT(product) : P.IDENTIFY_TEXT(text) });
  const r = await askJson(key, model, { system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, parts });
  return Array.isArray(r) ? r : r.wines ?? [];
}

export async function enrichOnline(key, model, wine) {
  const r = await askJson(key, model, {
    system: P.IDENTIFY_SYSTEM(), tools: [{ googleSearch: {} }],
    parts: [{ text: P.ENRICH(wine) }],
  });
  return r.wines?.[0] ?? r;
}

export async function pair(key, model, args) {
  const parts = [];
  if (args.image) parts.push(imagePart(args.image));
  parts.push({ text: P.pairText(args) });
  return askJson(key, model, {
    system: P.PAIR_SYSTEM(), schema: P.PAIR_SCHEMA, parts,
    tools: args.url ? [{ urlContext: {} }] : undefined,
  });
}

// history: [{role: 'user', text, image?} | {role: 'assistant', text, raw?}]
export async function chat(key, model, { system, history, onText, signal, webSearch }) {
  const contents = history.map((m) => (m.role === 'user'
    ? { role: 'user', parts: [...(m.image ? [imagePart(m.image)] : []), { text: m.text }] }
    : { role: 'model', parts: m.raw?.provider === 'gemini' ? m.raw.parts : [{ text: m.text }] }));
  const body = { systemInstruction: { parts: [{ text: system }] }, contents };
  if (webSearch) body.tools = [{ googleSearch: {} }, { urlContext: {} }];

  const res = await call(key, model, 'streamGenerateContent?alt=sse', body, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let signature;
  let last;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop();
    for (const ev of events) {
      const line = ev.split(/\r?\n/).find((l) => l.startsWith('data:'));
      if (!line) continue;
      let data;
      try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
      last = data;
      if (data.promptFeedback?.blockReason) throw new GeminiError('refused', MESSAGES.refused);
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) if (p.thoughtSignature) signature = p.thoughtSignature;
      const delta = textParts(parts);
      if (delta) { text += delta; onText?.(text); }
    }
  }
  const reason = last?.candidates?.[0]?.finishReason;
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(reason)) throw new GeminiError('refused', MESSAGES.refused);
  if (!text) throw new GeminiError('empty', MESSAGES.empty);
  return { text, raw: { provider: 'gemini', parts: [{ text, ...(signature ? { thoughtSignature: signature } : {}) }] } };
}
