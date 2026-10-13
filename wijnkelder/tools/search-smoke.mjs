// Echte mini-test van de Perplexity Search API. Leest de sleutel uit PERPLEXITY_API_KEY
// en print alleen de status en de vorm van het antwoord, nooit de sleutel.
import Perplexity from '@perplexity-ai/perplexity_ai';

if (!process.env.PERPLEXITY_API_KEY) {
  console.error('PERPLEXITY_API_KEY ontbreekt. Maak een sleutel op https://console.perplexity.ai en zet hem in je eigen terminal:');
  console.error('  export PERPLEXITY_API_KEY=...');
  process.exit(1);
}

const client = new Perplexity({ maxRetries: 0 }); // pakt PERPLEXITY_API_KEY zelf
try {
  const { data, response } = await client.search
    .create({ query: ['Pio Cesare Barolo 2018', 'Barolo drinkvenster'], max_results: 3, country: 'NL' })
    .withResponse();
  const first = data.results?.[0];
  console.log(JSON.stringify({
    status: response.status,
    resultCount: data.results?.length ?? 0,
    responseKeys: Object.keys(data),
    firstResultKeys: first ? Object.keys(first) : [],
  }, null, 2));
} catch (e) {
  if (e instanceof Perplexity.APIError) {
    const hint = { 401: 'sleutel klopt niet (authenticatie)', 429: `rate limit, wacht ${e.headers?.get?.('retry-after') ?? 'even'} seconden (Retry-After)` }[e.status] ?? '';
    console.error(JSON.stringify({ status: e.status ?? 'geen verbinding', error: e.name, hint }));
    process.exit(1);
  }
  throw e;
}
