// Kiest automatisch een AI die werkt. Volgorde: Claude (alleen als je dat aanzet), Gemini, OpenRouter.
// Doet de eerste het niet (limiet op, storing), dan neemt de volgende het over.
import { settings } from './db.js';
import * as Claude from './ai-claude.js';
import * as Gemini from './ai-gemini.js';
import * as OpenRouter from './ai-openrouter.js';

export { chatSystem } from './prompts.js';
export const geminiWorkingModel = () => Gemini.workingModel();

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const PROVIDERS = {
  claude: { label: 'Claude', mod: Claude, key: (s) => s.apiKey, args: (s) => [s.apiKey] },
  gemini: { label: 'Gemini', mod: Gemini, key: (s) => s.geminiKey, args: (s) => [s.geminiKey, s.geminiModel || Gemini.DEFAULT_MODEL] },
  openrouter: { label: 'OpenRouter', mod: OpenRouter, key: (s) => s.openrouterKey, args: (s) => [s.openrouterKey] },
};

function order() {
  const s = settings();
  const list = [];
  if (s.preferClaude && s.apiKey) list.push('claude');
  list.push('gemini', 'openrouter');
  return list.filter((p) => PROVIDERS[p].key(s));
}

export const hasKey = () => order().length > 0;
let lastUsed = null;
export const providerLabel = () => PROVIDERS[lastUsed ?? order()[0] ?? 'gemini'].label;

export function friendlyError(e) {
  if (e instanceof AiError) return e.message;
  return Claude.friendlyError(e) ?? Gemini.friendlyError(e) ?? OpenRouter.friendlyError(e) ?? e?.message ?? 'Er ging iets mis.';
}

export const isAbort = (e) => Claude.isAbort(e) || Gemini.isAbort(e) || OpenRouter.isAbort(e);

// Fouten waarbij een andere AI het wel kan: limiet, storing, verkeerde sleutel, geen gratis model
const SWITCH = new Set(['quota', 'nofree', 'model', 'busy', 'badkey', 'denied', 'credits', 'privacy', 'region', 'empty', 'net']);
function shouldSwitch(e) {
  if (isAbort(e)) return false;
  if (e?.code && SWITCH.has(e.code)) return true;
  if (!Claude.friendlyError(e)) return false;
  const st = e.status;
  return !st || st === 401 || st === 403 || st === 429 || st >= 500 || /credit balance/i.test(e.message ?? '');
}

async function run(name, ...rest) {
  const s = settings();
  const list = order();
  if (!list.length) throw new AiError('nokey', 'Vul eerst een gratis sleutel in bij Meer > Instellingen (Gemini of OpenRouter).');
  let firstError;
  for (const p of list) {
    try {
      const result = await PROVIDERS[p].mod[name](...PROVIDERS[p].args(s), ...rest);
      lastUsed = p;
      return result;
    } catch (e) {
      firstError ??= e;
      if (!shouldSwitch(e)) throw e;
    }
  }
  throw firstError;
}

export function testKey(p, key) {
  if (p === 'claude') return Claude.testKey(key);
  if (p === 'gemini') return Gemini.testKey(key, settings().geminiModel || Gemini.DEFAULT_MODEL);
  return OpenRouter.testKey(key);
}

export const identifyFromText = (text) => run('identify', { text });
export const identifyFromImage = (image) => run('identify', { image });
export const identifyFromProduct = (product) => run('identify', { product });
export const enrichOnline = (wine) => run('enrichOnline', wine);
export const pair = (args) => run('pair', args);
export const chat = (opts) => run('chat', { ...opts, webSearch: settings().webSearch });
