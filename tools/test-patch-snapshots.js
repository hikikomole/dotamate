'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boundaries, buildSnapshot } = require('./build-patch-snapshots');
const { retainPatch } = require('./fetch-patch-notes');

const heroes = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
const row = (id, time, radiant = 1) => [id, 0, time, 1200, null, radiant, 22, 7, [],
  ...Array.from({ length: 10 }, (_, i) => [i + 1])];
async function* rows(list) { for (const r of list) yield r; }

test('exact boundary, duplicate ID, raw integer daily counts', async () => {
  const patches = boundaries({ patches: [{ version: 'a', timestamp: 1000 }, { version: 'b', timestamp: 2000 }] });
  const result = await buildSnapshot(rows([row(1, 999), row(2, 1000), row(2, 1000), row(3, 1999, 0), row(4, 2000)]), patches[0], patches[1], heroes);
  assert.equal(result.meta.matches, 2);
  assert.deepEqual(result.meta.exclusions, { outsidePatch: 2, duplicateId: 1 });
  const day = Object.values(result.days)[0];
  assert.equal(day.matches, 2);
  assert.equal(day.heroes[1].n, 2);
  assert.equal(day.heroes[1].w, 1);
});

test('no old data is explicit insufficient and bad catalog rejected', async () => {
  const empty = await buildSnapshot(rows([row(1, 2000)]), { version: 'a', timestamp: 1000 }, { version: 'b', timestamp: 2000 }, heroes);
  assert.equal(empty.status, 'insufficient');
  assert.equal(empty.meta.matches, 0);
  assert.throws(() => boundaries({ patches: [{ version: '../x', timestamp: 1 }] }));
  assert.throws(() => boundaries({ patches: [{ version: 'a', timestamp: 1 }, { version: 'b', timestamp: 1 }] }));
});

test('Valve boundary catalog retains prior patch and rejects conflict', () => {
  const old = { version: 'a', timestamp: 1000 };
  const next = { version: 'b', timestamp: 2000 };
  const catalog = retainPatch({}, old, next);
  assert.deepEqual(catalog.patches, [old, next]);
  assert.deepEqual(retainPatch(catalog, old, next).patches, [old, next]);
  assert.throws(() => retainPatch(catalog, { version: 'a', timestamp: 999 }, next));
  assert.throws(() => retainPatch(catalog, old, { version: 'b', timestamp: null }));
});
