'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const perf = require('../js/perf-score');
const keys = ['k', 'd', 'a', 'lh', 'gpm', 'xpm', 'hd'];
const data = { methodVersion: '2', patchFrom: 100, builtAt: new Date().toISOString(), patch: 'test', from: 100, to: 200,
  weights: Object.fromEntries(keys.map(k => [k, k === 'd' ? 20 : 80 / 6])), heroes: { 1: { n: 600, metrics: Object.fromEntries(keys.map(k => [k, { n: 600, breakpoints: Array.from({length: 21}, (_, i) => i * 5) }])) } } };
const match = { start: 150, duration: 900, scoreEligible: true };

test('unknown leaver status keeps score and adds tooltip note', () => {
  const result = perf.score({ ...match, leaverUnknown: true }, player, data);
  assert.ok(result.score != null);
  assert.match(perf.tooltip({ leaverUnknown: true }, result), /статус выхода игроков не проверен \(старый кеш\)/);
  assert.doesNotMatch(perf.tooltip({}, result), /старый кеш/);
});
const player = { hero: 1, k: 5, d: 5, a: 5, lh: 5, gpm: 50, xpm: 50, hd: 5, missing: [] };
test('interpolation and ties', () => {
  assert.equal(perf.percentile(12.5, data.heroes[1].metrics.k.breakpoints), 12.5);
  const points = [0, 1, 1, 1, ...Array.from({ length: 17 }, (_, i) => i + 2)];
  assert.equal(perf.percentile(1, points), 10);
});
test('deaths invert and weights apply', () => {
  const scored = perf.score(match, player, data);
  assert.ok(Math.abs(scored.perMetric.d - 99.66666666666667) < 1e-9);
  assert.ok(scored.score > 30 && scored.score < 40);
});
test('unavailable reasons', () => {
  assert.equal(perf.score({ ...match, start: 99 }, player, data).reason, 'wrongPatch');
  assert.equal(perf.score({ ...match, scoreEligible: false }, player, data).reason, 'notEligible');
  assert.equal(perf.score(match, { ...player, hero: 2 }, data).reason, 'insufficientHero');
  assert.equal(perf.score(match, { ...player, missing: ['kills'] }, data).reason, 'dataMissing');
  assert.equal(perf.score(match, player, null).reason, 'jsonUnavailable');
  assert.equal(perf.score({ ...match, duration: Infinity }, player, data).reason, 'dataMissing');
});

test('load rejects a previous patch dataset even for newer matches', async () => {
  const previous = global.fetch;
  global.fetch = async url => ({ ok: true, json: async () => url.includes('patch-notes') ? { version: 'next', timestamp: 200 } : data });
  try { await assert.rejects(perf.load(), /Patch mismatch/); }
  finally { global.fetch = previous; }
});
