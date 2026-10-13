// Wijn opzoeken via de Google Custom Search JSON API (Programmable Search Engine).
// Nodig: GOOGLE_API_KEY en GOOGLE_CSE_ID in .env. Gratis tot 100 zoekopdrachten per dag.

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID);
}

export function buildQuery(wine) {
  return [wine.winery, wine.name, wine.vintage, 'wijn'].filter(Boolean).join(' ');
}

export async function searchWine(query) {
  if (!googleConfigured()) {
    throw new Error('Google zoeken staat uit: vul GOOGLE_API_KEY en GOOGLE_CSE_ID in je .env in');
  }
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', process.env.GOOGLE_API_KEY);
  url.searchParams.set('cx', process.env.GOOGLE_CSE_ID);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '5');

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google gaf een fout (${res.status}): ${body.error?.message ?? res.statusText}`);
  }
  const data = await res.json();
  return (data.items ?? []).map((item) => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet,
    image: item.pagemap?.cse_image?.[0]?.src ?? item.pagemap?.cse_thumbnail?.[0]?.src,
  }));
}

// Pak de eerste bruikbare info uit de zoekresultaten. Een Vivino-link heeft voorrang.
export function enrichmentFromResults(results) {
  if (!results.length) return {};
  const vivino = results.find((r) => /vivino\.com/.test(r.link));
  const best = vivino ?? results[0];
  const patch = {
    description: best.snippet,
    webUrl: best.link,
  };
  if (vivino) patch.vivinoUrl = vivino.link;
  const image = results.find((r) => r.image)?.image;
  if (image) patch.imageUrl = image;
  return patch;
}
