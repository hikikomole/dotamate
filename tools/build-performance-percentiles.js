#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { writeJsonAtomic } = require('./match-source');
const { createRowFilter, newCoverage, count, currentPatch, SOURCE, COHORT } = require('./stats-cohort');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing ' + name);
  return path.resolve(args[i + 1]);
}
const input = option('--input-dir', path.join(root, 'data', 'steam-matches'));
const output = option('--out-dir', path.join(root, 'data'));
const patchData = JSON.parse(fs.readFileSync(option('--patch-file', path.join(root, 'data', 'patch-notes.json')), 'utf8'));
const patch = currentPatch(JSON.parse(fs.readFileSync(option('--catalog-file', path.join(root, 'data', 'patch-catalog.json')), 'utf8')), patchData.version);
const known = new Set(JSON.parse(fs.readFileSync(path.join(root, 'data', 'heroes.json'), 'utf8')).heroes.map(h => Number(h.id)));
if (!known.size) throw new Error('No known heroes');
const specs = { k: [2, 100, true], d: [3, 100, true], a: [4, 100, true], lh: [5, 10, true], gpm: [7, 1, false], xpm: [8, 1, false], hd: [11, 1, true] };
const weights = { k: 15, d: 20, a: 15, lh: 10, gpm: 10, xpm: 10, hd: 20 };
const BINS = 65536; // Bounded at 7 metrics x 65536 bins per hero.
const filter = createRowFilter({ known, patchFrom: patch.timestamp });
const coverage = newCoverage(), heroes = new Map();
let from = Infinity, to = -Infinity, players = 0, leavers = 0, missing = 0, overflow = 0;
function histogram(id, key) {
  let hero = heroes.get(id);
  if (!hero) { hero = { n: 0, metrics: {} }; heroes.set(id, hero); }
  if (!hero.metrics[key]) hero.metrics[key] = { n: 0, bins: new Uint32Array(BINS), overflowBins: new Map() };
  return hero.metrics[key];
}
function breakpoints(metric, scale) {
  const points = [], values = [];
  let below = 0;
  for (let bin = 0; bin < BINS; bin++) {
    const c = metric.bins[bin];
    if (c) { values.push([bin / scale, (below + c / 2) / metric.n * 100]); below += c; }
  }
  for (const [bin, c] of [...metric.overflowBins].sort((a, b) => a[0] - b[0])) {
    values.push([bin / scale, (below + c / 2) / metric.n * 100]); below += c;
  }
  let j = 0;
  for (let p = 0; p <= 100; p += 5) {
    while (j + 1 < values.length && values[j + 1][1] < p) j++;
    const left = values[j], right = values[Math.min(j + 1, values.length - 1)];
    const v = p <= left[1] || left === right ? left[0] :
      left[0] + (right[0] - left[0]) * Math.min(1, (p - left[1]) / (right[1] - left[1]));
    points.push(Math.round(v * scale) / scale);
  }
  return points;
}
async function read(file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line), reason = filter(row);
      count(coverage, reason);
      if (reason) continue;
      from = Math.min(from, row[2]); to = Math.max(to, row[2]);
      for (const player of row.slice(9, 19)) {
        if (!Number.isInteger(player[21]) || player[21] > 1 || player[21] < 0) { leavers++; continue; }
        players++;
        let hero = heroes.get(player[0]);
        if (!hero) { hero = { n: 0, metrics: {} }; heroes.set(player[0], hero); }
        hero.n++;
        for (const [key, [index, scale, perMinute]] of Object.entries(specs)) {
          const raw = player[index];
          if (!Number.isSafeInteger(raw) || raw < 0) { missing++; continue; }
          const value = perMinute ? raw * 60 / row[3] : raw;
          const bin = Math.round(value * scale);
          if (!Number.isSafeInteger(bin)) { overflow++; continue; }
          const h = histogram(player[0], key);
          h.n++;
          if (bin < BINS) h.bins[bin]++;
          else h.overflowBins.set(bin, (h.overflowBins.get(bin) || 0) + 1);
        }
      }
    }
  } finally { lines.close(); }
}
(async () => {
  if (!fs.existsSync(input)) throw new Error('Missing Steam archive');
  for (const name of fs.readdirSync(input).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl\.gz$/.test(n) &&
      n.slice(0, 10) >= new Date(patch.timestamp * 1000).toISOString().slice(0, 10)).sort())
    await read(path.join(input, name));
  if (!coverage.accepted || !players) throw new Error('No eligible observations; keeping previous output');
  const result = { schemaVersion: 1, methodVersion: '2', weights, patch: patch.version,
    patchFrom: patch.timestamp, source: SOURCE, cohort: COHORT, builtAt: new Date().toISOString(),
    from, to, totals: { matches: coverage.accepted, players, heroes: heroes.size, missingMetrics: missing, overflowMetrics: overflow },
    exclusions: { ...coverage.excluded, leaverPlayers: leavers }, heroes: {} };
  for (const [id, hero] of [...heroes].sort((a, b) => a[0] - b[0])) {
    const metrics = {};
    for (const [key, [, scale]] of Object.entries(specs)) {
      const h = hero.metrics[key];
      metrics[key] = { n: h?.n || 0, insufficient: !h || h.n < 500 };
      if (h?.n >= 500) metrics[key].breakpoints = breakpoints(h, scale);
    }
    result.heroes[id] = { n: hero.n, insufficient: hero.n < 500, metrics };
  }
  fs.mkdirSync(output, { recursive: true });
  writeJsonAtomic(path.join(output, 'performance-percentiles.json'), JSON.stringify(result) + '\n');
  console.log('performance-percentiles.json: ' + coverage.accepted + ' matches');
})().catch(error => { console.error(error); process.exitCode = 1; });
