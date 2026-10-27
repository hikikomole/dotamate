'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wilsonLow, rankRole } = require('./stats-rating');
const { inspectSteamRow, createRowFilter, assertProvenance } = require('./stats-cohort');

const row = () => [42, 0, 1000, 1200, null, 1, 22, 7, [], ...Array.from({ length: 10 }, (_, i) => [i + 1])];
test('ranked cohort rejects invalid inputs', () => {
  const opts = { patchFrom: 900, known: new Set(Array.from({ length: 10 }, (_, i) => i + 1)) };
  assert.equal(inspectSteamRow(row(), opts), null);
  const cases = [[7, 0, 'notRanked'], [5, 2, 'missingResult'], [2, 899, 'outsidePatch']];
  for (const [i, value, reason] of cases) { const r = row(); r[i] = value; assert.equal(inspectSteamRow(r, opts), reason); }
  const dup = row(); dup[18] = [1]; assert.equal(inspectSteamRow(dup, opts), 'invalidHeroes');
  const filter = createRowFilter(opts);
  assert.equal(filter(row()), null);
  assert.equal(filter(row()), 'duplicateId');
  assert.throws(() => assertProvenance({ source: 'opendota', cohort: 'ranked-all-ranks', patch: '7.41', patchFrom: 900 }, '7.41'));
  assert.throws(() => assertProvenance({ source: 'stratz', cohort: 'ranked-all-ranks', patch: '7.41', patchFrom: 900 }, '7.41'));
});
test('Wilson and role thresholds', () => {
  assert.equal(wilsonLow(0, 0), null);
  assert.ok(Math.abs(wilsonLow(6, 12) - .2538) < .002);
  const rows = rankRole([{ id: 3, n: 30, w: 15 }, { id: 2, n: 100, w: 50 }, { id: 1, n: 100, w: 50 }, { id: 4, n: 0, w: 0 }], 1000);
  assert.deepEqual(rows.slice(0, 2).map(x => x.id), [1, 2]);
  assert.equal(rows[0].tier, null);
  assert.equal(rows[2].rating, null);
  assert.equal(rows[3].wr, null);
  const tiers = rankRole(Array.from({ length: 5 }, (_, i) => ({ id: i + 1, n: 100, w: 50 })), 500);
  assert.deepEqual(tiers.map(x => x.tier), ['S', 'A', 'A', 'B', 'B']);
});
