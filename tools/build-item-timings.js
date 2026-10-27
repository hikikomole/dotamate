#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BINS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700];
function createAccumulator(catalog, since = 0) {
  const items = new Map(), seen = new Set(), matches = new Set();
  let verifiedPlayers = 0;
  function add(m) {
    if (!m || seen.has(String(m.id)) || m.pro || m.mode !== 22 || m.lobby !== 7 ||
        !Number.isFinite(m.end) || !Number.isFinite(m.dur) || m.dur < 900 ||
        m.end - m.dur < since || !Array.isArray(m.p) || m.p.length !== 10) return;
    seen.add(String(m.id));
    for (const p of m.p) {
      if (!Array.isArray(p) || p[11] !== true || !Array.isArray(p[10])) continue;
      if (!p[10].every(e => Array.isArray(e) && Number.isFinite(e[0]) && e[0] <= m.dur &&
          typeof e[1] === 'string' && catalog[e[1]])) continue;
      verifiedPlayers++; matches.add(String(m.id));
      const first = new Map();
      for (const [t, key] of p[10]) if (!first.has(key)) first.set(key, t);
      for (const [key, t] of first) {
        const a = items.get(key) || [];
        a.push(t); items.set(key, a);
      }
    }
  }
  function finish() {
  const result = {};
  for (const [key, times] of items) {
    if (times.length < 30) continue;
    times.sort((a, b) => a - b);
    const hist = Array(BINS.length + 1).fill(0);
    for (const t of times) hist[BINS.findIndex(b => t < b) < 0 ? BINS.length : BINS.findIndex(b => t < b)]++;
    const q = f => times[Math.floor(f * times.length)];
    result[key] = { n: times.length, t: [q(.25), q(.5), q(.75)], hist };
  }
  return { schemaVersion: 1, status: verifiedPlayers ? 'ok' : 'insufficient',
    meta: { source: 'Valve replay purchase events', matches: matches.size, verifiedPlayers, minBuyers: 30 },
    bins: BINS, items: result };
  }
  return { add, finish };
}
function aggregate(rows, catalog, since = 0) {
  const acc = createAccumulator(catalog, since);
  for (const row of rows) acc.add(row);
  return acc.finish();
}
async function main() {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.join(__dirname, '..');
  const fixture = args.includes('--fixture');
  const input = fixture ? opt('--input-dir') || path.join(__dirname, 'fixtures', 'item-timings') : opt('--archive-dir');
  const out = opt('--out-dir');
  if (!input || !out) throw new Error('Provide --out-dir and --archive-dir, or --fixture');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'items-ru.json'))).items;
  const since = fixture ? 0 : Number(JSON.parse(fs.readFileSync(path.join(root, 'data', 'patch-notes.json'))).timestamp);
  const acc = createAccumulator(catalog, since);
  const stream = readline.createInterface({ input: fs.createReadStream(path.join(input, 'purchases.jsonl')), crlfDelay: Infinity });
  for await (const line of stream) { try { acc.add(JSON.parse(line.replace(/^\uFEFF/, ''))); } catch { /* incomplete final line */ } }
  const data = acc.finish();
  data.builtAt = new Date().toISOString();
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(out, 'item-timings.json'), temp = target + '.part';
  fs.writeFileSync(temp, JSON.stringify(data));
  fs.renameSync(temp, target);
  console.log(`item-timings: ${data.meta.matches} verified matches`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { aggregate, BINS };
