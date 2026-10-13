// Claude (Anthropic) als AI. Betaald per gebruik, sleutel alleen op dit toestel.
import { Anthropic } from '../vendor/anthropic.js';
import { extractJson } from './wine.js';
import * as P from './prompts.js';
import { promptFor } from './prompts.js';

const MODEL = 'claude-opus-5-5';
// Bij een (onterechte) weigering door de veiligheidsfilters neemt een ander model het over
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: 4 };
const WEB_FETCH = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 };

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let client;
let clientKey;
function ai(key) {
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

export function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Je Claude API-sleutel klopt niet. Check hem bij Instellingen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Deze Claude-sleutel mag dit model niet gebruiken.';
  if (e instanceof Anthropic.RateLimitError) return 'Even te veel vragen tegelijk. Probeer het over een minuutje opnieuw.';
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return 'Je Claude-tegoed is op. Waardeer op via console.anthropic.com, of kies Gemini bij Instellingen.';
    return `Claude snapte het verzoek niet: ${e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Geen verbinding. Check je internet.';
  if (e instanceof Anthropic.APIError) return 'Claude is even niet bereikbaar. Probeer het zo nog eens.';
  return null;
}

export const isAbort = (e) => e instanceof Anthropic.APIUserAbortError || e?.name === 'AbortError';

export async function testKey(key) {
  await new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 }).models.retrieve(MODEL);
}

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');

function checkStop(message) {
  if (message.stop_reason === 'refusal') throw new AiError('refused', 'Claude wilde hier niet op ingaan. Probeer het anders te omschrijven.');
  if (message.stop_reason === 'max_tokens') throw new AiError('cut', 'Het antwoord werd te lang en is afgekapt. Probeer het nog eens.');
}

const imageBlock = (img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });

// Eén vraag, JSON terug. Zonder tools met een vast schema, met tools (web) tolerant uitlezen.
async function askJson(key, { system, content, schema, tools, effort = 'low' }) {
  const params = { model: MODEL, max_tokens: 8000, system, ...FALLBACK, output_config: { effort } };
  if (tools?.length) {
    params.tools = tools;
    content = [...content, { type: 'text', text: P.JSON_ONLY }];
  } else {
    params.output_config.format = { type: 'json_schema', schema };
  }
  const first = [{ role: 'user', content }];
  let messages = first;
  let message;
  const blocks = [];
  for (let round = 0; round < 4; round++) {
    message = await ai(key).beta.messages.create({ ...params, messages });
    blocks.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    // web search/fetch was nog bezig: hetzelfde antwoord terugsturen, de server gaat verder
    messages = [...first, { role: 'assistant', content: [...blocks] }];
  }
  checkStop(message);
  const text = textOf(blocks);
  return tools?.length ? extractJson(text) : JSON.parse(text);
}

export async function identify(key, { text, image, product, search }) {
  const content = [];
  if (image) content.push(imageBlock(image));
  content.push({ type: 'text', text: promptFor({ text, image, product, search }) });
  const r = await askJson(key, { system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, content, effort: image ? 'medium' : 'low' });
  return r.wines ?? [];
}

export async function enrichOnline(key, wine, sources) {
  if (sources) {
    const r = await askJson(key, { system: P.IDENTIFY_SYSTEM(), schema: P.WINES_SCHEMA, content: [{ type: 'text', text: P.ENRICH_FROM_SOURCES(wine, sources) }] });
    return r.wines?.[0] ?? {};
  }
  const r = await askJson(key, {
    system: P.IDENTIFY_SYSTEM(), tools: [WEB_SEARCH], effort: 'medium',
    content: [{ type: 'text', text: P.ENRICH(wine) }],
  });
  return r.wines?.[0] ?? r;
}

export async function pair(key, args) {
  const content = [];
  if (args.image) content.push(imageBlock(args.image));
  content.push({ type: 'text', text: P.pairText(args) });
  return askJson(key, {
    system: P.PAIR_SYSTEM(), schema: P.PAIR_SCHEMA, effort: 'medium',
    tools: args.url ? [WEB_FETCH] : undefined, content,
  });
}

// history: [{role: 'user', text, image?} | {role: 'assistant', text, raw?}]
// raw = de volledige blokken van Claude, nodig om goed door te praten
export async function chat(key, { system, history, onText, signal, webSearch }) {
  const base = history.map((m) => (m.role === 'user'
    ? { role: 'user', content: [...(m.image ? [imageBlock(m.image)] : []), { type: 'text', text: m.text }] }
    : { role: 'assistant', content: m.raw?.provider === 'claude' ? m.raw.content : m.text }));
  const tools = webSearch ? [WEB_SEARCH, WEB_FETCH] : undefined;
  let messages = base;
  let text = '';
  let message;
  const content = [];
  for (let round = 0; round < 4; round++) {
    const stream = ai(key).beta.messages.stream({
      model: MODEL, max_tokens: 16000, system, messages, tools, ...FALLBACK,
      output_config: { effort: 'medium' },
    }, { signal });
    stream.on('text', (delta) => { text += delta; onText?.(text); });
    message = await stream.finalMessage();
    content.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    messages = [...base, { role: 'assistant', content: [...content] }];
  }
  checkStop(message);
  return { text, raw: { provider: 'claude', content } };
}
