import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, mergeResults, sourcesForPrompt } from '../js/search.js';
import { normalizeWine } from '../js/wine.js';

test('normalizeUrl ziet www, slash, hash en utm-tags als dezelfde pagina', () => {
  const a = normalizeUrl('https://www.Vivino.com/wijn/barolo/?utm_source=x#reviews');
  assert.equal(a, normalizeUrl('https://vivino.com/wijn/barolo'));
  assert.notEqual(normalizeUrl('https://a.nl/x?id=1'), normalizeUrl('https://a.nl/x?id=2'));
});

test('mergeResults haalt dubbele URL\'s weg en houdt de volgorde aan', () => {
  const out = mergeResults([
    { title: 'A', url: 'https://www.a.nl/x/', snippet: 's1', date: '2026-01-01' },
    { title: 'B', url: 'https://b.nl/y', snippet: 's2' },
    { title: 'A dubbel', url: 'https://a.nl/x', snippet: 's3' },
  ]);
  assert.deepEqual(out.map((r) => r.title), ['A', 'B']);
  assert.equal(out[0].date, '2026-01-01');
  assert.equal('date' in out[1], false);
});

test('mergeResults kan ook per zoekvraag geneste lijsten aan', () => {
  const out = mergeResults([
    [{ title: 'A', url: 'https://a.nl', snippet: '' }, { title: 'B', url: 'https://b.nl', snippet: '' }],
    [{ title: 'B2', url: 'https://www.b.nl/', snippet: '' }, { title: 'C', url: 'https://c.nl', snippet: '' }],
  ]);
  assert.deepEqual(out.map((r) => r.title), ['A', 'B', 'C']);
});

test('mergeResults slaat kapotte resultaten over', () => {
  assert.deepEqual(mergeResults([null, { title: 'x' }, { url: 'https://a.nl' }]), []);
  assert.deepEqual(mergeResults(undefined), []);
});

test('sourcesForPrompt nummert en kort af', () => {
  const txt = sourcesForPrompt([{ title: 'A', url: 'https://a.nl', snippet: 'x'.repeat(900), date: '2026-02-02' }]);
  assert.match(txt, /^\[1\] A \(2026-02-02\)\nhttps:\/\/a\.nl\n/);
  assert.ok(txt.length < 700);
});

test('normalizeWine bewaart alleen veilige bronnen', () => {
  const w = normalizeWine({ name: 'X', sources: [
    { title: 'Goed', url: 'https://a.nl', date: '2026-01-01' },
    { title: 'Eng', url: 'javascript:alert(1)' },
    { url: 'https://zonder-titel.nl' },
  ] });
  assert.deepEqual(w.sources, [{ title: 'Goed', url: 'https://a.nl', date: '2026-01-01' }]);
});
