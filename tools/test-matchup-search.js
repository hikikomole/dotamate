'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./build-matchup-search');

const row = (id, win = 1, lobby = 7) => [id, 0, 2000, 1200, null, win, 22, lobby, [],
  ...Array.from({ length: 10 }, (_, i) => [i + 1])];
const make = async rows => build((async function* () { yield* rows; })(),
  { heroIds: Array.from({ length: 10 }, (_, i) => i + 1), patch: 'test', patchFrom: 1000 });

test('ranked cohort, pair orientation, symmetry and threshold', async () => {
  const result = await make([...Array.from({ length: 299 }, (_, i) => row(i + 1)), row(300, 0), row(301, 1, 0)]);
  assert.equal(result.meta.matches, 300);
  assert.equal(result.meta.exclusions.notRanked, 1);
  const withPair = result.with.find(p => p.a === 1 && p.b === 2);
  const vsPair = result.vs.find(p => p.a === 1 && p.b === 6);
  assert.equal(withPair.n, 300); assert.equal(withPair.w, 299);
  assert.equal(vsPair.n, 300); assert.equal(vsPair.w, 299);
  assert.equal(result.vs.find(p => p.a === 5 && p.b === 10).n, 300);
  assert.ok(Number.isFinite(vsPair.delta));
  const thin = await make(Array.from({ length: 299 }, (_, i) => row(i + 1)));
  assert.equal(thin.vs[0].observed, null);
});

test('invalid and duplicate rows cannot change totals', async () => {
  const result = await make([row(1), row(1), row(2, 0), row(3, 1, 0)]);
  assert.equal(result.meta.matches, 2);
  assert.equal(result.meta.exclusions.duplicateId, 1);
  assert.equal(result.meta.exclusions.notRanked, 1);
  assert.equal(result.vs[0].w, 1);
});
