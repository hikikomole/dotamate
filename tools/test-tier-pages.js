'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderTierPages } = require('./tier-page-render');

test('tier pages keep role order and only index eligible positions', () => {
  const roles = Object.fromEntries([1, 2, 3, 4, 5].map(p => [p, { labeledSlots: p === 1 ? 200 : 0, heroes: p === 1 ? [{ id: 1, n: 120, w: 70, wr: 58.33, rating: 49.4, tier: 'S', pickShare: 60 }, { id: 2, n: 100, w: 50, wr: 50, rating: 40.2, tier: null, pickShare: 50 }] : [] }]));
  const data = { schemaVersion: 1, status: 'ok', meta: { source: 'valve-replay', patch: '7.41f', to: '2026-10-26T00:00:00Z', matches: 100, coverage: { gatePassed: true } }, positions: roles };
  const pages = renderTierPages(data, [{ id: 1, localized_name: 'Anti-Mage', name: 'npc_dota_hero_antimage' }, { id: 2, localized_name: 'Axe', name: 'npc_dota_hero_axe' }]);
  assert.match(pages['position-1'], /https:\/\/dotamate\.ru\/tier-list\/position-1\//);
  assert.match(pages['position-1'], /\/hero\/antimage\//);
  assert.ok(pages['position-1'].indexOf('antimage') < pages['position-1'].indexOf('/hero/axe/'));
  assert.deepEqual(pages.urls.map(x => x.loc), ['https://dotamate.ru/tier-list/', 'https://dotamate.ru/tier-list/position-1/']);
  assert.match(pages['position-2'], /Недостаточно/);
  data.meta.coverage.gatePassed = false;
  assert.equal(renderTierPages(data, []).urls.length, 0);
});
