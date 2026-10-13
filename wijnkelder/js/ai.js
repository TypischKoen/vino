// Kiest de AI die je bij Instellingen hebt gekozen: Gemini (gratis) of Claude (betaald)
import { settings } from './db.js';
import * as Claude from './ai-claude.js';
import * as Gemini from './ai-gemini.js';

export { chatSystem } from './prompts.js';
export const GEMINI_DEFAULT_MODEL = Gemini.DEFAULT_MODEL;

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const provider = () => (settings().provider === 'claude' ? 'claude' : 'gemini');
export const providerLabel = () => (provider() === 'claude' ? 'Claude' : 'Gemini');

function active() {
  const s = settings();
  if (provider() === 'claude') {
    if (!s.apiKey) throw new AiError('nokey', 'Vul eerst je Claude API-sleutel in bij Meer > Instellingen, of kies Gemini.');
    return { mod: Claude, args: [s.apiKey] };
  }
  if (!s.geminiKey) throw new AiError('nokey', 'Vul eerst je gratis Gemini API-sleutel in bij Meer > Instellingen.');
  return { mod: Gemini, args: [s.geminiKey, s.geminiModel || Gemini.DEFAULT_MODEL] };
}

export function hasKey() {
  const s = settings();
  return provider() === 'claude' ? Boolean(s.apiKey) : Boolean(s.geminiKey);
}

export function friendlyError(e) {
  if (e instanceof AiError) return e.message;
  return Claude.friendlyError(e) ?? Gemini.friendlyError(e) ?? e?.message ?? 'Er ging iets mis.';
}

export const isAbort = (e) => Claude.isAbort(e) || Gemini.isAbort(e);

export function testKey(which, key, model) {
  return which === 'claude' ? Claude.testKey(key) : Gemini.testKey(key, model || Gemini.DEFAULT_MODEL);
}

const run = (name, ...rest) => { const { mod, args } = active(); return mod[name](...args, ...rest); };

export const identifyFromText = (text) => run('identify', { text });
export const identifyFromImage = (image) => run('identify', { image });
export const identifyFromProduct = (product) => run('identify', { product });
export const enrichOnline = (wine) => run('enrichOnline', wine);
export const pair = (args) => run('pair', args);
export const chat = (opts) => run('chat', { ...opts, webSearch: settings().webSearch });
