'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, BINS } = require('./build-item-timings');

test('only verified ranked purchase logs contribute to timings', () => {
  const catalog = { blink: {}, boots: {} };
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: String(i + 1), end: 2000 + i, dur: 900, mode: 22, lobby: 7, p: [
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, [[i ? 300 : -1, 'blink'], [500, 'blink']], true],
      ...Array.from({ length: 9 }, () => [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, [[0, 'boots']], false])
    ]
  }));
  rows.push({ ...rows[0], id: 'unranked', lobby: 0 });
  rows.push({ ...rows[0], id: 'unknown', p: [[1,0,0,0,0,0,0,0,0,0,[[0,'unknown']],true]] });
  const result = aggregate(rows, catalog);
  assert.equal(result.meta.matches, 30);
  assert.equal(result.meta.verifiedPlayers, 30);
  assert.equal(result.items.blink.n, 30);
  assert.equal(result.items.blink.hist.reduce((a, b) => a + b, 0), 30);
  assert.equal(result.items.blink.hist[0], 1);
  assert.equal(result.items.blink.hist[BINS.indexOf(300) + 1], 29);
  assert.equal(result.items.boots, undefined);
});
