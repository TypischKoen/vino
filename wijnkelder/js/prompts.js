// Prompts en schema's die Claude en Gemini allebei gebruiken
import { TYPE_KEYS } from './wine.js';

const YEAR = () => new Date().getFullYear();

export const WINE_PROPS = {
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

export const WINES_SCHEMA = {
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

export const IDENTIFY_SYSTEM = () => `Je helpt iemand flessen wijn in te voeren in een kelder-app. Het is nu ${YEAR()}.
Vul aan wat je over de wijn weet: druif, appellation, regio, land (in het Nederlands), een realistisch drinkvenster voor deze jaargang, alcohol, smaak en een indicatie van de winkelprijs in euro.
Weet je iets echt niet, laat het veld dan weg. Verzin geen jaartal als het niet genoemd of zichtbaar is.
"quantity" is het aantal flessen als dat genoemd wordt of zichtbaar is, anders 1.
Schrijf in het Nederlands, kort en zonder gedachtestreepjes.`;

export const IDENTIFY_TEXT = (text) => `Omschrijving van de gebruiker: ${text}`;
export const IDENTIFY_IMAGE = 'Dit is een foto van een of meer wijnflessen of etiketten. Geef elke verschillende wijn die je kunt lezen. Tel gelijke flessen op in quantity. Een onleesbaar etiket laat je weg.';
export const IDENTIFY_PRODUCT = (product) => `Gevonden via de streepjescode (Open Food Facts):\n${JSON.stringify(product)}\nMaak hier precies één wijn van.`;
export const ENRICH = (wine) => `Zoek online op: ${JSON.stringify(wine)}.
Zoek het drinkvenster, smaak, alcohol, druiven, gemiddelde prijs in euro en waar hij goed bij past.
Antwoord met een JSON-object met (voor zover gevonden) de velden: ${Object.keys(WINE_PROPS).join(', ')}.`;
export const JSON_ONLY = 'Geef als laatste bericht alleen de JSON, zonder uitleg eromheen.';

export const PAIR_SCHEMA = {
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

export const PAIR_SYSTEM = () => `Je bent een nuchtere, ervaren sommelier die iemand helpt een fles uit de EIGEN kelder te kiezen. Het is nu ${YEAR()}.
Regels:
- Kies alleen wijnen uit de meegegeven kelder en gebruik exact hun id. Kies nooit iets dat er niet in staat.
- Kijk naar het hele gerecht: saus, bereiding, kruiden, pit en zuur wegen vaak zwaarder dan het hoofdingrediënt.
- Houd rekening met het drinkvenster: liever niet een wijn die over de top is of nog veel te jong. Een fles met status "Drink snel" mag voorrang krijgen als hij goed past.
- Leg uit in gewone spreektaal waarom het werkt (zuur, tannine, vet, zoet, pit, kracht). Max 3 korte zinnen. Geen gedachtestreepjes.
- Geef maximaal 2 alternatieven, liefst in een andere stijl dan de keuze.
- Past er echt niets goed bij (match onder 6) of is de kelder leeg, vul dan koopTip in met een concrete stijl en een betaalbaar voorbeeld uit de supermarkt of slijter. Laat keuze weg als de kelder leeg is.
- Reken voor "flessen" met ongeveer 2 tot 3 glazen per persoon en 6 glazen per fles.
- Schrijf in het Nederlands.`;

export function pairText({ dish, image, url, people, mood, cellar }) {
  return [
    dish && `Gerecht: ${dish}`,
    image && 'Op de foto zie je het gerecht.',
    url && `Het recept staat hier, lees het: ${url}`,
    people && `Aantal mensen: ${people}`,
    mood && `Wens: ${mood}`,
    `Mijn kelder (JSON):\n${JSON.stringify(cellar)}`,
  ].filter(Boolean).join('\n\n');
}

export function chatSystem(cellar, name) {
  return `Je bent de persoonlijke sommelier van ${name || 'de gebruiker'}, in een app die de wijnkelder bijhoudt. Het is nu ${YEAR()}.
Je praat als een vriend die veel van wijn weet: direct, eerlijk, met een beetje humor, zonder snobisme. Nederlands, spreektaal, geen gedachtestreepjes.
Je kent de kelder hieronder. Verwijs naar flessen bij naam. Raad een fles uit de kelder aan als die past; anders zeg je eerlijk wat ze beter kunnen kopen.
Houd antwoorden kort (max ~120 woorden) tenzij om meer gevraagd wordt. Gebruik gerust korte lijstjes.
Je mag op internet zoeken of een link lezen als dat echt helpt (prijzen, recensies, recepten).

Kelder (JSON):
${JSON.stringify(cellar)}`;
}
