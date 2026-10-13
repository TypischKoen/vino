// Het weer van vandaag via Open-Meteo (gratis, geen sleutel). Alleen als je het aanzet.
const CACHE_KEY = 'wijnkelder.weather';

const CODES = [
  [[0], 'zonnig', '☀️'], [[1, 2], 'half bewolkt', '🌤️'], [[3], 'bewolkt', '☁️'], [[45, 48], 'mistig', '🌫️'],
  [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], 'regen', '🌧️'], [[71, 73, 75, 77, 85, 86], 'sneeuw', '❄️'],
  [[95, 96, 99], 'onweer', '⛈️'],
];

function describe(code) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: '', icon: '🌡️' };
}

function position() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve(p.coords), reject, { maximumAge: 3600_000, timeout: 10_000 },
  ));
}

export async function today() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached.at < 3600_000) return cached.data;
  } catch {}
  const { latitude, longitude } = await position();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&current=temperature_2m,weather_code&daily=temperature_2m_max&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('weer niet beschikbaar');
  const j = await res.json();
  const data = {
    temp: Math.round(j.current.temperature_2m),
    max: Math.round(j.daily.temperature_2m_max[0]),
    ...describe(j.current.weather_code),
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}

// Korte tip op basis van het weer, zonder AI
export function weatherTip(w) {
  if (w.max >= 25) return 'Warm vandaag. Tijd voor iets fris: rosé, een strakke witte of bubbels uit de koelkast.';
  if (w.max >= 18) return 'Lekker weer. Een lichte rode iets gekoeld (pinot, gamay) of een frisse witte werkt goed.';
  if (w.max <= 6) return 'Koud buiten. Perfect voor iets stevigs: een volle rode of een glaasje port na het eten.';
  return 'Gewoon Hollands weer. Alles mag, kijk vooral naar wat je eet.';
}
