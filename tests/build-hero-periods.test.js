'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-periods-'));
const input = path.join(dir, 'in'), out = path.join(dir, 'out'), patchFile = path.join(dir, 'patch.json'), catalogFile = path.join(dir, 'catalog.json');
fs.mkdirSync(input); fs.mkdirSync(out);
const today = new Date().toISOString().slice(0, 10);
const day = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
const file = path.join(input, 'test.json');
const run = () => cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-hero-periods.js'),
  '--input-dir', input, '--out-dir', out, '--patch-file', patchFile, '--catalog-file', catalogFile], { encoding: 'utf8' });
const result = () => JSON.parse(fs.readFileSync(path.join(out, 'hero-periods.json'), 'utf8'));
const fixture = (patchOffset, offsets, matches = 200) => {
  const stamp = Date.parse(day(patchOffset) + 'T00:00:00Z') / 1000;
  fs.writeFileSync(patchFile, JSON.stringify({ version: 'test', timestamp: stamp - 86400 }));
  fs.writeFileSync(catalogFile, JSON.stringify({ patches: [{ version: 'test', timestamp: stamp }] }));
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1,
    meta: { source: 'steam', cohort: 'ranked-all-ranks', patch: 'test', patchFrom: stamp },
    days: Object.fromEntries(offsets.map(i => [day(i), { matches, heroes: { 1: { n: matches * 10, w: matches * 5 } } }])) }));
};
fixture(40, Array.from({ length: 30 }, (_, i) => i + 1));
assert.strictEqual(run().status, 0);
assert.strictEqual(result().periods['7d'].available, true);
assert.strictEqual(result().periods['30d'].heroes[0].wr, 50);
assert.strictEqual(result().periods['7d'].heroes[0].pickRate, 1000);
assert.strictEqual(result().schemaVersion, 3);
assert.strictEqual(result().periods['7d'].heroes[0].prevN, 14000);
assert.strictEqual(result().periods['7d'].heroes[0].prevW, 7000);
assert.strictEqual(result().periods['7d'].days.length, 7);
assert.strictEqual(result().periods['7d'].days[0], day(7));
assert.deepStrictEqual(result().periods['7d'].heroes[0].series.n, Array(7).fill(2000));
assert.deepStrictEqual(result().periods['7d'].heroes[0].series.w, Array(7).fill(1000));
assert(result().periods['7d'].heroes[0].low < 50 && result().periods['7d'].heroes[0].high > 50);
assert(Math.abs(result().periods['7d'].heroes[0].low + result().periods['7d'].heroes[0].high - 100) <= .01);
const fixtureSize = fs.statSync(path.join(out, 'hero-periods.json')).size;
fixture(3, [1, 2, 3], 400);
assert.strictEqual(run().status, 0);
assert.strictEqual(result().periods['30d'].from, day(3));
assert.strictEqual(result().periods['30d'].available, true);
assert.strictEqual(result().periods['30d'].heroes[0].prevN, null);
fixture(10, [1, 2], 100);
assert.strictEqual(run().status, 0);
assert.strictEqual(result().periods['7d'].available, false);
const previous = fs.readFileSync(path.join(out, 'hero-periods.json'));
fs.writeFileSync(file, '{broken');
assert.notStrictEqual(run().status, 0);
assert(previous.equals(fs.readFileSync(path.join(out, 'hero-periods.json'))));
console.log('hero periods: normal, patch-clipped, insufficient, failure keeps last valid; fixture ' + fixtureSize + ' bytes');
