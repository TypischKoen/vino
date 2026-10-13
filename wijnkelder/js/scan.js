// Streepjescode scannen met de camera + opzoeken in Open Food Facts (gratis, geen sleutel nodig)

let Detector;
async function detector() {
  if (!Detector) {
    if ('BarcodeDetector' in window) {
      Detector = window.BarcodeDetector;
    } else {
      // iPhone heeft geen ingebouwde BarcodeDetector: gebruik de meegeleverde (WebAssembly) versie
      const mod = await import('../vendor/barcode.js');
      const wasm = new URL('../vendor/zxing_reader.wasm', import.meta.url).href;
      mod.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm : prefix + path) } });
      Detector = mod.BarcodeDetector;
    }
  }
  return new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
}

export async function startScanner(video, onCode) {
  const d = await detector();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    try {
      const codes = await d.detect(video);
      const code = codes.find((c) => /^\d{8,14}$/.test(c.rawValue))?.rawValue ?? codes[0]?.rawValue;
      if (code && !stopped) { stop(); onCode(code); }
    } catch { /* volgende frame opnieuw */ }
    busy = false;
  }, 220);
  function stop() {
    stopped = true;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  return stop;
}

// Streepjescode uit een losse foto (als de live camera niet wil)
export async function scanImage(blob) {
  const d = await detector();
  const bitmap = await createImageBitmap(blob);
  const codes = await d.detect(bitmap);
  return codes[0]?.rawValue ?? null;
}

export async function lookupBarcode(code) {
  const fields = 'product_name,product_name_nl,product_name_en,brands,countries,quantity,alcohol_value,categories,labels,origins,image_front_url';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Open Food Facts reageert niet. Probeer het later nog eens.');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  return {
    barcode: code,
    naam: p.product_name_nl || p.product_name || p.product_name_en,
    merk: p.brands, land: p.countries || p.origins, inhoud: p.quantity,
    alcohol: p.alcohol_value, categorie: p.categories, labels: p.labels,
    foto: p.image_front_url,
  };
}
