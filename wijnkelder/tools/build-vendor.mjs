// Bundelt de libraries die de app gebruikt naar ../vendor, zodat de app zonder CDN en offline werkt.
import { build } from 'esbuild';
import { copyFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'vendor');
await mkdir(out, { recursive: true });

const entries = {
  'anthropic.js': "export { default as Anthropic } from '@anthropic-ai/sdk';",
  'perplexity.js': "export { default as Perplexity } from '@perplexity-ai/perplexity_ai';",
  'barcode.js': "export { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';",
};
for (const [file, contents] of Object.entries(entries)) {
  await build({
    stdin: { contents, resolveDir: here, loader: 'js' },
    bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'safari15',
    outfile: path.join(out, file), legalComments: 'eof', logLevel: 'warning',
  });
}
await copyFile(path.join(here, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'), path.join(out, 'zxing_reader.wasm'));
await writeFile(path.join(out, 'README.md'), 'Gegenereerd door `tools/build-vendor.mjs`. Niet met de hand aanpassen.\n');
console.log('vendor klaar');
