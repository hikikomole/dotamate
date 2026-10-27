'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('./build-item-followups');

test('distinct next purchase, ties and censored buyers', () => {
  const cat = { alpha: { cat: 'item' }, beta: { cat: 'item' }, tango: { cat: 'consumable' }, recipe_alpha: { cat: 'recipe' } };
  const make = (id, events) => ({ id: String(id), mode: 22, lobby: 7, dur: 900,
    p: [[1,0,0,0,0,0,0,0,0,0,events,true], ...Array.from({length:9},()=>[1,0,0,0,0,0,0,0,0,0,[],false])] });
  const rows = [make(1, [[0,'tango'],[10,'alpha'],[20,'alpha'],[40,'beta']]),
    make(2, [[10,'alpha'],[10,'beta']]), make(3, [[10,'alpha']])];
  const result = aggregate(rows, cat);
  assert.equal(result.items.alpha.buyers, 3);
  assert.equal(result.items.alpha.eligibleSequences, 1);
  assert.equal(result.meta.excludedTies, 1);
  assert.deepEqual(result.items.alpha.next, []); // publication threshold
});
