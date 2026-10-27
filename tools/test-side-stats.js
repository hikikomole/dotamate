'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./build-side-stats');
const row = (id, duration, win = 1) => [id, 0, 2000, duration, null, win, 22, 7, [],
  ...Array.from({ length: 10 }, (_, i) => [i + 1])];
const make = async rows => build((async function* () { yield* rows; })(),
  { heroIds: Array.from({ length: 10 }, (_, i) => i + 1), patch: 'test', patchFrom: 1000 });
test('duration boundaries, side outcomes and low-sample suppression', async () => {
  const x = await make([899, 900, 1499, 1500, 2099, 2100, 2699, 2700].map((d, i) => row(i + 1, d, i % 2)));
  assert.deepEqual(x.duration.map(d => d.n), [2, 2, 2, 1]);
  assert.equal(x.meta.exclusions.short, 1);
  assert.equal(x.duration.reduce((n, d) => n + d.n, 0), x.meta.matches);
  assert.equal(x.heroes[0].radiant.n, 7);
  assert.equal(x.heroes[5].dire.w, x.meta.matches - x.duration.reduce((n, d) => n + d.radiantWins, 0));
  assert.equal(x.heroes[0].delta, null);
  assert.equal(x.duration[0].radiantWr, null);
});
test('thresholds include 100 per side and 300 per bucket', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => row(i + 1, 1500, i % 2));
  for (let i = 150; i < 300; i++) [rows[i][9], rows[i][14]] = [rows[i][14], rows[i][9]];
  const x = await make(rows);
  assert.equal(x.duration[1].radiantWr, 50);
  assert.equal(x.heroes[0].delta, 0);
});
