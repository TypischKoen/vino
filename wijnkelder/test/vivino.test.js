import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseVivinoCsv } from '../lib/vivino.js';

test('parseCsv kan quotes, komma\'s en enters in velden aan', () => {
  const rows = parseCsv('a,b\n"x, y","regel1\nregel2"\n"zei ""hoi""",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'regel1\nregel2'], ['zei "hoi"', '2']]);
});

test('parseCsv herkent puntkomma als scheidingsteken', () => {
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('Vivino export wordt omgezet naar wijnen', () => {
  const csv = [
    'Winery,Wine name,Vintage,Region,Country,Regional wine style,Average rating,Your rating,Wine type,Drinking Window,Link to wine,Label image,User cellar count',
    'Château Musar,Château Musar Red,2017,Bekaa Valley,Lebanon,Lebanese Red,4.2,4,Red wine,2024 - 2040,https://www.vivino.com/x,https://img/x.png,3',
    'Bollinger,Special Cuvée,U.V.,Champagne,France,Champagne,4.3,,Sparkling,,,,1',
  ].join('\n');
  const { wines, recognized } = parseVivinoCsv(csv);
  assert.equal(wines.length, 2);
  assert.equal(wines[0].winery, 'Château Musar');
  assert.equal(wines[0].quantity, '3');
  assert.equal(wines[0].rating, '4.2');
  assert.equal(wines[0].drinkFrom, '2024');
  assert.equal(wines[0].drinkUntil, '2040');
  assert.equal(wines[1].vintage, undefined);
  assert.ok(recognized.includes('quantity'));
});

test('zonder aantal-kolom telt elke wijn als 1 fles', () => {
  const { wines } = parseVivinoCsv('Winery,Wine name\nA,B');
  assert.equal(wines[0].quantity, 1);
});

test('foutmelding als er geen naam-kolom is', () => {
  assert.throws(() => parseVivinoCsv('foo,bar\n1,2'), /Geen kolom/);
});
