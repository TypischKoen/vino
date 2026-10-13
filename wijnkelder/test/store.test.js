import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WineStore } from '../lib/store.js';

async function freshStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'wijn-'));
  const store = new WineStore(path.join(dir, 'wines.json'));
  await store.load();
  return store;
}

test('import voegt samen op producent + naam + jaar', async () => {
  const store = await freshStore();
  await store.importMany([{ winery: 'A', name: 'Rood', vintage: '2019', quantity: '2' }]);
  let res = await store.importMany([{ winery: 'a', name: 'rood ', vintage: 2019, quantity: 3 }], 'add');
  assert.deepEqual(res, { added: 0, updated: 1 });
  assert.equal(store.all()[0].quantity, 5);
  res = await store.importMany([{ winery: 'A', name: 'Rood', vintage: 2019, quantity: 1 }], 'replace');
  assert.equal(store.all()[0].quantity, 1);
});

test('opslaan en opnieuw laden', async () => {
  const store = await freshStore();
  const w = await store.add({ name: 'Test', quantity: '4' });
  await store.update(w.id, { quantity: 3 });
  const again = new WineStore(store.file);
  await again.load();
  assert.equal(again.get(w.id).quantity, 3);
  assert.ok(await again.remove(w.id));
});

test('wijn zonder naam en producent wordt geweigerd', async () => {
  const store = await freshStore();
  await assert.rejects(store.add({ vintage: 2020 }));
});
