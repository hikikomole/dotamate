'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cp = require('child_process');
const assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-'));
const input = path.join(dir, 'in'), out = path.join(dir, 'out'), patch = path.join(dir, 'patch.json'), catalog = path.join(dir, 'catalog.json');
fs.mkdirSync(input); fs.mkdirSync(out);
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const start = Math.floor(Date.parse(day + 'T12:00:00Z') / 1000);
fs.writeFileSync(patch, JSON.stringify({ version: 'test', timestamp: start - 86400 }));
fs.writeFileSync(catalog, JSON.stringify({ patches: [{ version: 'test', timestamp: start - 100 }] }));
const file = path.join(input, day + '.jsonl.gz');
const run = () => cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools/build-performance-percentiles.js'),
  '--input-dir', input, '--out-dir', out, '--patch-file', patch, '--catalog-file', catalog], { encoding: 'utf8' });
const output = path.join(out, 'performance-percentiles.json');
function row(id) {
  return [id, 1, start, 1800, null, 1, 22, 7, [], ...Array.from({ length: 10 }, (_, i) =>
    [i + 1, i < 5 ? i : i + 123, i === 0 ? (id % 2 ? 0 : 1) : 1, 2, 3, 4, 0, 500, 600, 0, 0, 900, 0, 0,
      [], [], 0, 0, 0, 0, 0, 0, []])];
}
const rows = Array.from({ length: 500 }, (_, i) => row(i + 1));
// Hero 1 has one observation per match; all seven values must use scorer units.
for (const sample of rows) {
  const p = sample[9];
  p[2] = 30; p[3] = 60; p[4] = 90; p[5] = 120;
  p[7] = 70000; p[8] = 80000; p[11] = 180000; // 6000 damage/min; GPM/XPM exceed the dense histogram.
}
rows[0][10][5] = null; // Missing last hits must not become zero.
rows[1][10][21] = 2;
const short = row(501); short[3] = 899;
const duplicate = row(1);
fs.writeFileSync(file, zlib.gzipSync([...rows, short, duplicate].map(x => JSON.stringify(x)).join('\n') + '\n'));
assert.strictEqual(run().status, 0);
const result = JSON.parse(fs.readFileSync(output));
assert.strictEqual(result.totals.matches, 500);
assert.strictEqual(result.patchFrom, start - 100);
assert.strictEqual(result.exclusions.short, 1);
assert.strictEqual(result.exclusions.duplicateId, 1);
assert.strictEqual(result.exclusions.leaverPlayers, 1);
assert.strictEqual(result.heroes['2'].metrics.lh.n, 498);
assert.strictEqual(result.heroes['1'].metrics.k.n, 500);
assert.strictEqual(result.methodVersion, '2');
for (const [key, expected] of Object.entries({ k: 1, d: 2, a: 3, lh: 4, gpm: 70000, xpm: 80000, hd: 6000 })) {
  const metric = result.heroes['1'].metrics[key];
  assert.strictEqual(metric.n, 500, key);
  assert.deepStrictEqual(metric.breakpoints, Array(21).fill(expected), key);
}
assert.strictEqual(result.heroes['1'].metrics.k.breakpoints.length, 21);
assert.strictEqual(result.heroes['1'].metrics.k.breakpoints[0], 1);
assert.strictEqual(result.heroes['1'].metrics.k.breakpoints[20], 1);
assert(result.heroes['1'].metrics.k.breakpoints.every(v => Number.isInteger(Math.round(v * 100))));
assert(result.heroes['1'].metrics.k.breakpoints.every((v, i, a) => i === 0 || v >= a[i - 1]));
assert.strictEqual(result.heroes['2'].insufficient, true);
assert.strictEqual(result.heroes['2'].metrics.k.breakpoints, undefined);
const bytes = fs.statSync(output).size;
const estimate = Math.round(bytes / 10 * 127);
const before = fs.readFileSync(output);
fs.writeFileSync(file, Buffer.from('bad gzip'));
assert.notStrictEqual(run().status, 0);
assert(before.equals(fs.readFileSync(output)));
console.log(`performance percentiles: ok; fixture ${bytes} bytes; 127 heroes estimate ${estimate} bytes`);
