// Alles wat met Claude praat. De API-sleutel staat alleen op dit toestel.
import { Anthropic } from '../vendor/anthropic.js';
import { settings } from './db.js';
import { TYPE_KEYS, extractJson } from './wine.js';

const MODEL = 'claude-opus-5-5';
// Bij een (onterechte) weigering door de veiligheidsfilters neemt een ander model het over
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: 4 };
const WEB_FETCH = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 };
const YEAR = () => new Date().getFullYear();

let client;
let clientKey;
function ai() {
  const { apiKey } = settings();
  if (!apiKey) throw new AiError('nokey', 'Vul eerst je Claude API-sleutel in bij Meer > Instellingen.');
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function friendlyError(e) {
  if (e instanceof AiError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'Je API-sleutel klopt niet. Check hem bij Instellingen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Deze API-sleutel mag dit model niet gebruiken.';
  if (e instanceof Anthropic.RateLimitError) return 'Even te veel vragen tegelijk. Probeer het over een minuutje opnieuw.';
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return 'Je API-tegoed is op. Waardeer op via console.anthropic.com.';
    return `Claude snapte het verzoek niet: ${e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Geen verbinding. Check je internet.';
  if (e instanceof Anthropic.APIError) return 'Claude is even niet bereikbaar. Probeer het zo nog eens.';
  return e?.message || 'Er ging iets mis.';
}

export const hasKey = () => Boolean(settings().apiKey);

export async function testKey(apiKey) {
  const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  await c.models.retrieve(MODEL);
}

function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function checkStop(message) {
  if (message.stop_reason === 'refusal') throw new AiError('refused', 'Claude wilde hier niet op ingaan. Probeer het anders te omschrijven.');
  if (message.stop_reason === 'max_tokens') throw new AiError('cut', 'Het antwoord werd te lang en is afgekapt. Probeer het nog eens.');
}

// Eén vraag, JSON terug. Zonder tools met een vast schema, met tools (web) tolerant uitlezen.
async function askJson({ system, content, schema, tools, effort = 'low', maxTokens = 8000 }) {
  const params = {
    model: MODEL, max_tokens: maxTokens, system, ...FALLBACK,
    output_config: { effort },
  };
  if (tools?.length) {
    params.tools = tools;
    content = [...content, { type: 'text', text: 'Geef als laatste bericht alleen de JSON, zonder uitleg eromheen.' }];
  } else {
    params.output_config.format = { type: 'json_schema', schema };
  }
  const first = [{ role: 'user', content }];
  let messages = first;
  let message;
  const blocks = [];
  for (let round = 0; round < 4; round++) {
    message = await ai().beta.messages.create({ ...params, messages });
    blocks.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    // web search/fetch was nog bezig: hetzelfde antwoord terugsturen, de server gaat verder
    messages = [...first, { role: 'assistant', content: [...blocks] }];
  }
  checkStop(message);
  const text = textOf({ content: blocks });
  return tools?.length ? extractJson(text) : JSON.parse(text);
}

const imageBlock = (img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });

/* ---------------- Wijn herkennen ---------------- */

const WINE_PROPS = {
  name: { type: 'string', description: 'Naam van de wijn/cuvée zonder producent en jaar' },
  winery: { type: 'string' },
  vintage: { type: 'integer' },
  type: { type: 'string', enum: TYPE_KEYS },
  grape: { type: 'string' },
  appellation: { type: 'string' },
  region: { type: 'string' },
  country: { type: 'string', description: 'In het Nederlands' },
  drinkFrom: { type: 'integer' },
  drinkUntil: { type: 'integer' },
  abv: { type: 'number' },
  price: { type: 'number', description: 'Indicatie winkelprijs in euro' },
  quantity: { type: 'integer' },
  tasting: { type: 'string', description: 'Korte smaakomschrijving, 1-2 zinnen' },
  pairsWith: { type: 'string', description: 'Korte lijst gerechten waar hij goed bij past' },
};
const WINES_SCHEMA = {
  type: 'object',
  properties: {
    wines: {
      type: 'array',
      items: { type: 'object', properties: WINE_PROPS, required: ['name', 'type'], additionalProperties: false },
    },
  },
  required: ['wines'],
  additionalProperties: false,
};

const IDENTIFY_SYSTEM = `Je helpt iemand flessen wijn in te voeren in een kelder-app. Het is nu ${YEAR()}.
Vul aan wat je over de wijn weet: druif, appellation, regio, land (in het Nederlands), een realistisch drinkvenster voor deze jaargang, alcohol, smaak en een indicatie van de winkelprijs in euro.
Weet je iets echt niet, laat het veld dan weg. Verzin geen jaartal als het niet genoemd of zichtbaar is.
"quantity" is het aantal flessen als dat genoemd wordt of zichtbaar is, anders 1.
Schrijf in het Nederlands, kort en zonder gedachtestreepjes.`;

export async function identifyFromText(text) {
  const r = await askJson({
    system: IDENTIFY_SYSTEM, schema: WINES_SCHEMA,
    content: [{ type: 'text', text: `Omschrijving van de gebruiker: ${text}` }],
  });
  return r.wines ?? [];
}

export async function identifyFromImage(img) {
  const r = await askJson({
    system: IDENTIFY_SYSTEM, schema: WINES_SCHEMA, effort: 'medium',
    content: [imageBlock(img), { type: 'text', text: 'Dit is een foto van een of meer wijnflessen of etiketten. Geef elke verschillende wijn die je kunt lezen. Tel gelijke flessen op in quantity. Een onleesbaar etiket laat je weg.' }],
  });
  return r.wines ?? [];
}

export async function identifyFromProduct(product) {
  const r = await askJson({
    system: IDENTIFY_SYSTEM, schema: WINES_SCHEMA,
    content: [{ type: 'text', text: `Gevonden via de streepjescode (Open Food Facts):\n${JSON.stringify(product)}\nMaak hier precies één wijn van.` }],
  });
  return r.wines ?? [];
}

// Info opzoeken op internet (Claude web search)
export async function enrichOnline(wine) {
  const r = await askJson({
    system: IDENTIFY_SYSTEM,
    tools: [WEB_SEARCH],
    effort: 'medium',
    content: [{ type: 'text', text: `Zoek online op: ${JSON.stringify(wine)}.
Zoek het drinkvenster, smaak, alcohol, druiven, gemiddelde prijs in euro en waar hij goed bij past.
Antwoord met een JSON-object met (voor zover gevonden) de velden: ${Object.keys(WINE_PROPS).join(', ')}.` }],
  });
  return r.wines?.[0] ?? r;
}

/* ---------------- Wijn bij eten ---------------- */

const PAIR_SCHEMA = {
  type: 'object',
  properties: {
    gerecht: { type: 'string', description: 'Het gerecht in een paar woorden, zoals jij het begrijpt' },
    sleutel: { type: 'string', description: 'Waar het bij dit gerecht om draait voor de wijn, 1 zin' },
    keuze: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        waarom: { type: 'string' },
        serveren: { type: 'string', description: 'Temperatuur, wel/niet laten ademen en hoe lang, 1 zin' },
        match: { type: 'integer', description: 'Hoe goed de match is, 1 tot 10' },
      },
      required: ['id', 'waarom', 'serveren', 'match'],
      additionalProperties: false,
    },
    alternatieven: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, waarom: { type: 'string' }, match: { type: 'integer' } },
        required: ['id', 'waarom', 'match'],
        additionalProperties: false,
      },
    },
    flessen: { type: 'integer', description: 'Hoeveel flessen je nodig hebt voor het aantal mensen' },
    koopTip: {
      type: 'object',
      description: 'Alleen invullen als niets uit de kelder echt goed past, of als de kelder leeg is',
      properties: { stijl: { type: 'string' }, waarom: { type: 'string' }, voorbeeld: { type: 'string' } },
      required: ['stijl', 'waarom', 'voorbeeld'],
      additionalProperties: false,
    },
  },
  required: ['gerecht', 'sleutel', 'alternatieven', 'flessen'],
  additionalProperties: false,
};

const PAIR_SYSTEM = () => `Je bent een nuchtere, ervaren sommelier die iemand helpt een fles uit de EIGEN kelder te kiezen. Het is nu ${YEAR()}.
Regels:
- Kies alleen wijnen uit de meegegeven kelder en gebruik exact hun id. Kies nooit iets dat er niet in staat.
- Kijk naar het hele gerecht: saus, bereiding, kruiden, pit en zuur wegen vaak zwaarder dan het hoofdingrediënt.
- Houd rekening met het drinkvenster: liever niet een wijn die over de top is of nog veel te jong. Een fles met status "Drink snel" mag voorrang krijgen als hij goed past.
- Leg uit in gewone spreektaal waarom het werkt (zuur, tannine, vet, zoet, pit, kracht). Max 3 korte zinnen. Geen gedachtestreepjes.
- Geef maximaal 2 alternatieven, liefst in een andere stijl dan de keuze.
- Past er echt niets goed bij (match onder 6) of is de kelder leeg, vul dan koopTip in met een concrete stijl en een betaalbaar voorbeeld uit de supermarkt of slijter. Laat keuze weg als de kelder leeg is.
- Reken voor "flessen" met ongeveer 2 tot 3 glazen per persoon en 6 glazen per fles.
- Schrijf in het Nederlands.`;

export async function pair({ dish, image, url, people, cellar, mood }) {
  const parts = [];
  if (image) parts.push(imageBlock(image));
  const ask = [
    dish && `Gerecht: ${dish}`,
    image && 'Op de foto zie je het gerecht.',
    url && `Het recept staat hier, lees het: ${url}`,
    people && `Aantal mensen: ${people}`,
    mood && `Wens: ${mood}`,
    `Mijn kelder (JSON):\n${JSON.stringify(cellar)}`,
  ].filter(Boolean).join('\n\n');
  parts.push({ type: 'text', text: ask });
  const result = await askJson({
    system: PAIR_SYSTEM(),
    schema: PAIR_SCHEMA,
    tools: url ? [WEB_FETCH] : undefined,
    effort: 'medium',
    content: parts,
  });
  if (url) result.alternatieven ??= [];
  return result;
}

/* ---------------- Sommelier-chat ---------------- */

export function chatSystem(cellar, name) {
  return `Je bent de persoonlijke sommelier van ${name || 'de gebruiker'}, in een app die de wijnkelder bijhoudt. Het is nu ${YEAR()}.
Je praat als een vriend die veel van wijn weet: direct, eerlijk, met een beetje humor, zonder snobisme. Nederlands, spreektaal, geen gedachtestreepjes.
Je kent de kelder hieronder. Verwijs naar flessen bij naam. Raad een fles uit de kelder aan als die past; anders zeg je eerlijk wat ze beter kunnen kopen.
Houd antwoorden kort (max ~120 woorden) tenzij om meer gevraagd wordt. Gebruik gerust korte lijstjes.
Je mag op internet zoeken of een link lezen als dat echt helpt (prijzen, recensies, recepten).

Kelder (JSON):
${JSON.stringify(cellar)}`;
}

// history: [{role, content}] waarbij assistant-content de volledige blokken van Claude zijn (nodig om goed door te praten)
export async function chat({ system, history, onText, signal }) {
  const { webSearch } = settings();
  const tools = webSearch ? [WEB_SEARCH, WEB_FETCH] : undefined;
  let messages = history;
  let text = '';
  let message;
  const content = [];
  for (let round = 0; round < 4; round++) {
    const stream = ai().beta.messages.stream({
      model: MODEL, max_tokens: 16000, system, messages, tools, ...FALLBACK,
      output_config: { effort: 'medium' },
    }, { signal });
    stream.on('text', (delta) => { text += delta; onText?.(text); });
    message = await stream.finalMessage();
    content.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    messages = [...history, { role: 'assistant', content: [...content] }];
  }
  checkStop(message);
  return { text, content };
}
