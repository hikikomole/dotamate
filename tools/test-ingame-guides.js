'use strict';
const assert = require('node:assert/strict');
const { makeGuide, parseKeyValues } = require('./build-ingame-guides');
const { responseSections } = require('./ingame-guide-responses');

const catalog = require('../data/items-ru.json').items;
const itemsById = new Map(Object.entries(catalog).map(([k, v]) => [String(v.id), `item_${k}`]));
const context = { catalog, itemsById, variants: {}, consumables: new Set(), abilities: {},
  missing: new Set(), usedAbilities: new Set(), patch: '7.41f', updated: '22.10.2026', creator: 0, now: 1 };
const rec = { n: 200, early: [{ i: 116, g: 10 }, { i: 254, g: 20 }, { i: 40, g: 9 }],
  late: [{ i: 116, g: 8 }, { i: 37, g: 30 }] };
const sections = responseSections(rec, context);
assert.deepEqual(sections.map(s => s.title), ['Против магии', 'Против физического урона', 'Против контроля']);
assert.deepEqual(sections[0].items.map(i => i.name), ['item_glimmer_cape', 'item_black_king_bar']);
assert.equal(sections[0].items[1].share, 0.05, 'inclusive threshold; phases must not be summed');
assert.deepEqual(responseSections({ ...rec, n: 149 }, context), [], 'sample floor');
assert.deepEqual(responseSections({ n: 200, early: [{ i: 40, g: 9 }] }, context), [], 'below 5%');
assert.equal(responseSections({ n: 200, early: [{ i: 40, g: 10 }] }, context)[0].title, 'Против невидимости');
assert.deepEqual(responseSections({ n: 200 }, context), [], 'no evidence');
assert.deepEqual(responseSections(rec, { ...context, catalog: {} }), [], 'no item mechanics');
assert.deepEqual(responseSections({ n: 200, early: [{ i: 116, g: 201 }] }, context), [], 'invalid count');
assert.deepEqual(responseSections({ n: 200, early: [{ i: 116, g: 6 }], late: [{ i: 116, g: 6 }] }, context), [], 'no false union');
assert.deepEqual(responseSections({ ...rec, n: NaN }, context), []);
assert.equal(responseSections({ n: 150, early: [{ i: 40, g: 8 }] }, context).length, 1, 'sample floor inclusive');
assert.deepEqual(responseSections({ n: 150, early: [{ i: 40, g: 7 }] }, context), []);
assert.equal(responseSections({ n: 200, early: [{ i: 99999, g: 10 }] },
  { ...context, variants: { 99999: 116 } })[0].items[0].name, 'item_black_king_bar');
assert.deepEqual(responseSections(rec, { ...context, catalog: { ...catalog,
  black_king_bar: { ...catalog.black_king_bar, descOwn: true },
  glimmer_cape: { ...catalog.glimmer_cape, desc: [] }, ghost: { ...catalog.ghost, desc: [] } } }), [], 'require mechanical evidence');

const hero = { id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' };
const guide = parseKeyValues(makeGuide(hero, 1, rec, null, context))[0][1];
const get = (pairs, key) => pairs.find(r => r[0] === key)?.[1];
assert.equal(get(guide, 'Title'), 'DotaMate · Anti-Mage · Керри, поз. 1');
const categories = get(get(guide, 'ItemBuild'), 'Items');
assert.deepEqual(categories.slice(-3).map(r => r[0]), sections.map(s => s.title));
assert.ok(categories.every(([, rows]) => rows.every(([k, v]) => k === 'item' && v.startsWith('item_'))));
assert.ok(!categories.some(([k]) => /на линии/.test(k)), 'no lane-item evidence in current inputs');
const tips = get(get(guide, 'ItemBuild'), 'ItemTooltips');
assert.equal(new Set(tips.map(r => r[0])).size, tips.length, 'shared items have one tooltip');
assert.match(get(tips, 'item_black_king_bar'), /не менее 5%/);
assert.match(get(tips, 'item_black_king_bar'), /нормальное развеивание/);
const ranked = parseKeyValues(makeGuide(hero, 1, { n: 200, early: [{ i: 40, g: 10 }] }, null,
  context, false, { key: 'low', ranks: [10, 49] }))[0][1];
assert.deepEqual(get(get(ranked, 'ItemBuild'), 'Items').filter(([k]) => k.startsWith('Против')).map(([k]) => k),
  ['Против невидимости'], 'ranked guide uses only its own slice');
assert.equal(get(ranked, 'Title'), 'DotaMate · 10–49 · Anti-Mage · Керри, поз. 1');
console.log('ingame guide fixtures: PASS');
