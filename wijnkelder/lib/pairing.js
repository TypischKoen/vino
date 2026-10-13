// AI wijn-spijs advies: Claude krijgt het gerecht + je voorraad en kiest een fles die je HEBT.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Je bent een nuchtere sommelier die iemand helpt een fles uit de eigen kelder te kiezen.
Je krijgt een gerecht en een lijst met wijnen die op voorraad zijn, elk met een id.
Regels:
- Kies ALLEEN wijnen uit de lijst en gebruik exact hun id.
- Kijk naar het hele gerecht: saus, bereiding en kruiden wegen vaak zwaarder dan het hoofdingredient.
- Houd rekening met het drinkvenster als dat bekend is: een wijn die over zijn piek is of nog veel te jong, kies je liever niet.
- Leg in gewone spreektaal uit waarom het werkt (zuur, tannine, vet, zoet, kracht). Kort, geen poespas.
- Past er echt niets goed bij, zeg dat eerlijk in "tip" en kies dan de minst slechte optie.
- Schrijf in het Nederlands.`;

const SCHEMA = {
  type: 'object',
  properties: {
    keuze: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        waarom: { type: 'string' },
        serveertip: { type: 'string' },
      },
      required: ['id', 'waarom', 'serveertip'],
      additionalProperties: false,
    },
    alternatieven: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          waarom: { type: 'string' },
        },
        required: ['id', 'waarom'],
        additionalProperties: false,
      },
    },
    tip: { type: 'string' },
  },
  required: ['keuze', 'alternatieven', 'tip'],
  additionalProperties: false,
};

function describeWine(w) {
  const parts = [
    `id=${w.id}`,
    [w.winery, w.name, w.vintage].filter(Boolean).join(' '),
    w.type && `type: ${w.type}`,
    w.grape && `stijl/druif: ${w.grape}`,
    [w.region, w.country].filter(Boolean).join(', '),
    (w.drinkFrom || w.drinkUntil) && `drinkvenster: ${w.drinkFrom ?? '?'}-${w.drinkUntil ?? '?'}`,
    w.rating && `rating: ${w.rating}`,
    `aantal: ${w.quantity}`,
    w.notes && `notitie: ${w.notes}`,
    w.description && `info: ${w.description.slice(0, 200)}`,
  ];
  return '- ' + parts.filter(Boolean).join(' | ');
}

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('AI staat uit: zet ANTHROPIC_API_KEY in je .env');
  }
  client ??= new Anthropic();
  return client;
}

export async function suggestWine(dish, wines) {
  const inStock = wines.filter((w) => (w.quantity ?? 0) > 0);
  if (!inStock.length) {
    throw new Error('Je voorraad is leeg, dus er valt niks te kiezen. Voeg eerst wijnen toe.');
  }

  const year = new Date().getFullYear();
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Bij een (onterechte) weigering door de veiligheidsfilters neemt een ander model het over
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Het is ${year}.\n\nGerecht: ${dish}\n\nMijn voorraad:\n${inStock.map(describeWine).join('\n')}`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('De AI wilde hier geen advies over geven. Probeer het gerecht anders te omschrijven.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Het antwoord werd afgekapt. Probeer het nog een keer.');
  }

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const advice = JSON.parse(text);

  // Nooit een fles teruggeven die je niet hebt, ook niet als het model een id verzint
  const byId = new Map(inStock.map((w) => [w.id, w]));
  if (!byId.has(advice.keuze.id)) {
    throw new Error('De AI koos een wijn die niet in je voorraad staat. Probeer het opnieuw.');
  }
  return {
    keuze: { ...advice.keuze, wine: byId.get(advice.keuze.id) },
    alternatieven: advice.alternatieven
      .filter((a) => byId.has(a.id) && a.id !== advice.keuze.id)
      .slice(0, 2)
      .map((a) => ({ ...a, wine: byId.get(a.id) })),
    tip: advice.tip,
  };
}
