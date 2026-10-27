#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function createAccumulator(catalog) {
  const acc = new Map(), seen = new Set();
  let verifiedMatches = 0, verifiedPlayers = 0, tied = 0;
  function add(m) {
    if (!m || seen.has(String(m.id)) || m.pro || m.mode !== 22 || m.lobby !== 7 ||
        !Number.isFinite(m.dur) || m.dur < 900 || !Array.isArray(m.p) || m.p.length !== 10) return;
    seen.add(String(m.id));
    let used = false;
    for (const p of m.p) {
      if (!Array.isArray(p) || p[11] !== true || !Array.isArray(p[10]) ||
          !p[10].every(e => Array.isArray(e) && Number.isFinite(e[0]) && e[0] <= m.dur && catalog[e[1]])) continue;
      used = true; verifiedPlayers++;
      const seq = p[10].map(([t, key], i) => ({ t, key, i }))
        .filter(e => { const item = catalog[e.key]; return item.cat === 'item' && !e.key.startsWith('recipe_'); })
        .sort((a, b) => a.t - b.t || a.i - b.i);
      const first = seq[0];
      if (!first) continue;
      const entry = acc.get(first.key) || { buyers: 0, eligibleSequences: 0, next: new Map() };
      acc.set(first.key, entry); entry.buyers++;
      const next = seq.find(e => e.key !== first.key);
      if (!next) continue;
      if (next.t === first.t) { tied++; continue; }
      entry.eligibleSequences++;
      const delays = entry.next.get(next.key) || [];
      delays.push(next.t - first.t); entry.next.set(next.key, delays);
    }
    if (used) verifiedMatches++;
  }
  function finish() {
  const items = {};
  for (const [key, a] of acc) {
    items[key] = { buyers: a.buyers, eligibleSequences: a.eligibleSequences,
      next: [...a.next].map(([k, delays]) => {
        delays.sort((x, y) => x - y);
        return { key: k, n: delays.length, share: Math.round(1000 * delays.length / a.eligibleSequences) / 10,
          medianDelay: delays[Math.floor(delays.length / 2)] };
      }).filter(x => x.n >= 30 && a.eligibleSequences >= 100).sort((x, y) => y.n - x.n || x.key.localeCompare(y.key)) };
  }
  return { schemaVersion: 1, status: verifiedMatches ? 'ok' : 'insufficient',
    meta: { source: 'Valve replay purchase events', verifiedMatches, verifiedPlayers, excludedTies: tied,
      minSourceSequences: 100, minPair: 30 }, items };
  }
  return { add, finish };
}
function aggregate(rows, catalog) {
  const acc = createAccumulator(catalog);
  for (const row of rows) acc.add(row);
  return acc.finish();
}
async function main() {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.join(__dirname, '..'), fixture = args.includes('--fixture');
  const input = fixture ? opt('--input-dir') || path.join(__dirname, 'fixtures', 'item-timings') : opt('--archive-dir');
  const out = opt('--out-dir');
  if (!input || !out) throw new Error('Provide --out-dir and --archive-dir, or --fixture');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'items-ru.json'))).items;
  const acc = createAccumulator(catalog);
  const stream = readline.createInterface({ input: fs.createReadStream(path.join(input, 'purchases.jsonl')), crlfDelay: Infinity });
  for await (const line of stream) { try { acc.add(JSON.parse(line.replace(/^\uFEFF/, ''))); } catch {} }
  const data = acc.finish();
  data.builtAt = new Date().toISOString();
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(out, 'item-followups.json'), temp = target + '.part';
  fs.writeFileSync(temp, JSON.stringify(data)); fs.renameSync(temp, target);
  console.log(`item-followups: ${data.meta.verifiedMatches} verified matches`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { aggregate };
