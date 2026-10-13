import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWine, normalizeType, drinkStatus, stats, matches, cellarForPrompt, toCsv, extractJson, label } from '../js/wine.js';

test('normalizeType herkent gangbare omschrijvingen', () => {
  assert.equal(normalizeType('Red wine'), 'rood');
  assert.equal(normalizeType('Witte wijn'), 'wit');
  assert.equal(normalizeType('rose'), 'rosé');
  assert.equal(normalizeType('Champagne'), 'mousserend');
  assert.equal(normalizeType('Tawny port'), 'versterkt');
  assert.equal(normalizeType('Sauternes'), 'dessert');
});

test('normalizeWine maakt getallen van tekst en kapt rare waarden af', () => {
  const w = normalizeWine({ name: ' Barolo ', vintage: '2018', quantity: '-3', price: '€ 24,95', rating: 9, abv: '14,5%' });
  assert.equal(w.name, 'Barolo');
  assert.equal(w.vintage, 2018);
  assert.equal(w.quantity, 0);
  assert.equal(w.price, 24.95);
  assert.equal(w.rating, 5);
  assert.equal(w.abv, 14.5);
  assert.equal(w.type, 'rood');
  assert.equal(normalizeWine({ name: 'x' }).quantity, 1);
  assert.equal(normalizeWine({ name: 'x', vintage: 12 }).vintage, undefined);
});

test('drinkStatus volgt het drinkvenster', () => {
  assert.equal(drinkStatus({ drinkFrom: 2030, drinkUntil: 2040 }, 2026), 'jong');
  assert.equal(drinkStatus({ drinkFrom: 2020, drinkUntil: 2035 }, 2026), 'piek');
  assert.equal(drinkStatus({ drinkFrom: 2020, drinkUntil: 2027 }, 2026), 'nu');
  assert.equal(drinkStatus({ drinkUntil: 2024 }, 2026), 'over');
  assert.equal(drinkStatus({}, 2026), null);
});

test('stats telt alleen wat op voorraad is', () => {
  const s = stats([
    { type: 'rood', quantity: 2, price: 10, vintage: 2015, drinkUntil: 2026 },
    { type: 'wit', quantity: 1, price: 8, vintage: 2022 },
    { type: 'wit', quantity: 0, price: 100, vintage: 1990 },
  ], 2026);
  assert.equal(s.bottles, 3);
  assert.equal(s.labels, 2);
  assert.equal(s.value, 28);
  assert.equal(s.byType.wit, 1);
  assert.equal(s.oldest, 2015);
  assert.equal(s.urgent.length, 1);
});

test('zoeken matcht op alle woorden', () => {
  const w = { name: 'Barolo', winery: 'Pio Cesare', grape: 'Nebbiolo', country: 'Italië', type: 'rood' };
  assert.ok(matches(w, 'nebbiolo pio'));
  assert.ok(!matches(w, 'nebbiolo frankrijk'));
});

test('cellarForPrompt laat lege flessen weg', () => {
  const out = cellarForPrompt([{ id: 'a', name: 'X', type: 'rood', quantity: 1 }, { id: 'b', name: 'Y', type: 'wit', quantity: 0 }], 2026);
  assert.deepEqual(out.map((o) => o.id), ['a']);
});

test('extractJson vindt JSON in rommelige tekst', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Hier:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Ik vond dit. {"a":3} Succes!'), { a: 3 });
  assert.throws(() => extractJson('niks'));
});

test('CSV ontsnapt puntkomma\'s en quotes', () => {
  const csv = toCsv([{ name: 'A;B', notes: 'zei "hoi"', type: 'rood', quantity: 1 }]);
  assert.match(csv, /"A;B"/);
  assert.match(csv, /"zei ""hoi"""/);
});

test('label plakt producent, naam en jaar', () => {
  assert.equal(label({ winery: 'Pio Cesare', name: 'Barolo', vintage: 2018 }), 'Pio Cesare Barolo 2018');
});
