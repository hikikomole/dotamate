'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('../js/me');
const match = (i, heroId = 1, score = 60) => ({ matchId: i, start: 100 + i, scoreEligible: true, details: true, win: i % 2 === 0, heroId, k: 4, d: 2, a: 6, perf: score == null ? { score: null } : { score, perMetric: { k: 70, d: 30, a: 60, lh: 20, gpm: 80, xpm: 70, hd: 60 } } });
test('current patch window, chronological trend, gaps and rolling ten', () => {
  const input = Array.from({ length: 55 }, (_, i) => match(55 - i));
  input[0].perf.score = null;
  input[2].scoreEligible = false;
  const a = aggregate(input, 100);
  assert.equal(a.window.length, 50);
  assert.equal(a.window[0].matchId, 5);
  assert.equal(a.trend.at(-1).score, null);
  assert.equal(a.scored, 49);
  assert.equal(a.trend.at(-1).average, 60);
});
test('complete match threshold and aggregate KDA', () => {
  const a = aggregate(Array.from({ length: 10 }, (_, i) => match(i + 1)), 100);
  assert.equal(a.winrate, 50);
  assert.equal(a.kda, 5);
  assert.equal(aggregate([match(1)], 100).kda, null);
});
test('hero threshold and weakest median percentiles', () => {
  const input = [...Array.from({ length: 10 }, (_, i) => match(i + 1, 1, 60)), ...Array.from({ length: 10 }, (_, i) => match(i + 11, 2, 40)), match(21, 3, 100)];
  const a = aggregate(input.reverse(), 100);
  assert.deepEqual(a.heroes.map(h => h.heroId), [1, 2]);
  assert.deepEqual(a.played[0].weak.map(x => x.key), ['lh', 'd']);
});
